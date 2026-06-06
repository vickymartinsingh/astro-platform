// Multi-provider Kundli API for the AstroSeer apps.
//
// The admin picks the provider + pastes its key in the admin portal
// (settings/kundliApi). This relay reads that config from Firestore and
// routes to the matching adapter, so switching providers needs NO code
// change or redeploy - just save the key in the admin portal.
//
// Fully wired adapters: prokerala, astrologyapi, vedicastroapi,
// freeastrologyapi. Prokerala also falls back to the relay env vars
// (PROKERALA_CLIENT_ID / PROKERALA_CLIENT_SECRET) if no key is stored.
const admin = require('firebase-admin');

function initAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return false;
  try {
    const sa = JSON.parse(raw);
    // ALSO set storageBucket here - the lazy require of
    // lib/kundliReport.js below uploads PDFs to Firebase Storage
    // and admin.storage().bucket() throws "Bucket name not
    // specified" if no bucket was given at init. Initialising once
    // with the right bucket name means whichever code path runs
    // first wins, and the report path no longer fails with
    // "Could not save the PDF" on Vercel cold starts.
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        || `${sa.project_id}.firebasestorage.app`,
    });
    return true;
  } catch (_) { return false; }
}

// ===== Chat inactivity sweeper ========================================
// Idle threshold (ms). When a customer has not posted any chat activity
// for this long during a chat session, we force-end the session and
// instant-refund the inactive minutes.
const CHAT_IDLE_MS = 3 * 60 * 1000 + 1000;

// Scan every active chat session and end any whose lastCustomerActivityAt
// is older than CHAT_IDLE_MS. Called by the warm-keeper ping every 10
// minutes so a customer who closes the app mid-session never sits in an
// active billing state forever. Returns the count of sessions swept.
async function sweepIdleChats(db) {
  let n = 0;
  try {
    const cutoff = Date.now() - CHAT_IDLE_MS;
    const snap = await db.collection('sessions')
      .where('status', '==', 'active')
      .where('type', '==', 'chat')
      .limit(50)
      .get();
    for (const d of snap.docs) {
      try {
        const s = d.data() || {};
        const la = s.lastCustomerActivityAt;
        const ms = la && la.toMillis ? la.toMillis()
          : la && la.seconds ? la.seconds * 1000
          : (s.createdAt && s.createdAt.toMillis
            ? s.createdAt.toMillis() : 0);
        if (!ms || ms < cutoff) {
          // eslint-disable-next-line no-await-in-loop
          await endChatForInactivity(db, d.id);
          n += 1;
        }
      } catch (_) { /* keep sweeping */ }
    }
  } catch (_) { /* no-op */ }
  return n;
}

// Atomic end-and-refund for one chat session. Idempotent: a session
// already finalised returns { skipped: 'not_active' }.
async function endChatForInactivity(db, sessionId) {
  const sRef = db.collection('sessions').doc(sessionId);
  const out = await db.runTransaction(async (t) => {
    const ss = await t.get(sRef);
    if (!ss.exists) throw new Error('Session not found');
    const s = ss.data() || {};
    if (s.status !== 'active') {
      return { skipped: 'not_active', status: s.status };
    }
    if (s.type && s.type !== 'chat') {
      return { skipped: 'not_chat', type: s.type };
    }
    const la = s.lastCustomerActivityAt;
    const lastMs = la && la.toMillis ? la.toMillis()
      : la && la.seconds ? la.seconds * 1000 : 0;
    const startMs = s.startedAt && s.startedAt.toMillis
      ? s.startedAt.toMillis()
      : s.createdAt && s.createdAt.toMillis
        ? s.createdAt.toMillis() : Date.now();
    const now = Date.now();
    // Anchor the active window to the LAST customer activity if we
    // have one - if not, treat the whole elapsed time as billed
    // (no refund) since we have nothing to prove idleness with.
    const effectiveEnd = lastMs > 0 ? lastMs : now;
    const billedSec = Math.max(0,
      Math.floor((effectiveEnd - startMs) / 1000));
    const idleSec = Math.max(0,
      Math.floor((now - effectiveEnd) / 1000));
    const ratePerMin = Number(s.ratePerMin || s.rate || 0);
    // Refund cap: 3 minutes' worth so even if the cron is late, we
    // never over-credit. Customer can dispute longer idles manually.
    const refundMin = Math.min(3, Math.floor(idleSec / 60));
    const refundAmt = Math.max(0,
      Math.round(refundMin * ratePerMin));
    // Update session.
    t.update(sRef, {
      status: 'ended',
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
      endReason: 'no_activity',
      idleSec,
      billedSec,
      noActivityRefund: refundAmt,
      duration: billedSec,
    });
    if (refundAmt > 0 && s.userId) {
      const uRef = db.collection('users').doc(s.userId);
      const u = await t.get(uRef);
      const w = Number((u.data() || {}).wallet || 0) + refundAmt;
      t.update(uRef, { wallet: w });
      // Same sessionId as referenceId so the customer can match the
      // refund row to the session it came from in their statement.
      t.set(db.collection('transactions').doc(), {
        userId: s.userId,
        amount: refundAmt,
        type: 'credit',
        reason: 'No activity refund',
        referenceId: sessionId,
        sessionId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.set(db.collection('users').doc(s.userId)
        .collection('walletAudit').doc(), {
        before: w - refundAmt,
        delta: refundAmt,
        after: w,
        reason: 'No activity refund',
        source: 'endChatForInactivity',
        sessionId,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return {
      ok: true, ended: true,
      billedSec, idleSec, refundAmt, refundMin,
    };
  });
  // Notify the customer once - in-app + push. Best-effort.
  try {
    if (out && out.ended) {
      const ss = await sRef.get();
      const s = ss.data() || {};
      if (s.userId) {
        await db.collection('notifications').add({
          userId: s.userId,
          type: 'chat_ended_inactivity',
          title: 'Chat ended (no activity)',
          message: 'Your chat ended after 3 minutes of inactivity. '
            + (out.refundAmt > 0
              ? `Rs ${out.refundAmt} (${out.refundMin} min) refunded.`
              : 'No refund was due.'),
          sessionId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const u = await db.collection('users').doc(s.userId).get();
        const ud = u.exists ? (u.data() || {}) : {};
        const toks = []
          .concat(Array.isArray(ud.fcmTokens) ? ud.fcmTokens : [])
          .concat(ud.fcmToken ? [ud.fcmToken] : [])
          .filter(Boolean);
        if (toks.length) {
          await admin.messaging().sendEachForMulticast({
            tokens: [...new Set(toks)],
            notification: {
              title: 'Chat ended (no activity)',
              body: out.refundAmt > 0
                ? `Rs ${out.refundAmt} refunded for the idle period.`
                : 'Chat closed after 3 mins of inactivity.',
            },
            data: { type: 'chat_ended', route: '/transactions',
              sessionId },
            android: {
              priority: 'high',
              notification: {
                channelId: 'astro-default', sound: 'default' },
            },
          });
        }
      }
    }
  } catch (_) { /* notify is best-effort */ }
  return out;
}

// Pick the best fallback provider when we can't read settings from
// Firestore. AstroSeer needs nothing more than its env-var base URL
// to function, so it's the safest default whenever
// ASTROSEER_API_URL is present (which it is on this relay). The old
// fallback was Prokerala, which throws if creds aren't set.
// ===== Recording backend helpers =====================================
//
// Storage destinations for call / video / live recordings (NOT the
// kundli PDFs - those have their own R2 helper inside lib/kundliReport).
//
// Google Drive is preferred when configured (user has 1 TB on their
// personal account). Service account uploads land in a shared folder;
// quota counts against the FOLDER OWNER's account, i.e. the user, not
// the service account.
//
// Required Vercel env vars for Drive:
//   DRIVE_FOLDER_ID    - Drive folder ID (from the share URL)
//   FIREBASE_SERVICE_ACCOUNT - same JSON the rest of the relay uses;
//                              we just add the Drive scope below
// User MUST share the target folder with the service account email
// (find it in the JSON's client_email field) and give Editor access.
async function _uploadToDrive(fileName, contentType, buf, folderId) {
  const { google } = require('googleapis');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });
  const { Readable } = require('stream');
  // 1. Upload the file into the shared folder.
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType: contentType, body: Readable.from(buf) },
    fields: 'id, webContentLink, webViewLink',
  });
  const fileId = created.data.id;
  // 2. Make it publicly readable so the customer + admin can stream
  //    without authenticating. Drive returns webContentLink for direct
  //    download. The "anyone with the link" permission is fine for
  //    audio recordings - they are session-scoped + uuid-keyed so they
  //    can't be enumerated.
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (_) { /* if perm already exists, ignore */ }
  // 3. Prefer the direct-download URL; fall back to view link.
  return (created.data.webContentLink
    || `https://drive.google.com/uc?id=${fileId}&export=download`);
}

async function _uploadToR2(key, contentType, buf) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.`
      + 'r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buf,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  const publicBase = process.env.R2_PUBLIC_URL
    || `https://${process.env.R2_BUCKET}.r2.dev`;
  return `${publicBase.replace(/\/+$/, '')}/${key}`;
}

// ===== End recording backends ========================================

function envFallbackProvider() {
  if (process.env.ASTROSEER_API_URL || process.env.ASTROSEER_API_KEY) {
    return 'astroseer';
  }
  if (process.env.PROKERALA_CLIENT_ID
      && process.env.PROKERALA_CLIENT_SECRET) {
    return 'prokerala';
  }
  return 'astroseer'; // last-resort - has a built-in default URL too
}

async function readProviderConfig() {
  const adminOk = initAdmin();
  const fallbackProvider = envFallbackProvider();
  if (!adminOk) {
    return { provider: fallbackProvider, creds: {},
      adminInit: false,
      providerNote: 'FIREBASE_SERVICE_ACCOUNT env var not set on the '
        + `relay - using ${fallbackProvider} env credentials.` };
  }
  try {
    const s = await admin.firestore()
      .collection('settings').doc('kundliApi').get();
    const d = s.exists ? (s.data() || {}) : {};
    const provider = d.provider || fallbackProvider;
    const creds = d[provider] || {};
    const note = (!creds.key && !creds.secret
      && provider !== 'prokerala' && provider !== 'astroseer')
      ? `Provider ${provider} is selected but has no key saved in `
        + 'settings/kundliApi.' + provider + '.key - cannot use it.'
      : '';
    return { provider, creds, adminInit: true, providerNote: note };
  } catch (e) {
    // Firestore at quota / unreachable. AstroSeer (or whatever the
    // env-var fallback is) keeps working without Firestore creds.
    return { provider: fallbackProvider, creds: {},
      adminInit: true,
      providerNote: `Firestore read failed (${(e && e.message)
        || e}); using ${fallbackProvider} env credentials as `
        + 'fallback so chart still loads.' };
  }
}

async function geocode(place) {
  try {
    const q = encodeURIComponent(String(place || '').split(',')[0].trim());
    const r = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${q}`
      + '&count=1&language=en&format=json');
    const j = await r.json();
    const hit = j && j.results && j.results[0];
    if (hit) return { lat: hit.latitude, lng: hit.longitude };
  } catch (_) { /* ignore */ }
  return null;
}

function parseDob(dob, tob, ampm) {
  const parts = String(dob || '').trim().split(/[-/]/).map(
    (n) => parseInt(n, 10));
  let d; let m; let y;
  if (parts[0] > 31) { [y, m, d] = parts; } else { [d, m, y] = parts; }
  let [hh, mm] = String(tob || '12:00').split(':').map(
    (n) => parseInt(n, 10));
  if (Number.isNaN(hh)) hh = 12;
  if (Number.isNaN(mm)) mm = 0;
  const ap = String(ampm || '').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return { d, m, y, hh, mm };
}
function toIso(p, tz) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:00`
    + `${tz || '+05:30'}`;
}

// Stamp `current: true` on whichever maha / antar / pratyantar
// period the user is sitting in right now. Used by the legacy
// Prokerala / AstrologyAPI adapters (which call with a flat list)
// AND by the AstroSeer adapter (which calls with the deep tree).
function markDasha(list) {
  const now = Date.now();
  const dasha = (list || []).map((x) => {
    const s = x.start ? Date.parse(x.start) : 0;
    const e = x.end ? Date.parse(x.end) : 0;
    const antar = Array.isArray(x.antardasha) ? x.antardasha.map((a) => {
      const as = a.start ? Date.parse(a.start) : 0;
      const ae = a.end ? Date.parse(a.end) : 0;
      const praty = Array.isArray(a.pratyantardasha)
        ? a.pratyantardasha.map((p) => {
          const ps = p.start ? Date.parse(p.start) : 0;
          const pe = p.end ? Date.parse(p.end) : 0;
          return {
            planet: p.planet, start: p.start, end: p.end,
            current: ps && pe && now >= ps && now < pe,
          };
        }) : [];
      return {
        planet: a.planet, start: a.start, end: a.end,
        current: as && ae && now >= as && now < ae,
        pratyantardasha: praty,
      };
    }) : [];
    return {
      planet: x.planet, start: x.start, end: x.end,
      current: s && e && now >= s && now < e,
      antardasha: antar,
    };
  });
  // The legacy callers (prokerala, astrologyapi, vedicastroapi,
  // freeastrologyapi) destructure { dasha, currentDasha }. Keep
  // that shape, AND attach the array itself as `dasha` so the
  // AstroSeer adapter can `markDasha(tree).dasha` to get just the
  // array without the wrapper.
  return { dasha, currentDasha: dasha.find((d) => d.current) || null };
}

// ---------- Prokerala ----------
let pkToken = null;
async function prokeralaToken(creds) {
  if (pkToken && pkToken.exp > Date.now() + 60000) return pkToken.token;
  const id = creds.key || process.env.PROKERALA_CLIENT_ID;
  const secret = creds.secret || process.env.PROKERALA_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Prokerala credentials not set');
  const r = await fetch('https://api.prokerala.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id, client_secret: secret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    throw new Error('Prokerala auth failed: ' + JSON.stringify(j)
      .slice(0, 160));
  }
  pkToken = { token: j.access_token,
    exp: Date.now() + (Number(j.expires_in || 3000) * 1000) };
  return pkToken.token;
}
async function runProkerala(creds, lat, lng, datetime) {
  const token = await prokeralaToken(creds);
  const base = 'https://api.prokerala.com/v2/astrology';
  const qs = `?ayanamsa=1&coordinates=${lat},${lng}`
    + `&datetime=${encodeURIComponent(datetime)}`;
  const get = async (path, extra = '') => {
    try {
      const rr = await fetch(`${base}/${path}${qs}${extra}`, {
        headers: { Authorization: `Bearer ${token}` } });
      const jj = await rr.json();
      if (jj.status === 'error' || jj.errors) return null;
      return jj.data || null;
    } catch (_) { return null; }
  };
  const getSvg = async (ct) => {
    try {
      const rr = await fetch(`${base}/chart${qs}`
        + `&chart_type=${ct}&chart_style=north-indian&la=en`, {
        headers: { Authorization: `Bearer ${token}`,
          Accept: 'image/svg+xml' } });
      const t = await rr.text();
      return t && t.indexOf('<svg') !== -1 ? t : null;
    } catch (_) { return null; }
  };
  const [bd, pp, dp, svgR, svgN] = await Promise.all([
    get('birth-details'),
    get('planet-position', '&planet_position_format=detailed'),
    get('dasha-periods'), getSvg('rasi'), getSvg('navamsa')]);
  if (!bd) throw new Error('Prokerala returned no birth details');
  const rawP = (pp && (pp.planet_position || pp.planets)) || [];
  const planets = rawP.map((p) => ({
    name: p.name, sign: p.rasi && p.rasi.name,
    house: p.position || p.house,
    degree: typeof p.degree === 'number'
      ? Math.round(p.degree * 100) / 100 : p.degree,
    retrograde: !!p.is_retrograde }));
  const ascP = rawP.find((p) => /ascend|lagna/i.test(p.name || ''));
  const { dasha, currentDasha } = markDasha(
    (dp && (dp.dasha_periods || dp.periods) || []).map((x) => ({
      planet: x.name, start: x.start, end: x.end,
      antardasha: (x.antardasha || []).map((a) => ({
        planet: a.name, start: a.start, end: a.end })) })));
  return {
    ascendant: ascP ? { sign: ascP.rasi && ascP.rasi.name,
      degree: ascP.degree } : null,
    nakshatra: bd.nakshatra && bd.nakshatra.name,
    nakshatra_pada: bd.nakshatra && bd.nakshatra.pada,
    chandra_rasi: bd.chandra_rasi && bd.chandra_rasi.name,
    soorya_rasi: bd.soorya_rasi && bd.soorya_rasi.name,
    zodiac: bd.zodiac && bd.zodiac.name,
    additional_info: bd.additional_info || null,
    planets, dasha, currentDasha,
    charts: { rasi: svgR || null, navamsa: svgN || null },
  };
}

// ---------- AstrologyAPI.com ----------
async function runAstrologyApi(creds, p, lat, lng) {
  const userId = creds.key; const apiKey = creds.secret;
  if (!userId || !apiKey) throw new Error('AstrologyAPI creds not set');
  const auth = 'Basic ' + Buffer.from(`${userId}:${apiKey}`)
    .toString('base64');
  const body = { day: p.d, month: p.m, year: p.y, hour: p.hh,
    min: p.mm, lat, lon: lng, tzone: 5.5 };
  const call = async (ep) => {
    try {
      const rr = await fetch(`https://json.astrologyapi.com/v1/${ep}`, {
        method: 'POST',
        headers: { Authorization: auth,
          'Content-Type': 'application/json' },
        body: JSON.stringify(body) });
      return await rr.json();
    } catch (_) { return null; }
  };
  const [bd, pl, vd] = await Promise.all([
    call('birth_details'), call('planets'), call('major_vdasha')]);
  const planets = Array.isArray(pl) ? pl.map((x) => ({
    name: x.name, sign: x.sign, house: x.house,
    degree: typeof x.normDegree === 'number'
      ? Math.round(x.normDegree * 100) / 100 : x.normDegree,
    retrograde: !!x.isRetro && x.isRetro !== 'false' })) : [];
  const ascP = planets.find((x) => /ascend/i.test(x.name || ''));
  const { dasha, currentDasha } = markDasha(
    (Array.isArray(vd) ? vd : []).map((x) => ({
      planet: x.dasha || x.planet, start: x.start_date,
      end: x.end_date })));
  return {
    ascendant: ascP ? { sign: ascP.sign } : (bd && bd.ascendant
      ? { sign: bd.ascendant } : null),
    nakshatra: bd && bd.nakshatra,
    chandra_rasi: bd && bd.moon_sign,
    soorya_rasi: bd && bd.sun_sign,
    zodiac: bd && (bd.sign || bd.ascendant),
    additional_info: bd || null,
    planets, dasha, currentDasha,
    charts: { rasi: null, navamsa: null },
  };
}

// ---------- VedicAstroAPI.com ----------
async function runVedicAstroApi(creds, p, lat, lng) {
  const key = creds.key;
  if (!key) throw new Error('VedicAstroAPI key not set');
  const base = 'https://api.vedicastroapi.com/v3-json';
  const q = `?dob=${p.d}/${p.m}/${p.y}&tob=${p.hh}:${p.mm}`
    + `&lat=${lat}&lon=${lng}&tz=5.5&api_key=${key}&lang=en`;
  const call = async (ep) => {
    try {
      const rr = await fetch(`${base}/${ep}${q}`);
      const j = await rr.json();
      return j && j.response ? j.response : null;
    } catch (_) { return null; }
  };
  const [pd, md] = await Promise.all([
    call('horoscope/planet-details'),
    call('dashas/maha-dasha')]);
  const arr = pd ? Object.values(pd).filter(
    (x) => x && x.name) : [];
  const planets = arr.map((x) => ({
    name: x.name, sign: x.zodiac || x.sign, house: x.house,
    degree: x.normDegree || x.degree,
    retrograde: !!x.retro }));
  const asc = arr.find((x) => /ascend/i.test(x.name || ''));
  const { dasha, currentDasha } = markDasha(
    (md && md.dashas ? md.dashas : []).map((x) => ({
      planet: x.planet || x.name, start: x.start, end: x.end })));
  return {
    ascendant: asc ? { sign: asc.zodiac || asc.sign } : null,
    nakshatra: null, chandra_rasi: null, soorya_rasi: null,
    zodiac: asc ? (asc.zodiac || asc.sign) : null,
    additional_info: null, planets, dasha, currentDasha,
    charts: { rasi: null, navamsa: null },
  };
}

// ---------- FreeAstrologyAPI.com ----------
async function runFreeAstrologyApi(creds, p, lat, lng) {
  const key = creds.key;
  if (!key) throw new Error('FreeAstrologyAPI key not set');
  try {
    const rr = await fetch('https://json.freeastrologyapi.com/planets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        year: p.y, month: p.m, date: p.d, hours: p.hh, minutes: p.mm,
        seconds: 0, latitude: lat, longitude: lng, timezone: 5.5,
        settings: { observation_point: 'topocentric',
          ayanamsha: 'lahiri' } }),
    });
    const j = await rr.json();
    const out = (j && (j.output || j.planets)) || [];
    const list = Array.isArray(out) ? out
      : Object.values(out || {});
    const planets = list.filter((x) => x && x.name).map((x) => ({
      name: x.name, sign: x.sign || x.zodiac_sign_name,
      house: x.house, degree: x.normDegree || x.fullDegree,
      retrograde: !!x.isRetro }));
    const asc = planets.find((x) => /ascend/i.test(x.name || ''));
    return {
      ascendant: asc ? { sign: asc.sign } : null,
      nakshatra: null, chandra_rasi: null, soorya_rasi: null,
      zodiac: asc ? asc.sign : null,
      additional_info: null, planets, dasha: [], currentDasha: null,
      charts: { rasi: null, navamsa: null },
    };
  } catch (e) {
    throw new Error('FreeAstrologyAPI failed: '
      + String((e && e.message) || e));
  }
}

// ---- AstroSeer (our own Render-hosted API) ----
// Docs: POST {BASE}/api/kundli with X-API-Key header.
// Body shape: { year, month, day, hour, minute, tz_offset,
//               latitude, longitude }.
// Returns a rich Vedic kundli ({ ascendant, planetary_position,
//   avkahada_chakra, houses, yogas, doshas, panchang, _meta, ...}).
//
// Two ways to configure (env wins, then Firestore creds):
//   1. ASTROSEER_API_URL + ASTROSEER_API_KEY env vars set on the
//      push-relay Vercel project (NOT on astroseer.in - the relay is
//      what makes the call, not the customer app).
//   2. settings/kundliApi.astroseer.{key, baseUrl, tz} in Firestore
//      via /admin-kundli-api so the operator can rotate the key
//      without redeploying.
// IMPORTANT: env vars MUST be on the push-relay project. The user docs
// say "astroseer.in Vercel dashboard" but our architecture funnels all
// provider calls through the relay so the key stays server-side.
async function runAstroSeer(creds, p, lat, lng) {
  // Defensive URL resolution - we've seen ASTROSEER_API_URL get
  // accidentally set to the API KEY value on Vercel (the two env
  // vars are easy to swap). Validate that whatever we pull is
  // actually an http(s) URL; otherwise fall back to the next
  // candidate so a config mistake on one env var doesn't break
  // the whole kundli endpoint.
  //
  // Precedence (each validated as a URL):
  //   1. explicit Firestore creds.baseUrl
  //   2. creds.secret if it looks like a URL (admin form's
  //      positional 2nd field, doubling as base-URL override)
  //   3. ASTROSEER_API_URL env var on the relay
  //   4. Render default
  const candidates = [
    creds && creds.baseUrl,
    creds && creds.secret,
    process.env.ASTROSEER_API_URL,
    'https://astroseer-api.onrender.com',
  ];
  const base = candidates.find(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    || 'https://astroseer-api.onrender.com';

  // Same defensive treatment for the key - accept either env var,
  // ignore values that don't look like an AstroSeer key. The API
  // currently accepts unauthenticated calls so an empty key still
  // works; we send the header only when we have something.
  function looksLikeKey(s) {
    return typeof s === 'string' && /^as_(live|test)_/i.test(s);
  }
  const keyCandidates = [
    creds && creds.key,
    process.env.ASTROSEER_API_KEY,
    // Defensive: if URL got set to the key by mistake, salvage it.
    process.env.ASTROSEER_API_URL,
  ];
  const key = keyCandidates.find(looksLikeKey) || '';
  // tz_offset: India default 5.5; admin can override via creds.tz.
  const tz = Number(creds && creds.tz);
  const tzOffset = Number.isFinite(tz) ? tz : 5.5;
  const body = {
    year: p.y,
    month: p.m,
    day: p.d,
    hour: p.hh,   // already 24-hour after AM/PM normalisation
    minute: p.mm,
    tz_offset: tzOffset,
    latitude: lat,
    longitude: lng,
  };
  // Auto-recover from a stale / rotated key. AstroSeer accepts
  // unauthenticated requests in their current public-API mode but
  // 401s when a header IS sent and the key is invalid. So: try
  // WITH the key first; on 401, retry WITHOUT the key. End-users
  // never see the rotation; the operator gets a heads-up via
  // /api/kundli?probe=1 to update the key when they have time.
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;
  const headersNoAuth = { 'Content-Type': 'application/json' };
  const baseUrl = base.replace(/\/+$/, '');
  async function postWithFallback(path) {
    const r = await fetch(`${baseUrl}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    if (r.status !== 401 || !key) return r;
    // Stale key path: same call again without the X-API-Key header.
    return fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: headersNoAuth, body: JSON.stringify(body),
    });
  }
  const post = (path) => postWithFallback(path).catch((e) => ({
    ok: false, _err: e,
  }));
  // Fan out the kundli + dasha calls in parallel so the user gets
  // EVERY chart section (lagna, planets, dasha tree) from a single
  // /api/kundli request to our relay. Dasha is fetched as a separate
  // AstroSeer endpoint (/api/dasha is the full Vimshottari tree;
  // /api/dasha/current resolves the running maha/antar/pratyantar)
  // because their /api/kundli omits dasha by default. We swallow
  // dasha failures so a kundli still renders if dasha is down.
  const [kRes, dRes, dCurRes] = await Promise.all([
    post('/api/kundli'),
    post('/api/dasha').catch((e) => ({ ok: false, _err: e })),
    post('/api/dasha/current').catch((e) => ({ ok: false, _err: e })),
  ]);
  if (!kRes.ok) {
    const t = await kRes.text().catch(() => '');
    throw new Error(`AstroSeer ${kRes.status}: ${t.slice(0, 200)}`);
  }
  const j = await kRes.json().catch(() => ({}));
  const dashaJson = (dRes && dRes.ok)
    ? await dRes.json().catch(() => null) : null;
  const dashaCurJson = (dCurRes && dCurRes.ok)
    ? await dCurRes.json().catch(() => null) : null;

  // Best-effort mapping back to the shape the rest of the app expects.
  // AstroSeer returns objects for nakshatra / moon_sign / sun_sign
  // (rich detail with pada/lord/yoni/gana/nadi) while the client
  // expects strings ("Dhanishta", "Capricorn", "Libra") - rendering
  // an object directly throws "Objects are not valid as a React
  // child". We flatten to strings at the top level AND surface the
  // full detail under nakshatraDetail / moonSign / sunSign for any
  // future UI that wants the extra info. The raw response stays
  // under `raw` for the rich sections we don't map yet (avkahada
  // chakra, 16 divisional charts, panchang, yogas, doshas).
  const ascendant = j.ascendant
    || (j.lagna ? { sign: j.lagna.sign, lord: j.lagna.lord } : null);
  const planetsSrc = Array.isArray(j.planetary_position)
    ? j.planetary_position
    : Array.isArray(j.planets) ? j.planets : [];
  // Normalise each planet so the client's <table> renders cleanly.
  // AstroSeer ships {name, sign, house, degree_display, retrograde}
  // (degree as both numeric `degree_in_sign` and pre-formatted
  // `degree_display`). The client reads `degree` only.
  const planets = planetsSrc.map((pl) => ({
    name: pl.name,
    sign: pl.sign || pl.zodiac_sign_name,
    house: pl.house,
    degree: pl.degree_display || (typeof pl.degree_in_sign === 'number'
      ? pl.degree_in_sign.toFixed(2) : pl.degree),
    retrograde: !!(pl.retrograde || pl.isRetro),
    nakshatra: typeof pl.nakshatra === 'string'
      ? pl.nakshatra : (pl.nakshatra && pl.nakshatra.name) || null,
    nakshatraLord: pl.nakshatra_lord || null,
    pada: pl.pada || null,
    combust: !!pl.combust,
    dignity: pl.dignity || null,
  }));
  // Vimshottari dasha tree. Pulled from /api/dasha when the kundli
  // endpoint itself doesn't include it (AstroSeer's design - keeps
  // the kundli call snappy and dasha optional). Each maha period has
  // a nested antardasha[] and each antardasha has a pratyantardasha[]
  // (sub-sub). Falls back to whatever /api/kundli might already have
  // inline for adapters that DO include it.
  function extractDashaArray(d) {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    // AstroSeer /api/dasha returns an object. v1.0.0 used
    // `vimshottari`; v1.1.0 renamed it to `vimshottari_mahadasha`.
    // We accept both plus every alias we have seen across other
    // adapters so a future rename is one entry away from working.
    const keys = ['vimshottari_mahadasha', 'vimshottari', 'periods',
      'mahadasha', 'maha_dasha', 'dasha', 'data', 'result', 'list'];
    for (const k of keys) {
      if (Array.isArray(d[k])) return d[k];
      if (d[k] && Array.isArray(d[k].periods)) return d[k].periods;
    }
    return [];
  }
  const dashaList = extractDashaArray(dashaJson)
    .length ? extractDashaArray(dashaJson)
    : (Array.isArray(j.vimshottari_dasha)
      ? j.vimshottari_dasha
      : Array.isArray(j.dasha) ? j.dasha : []);

  // Normalise the nested tree:
  //   maha.{planet, start, end, antardasha[]}
  //   antar.{planet, start, end, pratyantardasha[]}
  //   pratyantar.{planet, start, end}
  // AstroSeer uses these exact names; some other adapters use
  // `sub`/`sub_sub` which we alias.
  function normPeriod(p) {
    if (!p || typeof p !== 'object') return null;
    const out = {
      planet: p.planet || p.lord || p.name || '',
      start: p.start || p.start_date || p.from || '',
      end: p.end || p.end_date || p.to || '',
    };
    const antar = p.antardasha || p.antar_dasha || p.antar
      || p.sub || p.sub_dasha || p.subPeriods || [];
    if (Array.isArray(antar) && antar.length) {
      out.antardasha = antar.map((a) => {
        const inner = normPeriod(a);
        const pratyantar = a.pratyantardasha || a.pratyantar
          || a.pratyantar_dasha || a.sub_sub || a.subSub
          || a.subSubPeriods || [];
        if (Array.isArray(pratyantar) && pratyantar.length) {
          inner.pratyantardasha = pratyantar.map(normPeriod).filter(Boolean);
        }
        return inner;
      }).filter(Boolean);
    }
    return out;
  }
  const dashaTree = dashaList.map(normPeriod).filter(Boolean);

  // Current period (Maha + Antar + Pratyantar). AstroSeer's
  // /api/dasha/current returns this already drilled-down; otherwise
  // we compute it from the tree.
  function pickCurrent(tree) {
    const now = Date.now();
    const m = tree.find((x) => Date.parse(x.start) <= now
      && now < Date.parse(x.end));
    if (!m) return null;
    const a = (m.antardasha || []).find((x) =>
      Date.parse(x.start) <= now && now < Date.parse(x.end));
    const pr = a && (a.pratyantardasha || []).find((x) =>
      Date.parse(x.start) <= now && now < Date.parse(x.end));
    return {
      planet: m.planet, start: m.start, end: m.end,
      antar: a ? { planet: a.planet, start: a.start, end: a.end } : null,
      pratyantar: pr
        ? { planet: pr.planet, start: pr.start, end: pr.end }
        : null,
    };
  }
  function currentFromApi(d) {
    if (!d || typeof d !== 'object') return null;
    // AstroSeer's /api/dasha/current commonly returns
    //   { maha: {...}, antar: {...}, pratyantar: {...} }
    // or { mahadasha: {...}, antardasha: {...}, pratyantardasha: {...} }
    const m = d.maha || d.mahadasha || d.current_maha || d.current_dasha;
    const a = d.antar || d.antardasha || d.current_antar;
    const pr = d.pratyantar || d.pratyantardasha || d.current_pratyantar;
    if (!m) return null;
    return {
      planet: m.planet || m.lord || m.name,
      start: m.start || m.start_date || m.from,
      end: m.end || m.end_date || m.to,
      antar: a ? {
        planet: a.planet || a.lord || a.name,
        start: a.start || a.start_date || a.from,
        end: a.end || a.end_date || a.to,
      } : null,
      pratyantar: pr ? {
        planet: pr.planet || pr.lord || pr.name,
        start: pr.start || pr.start_date || pr.from,
        end: pr.end || pr.end_date || pr.to,
      } : null,
    };
  }
  const currentDasha = currentFromApi(dashaCurJson)
    || pickCurrent(dashaTree);

  // Flatten object-or-string fields. AstroSeer's:
  //   nakshatra: { name, pada, lord, yoni, gana, nadi }
  //   moon_sign: { sign, nakshatra, pada, lord }
  //   sun_sign:  { sign, lord }
  // The client renders these as plain text - extract `.name` /
  // `.sign` so React doesn't bail.
  function flatName(x) {
    if (!x) return null;
    if (typeof x === 'string') return x;
    return x.name || x.sign || null;
  }
  const nakshatra = flatName(j.nakshatra)
    || (j.avkahada_chakra && flatName(j.avkahada_chakra.nakshatra))
    || null;
  const chandraRasi = flatName(j.moon_sign)
    || j.chandra_rasi || j.moon_rasi || null;
  const sooryaRasi = flatName(j.sun_sign)
    || j.soorya_rasi || j.sun_rasi || null;

  return {
    provider: 'astroseer',
    ascendant,
    nakshatra,
    chandra_rasi: chandraRasi,
    soorya_rasi: sooryaRasi,
    // Detail objects for any future UI that wants pada / nadi / lord.
    nakshatraDetail: typeof j.nakshatra === 'object' ? j.nakshatra : null,
    moonSign: typeof j.moon_sign === 'object' ? j.moon_sign : null,
    sunSign: typeof j.sun_sign === 'object' ? j.sun_sign : null,
    zodiac: ascendant && ascendant.sign,
    additional_info: j.avkahada_chakra || null,
    planets,
    // Full Vimshottari tree (each maha has nested antardasha[],
    // each antar has nested pratyantardasha[]). `current: true` is
    // stamped on the period containing now at every level.
    // markDasha returns {dasha, currentDasha} - we just want the
    // marked array here; AstroSeer's separate /api/dasha/current
    // already gives us the current period drilled down (see
    // currentDasha below) so we don't lose that detail.
    dasha: markDasha(dashaTree).dasha,
    currentDasha,
    // Raw responses from the dasha endpoints (handy if any
    // downstream consumer wants the original AstroSeer shape).
    dashaRaw: dashaJson || null,
    dashaCurrentRaw: dashaCurJson || null,
    charts: j.charts || { rasi: null, navamsa: null },
    panchang: j.panchang || null,
    yogas: j.yogas || [],
    doshas: j.doshas || null,
    karakas: j.karakas || null,
    cacheKey: (j._meta && j._meta.cache_key) || j.cache_key || null,
    // Raw response so the client can show any extra section the
    // mapping above didn't cover (16 divisional charts, special
    // lagnas, etc.).
    raw: j,
  };
}

// Lazy require so the kundliReport module + its nodemailer/firebase-
// admin pulls don't load on a plain kundli JSON call (saves ~80 ms
// of cold-start when no PDF is being generated).
let _reportMod;
function reportMod() {
  if (!_reportMod) _reportMod = require('../lib/kundliReport');
  return _reportMod;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST'
    ? (typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); }
            catch (_) { return {}; } })()
        : (req.body || {}))
    : (req.query || {});

  // PDF report action - folded under /api/kundli so the relay stays
  // at 12 serverless functions (Vercel Hobby cap). Caller sends
  //   POST /api/kundli with body { action:'report', kind, uid,
  //                                kundliProfileId }
  // and gets back the same { ok, pdfUrl, orderId, ... } payload the
  // old /api/kundliReport returned.
  if (src.action === 'report' && req.method === 'POST') {
    return reportMod().handleReport(req, res);
  }

  // Async PDF generation pattern (the AstroSeer team shipped a new
  // /api/orders/{id}/status + /api/orders/{id}/pdf flow on
  // 2026-05-27 to fix the >90s timeout for full_life /
  // consolidated_premium reports). Three new actions:
  //
  //   action:'reportStatus' { orderId } -> poll AstroSeer status
  //                                       and sync to Firestore.
  //   action:'reportPdf'    { orderId } -> stream PDF bytes back
  //                                       from AstroSeer + cache.
  //   action:'wake'                     -> pre-warm the Render dyno
  //                                       (fire-and-forget /wake).
  //
  // See push-relay/lib/kundliReport.js for the handlers.
  if (src.action === 'reportStatus' && req.method === 'POST') {
    return reportMod().handleReportStatus(req, res);
  }
  if (src.action === 'reportPdf' && req.method === 'POST') {
    return reportMod().handleReportPdf(req, res);
  }
  if (src.action === 'wake') {
    return reportMod().handleWake(req, res);
  }
  // Server-side sweep of every *_generating order across all
  // customers. Polls AstroSeer for each, fetches PDF + emails the
  // customer + writes Firestore status:'ready' when AstroSeer
  // says the job finished. Designed to be hit by an external
  // 1-min cron (cron-job.org, EasyCron) so order updates happen
  // automatically without anyone visiting the admin panel.
  // Hitting via GET ?action=sweepPending also works so the cron
  // service can just hit a plain URL with no body.
  if (src.action === 'sweepPending') {
    return reportMod().handleSweepPending(req, res);
  }
  // AstroSeer pushes here the moment a job flips to status:'sent' (or
  // 'failed'). The relay then fetches the PDF, uploads to Firebase
  // Storage, and flips the corresponding Firestore order doc to
  // 'ready'. Authenticated by shared secret header.
  if (src.action === 'webhookComplete' && req.method === 'POST') {
    return reportMod().handleWebhookComplete(req, res);
  }
  // Firestore-free rescue path. Customer's app calls this when its
  // Firestore listener hits RESOURCE_EXHAUSTED - we fetch the PDF
  // from AstroSeer + push to R2 + return the URL without touching
  // Firestore at all. Works as GET or POST.
  if (src.action === 'rescueByOrderId') {
    return reportMod().handleRescueByOrderId(req, res);
  }

  // ----------------------------------------------------------------
  // Admin presign for a direct-to-R2 PUT.
  //
  // Vercel functions have a hard 4.5 MB request-body limit. Base64-
  // encoded PDFs over ~3 MB raw cross that limit and the browser
  // gets back a "Failed to fetch" with no CORS header. Instead of
  // shipping bytes through the relay, we hand the browser a
  // presigned R2 PUT URL and the file flows direct to Cloudflare -
  // no Vercel involvement, no size cap.
  //
  // POST { action: 'presignManualUpload', orderId }
  // Auth: Bearer (admin only).
  // Returns: { uploadUrl, publicUrl, key, expiresInSec }.
  // ----------------------------------------------------------------
  if (src.action === 'presignManualUpload'
    && req.method === 'POST') {
    if (!initAdmin()) {
      return res.status(503).json({
        error: 'admin SDK not configured' });
    }
    try {
      const dbA = admin.firestore();
      const authz = req.headers.authorization || '';
      const idToken = authz.startsWith('Bearer ')
        ? authz.slice(7) : '';
      if (!idToken) {
        return res.status(401).json({ error: 'no token' });
      }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const callerSnap = await dbA.collection('users')
        .doc(decoded.uid).get();
      const callerData = callerSnap.exists
        ? (callerSnap.data() || {}) : {};
      const callerRoles = Array.isArray(callerData.roles)
        ? callerData.roles : [callerData.role || ''];
      const isAdmin = callerRoles.includes('admin')
        || callerData.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'not an admin' });
      }
      const orderId = String(src.orderId || '').trim();
      if (!orderId) {
        return res.status(400).json({ error: 'orderId required' });
      }
      const r2OK = !!(process.env.R2_ACCOUNT_ID
        && process.env.R2_ACCESS_KEY_ID
        && process.env.R2_SECRET_ACCESS_KEY
        && process.env.R2_BUCKET);
      if (!r2OK) {
        return res.status(503).json({
          error: 'R2 not configured on the relay' });
      }
      // eslint-disable-next-line global-require
      const { S3Client, PutObjectCommand } = require(
        '@aws-sdk/client-s3');
      // eslint-disable-next-line global-require
      const { getSignedUrl } = require(
        '@aws-sdk/s3-request-presigner');
      const client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.`
          + 'r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      });
      const key = `rescued/${orderId}.pdf`;
      const cmd = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentType: 'application/pdf',
        CacheControl: 'public, max-age=31536000, immutable',
      });
      const uploadUrl = await getSignedUrl(client, cmd,
        { expiresIn: 600 });
      const r2Base = process.env.R2_PUBLIC_URL
        || `https://${process.env.R2_BUCKET}.r2.dev`;
      const publicUrl = `${r2Base.replace(/\/+$/, '')}/${key}`;
      return res.status(200).json({
        ok: true, uploadUrl, publicUrl, key,
        expiresInSec: 600,
      });
    } catch (e) {
      return res.status(400).json({
        error: String((e && e.message) || e) });
    }
  }

  // ----------------------------------------------------------------
  // Admin manual upload of a PDF for an order.
  //
  // Used when AstroSeer has the PDF (status SENT) but the relay's
  // auto-rescue did not deliver it - the operator pulls the PDF
  // from AstroSeer manually and uploads it through this endpoint.
  // Optional redebit=true re-charges the wallet if it was previously
  // refunded (so the operator does not have to manually adjust two
  // ledgers).
  //
  // POST { action: 'manualUploadReport', orderId, uid, pdfBase64,
  //        redebit?: bool }
  // Auth: caller must be an admin (verified via Bearer + users role).
  // ----------------------------------------------------------------
  if (src.action === 'manualUploadReport'
    && req.method === 'POST') {
    if (!initAdmin()) {
      return res.status(503).json({
        error: 'admin SDK not configured' });
    }
    try {
      const dbA = admin.firestore();
      // Auth: verify the caller is an admin.
      const authz = req.headers.authorization || '';
      const idToken = authz.startsWith('Bearer ')
        ? authz.slice(7) : '';
      if (!idToken) {
        return res.status(401).json({ error: 'no token' });
      }
      const decoded = await admin.auth().verifyIdToken(idToken);
      const callerSnap = await dbA.collection('users')
        .doc(decoded.uid).get();
      const callerData = callerSnap.exists
        ? (callerSnap.data() || {}) : {};
      const callerRoles = Array.isArray(callerData.roles)
        ? callerData.roles : [callerData.role || ''];
      const isAdmin = callerRoles.includes('admin')
        || callerData.role === 'admin';
      if (!isAdmin) {
        return res.status(403).json({ error: 'not an admin' });
      }
      const orderId = String(src.orderId || '').trim();
      const uid = String(src.uid || '').trim();
      const pdfB64 = String(src.pdfBase64 || '');
      const providedPdfUrl = String(src.pdfUrl || '').trim();
      const redebit = !!src.redebit;
      if (!orderId || !uid || (!pdfB64 && !providedPdfUrl)) {
        return res.status(400).json({
          error: 'orderId, uid and (pdfBase64 OR pdfUrl) are required' });
      }
      // Load the order doc so we know amount + previous status.
      const orderRef = dbA.collection('users').doc(uid)
        .collection('orders').doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        return res.status(404).json({ error: 'order not found' });
      }
      const order = orderSnap.data() || {};
      const amount = Number(order.amount || 0);
      const wasRefunded = order.status === 'failed_refunded';
      // 1) Resolve the final PDF URL.
      // PATH A: caller already uploaded direct to R2 via presigned
      //   URL (new fast path - avoids Vercel's 4.5MB body limit).
      //   We just take their URL as the final PDF location.
      // PATH B: caller sent base64 in body (legacy small-file path).
      //   We decode and upload here.
      const rescueKey = `rescued/${orderId}.pdf`;
      let pdfUrl = null;
      if (providedPdfUrl) {
        pdfUrl = providedPdfUrl;
      } else {
        const cleaned = pdfB64.replace(
          /^data:application\/pdf;base64,/, '');
        const pdfBuf = Buffer.from(cleaned, 'base64');
        if (!pdfBuf.length || pdfBuf.length > 25 * 1024 * 1024) {
          return res.status(400).json({
            error: 'PDF must be between 1 byte and 25 MB.' });
        }
        const r2OK = !!(process.env.R2_ACCOUNT_ID
          && process.env.R2_ACCESS_KEY_ID
          && process.env.R2_SECRET_ACCESS_KEY
          && process.env.R2_BUCKET);
        if (r2OK) {
          try {
            const { S3Client, PutObjectCommand } = require(
              '@aws-sdk/client-s3');
            const client = new S3Client({
              region: 'auto',
              endpoint: `https://${process.env.R2_ACCOUNT_ID}.`
                + 'r2.cloudflarestorage.com',
              credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
              },
              forcePathStyle: true,
            });
            await client.send(new PutObjectCommand({
              Bucket: process.env.R2_BUCKET,
              Key: rescueKey,
              Body: pdfBuf,
              ContentType: 'application/pdf',
              CacheControl:
                'public, max-age=31536000, immutable',
            }));
            const r2Base = process.env.R2_PUBLIC_URL
              || `https://${process.env.R2_BUCKET}.r2.dev`;
            pdfUrl = `${r2Base.replace(/\/+$/, '')}/${rescueKey}`;
          } catch (e) {
            return res.status(502).json({
              error: 'R2 upload failed: '
                + String((e && e.message) || e) });
          }
        }
        if (!pdfUrl && process.env.BLOB_READ_WRITE_TOKEN) {
          try {
            const { put } = require('@vercel/blob');
            const blob = await put(rescueKey, pdfBuf, {
              access: 'public',
              contentType: 'application/pdf',
              cacheControlMaxAge: 31536000,
              addRandomSuffix: false,
            });
            pdfUrl = blob.url;
          } catch (e) {
            return res.status(502).json({
              error: 'Vercel Blob upload failed: '
                + String((e && e.message) || e) });
          }
        }
      }
      if (!pdfUrl) {
        return res.status(503).json({
          error: 'no storage backend configured' });
      }
      // 2) Re-debit the wallet ONLY if the order was previously
      //    refunded AND the operator explicitly opted in. Same-shape
      //    transaction the original deduction uses.
      let redebitedAmount = 0;
      if (redebit && wasRefunded && amount > 0) {
        try {
          await dbA.runTransaction(async (tx) => {
            const uRef = dbA.collection('users').doc(uid);
            const uSnap = await tx.get(uRef);
            const w = Number((uSnap.data() || {}).wallet || 0);
            const nextWallet = Math.max(0, w - amount);
            tx.update(uRef, {
              wallet: nextWallet,
              updatedAt: admin.firestore.FieldValue
                .serverTimestamp(),
            });
            const txRef = dbA.collection('transactions').doc();
            tx.set(txRef, {
              userId: uid,
              amount: -amount,
              type: 'debit',
              reason: 'Kundli report (manual delivery '
                + 'after earlier refund)',
              referenceId: orderId,
              createdAt: admin.firestore.FieldValue
                .serverTimestamp(),
            });
          });
          redebitedAmount = amount;
        } catch (e) {
          return res.status(500).json({
            error: 'Re-debit failed: '
              + String((e && e.message) || e) });
        }
      }
      // 3) Update the order doc to ready, clear the failure
      //    fields, and stamp the manual-upload provenance.
      await orderRef.update({
        status: order.kind === 'free'
          ? 'ready_rescued' : 'paid_ready',
        pdfUrl,
        pdfReadyAt: admin.firestore.FieldValue.serverTimestamp(),
        rescuedAt: admin.firestore.FieldValue.serverTimestamp(),
        rescueSource: 'admin_manual',
        manualUpload: true,
        manualUploadBy: decoded.uid,
        manualUploadAt: admin.firestore.FieldValue
          .serverTimestamp(),
        failReason: admin.firestore.FieldValue.delete(),
        lastErrorReason: admin.firestore.FieldValue.delete(),
        redebited: redebitedAmount > 0,
        redebitedAmount,
      });
      // 4) In-app notification.
      try {
        await dbA.collection('notifications').add({
          userId: uid,
          type: 'report_ready',
          title: 'Your report is ready',
          message: 'We finished generating your report. '
            + 'Open Orders to download it.',
          orderId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      // 5) Push notification (best-effort).
      try {
        const u = await dbA.collection('users').doc(uid).get();
        const ud = u.exists ? (u.data() || {}) : {};
        const toks = []
          .concat(Array.isArray(ud.fcmTokens) ? ud.fcmTokens : [])
          .concat(ud.fcmToken ? [ud.fcmToken] : [])
          .filter(Boolean);
        if (toks.length) {
          await admin.messaging().sendEachForMulticast({
            tokens: [...new Set(toks)],
            notification: {
              title: 'Your report is ready',
              body: 'Open Orders to download your PDF.',
            },
            data: { type: 'report_ready', route: '/orders',
              orderId: String(orderId) },
            android: {
              priority: 'high',
              notification: {
                channelId: 'astro-default', sound: 'default',
              },
            },
          });
        }
      } catch (_) {}
      // 6) Email the customer the PDF link via the emailOtp relay.
      try {
        const u = await dbA.collection('users').doc(uid).get();
        const ud = u.exists ? (u.data() || {}) : {};
        const to = String(ud.email || order.email || '').trim();
        if (to) {
          const origin = req.headers['x-forwarded-host']
            ? `https://${req.headers['x-forwarded-host']}`
            : `https://${req.headers.host || ''}`;
          const subject = 'Your AstroSeer report is ready';
          const html = `<p>Hi ${ud.name || ''},</p>`
            + '<p>Your astrology report is ready. You can open it '
            + 'in the app from <b>Orders</b>, or download it '
            + `directly from this link:</p><p><a href="${pdfUrl}">`
            + `${pdfUrl}</a></p>`
            + `<p>Order reference: <b>${orderId}</b></p>`
            + '<p>Thank you for using AstroSeer.</p>';
          await fetch(`${origin}/api/emailOtp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send',
              to, subject, html,
            }),
          });
        }
      } catch (_) { /* email is best-effort */ }
      return res.status(200).json({
        ok: true,
        orderId,
        pdfUrl,
        wasRefunded,
        redebited: redebitedAmount > 0,
        redebitedAmount,
      });
    } catch (e) {
      return res.status(400).json({
        error: String((e && e.message) || e) });
    }
  }

  // ----------------------------------------------------------------
  // Live audience bot tick. Pinged every N seconds by an external
  // cron (e.g. cron-job.org -> https://.../api/kundli?action=liveBotTick).
  // Reads settings/config.live_bots_*, finds every currently-active
  // live broadcast, picks one random bot + question per active live
  // and writes a join + a comment into the SAME messages collection
  // viewers + astrologer subscribe to. Runs through the Firebase
  // Admin SDK so it bypasses client rules + works even when the
  // astrologer's deployed bundle is stale.
  // ----------------------------------------------------------------
  // ----------------------------------------------------------------
  // Warm-keeper ping. The Vercel cron pings this every 10 minutes
  // (vercel.json) to keep the relay function instance warm so the
  // first real user request never pays a cold-start. Returns a
  // small ~20KB JSON payload (intentionally non-empty so any CDN /
  // proxy that strips zero-byte responses still treats it as a
  // real hit). Also opportunistically runs the chat-inactivity
  // sweeper (see endChatForInactivity action) so a 3-minute idle
  // chat never sits forever if the customer's app is offline.
  // ----------------------------------------------------------------
  if (src.action === 'ping') {
    let swept = 0;
    try {
      if (initAdmin()) {
        swept = await sweepIdleChats(admin.firestore());
      }
    } catch (_) { /* warmth is the primary job, sweep is bonus */ }
    // ~20KB filler so the response is large enough to keep the
    // function instance + warm pool busy through the round-trip.
    const filler = 'x'.repeat(20000);
    return res.status(200).json({
      ok: true,
      at: Date.now(),
      sweptIdleChats: swept,
      filler,
    });
  }

  // ----------------------------------------------------------------
  // Force-end a chat session whose customer has gone idle. Caller
  // is the customer themselves OR the cron. Server enforces the
  // 3-minute idle rule by reading sessions/{id}.lastCustomerActivityAt
  // and refusing if the customer was active within the threshold.
  //
  // Bills the active portion (already deducted live in normal flow)
  // and credits back the inactive minutes (up to 3) labelled
  // "No activity refund" with the SAME session id so the customer
  // can trace it in their statement.
  // ----------------------------------------------------------------
  if (src.action === 'endChatForInactivity'
    && req.method === 'POST') {
    if (!initAdmin()) {
      return res.status(503).json({
        error: 'admin SDK not configured' });
    }
    try {
      const dbA = admin.firestore();
      const sid = String((src.sessionId || '')).trim();
      if (!sid) return res.status(400).json({ error: 'sessionId' });
      const out = await endChatForInactivity(dbA, sid);
      return res.status(200).json(out);
    } catch (e) {
      return res.status(400).json({
        error: String((e && e.message) || e) });
    }
  }

  if (src.action === 'liveBotTick') {
    if (!initAdmin()) {
      return res.status(503).json({
        error: 'admin SDK not configured' });
    }
    try {
      const db = admin.firestore();
      const cfgSnap = await db.collection('settings')
        .doc('config').get();
      const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
      if (!cfg.live_bots_enabled) {
        return res.status(200).json({ ok: true, skipped: 'disabled' });
      }
      // Find every active live broadcast: chats/live_<uid> with
      // status === 'live' (the liveService.startLive writer).
      const liveSnap = await db.collection('chats').get();
      const lives = liveSnap.docs.filter((d) =>
        d.id.startsWith('live_')
        && (d.data() || {}).status === 'live');
      if (lives.length === 0) {
        return res.status(200).json({ ok: true, ticks: 0,
          note: 'no active lives' });
      }
      // Pool sample.
      const botsSnap = await db.collection('liveBots')
        .limit(300).get();
      const bots = botsSnap.docs.map((d) => d.data())
        .filter((b) => b.enabled !== false);
      const qsSnap = await db.collection('liveBotQuestions')
        .limit(300).get();
      const qs = qsSnap.docs.map((d) => d.data())
        .filter((x) => x.text);
      if (bots.length === 0 || qs.length === 0) {
        return res.status(200).json({ ok: true,
          skipped: 'empty pool',
          bots: bots.length, questions: qs.length });
      }
      let ticked = 0;
      for (const liveDoc of lives) {
        const astroUid = liveDoc.id.replace(/^live_/, '');
        // Scope check.
        if ((cfg.live_bots_scope || 'all') === 'allowlist') {
          const arr = Array.isArray(cfg.live_bots_astro_uids)
            ? cfg.live_bots_astro_uids : [];
          if (!arr.includes(astroUid)) continue;
        }
        const msgsRef = db.collection('chats').doc(liveDoc.id)
          .collection('messages');
        // 1 join + (50% chance) 1 comment per tick - matches the
        // 'few seconds between joins, longer between comments'
        // pacing the admin set in the catalogue defaults.
        const b1 = bots[Math.floor(Math.random() * bots.length)];
        // eslint-disable-next-line no-await-in-loop
        await msgsRef.add({
          type: 'join', name: b1.name, code: b1.code, _bot: true,
          senderId: `bot_${b1.code}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (Math.random() < 0.5) {
          const b2 = bots[Math.floor(Math.random() * bots.length)];
          const q = qs[Math.floor(Math.random() * qs.length)];
          // eslint-disable-next-line no-await-in-loop
          await msgsRef.add({
            type: 'comment', name: b2.name, code: b2.code,
            text: q.text, _bot: true,
            senderId: `bot_${b2.code}`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        ticked += 1;
      }
      return res.status(200).json({ ok: true, ticks: ticked,
        lives: lives.length });
    } catch (e) {
      return res.status(500).json({ ok: false,
        error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  // Call / video / live recording upload via R2.
  //
  // Firebase Storage requires a Blaze billing upgrade, which this
  // project has explicitly opted out of. Customer recordings come
  // in as a base64-encoded WebM blob in the POST body; we decode
  // and push to the existing Cloudflare R2 bucket the kundli PDFs
  // use (so no new infra, no second Vercel env to manage). On
  // success we ALSO write the chats/recording_<sessionId> index
  // doc so /consultations + /admin-recordings pick it up
  // automatically.
  //
  // Body:
  //   { action:'uploadRecording', sessionId, type, userId, astroId,
  //     mime, kind, dataBase64 }
  // Returns:
  //   { ok:true, url, size }
  // Quick env probe so admin can see whether Drive is wired without
  // making a real call. GET /api/kundli?action=recordingProbe
  if (src.action === 'recordingProbe') {
    let saClientEmail = '';
    try {
      saClientEmail = (JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT || '{}').client_email) || '';
    } catch (_) {}
    return res.status(200).json({
      driveFolderId: process.env.DRIVE_FOLDER_ID || null,
      driveScopeReady: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      serviceAccountEmail: saClientEmail,
      r2Configured: !!(process.env.R2_ACCOUNT_ID
        && process.env.R2_ACCESS_KEY_ID
        && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET),
    });
  }

  if (src.action === 'uploadRecording' && req.method === 'POST') {
    if (!initAdmin()) {
      return res.status(503).json({ error: 'admin SDK not configured' });
    }
    const { sessionId, mime, kind, dataBase64,
      userId, astroId } = src;
    const type = String(src.type || 'session').replace(/[^a-z0-9]/gi, '');
    if (!sessionId || !dataBase64) {
      return res.status(400).json({
        error: 'sessionId and dataBase64 required' });
    }
    const buf = Buffer.from(String(dataBase64), 'base64');
    if (!buf || buf.length < 200) {
      return res.status(400).json({ error: 'empty/tiny blob',
        size: buf ? buf.length : 0 });
    }
    if (buf.length > 25 * 1024 * 1024) {     // Vercel body cap ~4.5 MB
      return res.status(413).json({ error: 'recording too large',
        size: buf.length });                  // - but we accept up to
                                              //   the Node mem cap.
    }
    const ext = mime && mime.includes('mp4') ? 'm4a' : 'webm';
    const fileName = `${sessionId}.${ext}`;
    const r2KeyOrPath = `recordings/${type}/${fileName}`;
    const contentType = mime || 'audio/webm';

    // Decide which backend to use. Google Drive WINS when configured -
    // user has a 1 TB Drive and prefers it over R2 / Firebase Storage.
    // R2 stays as the fallback so the customer never loses a recording
    // because the Drive token expired.
    let url = '';
    let backend = '';
    let driveError = null;          // surfaced in the response for
                                    // diagnostic
    try {
      if (process.env.DRIVE_FOLDER_ID) {
        url = await _uploadToDrive(fileName, contentType, buf,
          process.env.DRIVE_FOLDER_ID);
        backend = 'google-drive';
      }
    } catch (e) {
      driveError = String((e && e.message) || e).slice(0, 300);
      // eslint-disable-next-line no-console
      console.warn('drive upload failed, falling back to R2:', driveError);
    }
    if (!url) {
      if (!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
          && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET)) {
        return res.status(503).json({
          error: 'No storage backend configured (need DRIVE_FOLDER_ID '
            + 'or R2_* env vars)' });
      }
      try {
        url = await _uploadToR2(r2KeyOrPath, contentType, buf);
        backend = 'cloudflare-r2';
      } catch (e) {
        return res.status(500).json({ ok: false,
          error: String((e && e.message) || e).slice(0, 300) });
      }
    }
    // Index doc - deterministic id so duplicate uploads merge.
    // Enrich with the session's duration so /admin-recordings can
    // show "12m 04s" without a second round-trip per row.
    let durationSec = 0;
    try {
      const s = await admin.firestore().collection('sessions')
        .doc(sessionId).get();
      if (s.exists) durationSec = Number(s.data().duration || 0);
    } catch (_) { /* duration is decorative */ }
    try {
      await admin.firestore().collection('chats')
        .doc(`recording_${sessionId}`).set({
          isRecordingDoc: true,
          sessionId,
          type,
          astroId: astroId || '',
          userId: userId || '',
          kind: kind || 'audio',
          url,
          backend,
          sizeKB: Math.round(buf.length / 1024),
          durationSec,
          ts: Date.now(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    } catch (_) { /* index write best-effort */ }
    return res.status(200).json({ ok: true, url, size: buf.length,
      backend, driveError });
  }

  // GET ?probe=1 -> just report which provider would be used and
  // whether the relay can read Firestore. Lets admin verify the chain
  // without computing a kundli (no API quota used).
  if (src.probe === '1' || src.probe === 1) {
    const pc = await readProviderConfig();
    // AstroSeer extras: report env-var presence + a /health ping so
    // the admin can tell at a glance whether the relay can reach the
    // Render API without burning a real kundli call.
    const extras = {};
    if (pc.provider === 'astroseer') {
      // Mirror the adapter's defensive URL/key resolution so the
      // admin probe shows EXACTLY what runAstroSeer would pick.
      const isUrl = (u) => typeof u === 'string'
        && /^https?:\/\//i.test(u);
      const isKey = (k) => typeof k === 'string'
        && /^as_(live|test)_/i.test(k);
      const urlCandidates = [
        pc.creds && pc.creds.baseUrl,
        pc.creds && pc.creds.secret,
        process.env.ASTROSEER_API_URL,
        'https://astroseer-api.onrender.com',
      ];
      const base = urlCandidates.find(isUrl)
        || 'https://astroseer-api.onrender.com';
      const key = [pc.creds && pc.creds.key,
        process.env.ASTROSEER_API_KEY,
        process.env.ASTROSEER_API_URL].find(isKey) || '';
      extras.envUrl = !!process.env.ASTROSEER_API_URL;
      extras.envUrlIsUrl = isUrl(process.env.ASTROSEER_API_URL);
      extras.envKey = !!process.env.ASTROSEER_API_KEY;
      extras.envKeyLooksLikeKey = isKey(process.env.ASTROSEER_API_KEY);
      extras.envUrlLooksLikeKey = isKey(process.env.ASTROSEER_API_URL);
      extras.firestoreKey = !!(pc.creds && pc.creds.key);
      extras.baseUrlInUse = base;
      extras.keyResolved = !!key;
      try {
        const hr = await fetch(`${base.replace(/\/+$/, '')}/health`, {
          method: 'GET',
          headers: key ? { 'X-API-Key': key } : {},
        });
        extras.healthStatus = hr.status;
        try {
          const hj = await hr.json();
          extras.health = hj;
        } catch (_) { /* not JSON */ }
      } catch (e) {
        extras.healthError = String((e && e.message) || e);
      }
    }
    // Storage backend env-var visibility (so operator can confirm
    // R2 / Vercel Blob credentials picked up by the deploy).
    const storage = {
      vercelBlob: !!process.env.BLOB_READ_WRITE_TOKEN,
      r2: {
        accountId: !!process.env.R2_ACCOUNT_ID,
        accessKeyId: !!process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: !!process.env.R2_SECRET_ACCESS_KEY,
        bucket: process.env.R2_BUCKET || null,
        publicUrl: process.env.R2_PUBLIC_URL || null,
      },
    };
    return res.status(200).json({
      relayBuild: 'firestore-free-free-flow-2026-05-29T04:50',
      provider: pc.provider,
      adminInit: pc.adminInit,
      hasKey: !!(pc.creds && (pc.creds.key || pc.creds.secret))
        || (pc.provider === 'astroseer'
          && !!process.env.ASTROSEER_API_KEY),
      providerNote: pc.providerNote || '',
      storage,
      ...extras,
    });
  }

  const { dob, tob, ampm, place } = src;
  if (!dob) return res.status(400).json({ error: 'dob required' });

  try {
    let lat = Number(src.lat);
    let lng = Number(src.lng);
    if (!lat || !lng) {
      const g = await geocode(place);
      if (!g) return res.status(400).json({
        error: 'could not locate place' });
      lat = g.lat; lng = g.lng;
    }
    const p = parseDob(dob, tob, ampm);
    const datetime = toIso(p, src.tz);
    const cfg = await readProviderConfig();
    const { provider, creds } = cfg;

    const run = {
      prokerala: () => runProkerala(creds, lat, lng, datetime),
      astrologyapi: () => runAstrologyApi(creds, p, lat, lng),
      vedicastroapi: () => runVedicAstroApi(creds, p, lat, lng),
      freeastrologyapi: () => runFreeAstrologyApi(creds, p, lat, lng),
      // Our own Render-hosted API. Rich Vedic kundli (avkahada chakra,
      // yogas, doshas, panchang, divisional charts) returned as one
      // JSON blob.
      astroseer: () => runAstroSeer(creds, p, lat, lng),
    }[provider];

    let data;
    try {
      data = run ? await run()
        : await runProkerala(creds, lat, lng, datetime);
    } catch (e) {
      // Fall back to Prokerala env if the chosen provider is not
      // configured, so Kundli keeps working.
      try { data = await runProkerala({}, lat, lng, datetime); }
      catch (e2) {
        return res.status(502).json({
          error: 'kundli provider failed',
          provider,
          detail: String((e && e.message) || e),
        });
      }
    }

    return res.status(200).json({
      provider,
      adminInit: cfg.adminInit,
      providerNote: cfg.providerNote || '',
      datetime,
      coordinates: { lat, lng },
      generatedAt: Date.now(),
      ...data,
    });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }
};
