// Kundli PDF report - both flavours land here:
//
//   POST /api/kundliReport
//   body: { kind, kundliProfileId, uid }
//     kind = 'free'          -> 250+ page lifetime Vedic kundli
//                                (returns PDF, NO wallet deduction)
//     kind = 'forecast12'    -> paid 12-month forecast starting from
//                                the current month. Deducts the price
//                                from users.wallet in a Firestore
//                                transaction, fails 402 if not enough.
//
// Common pipeline:
//   1. Auth: ensure the kundli profile is owned by the requesting uid.
//      Hard rule from user: "kundli of each person should be allocated
//      to one user only". Cross-user reads here = bug.
//   2. Wallet deduct (paid only) atomically with order doc creation.
//   3. Generate PDF via AstroSeer /api/kundli/pdf (tier 9 for free,
//      tier 9 + monthly=12 for forecast).
//   4. Upload PDF to Firebase Storage at
//        media/reports/{uid}/{ts}_{kind}.pdf
//      and grab a long-lived signed URL.
//   5. Write users/{uid}/orders/{orderId} with {kind, pdfUrl, paidAt,
//      amount, kundliProfileId, validUntil}.
//   6. Email the PDF to the user via the existing SMTP config (same
//      transporter as the OTP endpoint reads from settings/email).
//   7. Return { ok, pdfUrl, orderId, alreadyHave } so the client can
//      open the immediate "Download now" popup.
//
// On any failure AFTER the wallet deduct, the deduction is reversed
// so the user is never billed for a missing PDF (Hard Rule 4 of the
// blueprint - never overcharge).
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const {
  logAstroSeerEvent, birthSummaryFromProfile,
} = require('./astroseerLog');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const sa = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    storageBucket: bucketName(sa),
  });
}

// Mint a unique RANDOM 8-digit numeric Order ID. Each candidate
// (between 10000000 and 99999999, ~90 million space) is reserved
// atomically by trying to write to orderNumbers/{candidate} inside
// a Firestore transaction. If the doc already exists (collision)
// we generate another candidate. With ~thousands of orders in a
// 90 million space the birthday-paradox collision probability per
// attempt is microscopic, so 6 attempts is plenty of headroom.
//
// User asked for "unique randomised 8 digit numbers" - sequential
// counters leak how many orders we have processed; random ids are
// harder to guess + look more like real order numbers.
//
// Falls back to a Firestore auto-id (longer alphanumeric) only if
// all 6 attempts somehow collide, so a customer purchase is never
// blocked by id minting.
async function mintOrderId(db) {
  const reg = db.collection('orderNumbers');
  for (let i = 0; i < 6; i += 1) {
    // 10000000 + 0..89999999 covers exactly the 8-digit range.
    const candidate = String(10000000
      + Math.floor(Math.random() * 90000000));
    try {
      // eslint-disable-next-line no-await-in-loop
      const id = await db.runTransaction(async (tx) => {
        const ref = reg.doc(candidate);
        const snap = await tx.get(ref);
        if (snap.exists) return null;     // collision, retry
        tx.set(ref, {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return candidate;
      });
      if (id) return id;
    } catch (_) { /* retry */ }
  }
  return db.collection('_tmp').doc().id;
}

// Resolve the Firebase Storage bucket name. Source-of-truth order:
// explicit FIREBASE_STORAGE_BUCKET env on Vercel, then the new
// "<project>.firebasestorage.app" format (current default for
// projects created in 2024+), then the legacy "<project>.appspot.com"
// - we try both, the upload that succeeds wins.
function bucketName(sa) {
  return process.env.FIREBASE_STORAGE_BUCKET
    || `${(sa && sa.project_id) || 'astrology-2092d'}.firebasestorage.app`;
}
function legacyBucketName(sa) {
  return `${(sa && sa.project_id) || 'astrology-2092d'}.appspot.com`;
}

const FREE_TIER = 9;
const DEFAULT_FORECAST_PRICE = 50;

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (_) { b = {}; }
  }
  return b || {};
}

// Reuse the same AstroSeer URL/key resolution the kundli adapter
// uses so admin can rotate creds from one place.
function resolveAstroSeer(creds) {
  const candidates = [
    creds && creds.baseUrl, creds && creds.secret,
    process.env.ASTROSEER_API_URL,
    'https://astroseer-api.onrender.com',
  ];
  const base = candidates.find(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    || 'https://astroseer-api.onrender.com';
  const looksLikeKey = (s) =>
    typeof s === 'string' && /^as_(live|test)_/i.test(s);
  const key = [creds && creds.key, process.env.ASTROSEER_API_KEY,
    process.env.ASTROSEER_API_URL].find(looksLikeKey) || '';
  return { base: base.replace(/\/+$/, ''), key };
}

async function getAstroSeerCreds(db) {
  try {
    const s = await db.collection('settings').doc('kundliApi').get();
    const d = s.exists ? (s.data() || {}) : {};
    return resolveAstroSeer(d.astroseer || {});
  } catch (_) { return resolveAstroSeer({}); }
}

// Default prices for each report kind. Admin overrides via
// settings/config.kundli_<kind>_price (and the legacy
// settings/config.kundli_report_price still maps to forecast12
// for backwards compatibility).
const DEFAULT_PRICES = {
  free: 0,
  forecast12: 50,
  careerFinance: 99,
  lifetime: 299,
};
async function getReportPrice(db, kind) {
  if (kind === 'free') return 0;
  const baseDefault = DEFAULT_PRICES[kind] != null
    ? DEFAULT_PRICES[kind] : DEFAULT_FORECAST_PRICE;
  try {
    const s = await db.collection('settings').doc('config').get();
    const d = s.exists ? (s.data() || {}) : {};
    // Per-type override.
    const perType = Number(d[`kundli_${kind}_price`]);
    if (Number.isFinite(perType) && perType >= 0) return perType;
    // Legacy global override (forecast12 only, for the original
    // single-product world).
    if (kind === 'forecast12') {
      const legacy = Number(d.kundli_report_price);
      if (Number.isFinite(legacy) && legacy >= 0) return legacy;
    }
    return baseDefault;
  } catch (_) { return baseDefault; }
}

// What we send AstroSeer for each report kind. All four pull the
// top tier (most pages). forecast12 adds months + start_month so
// the API knows to bake the next 12 monthly forecasts.
function astroSeerBody(kind, p, lat, lng, profile) {
  // tz: prefer the value locked on the profile at city-select time.
  // Falls back to India IST (5.5) only if the profile carried no
  // timezone - that lines up with our customer base today and is
  // safer than GMT+0 which would silently corrupt every chart.
  const profileTz = Number(profile && profile.tz);
  const tz = Number.isFinite(profileTz) ? profileTz : 5.5;
  // 0 is a "missing" sentinel here even though it's a valid
  // coordinate - there is no birth in the middle of the Atlantic.
  // Without this guard the report ends up at (0, 0) GMT+0 (the
  // user-reported bug).
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const safeLat = (Number.isFinite(latNum) && latNum !== 0)
    ? latNum : null;
  const safeLng = (Number.isFinite(lngNum) && lngNum !== 0)
    ? lngNum : null;
  // POST /api/kundli/pdf body shape per the AstroSeer API spec
  // (docs/ASTROSEER_API_AGENT_PROMPT.md line 625-627):
  //   { birth: {...}, kind: 'free'|'forecast12'|... }
  // We also send the flat fields at the top level so an older API
  // build that hasn't migrated to the wrapped shape still works.
  // (Plus name + place + tier + branding kept flat for back-compat
  // with the existing AstroSeer implementation.)
  const birth = {
    year: p.y, month: p.m, day: p.d, hour: p.hh, minute: p.mm,
    tz_offset: tz,
    latitude: safeLat,
    longitude: safeLng,
  };
  const body = {
    ...birth,
    birth,
    kind,
    place: profile.place || '',
    name: profile.name || '',
    tier: FREE_TIER,
    branding: {
      app: 'AstroSeer',
      accent: '#7F2020',
      // Dedicated PDF cover-page logo (cosmic-eye / sun-mandala
      // design in Royal navy + gold + rust). Lives in
      // client-web/public/pdf-cover-logo.png so the customer
      // Vercel project serves it at astroseer.in/pdf-cover-logo.png
      // AstroSeer's WeasyPrint template fetches the URL at render
      // time and embeds it on the cover.
      logo_url: 'https://astroseer.in/pdf-cover-logo.png',
    },
  };
  if (kind === 'forecast12') {
    body.months = 12;
    body.start_month = new Date().toISOString().slice(0, 7);
  } else if (kind === 'careerFinance') {
    body.focus = ['career', 'finance'];
    body.years = 5;
  } else if (kind === 'lifetime') {
    body.focus = ['lifetime'];
    body.years = 120;
    body.include_yogini = true;
  }
  return body;
}

// Open-Meteo geocoding (no key, no quota for the volume we run at).
// Mirrors the geocode() in api/kundli.js. Used as a fallback when
// the kundliProfiles doc only has a `place` string with no
// pre-resolved lat/lng - most user-saved profiles are that shape
// because the BirthInputs CityField only writes the text label.
// AstroSeer's /api/kundli/pdf insists on numeric latitude+longitude
// and 422's otherwise (this was the actual cause of the "Report
// generation failed" toast users were seeing on saved profiles).
async function geocode(place) {
  if (!place) return null;
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(place)}&count=1&language=en`;
    const r = await fetch(url);
    if (!r.ok) return null;
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
  // SAFETY: if we end up at hh=12 with no explicit PM, the source
  // tob was probably 12:XX with an empty ampm. Logging so a future
  // AM->PM bug surfaces in Vercel logs immediately.
  if (hh === 12 && ap !== 'PM') {
    // eslint-disable-next-line no-console
    console.warn('[parseDob] hour=12 with non-PM ampm (' + ap
      + '); profile likely missing ampm. tob=' + tob);
  }
  return { y, m, d, hh, mm };
}

// AstroSeer's /api/kundli/pdf returns the PDF bytes directly. We
// stream them straight to Storage so the relay's memory stays low.
async function callAstroSeerPdf({ base, key, body }) {
  // Same stale-key recovery as the kundli JSON path: try WITH the
  // key first, retry WITHOUT on 401. AstroSeer rejects an invalid
  // key but accepts unauthenticated calls.
  //
  // Hard 55s timeout (Vercel function cap is 60s) - AstroSeer on
  // Render free tier cold-starts in ~30s, so we give it room while
  // still aborting before Vercel kills us with a 504. Without this
  // the browser sees "Failed to fetch" with no JSON body (because
  // Vercel terminates the function mid-response).
  //
  // Cold-start strategy: fire /health in the BACKGROUND (no await)
  // to start waking the Render dyno, then immediately call the real
  // /api/kundli/pdf endpoint. Both requests race to the same dyno;
  // whichever arrives first triggers the cold-start, the other one
  // queues until the dyno is alive. This way we don't waste the
  // 55s PDF budget waiting for /health to finish a 30-40s wake-up.
  //
  // Previously we awaited /health with a 25s timeout, but Render
  // free dyno cold-starts often exceed 25s, so /health aborted
  // before the dyno was alive and the whole flow failed without
  // even attempting PDF generation. Fire-and-forget instead.
  try {
    const wakeAc = new AbortController();
    // 8s is enough to fire the request + initiate the cold-start
    // on Render's edge; after that the dyno wake-up continues in
    // the background regardless of whether we keep listening.
    const wakeTid = setTimeout(() => wakeAc.abort(), 8000);
    fetch(`${base}/health`, {
      method: 'GET',
      headers: key ? { 'X-API-Key': key } : {},
      signal: wakeAc.signal,
    }).catch(() => { /* swallow - the real PDF call will surface
                        any persistent failure */ })
      .finally(() => clearTimeout(wakeTid));
  } catch (_) { /* swallow - never block on the warm-up */ }
  const url = `${base}/api/kundli/pdf`;
  const payload = JSON.stringify(body);
  const withKey = {
    'Content-Type': 'application/json',
    ...(key ? { 'X-API-Key': key } : {}),
  };
  const noKey = { 'Content-Type': 'application/json' };
  const doFetch = async (headers) => {
    const ac = new AbortController();
    // 57s: leaves 3s headroom under Vercel's 60s function cap so we
    // abort cleanly and return a JSON error before Vercel kills the
    // process (which would strip CORS headers and surface as
    // "Failed to fetch" in the browser). This is the maximum we
    // can give the AstroSeer dyno to wake AND respond.
    const tid = setTimeout(() => ac.abort(), 57000);
    try {
      return await fetch(url, {
        method: 'POST', headers, body: payload, signal: ac.signal,
      });
    } finally { clearTimeout(tid); }
  };
  let r;
  try {
    r = await doFetch(withKey);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // 57s passed and Render still hadn't woken + processed. On
      // free tier this happens when the dyno was in deep sleep AND
      // the PDF tier is large (lifetime / forecast12). The retry
      // hint is real - the background /health ping we fired at the
      // top of this function has now had time to wake the dyno, so
      // a second attempt usually succeeds in under 10s.
      throw new Error('AstroSeer PDF API did not respond within 57s. '
        + 'The Render dyno was cold; it should now be warm. Please '
        + 'click Regenerate once more and the PDF will generate '
        + 'instantly. (Wallet was auto-refunded for paid orders.)');
    }
    throw new Error(`AstroSeer fetch failed: ${(e && e.message) || e}`);
  }
  if (r.status === 401 && key) {
    try {
      r = await doFetch(noKey);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('AstroSeer PDF API timed out (retry without key).');
      }
      throw e;
    }
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`AstroSeer report/pdf ${r.status}: `
      + `${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('AstroSeer returned empty PDF');
  return buf;
}

// Storage backend (tiered, automatic fallback):
//
//   1. Vercel Blob - if BLOB_READ_WRITE_TOKEN set. Vercel-managed
//      CDN URL, free on Hobby plan (1 GB storage + 100 GB BW/month).
//
//   2. Cloudflare R2 - if R2_ACCOUNT_ID + R2_ACCESS_KEY_ID +
//      R2_SECRET_ACCESS_KEY + R2_BUCKET set. S3-compatible
//      object storage with 10 GB free + UNLIMITED bandwidth.
//      Backed by Cloudflare's CDN. Recommended for production.
//      Optional R2_PUBLIC_URL overrides the default <bucket>.r2.dev.
//
//   3. Firebase Storage - if admin SDK has bucket access. Initially
//      the workhorse but the relay's service account often lacks
//      Storage permissions; we still try as a fallback.
//
//   4. Chunked Firestore - the bulletproof always-works tier.
//      Writes PDF base64 as N x 800 KB docs in
//      users/{uid}/orders/{id}/pdfChunks/. Client-side
//      resolveOrderPdfUrl reassembles. Costs Firestore reads on
//      every download (~5 per PDF), so this should be the last
//      resort - prefer R2 or Vercel Blob.
//
//   5. Firestore inline base64 - only for PDFs under ~950 KB.
//
// Caller gets back { url, storagePath, bucketUsed } as before so
// the rest of handleReport doesn't change. inline === true on the
// return value tells the caller to also write pdfBase64 onto the
// order doc.
// Upload helpers exposed so the dual-write coordinator below can
// call each backend independently. Each returns the same shape as
// uploadPdf or null if that backend is not configured / fails.
async function _putToVercelBlob(uid, kind, buf) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { put } = require('@vercel/blob');
    const ts = Date.now();
    const path = `reports/${uid}/${ts}_${kind}.pdf`;
    const blob = await put(path, buf, {
      access: 'public',
      contentType: 'application/pdf',
      cacheControlMaxAge: 31536000,
      addRandomSuffix: false,
    });
    return {
      storagePath: blob.pathname || path,
      bucketUsed: 'vercel-blob',
      url: blob.url,
      inline: false,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Vercel Blob upload failed:', (e && e.message) || e);
    return null;
  }
}

async function _putToR2(uid, kind, buf) {
  if (!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
      && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET)) {
    return null;
  }
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
    const ts = Date.now();
    const path = `reports/${uid}/${ts}_${kind}.pdf`;
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: path,
      Body: buf,
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const publicBase = process.env.R2_PUBLIC_URL
      || `https://${process.env.R2_BUCKET}.r2.dev`;
    return {
      storagePath: path,
      bucketUsed: `cloudflare-r2:${process.env.R2_BUCKET}`,
      url: `${publicBase.replace(/\/+$/, '')}/${path}`,
      inline: false,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Cloudflare R2 upload failed:', (e && e.message) || e);
    return null;
  }
}

async function uploadPdf(uid, kind, buf) {
  // DUAL-WRITE COORDINATOR. When both Vercel Blob AND R2 are
  // configured, write to BOTH in parallel and return the primary
  // URL with the backup URL attached on the side. The caller
  // saves both onto the order doc so the customer can fail over
  // at DOWNLOAD time too - not just upload time.
  const dualConfigured = !!process.env.BLOB_READ_WRITE_TOKEN
    && !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
      && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
  if (dualConfigured) {
    const [blobRes, r2Res] = await Promise.all([
      _putToVercelBlob(uid, kind, buf),
      _putToR2(uid, kind, buf),
    ]);
    // Pick whichever succeeded as primary (preferring Blob), expose
    // the other as backupUrl. If both failed we fall through to
    // Firebase / chunked Firestore below.
    if (blobRes && r2Res) {
      return {
        ...blobRes,
        backupUrl: r2Res.url,
        backupStoragePath: r2Res.storagePath,
        backupBucket: r2Res.bucketUsed,
      };
    }
    if (blobRes) return blobRes;
    if (r2Res) return r2Res;
    // both null -> fall through to Firebase + chunks below
  } else if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blobRes = await _putToVercelBlob(uid, kind, buf);
    if (blobRes) return blobRes;
  } else if (process.env.R2_ACCOUNT_ID) {
    const r2Res = await _putToR2(uid, kind, buf);
    if (r2Res) return r2Res;
  }
  // Firebase Storage tier. Requires admin SDK to have been
  // initialised with storageBucket - init() above does that using
  // FIREBASE_STORAGE_BUCKET env var or the project_id default.
  // Try the default bucket (whichever bucketName(sa) resolved to),
  // then fall back to the legacy <project>.appspot.com bucket if
  // the first one doesn't exist. Google migrated newer projects to
  // .firebasestorage.app in 2024 but a lot of projects also still
  // own the old .appspot.com bucket - either can be the active one.
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const candidates = [
    bucketName(sa),
    legacyBucketName(sa),
  ].filter((n, i, a) => a.indexOf(n) === i);
  const attempts = []; // collects every bucket attempt for diagnostics
  for (const candidate of candidates) {
    try {
      const bucket = admin.storage().bucket(candidate);
      const ts = Date.now();
      const path = `reports/${uid}/${ts}_${kind}.pdf`;
      const file = bucket.file(path);
      await file.save(buf, {
        metadata: { contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000, immutable' },
        resumable: false,
        validation: false,
      });
      let url = null;
      try {
        await file.makePublic();
        url = `https://firebasestorage.googleapis.com/v0/b/`
          + `${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      } catch (_) {
        const [signed] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + (100 * 365 * 24 * 60 * 60 * 1000),
        });
        url = signed;
      }
      return {
        storagePath: path,
        bucketUsed: bucket.name,
        url,
        inline: false,
      };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      attempts.push(`${candidate}: ${msg}`);
      // eslint-disable-next-line no-console
      console.warn(`Firebase Storage upload to "${candidate}" `
        + `failed: ${msg}`);
    }
  }
  const lastErr = { bucket: candidates[candidates.length - 1],
    firebase: attempts.join(' | ') };
  // Single-doc inline path: encode the PDF bytes as base64 and
  // return a data URL the browser can download directly. Works
  // for sub-megabyte PDFs without any subcollection write.
  const b64 = Buffer.from(buf).toString('base64');
  const dataUrl = `data:application/pdf;base64,${b64}`;
  if (b64.length > 950 * 1024) {
    // CHUNKED FIRESTORE STORAGE - the bulletproof fallback. Splits
    // the base64 string across N x 800 KB docs in the
    // users/{uid}/orders/{orderId}/pdfChunks subcollection. The
    // customer-side service reads all chunks ordered by idx, joins
    // them, and re-builds the data URL. No storage bucket needed,
    // no env vars, no IAM grants - just Firestore writes the relay
    // can always do.
    //
    // Caller is responsible for telling Firestore the chunk count;
    // we mark the return value with chunked:true so handleReport
    // writes pdfChunkCount onto the order doc instead of pdfBase64.
    return {
      storagePath: null,                     // no file path - chunks
      bucketUsed: 'firestore-chunked',
      url: 'chunked',                        // sentinel; client reassembles
      inline: false,
      chunked: true,
      pdfBuf: buf,                           // caller writes chunks
    };
  }
  return {
    storagePath: `inline:${uid}:${Date.now()}_${kind}`,
    bucketUsed: 'firestore-inline',
    url: dataUrl,
    inline: true,
    pdfBase64: b64,
  };
}

// Returns either { transporter, from } on success or
// { error: '...' } when SMTP isn't configured. Callers that want a
// silent best-effort send can treat error like a falsy transporter;
// callers that want to surface the failure to admin (the new
// /api/kundli action:'report' path does this) pass the error string
// up into the JSON response.
async function smtpTransport(db) {
  let cfg = {};
  try {
    const s = await db.collection('settings').doc('email').get();
    if (s.exists) cfg = s.data() || {};
  } catch (_) { /* env-only */ }
  const host = cfg.smtpHost || process.env.SMTP_HOST || '';
  const port = Number(cfg.smtpPort || process.env.SMTP_PORT || 587);
  const user = cfg.smtpUser || process.env.SMTP_USER || '';
  const pass = cfg.smtpPass || process.env.SMTP_PASS || '';
  const secure = typeof cfg.smtpSecure === 'boolean'
    ? cfg.smtpSecure : port === 465;
  const from = cfg.fromAddress || cfg.smtpFrom || process.env.MAIL_FROM
    || 'AstroSeer <support@astroseer.in>';
  // BCC policy: ADMIN-CONFIGURABLE ONLY.
  // The previous hard-coded compliance archive (an old outlook
  // address) has been REMOVED per operator instruction. The relay
  // only honours the admin's own BCC entries now
  // (settings/email.bccTo + bccEnabled). If neither is set, the
  // kundli-report email goes out with NO BCC at all. Operator's
  // working inbox is vickymartinsing@gmail.com.
  const bccEnabled = !!cfg.bccEnabled;
  const bccTo = String(cfg.bccTo || '').trim();
  const adminBcc = (bccEnabled && /.+@.+\..+/.test(bccTo))
    ? bccTo : '';
  const bcc = adminBcc;
  if (!host || !user || !pass) {
    return { error: 'SMTP not configured. Set host / user / pass '
      + 'in /admin-email (settings/email) or SMTP_HOST / SMTP_USER '
      + '/ SMTP_PASS env vars on the relay.' };
  }
  return {
    transporter: nodemailer.createTransport({
      host, port, secure, auth: { user, pass },
    }),
    from,
    bcc,
    cfg,
  };
}

// Defensive scrubber: drop addresses the operator has explicitly
// asked us never to email. 2026-06-07 (second pass): operator
// instructed every reference to the old outlook compliance address
// be removed from code entirely. If emails are STILL landing in
// that inbox after this scrub + relay deploy, the source is OUTSIDE
// this codebase - almost certainly a Zoho-side forwarding rule on
// support@astroseer.in. The scrubber infrastructure stays in place
// so future operator bans can be enforced without code edits.
// Operator's working inbox is vickymartinsing@gmail.com.
const BLOCKED_RECIPIENTS = new Set([
]);
function scrubBcc(raw) {
  if (!raw) return '';
  return String(raw).split(/[,;\s]+/)
    .map((x) => x.trim()).filter(Boolean)
    .filter((x) => !BLOCKED_RECIPIENTS.has(x.toLowerCase()))
    .join(', ');
}

// Wrap a nodemailer mailOptions object so the silent BCC (when
// enabled in settings/email) gets attached without any caller
// remembering to do it. If the caller already set a bcc, this
// appends to it as a comma-separated list.
function withBcc(opts, t) {
  if (!t || !t.bcc) return opts;
  const next = { ...opts };
  const merged = opts.bcc ? `${opts.bcc}, ${t.bcc}` : t.bcc;
  next.bcc = scrubBcc(merged);
  return next;
}

// Minimal HTML-escape for the email template.
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Email the freshly generated PDF to the customer. When the admin
// sends the report from /admin-user-profile we set complimentary=true
// so the template thanks them and labels the report as a gift; the
// rest of the body is the same polished AstroSeer signature card
// used everywhere else (matches shared/services/emailService.js).
async function emailReport({
  db, toEmail, name, kind, pdfBuf, pdfName,
  complimentary, senderNote,
}) {
  const t = await smtpTransport(db);
  if (!t || t.error || !t.transporter) {
    return { ok: false, error: (t && t.error)
      || 'SMTP transport not available.' };
  }
  const human = kind === 'forecast12'
    ? 'Your 12-Month Kundli Forecast'
    : 'Your Vedic Kundli Report';
  const subject = complimentary
    ? `A complimentary kundli from AstroSeer - ${human}`
    : `${human} from AstroSeer is ready`;
  const opener = complimentary
    ? `As a thank-you from the AstroSeer team, please find your `
      + 'complimentary Vedic kundli attached to this email. There '
      + 'is no charge for this report.'
    : `${human} is attached to this email as a PDF.`;
  const text = `Namaste ${name || 'there'},\n\n${opener}\n\n`
    + 'Inside you will find:\n'
    + '  * Birth, Avakhada and Panchang details\n'
    + '  * Lagna chart and 16 divisional charts\n'
    + '  * Planetary positions, nakshatras and dignities\n'
    + '  * Full Vimshottari dasha tree and current periods\n'
    + '  * Yogas, doshas and ascendant analysis\n\n'
    + (senderNote ? `Note from the team:\n  ${senderNote}\n\n` : '')
    + 'You can also re-download it any time from the Orders '
    + 'section in the AstroSeer app: https://astroseer.in/orders\n\n'
    + 'If a particular life area calls for a deeper look, our '
    + 'astrologers are one tap away on the AstroSeer app.\n\n'
    + 'With blessings,\nTeam AstroSeer\n'
    + 'support@astroseer.in - astroseer.in';
  const heading = complimentary
    ? 'A complimentary kundli for you'
    : `${human} is ready`;
  const leadHtml = complimentary
    ? `Namaste <b>${_esc(name || 'there')}</b>, as a thank-you `
      + 'from the AstroSeer team, please find your complimentary '
      + 'Vedic kundli attached to this email. <i>There is no '
      + 'charge for this report.</i>'
    : `Namaste <b>${_esc(name || 'there')}</b>, ${_esc(human)} is `
      + 'ready and attached to this email as a PDF.';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${_esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F5F1EA;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
  Helvetica,Arial,sans-serif;color:#1A1A2E">
<table role="presentation" width="100%" cellpadding="0"
  cellspacing="0" style="background:#F5F1EA"><tr><td align="center"
  style="padding:24px 12px">
  <table role="presentation" width="600"
    style="max-width:600px;background:#ffffff;border-radius:16px;
    overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.06)">
  <tr><td style="background:linear-gradient(135deg,#7F2020,#A52A2A);
    padding:28px 32px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:2px;text-transform:
      uppercase;opacity:.85">AstroSeer${
  complimentary ? ' &middot; A gift for you' : ''}</div>
    <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.3">
      ${_esc(heading)}</h1>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0;font-size:15px;line-height:1.6">${leadHtml}</p>
    <ul style="margin:16px 0;padding-left:20px;font-size:14px;
      line-height:1.65">
      <li>Birth, Avakhada and Panchang details</li>
      <li>Lagna chart and 16 divisional charts</li>
      <li>Planetary positions, nakshatras and dignities</li>
      <li>Full Vimshottari dasha tree and current periods</li>
      <li>Yogas, doshas and ascendant analysis</li>
    </ul>
    ${senderNote ? `<div style="margin:14px 0;padding:12px 14px;
      background:#FBF7EE;border-left:3px solid #7F2020;border-radius:
      6px;font-size:13px;line-height:1.55"><b>Note from the team:</b>
      <br/>${_esc(senderNote)}</div>` : ''}
    <div style="margin:24px 0;text-align:center">
      <a href="https://astroseer.in/orders"
        style="display:inline-block;padding:12px 28px;border-radius:
        999px;background:#7F2020;color:#ffffff;text-decoration:none;
        font-weight:700;font-size:14px">View in My Orders</a>
    </div>
    <p style="margin:16px 0 0 0;font-size:13px;line-height:1.6;
      color:#555">If a particular life area calls for a deeper
      look, our astrologers are one tap away on the AstroSeer app.</p>
  </td></tr>
  <tr><td style="border-top:1px solid #F0E9D9;padding:20px 32px;
    background:#FBF7EE;font-size:12px;line-height:1.6;color:#4A4A55">
    <div style="font-weight:700;color:#7F2020;font-size:13px;
      margin-bottom:4px">Team AstroSeer</div>
    <div>Vedic astrology, kundli, tarot &amp; consultations</div>
    <div style="margin-top:8px">
      <a href="https://astroseer.in"
        style="color:#7F2020;text-decoration:none">astroseer.in</a>
      &nbsp;&middot;&nbsp;
      <a href="mailto:support@astroseer.in"
        style="color:#7F2020;text-decoration:none">support@astroseer.in</a>
    </div>
    <div style="margin-top:10px;color:#999">
      You received this because you have an account or active order
      with AstroSeer. To stop, reply with "unsubscribe".
    </div>
  </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  // Write an audit row to chats/{id} so /admin-email log can show
  // exactly what was sent - subject, body, html preview, attachment
  // metadata (name + size only, not the binary), final status.
  const auditRef = db.collection('chats').doc();
  try {
    await auditRef.set({
      isEmailDoc: true,
      to: toEmail,
      kind: complimentary
        ? 'kundli_report_complimentary'
        : 'kundli_report_ready',
      subject,
      body: text || '',
      html: html || '',
      attachments: [{ filename: pdfName,
        contentType: 'application/pdf',
        sizeBytes: (pdfBuf && pdfBuf.length) || 0 }],
      status: 'sending',
      ts: Date.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) { /* audit is best-effort */ }
  // NEW STRATEGY: send the LINK-ONLY email FIRST as the guaranteed
  // delivery (the same shape as the /admin-email test send, which
  // the user has confirmed works). Then try the with-attachment
  // email as a bonus second send. This way:
  //   - Customer ALWAYS receives the email (link-only never fails
  //     unless SMTP itself is broken - and the test send proves
  //     it isn't).
  //   - If the attachment send succeeds, customer gets two emails:
  //     one with the link, one with the PDF attached. Two is fine;
  //     deliverability >> elegance.
  //   - If the attachment send fails, we still return ok:true
  //     because the link-only email landed. The admin popup shows
  //     mode:'link-only' + the attachment error so admin can fix
  //     the SMTP size limit / policy without panicking.
  async function sendOnce(attachAttachment) {
    const cleanText = attachAttachment ? text
      : `${text}\n\nDownload your report any time: `
        + 'https://astroseer.in/orders';
    const cleanHtml = attachAttachment ? html
      : html + '<p style="margin:12px 0 0 0;font-size:11px;'
        + 'color:#777">Tip: open '
        + '<a href="https://astroseer.in/orders" style="color:'
        + '#7F2020">My Orders</a> on AstroSeer to download the PDF '
        + 'any time.</p>';
    const opts = {
      from: t.from, to: toEmail, subject, text: cleanText,
      html: cleanHtml,
    };
    if (attachAttachment) {
      opts.attachments = [{ filename: pdfName, content: pdfBuf,
        contentType: 'application/pdf' }];
    }
    return t.transporter.sendMail(withBcc(opts, t));
  }

  // 1) Link-only email - the guaranteed delivery.
  let linkOnlyInfo = null;
  let linkOnlyError = null;
  try {
    linkOnlyInfo = await sendOnce(false);
  } catch (e0) {
    linkOnlyError = String((e0 && e0.message) || e0).slice(0, 500);
  }

  // 2) Bonus with-attachment send.
  let withAttachInfo = null;
  let withAttachError = null;
  try {
    withAttachInfo = await sendOnce(true);
  } catch (e1) {
    withAttachError = String((e1 && e1.message) || e1).slice(0, 500);
  }

  const linkOnlyOk = !!linkOnlyInfo;
  const withAttachOk = !!withAttachInfo;
  const finalMode = withAttachOk
    ? (linkOnlyOk ? 'both' : 'with-attachment')
    : (linkOnlyOk ? 'link-only' : 'none');

  try {
    await auditRef.update({
      status: linkOnlyOk || withAttachOk ? 'sent' : 'failed',
      deliveryMode: finalMode,
      linkOnlyMessageId: linkOnlyOk
        ? (linkOnlyInfo.messageId || '') : '',
      withAttachMessageId: withAttachOk
        ? (withAttachInfo.messageId || '') : '',
      linkOnlyError: linkOnlyError || null,
      withAttachError: withAttachError || null,
    });
  } catch (_) {}

  if (linkOnlyOk || withAttachOk) {
    return {
      ok: true,
      mode: finalMode,
      messageId: (withAttachInfo && withAttachInfo.messageId)
        || (linkOnlyInfo && linkOnlyInfo.messageId) || '',
      // Bubble up the attachment-attempt error even on success so
      // admin sees why the PDF didn't land (SMTP size limit etc.).
      attachmentError: withAttachOk ? null : withAttachError,
      linkOnlyError: linkOnlyOk ? null : linkOnlyError,
    };
  }
  return {
    ok: false,
    error: linkOnlyError || withAttachError || 'SMTP send failed.',
    linkOnlyError,
    attachmentError: withAttachError,
  };
}

// Public entry: handle a kundli PDF request and call res.json/.status
// itself. Invoked from api/kundli.js when body.action === 'report'
// (we keep ONE serverless function for the kundli surface to stay
// under Vercel Hobby's 12-function limit).
async function handleReport(req, res) {
  try {
    return await _handleReportInner(req, res);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Always include CORS so the browser sees the JSON instead of
    // a "Failed to fetch" wall. Common throw causes:
    //   - Firestore RESOURCE_EXHAUSTED (Spark plan daily quota)
    //   - Network blip to Astrology API
    //   - Vercel cold-start hit > 60s
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } catch (_) { /* */ }
    return res.status(503).json({
      ok: false,
      error: /quota/i.test(msg)
        ? 'Report service is at quota right now. Please try again '
          + 'in a few minutes.'
        : `Report service hiccup: ${msg.slice(0, 200)}`,
      detail: msg.slice(0, 500),
    });
  }
}

async function _handleReportInner(req, res) {
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  // Validate the report kind against the known catalogue. Unknown
  // kinds collapse to 'free' so a stale client never accidentally
  // bills the user.
  const KNOWN_KINDS = new Set(
    ['free', 'forecast12', 'careerFinance', 'lifetime']);
  const kind = KNOWN_KINDS.has(body.kind) ? body.kind : 'free';
  const profileId = String(body.kundliProfileId || '').trim();
  const uid = String(body.uid || '').trim();
  if (!profileId || !uid) {
    return res.status(400).json({
      error: 'kundliProfileId and uid required' });
  }

  // 1. Verify ownership of the kundli profile. This is the gate that
  //    enforces "kundli of each person allocated to one user only".
  const pSnap = await db.collection('kundliProfiles').doc(profileId).get();
  if (!pSnap.exists) {
    return res.status(404).json({ error: 'kundli profile not found' });
  }
  const profile = pSnap.data() || {};
  if (String(profile.userId || '') !== uid) {
    return res.status(403).json({
      error: 'kundli profile does not belong to this user' });
  }
  if (!profile.dob) {
    return res.status(400).json({ error: 'profile missing birth data' });
  }

  // birthSig - same shape the shared client kundliService uses. Two
  // profiles with the same DOB / TOB / AM-PM / place collapse into
  // one signature; any minor edit to those four fields changes it.
  // We stamp this on every order doc so a later "cached order
  // lookup" matches only when the birth data is byte-for-byte
  // identical to what generated the existing PDF.
  // Cache key: DOB, TOB, AM/PM, place AND name. Per user request
  // (2026-05-28) the cache must invalidate when any of these
  // change; a name correction is a meaningful regeneration trigger
  // because the cover page + greetings throughout the PDF carry
  // the name. Everything else (lat/lng, isDefault, etc.) is
  // ignored - those don't change the rendered output.
  function birthSig(p) {
    return [p.name, p.dob, p.tob, p.ampm, p.place]
      .map((x) => String(x || '').trim().toLowerCase()).join('|');
  }
  const sig = birthSig(profile);

  // 1b. Hot path: if an order with this exact (kind, profileId,
  //     birthSig) is already 'ready', return that PDF immediately.
  //     No AstroSeer call, no Storage upload, no wallet deduction
  //     for paid kinds (the user already paid for THIS chart). Edit
  //     the profile and the sig changes, so we regenerate - exactly
  //     what the user asked for ("even a minor change must force a
  //     regenerate").
  //
  // Query intentionally only uses two equality filters and no
  // orderBy() so Firestore does NOT need a composite index. The
  // orders subcollection is per-user, almost always under 20 docs,
  // so client-side filtering + pick-most-recent is cheap.
  // Admin can force a rebuild from the order management list or
  // from the user profile by passing regenerate:true. In that mode
  // we SKIP the cache lookup entirely so the relay always generates
  // a fresh PDF (with the latest birth data the admin may just have
  // edited).
  const skipCache = !!body.regenerate;
  try {
    if (skipCache) throw new Error('skipCache'); // jumps to catch
    const cached = await db.collection('users').doc(uid)
      .collection('orders')
      .where('birthSig', '==', sig)
      .where('kind', '==', kind)
      .get();
    const allCached = cached.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.kundliProfileId === profileId);
    const ready = allCached
      .filter((o) => o.status === 'ready' && o.pdfUrl)
      .sort((a, b) => {
        const at = (a.deliveredAt && a.deliveredAt.toMillis
          && a.deliveredAt.toMillis()) || 0;
        const bt = (b.deliveredAt && b.deliveredAt.toMillis
          && b.deliveredAt.toMillis()) || 0;
        return bt - at;
      })[0];

    // PRE-PAID CLAIM PATH (user requirement 2026-05-28).
    // A 'prepaid' or 'prepaid_generating' order means the report
    // was pre-generated in the background when the customer saved
    // their profile. The PDF is sitting in storage but the wallet
    // hasn't been charged yet. When the customer NOW clicks Buy,
    // we debit the wallet, flip the order to 'ready', and serve
    // the PDF immediately - no AstroSeer call, no new generation.
    // Only fires for the explicit-buy path (NOT prepayForAll, NOT
    // autoGenerated, AND price > 0).
    const claimingPrepaid = price > 0
      && !body.prepayForAll
      && !body.autoGenerated
      && !ready;
    if (claimingPrepaid) {
      const prepaid = allCached
        .filter((o) => (o.status === 'prepaid'
          || o.status === 'prepaid_ready') && o.pdfUrl)
        .sort((a, b) => {
          const at = (a.deliveredAt && a.deliveredAt.toMillis
            && a.deliveredAt.toMillis()) || 0;
          const bt = (b.deliveredAt && b.deliveredAt.toMillis
            && b.deliveredAt.toMillis()) || 0;
          return bt - at;
        })[0];
      if (prepaid) {
        // Atomic wallet debit + order claim. If wallet doesn't
        // have enough, return 402 like the regular paid path.
        try {
          await db.runTransaction(async (tx) => {
            const uRef = db.collection('users').doc(uid);
            const uSnap = await tx.get(uRef);
            const wallet = Number((uSnap.data() || {})
              .wallet || 0);
            if (wallet < price) {
              const err = new Error('insufficient wallet');
              err.code = 'insufficient_wallet';
              err.wallet = wallet; err.price = price;
              throw err;
            }
            tx.update(uRef, {
              wallet: wallet - price,
              updatedAt: admin.firestore.FieldValue
                .serverTimestamp(),
            });
            const prepaidRef = db.collection('users').doc(uid)
              .collection('orders').doc(prepaid.id);
            tx.update(prepaidRef, {
              status: 'ready',
              amount: price,
              claimedAt: admin.firestore.FieldValue
                .serverTimestamp(),
            });
            const txRef = db.collection('transactions').doc();
            tx.set(txRef, {
              userId: uid, amount: -price, type: 'debit',
              reason: kind === 'forecast12'
                ? '12-month kundli forecast'
                : 'kundli report',
              referenceId: prepaid.id,
              createdAt: admin.firestore.FieldValue
                .serverTimestamp(),
            });
          });
        } catch (e) {
          if (e.code === 'insufficient_wallet') {
            return res.status(402).json({
              error: 'Insufficient wallet balance.',
              wallet: e.wallet, price: e.price });
          }
          throw e;
        }
        // Resolve URL across every storage tier - including the
        // chunked tier (pdfChunked + pdfChunkCount on the doc).
        // For chunked we surface a sentinel; the customer's
        // resolveOrderPdfUrl reads the subcollection client-side.
        let realUrl;
        if (prepaid.pdfBase64) {
          realUrl = `data:application/pdf;base64,${prepaid.pdfBase64}`;
        } else if (prepaid.pdfChunked && prepaid.pdfChunkCount > 0) {
          realUrl = 'chunked';
        } else {
          realUrl = prepaid.pdfUrl;
        }
        // Per user requirement 2026-05-28: paid kundlis MUST email
        // the customer when they're delivered. Per 2026-05-29: ALSO
        // fire a push notification. Both fire-and-forget so SMTP /
        // FCM latency never delays the PDF response.
        (async () => {
          try {
            let pdfBufClaim = null;
            if (prepaid.pdfBase64) {
              try { pdfBufClaim = Buffer.from(
                prepaid.pdfBase64, 'base64'); } catch (_) { /* */ }
            }
            const uSnap2 = await db.collection('users').doc(uid).get();
            const u2 = (uSnap2.exists ? uSnap2.data() : null) || {};
            const toEmail = u2.email || '';
            if (toEmail) {
              await emailReport({
                db, toEmail, name: u2.name || profile.name || '',
                kind, pdfBuf: pdfBufClaim || Buffer.alloc(0),
                pdfName: prepaid.pdfName || 'AstroSeer-Kundli.pdf',
                complimentary: false,
                senderNote: '',
              });
            }
            // Push: tokens collected the same way as sendPush.js.
            const tokens = (Array.isArray(u2.fcmTokens)
              ? u2.fcmTokens.slice() : []);
            if (u2.fcmToken && !tokens.includes(u2.fcmToken)) {
              tokens.push(u2.fcmToken);
            }
            const valid = tokens.filter(Boolean);
            if (valid.length) {
              const kindLabel = kind === 'forecast12'
                ? '12-Month Forecast'
                : kind === 'careerFinance' ? 'Career Report'
                : kind === 'lifetime' ? 'Lifetime Report'
                : 'Kundli Report';
              await admin.messaging().sendEachForMulticast({
                tokens: valid,
                notification: {
                  title: 'Your report is ready',
                  body: `Your ${kindLabel} has been generated. Tap to`
                    + ' view and download.',
                },
                data: {
                  type: 'report_ready',
                  orderId: String(prepaid.id),
                  kind: String(kind),
                  pdfUrl: String(prepaid.pdfUrl || ''),
                },
                android: { priority: 'high',
                  notification: { channelId: 'reports',
                    defaultSound: true } },
                apns: { payload: { aps: { sound: 'default',
                  'content-available': 1 } } },
              }).catch(() => { /* */ });
            }
          } catch (_) { /* never block the claim response */ }
        })();
        return res.status(200).json({
          ok: true,
          orderId: prepaid.id,
          pdfUrl: realUrl,
          pdfName: prepaid.pdfName || 'AstroSeer-Kundli.pdf',
          sizeBytes: prepaid.sizeBytes || 0,
          amount: price,                  // we just charged this
          kind,
          claimedPrepaid: true,
          cached: true,
        });
      }
    }
    if (ready) {
      // For inline-storage orders the actual pdfUrl on the doc is
      // a short marker ("inline"). The real bytes are on
      // pdfBase64 - rebuild the data URL here so the client gets
      // a clickable download with no extra round-trip.
      const realUrl = ready.pdfBase64
        ? `data:application/pdf;base64,${ready.pdfBase64}`
        : ready.pdfUrl;

      // If the caller explicitly asked to email this cached order
      // (admin "Email complimentary kundli", or the user clicking
      // "Resend by email"), DO email it. Previously this branch
      // returned emailed:false unconditionally, which made the
      // admin progress popup say "Both email attempts failed - relay
      // did not return an error string" even though the PDF was
      // perfectly fine; nothing actually tried to send it.
      let cEmailed = false;
      let cEmailMode = null;
      let cEmailError = null;
      let cAttachmentError = null;
      let cLinkOnlyError = null;
      const wantsEmail = !!body.email || !!body.complimentary
        || !!body.resend;
      if (wantsEmail) {
        // Decode the PDF back into a Buffer for the SMTP attachment.
        let pdfBuf = null;
        if (ready.pdfBase64) {
          try { pdfBuf = Buffer.from(ready.pdfBase64, 'base64'); }
          catch (_) { pdfBuf = null; }
        }
        // Look up the user's email + name (same query the fresh-
        // generate path uses lower down).
        let userEmail = '';
        let userName = profile.name || '';
        try {
          const uSnap = await db.collection('users').doc(uid).get();
          const u = uSnap.data() || {};
          userEmail = u.email || '';
          if (!userName) userName = u.name || '';
        } catch (_) { /* fine */ }
        if (!userEmail) {
          cEmailError = 'no email on file for this user';
        } else if (!pdfBuf) {
          // PDF lives in Vercel Blob (external CDN), not inline -
          // we cannot easily refetch the bytes here without an HTTP
          // GET. Send the link-only flavour so the user still
          // receives an email and can download from the URL.
          const r = await emailReport({
            db, toEmail: userEmail, name: userName,
            kind, pdfBuf: Buffer.alloc(0), pdfName: ready.pdfName
              || 'AstroSeer-Kundli.pdf',
            complimentary: !!body.complimentary,
            senderNote: body.senderNote || '',
          });
          if (r && r.ok) {
            cEmailed = true; cEmailMode = r.mode || 'link-only';
            cAttachmentError = r.attachmentError || null;
            cLinkOnlyError = r.linkOnlyError || null;
          } else {
            cEmailError = (r && r.error) || 'email send failed';
            cAttachmentError = (r && r.attachmentError) || null;
            cLinkOnlyError = (r && r.linkOnlyError) || null;
          }
        } else {
          const r = await emailReport({
            db, toEmail: userEmail, name: userName,
            kind, pdfBuf, pdfName: ready.pdfName
              || 'AstroSeer-Kundli.pdf',
            complimentary: !!body.complimentary,
            senderNote: body.senderNote || '',
          });
          if (r && r.ok) {
            cEmailed = true; cEmailMode = r.mode || 'link-only';
            cAttachmentError = r.attachmentError || null;
            cLinkOnlyError = r.linkOnlyError || null;
          } else {
            cEmailError = (r && r.error) || 'email send failed';
            cAttachmentError = (r && r.attachmentError) || null;
            cLinkOnlyError = (r && r.linkOnlyError) || null;
          }
        }
      }

      return res.status(200).json({
        ok: true,
        orderId: ready.id,
        pdfUrl: realUrl,
        pdfName: ready.pdfName || 'AstroSeer-Kundli.pdf',
        sizeBytes: ready.sizeBytes || 0,
        amount: 0, // never bill twice for the same chart
        kind,
        emailed: cEmailed,
        emailMode: cEmailMode,
        emailError: cEmailError,
        attachmentError: cAttachmentError,
        linkOnlyError: cLinkOnlyError,
        validUntil: ready.validUntil || null,
        cached: true,
      });
    }
  } catch (_) {
    // Never block PDF delivery on a cache-lookup failure - fall
    // through to fresh generation. The original-flow refund/email
    // guarantees still apply.
  }

  // 1c. Stuck-order sweeper. Operator policy (rewritten 2026-06-06):
  //
  //   - GRACE_MS extended from 300s (5 min) to 4 HOURS. AstroSeer
  //     hits transient quota / Render cold-start / weasyprint queue
  //     pressure that can legitimately delay a PDF for hours. The
  //     previous "fail at 5 min" was eagerly refunding customers
  //     for reports the API later marked SENT - the operator's
  //     report: "these reports are already got generated but they
  //     got refunded and shown as failed."
  //
  //   - RESCUE FIRST, REFUND LAST. For every stale order, before
  //     touching the wallet we ask AstroSeer's status endpoint. If
  //     it returns {status:'sent', pdf_ready:true} we fetch the
  //     PDF, push it to R2, mark the order ready, drop a wallet
  //     notification + an in-app notification, and EXIT - NO
  //     REFUND. Same idempotency the rescue endpoint uses.
  //
  //   - Only after 4 hours have passed AND the rescue attempt did
  //     not succeed do we tip into failed_refunded.
  //
  //   - All failures are swallowed so the sweeper never blocks the
  //     primary generate path below.
  const GRACE_MS = 4 * 60 * 60 * 1000;      // 4 hours
  const RESCUE_AFTER_MS = 2 * 60 * 1000;    // start polling after 2 min
  try {
    const stale = await db.collection('users').doc(uid)
      .collection('orders')
      .where('status', 'in',
        ['paid_generating', 'free_generating'])
      .get();
    const now = Date.now();
    const writes = [];
    stale.docs.forEach((d) => {
      const o = d.data() || {};
      const paidMs = (o.paidAt && o.paidAt.toMillis
        && o.paidAt.toMillis()) || 0;
      const ageMs = paidMs ? (now - paidMs) : 0;
      // Skip orders too fresh to bother sweeping (covers the normal
      // happy path where the primary handleReport flow finishes
      // within ~30-60s).
      if (!paidMs || ageMs < RESCUE_AFTER_MS) return;
      const refundAmount = Number(o.amount || 0);
      writes.push((async () => {
        // ---- RESCUE ATTEMPT ----
        // 1. Ask AstroSeer if the order is SENT + pdf_ready.
        let astroStatus = null;
        try {
          const base = process.env.ASTROSEER_API_URL
            || 'https://astroseer-api.onrender.com';
          const sr = await fetch(`${base}/api/orders/`
            + `${encodeURIComponent(d.id)}/status`,
          { method: 'GET' });
          if (sr.ok) astroStatus = await sr.json()
            .catch(() => null);
        } catch (_) { /* network blip */ }
        const isSent = astroStatus
          && astroStatus.status === 'sent'
          && astroStatus.pdf_ready;
        if (isSent) {
          // 2. Fetch PDF bytes from AstroSeer.
          let pdfBuf;
          try {
            const base = process.env.ASTROSEER_API_URL
              || 'https://astroseer-api.onrender.com';
            const pr = await fetch(`${base}/api/orders/`
              + `${encodeURIComponent(d.id)}/pdf`,
            { method: 'GET' });
            if (pr.ok) {
              pdfBuf = Buffer.from(await pr.arrayBuffer());
            }
          } catch (_) { /* leave pdfBuf undefined */ }
          // 3. Upload to R2 (or Vercel Blob fallback) at a
          //    deterministic rescue key so re-runs are idempotent.
          let pdfUrl = null;
          if (pdfBuf) {
            const rescueKey = `rescued/${d.id}.pdf`;
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
              } catch (_) {}
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
              } catch (_) {}
            }
          }
          if (pdfUrl) {
            // 4. Mark order ready (same shape the primary flow uses)
            //    and stamp where the rescue came from for forensics.
            try {
              await d.ref.update({
                status: o.kind === 'free'
                  ? 'ready_rescued' : 'paid_ready',
                pdfUrl,
                pdfReadyAt: admin.firestore.FieldValue
                  .serverTimestamp(),
                rescuedAt: admin.firestore.FieldValue
                  .serverTimestamp(),
                rescueSource: 'sweeper',
                failReason: admin.firestore.FieldValue.delete(),
              });
            } catch (_) {}
            // 5. In-app notification so the customer sees the
            //    PDF available without refreshing the orders list.
            try {
              await db.collection('notifications').add({
                userId: uid,
                type: 'report_ready',
                title: 'Your report is ready',
                message: 'We finished generating your report. '
                  + 'Open Orders to download it.',
                orderId: d.id,
                read: false,
                createdAt: admin.firestore.FieldValue
                  .serverTimestamp(),
              });
            } catch (_) {}
            // 6. Push notification (best-effort).
            try {
              const uSnap = await db.collection('users').doc(uid)
                .get();
              const ud = uSnap.exists ? (uSnap.data() || {}) : {};
              const toks = []
                .concat(Array.isArray(ud.fcmTokens)
                  ? ud.fcmTokens : [])
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
                    orderId: String(d.id) },
                  android: {
                    priority: 'high',
                    notification: {
                      channelId: 'astro-default', sound: 'default',
                    },
                  },
                });
              }
            } catch (_) {}
            try {
              logAstroSeerEvent({
                orderId: d.id,
                status: 'sent',
                kind: o.kind,
                userId: uid,
                error: 'Rescued by sweeper - no refund.',
              });
            } catch (_) {}
            return; // RESCUED. Do not refund.
          }
        }
        // ---- NOT YET SENT. Decide refund vs leave-for-next-sweep ----
        // Until 4 hours have passed we leave the order as
        // *_generating so the next sweep can rescue it. Do NOT
        // refund eagerly.
        if (ageMs < GRACE_MS) return;
        // 4 hours elapsed and AstroSeer still has no PDF. NOW we
        // can safely refund.
        if (refundAmount > 0) {
          try {
            await db.runTransaction(async (tx) => {
              const uRef = db.collection('users').doc(uid);
              const uSnap = await tx.get(uRef);
              const w = Number((uSnap.data() || {}).wallet || 0);
              tx.update(uRef, { wallet: w + refundAmount,
                updatedAt: admin.firestore.FieldValue
                  .serverTimestamp() });
              tx.update(d.ref, {
                status: 'failed_refunded',
                failedAt: admin.firestore.FieldValue.serverTimestamp(),
                failReason: 'Generation did not complete within '
                  + '4 hours; wallet auto-refunded.',
              });
              const txRef = db.collection('transactions').doc();
              tx.set(txRef, {
                userId: uid, amount: refundAmount, type: 'credit',
                reason: 'Kundli report refund (4h timeout)',
                referenceId: d.id,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            });
          } catch (_) { /* leave for next sweep */ }
        } else {
          await d.ref.update({
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failReason: 'Generation did not complete within 4 hours.',
          }).catch(() => {});
        }
        try {
          logAstroSeerEvent({
            orderId: d.id,
            status: 'failed',
            kind: o.kind,
            userId: uid,
            error: 'Generation did not complete within 4 hours'
              + (refundAmount > 0 ? '; auto-refunded.' : '.'),
          });
        } catch (_) { /* swallow */ }
      })());
    });
    if (writes.length) await Promise.all(writes);
  } catch (_) { /* sweeper failure must not block fresh generate */ }

  // 2. Resolve price + check we have AstroSeer creds.
  const price = await getReportPrice(db, kind);
  const { base, key } = await getAstroSeerCreds(db);

  // 2b. Mint an 8-digit numeric Order ID for the new doc.
  //
  // We use an atomic-transaction counter at counters/orderNumber so
  // every order gets a strictly increasing, unique 8-digit id like
  // 10000001, 10000002, ... up to 99999999 (~90M orders of room).
  // Sequential numeric IDs are easier for the customer to read +
  // dictate in support tickets, easier for admin to search, and
  // can never collide. Falls back to Firestore's auto-generated
  // doc id on transaction failure so a single bad transaction
  // doesn't block the customer's purchase.
  const orderId = await mintOrderId(db);

  // 3. For paid kinds: atomic wallet deduct + order placeholder.
  //
  // REGENERATE EXCEPTION: when body.regenerate is true (admin
  // Regenerate button, or any retry), we are NOT selling a new
  // report - the customer already paid for this chart in a prior
  // order. Skip the wallet deduct entirely and just create a new
  // order doc with amount:0. Without this, every Regenerate click
  // would re-charge the wallet ₹299, which is what the user just
  // reported as a bug.
  let orderRef = db.collection('users').doc(uid)
    .collection('orders').doc(orderId);
  let chargedAmount = 0;
  // 2026-06-07 bugfix: when admin generates a report and ticks
  // "complimentary", we MUST NOT debit the wallet. Previously this
  // gate omitted !body.complimentary so admin gifts were charged
  // anyway (operator: "selected as complimentary but still money was
  // debited from the client wallet").
  if (price > 0 && !body.regenerate && !body.prepayForAll
    && !body.complimentary) {
    const userRef = db.collection('users').doc(uid);
    try {
      await db.runTransaction(async (tx) => {
        const uSnap = await tx.get(userRef);
        const wallet = Number((uSnap.data() || {}).wallet || 0);
        if (wallet < price) {
          const err = new Error('insufficient wallet');
          err.code = 'insufficient_wallet';
          err.wallet = wallet; err.price = price;
          throw err;
        }
        tx.update(userRef, {
          wallet: wallet - price,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(orderRef, {
          kind, kundliProfileId: profileId, amount: price,
          status: 'paid_generating',
          // birthSig is the cache key; profile snapshot makes
          // /orders rows human-readable without an extra join.
          birthSig: sig,
          profileName: profile.name || '',
          profileDob: profile.dob || '',
          profileTob: profile.tob || '',
          profileAmpm: profile.ampm || '',
          profilePlace: profile.place || '',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Ledger row so /transactions shows the debit. Amount is
        // stored as a NEGATIVE number for debits (matches the
        // session-end pattern in sessionService.endAndSettleClient);
        // the transactions page colours by sign, so a positive
        // value here would render as a credit.
        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId: uid, amount: -price, type: 'debit',
          reason: kind === 'forecast12'
            ? '12-month kundli forecast'
            : 'kundli report',
          referenceId: orderRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      chargedAmount = price;
    } catch (e) {
      if (e.code === 'insufficient_wallet') {
        // Log the insufficient-wallet attempt to the AstroSeer
        // Activity feed BEFORE returning 402, so the failure
        // shows up in the central admin view too (it used to be
        // invisible because we returned early).
        try {
          const uSnap = await db.collection('users').doc(uid).get();
          const u = (uSnap.exists ? uSnap.data() : null) || {};
          logAstroSeerEvent({
            creds: { baseUrl: base },
            orderId: orderRef.id,
            status: 'failed',
            kind,
            userName: u.name || '',
            userEmail: u.email || '',
            userId: uid,
            amount: price,
            error: `Insufficient wallet (₹${e.wallet} < ₹${price})`,
          });
        } catch (_) { /* swallow */ }
        return res.status(402).json({
          error: 'Insufficient wallet balance.',
          wallet: e.wallet, price: e.price });
      }
      throw e;
    }
  } else if (price > 0 && body.regenerate) {
    // Regenerate of a paid order: create a new order doc with
    // amount:0 (since the customer was already charged on the
    // original order) so /orders shows it as a free retry instead
    // of pretending they paid twice.
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: 0,
      status: 'paid_generating',
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      regeneratedFrom: body.fromOrderId || '',
    });
  } else if (price > 0 && body.complimentary) {
    // COMPLIMENTARY path (2026-06-07). Admin generates a paid-tier
    // report as a gift for the customer. No wallet debit, no
    // transactions row. Order doc carries amount:0 + complimentary
    // markers so:
    //   - /orders shows it labelled "Complimentary"
    //   - the email + push templates pick up the complimentary
    //     copy (loadOrderForEmail already reads .complimentary)
    //   - revenue dashboards exclude it from real-revenue totals
    // Status stays "paid_generating" so the same fulfilment pipeline
    // (AstroSeer call -> R2 upload -> deliver) runs unchanged.
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: 0,
      status: 'paid_generating',
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      complimentary: true,
      issuedByAdmin: true,
      originalPrice: price,
    });
  } else if (price > 0 && body.prepayForAll) {
    // PRE-GENERATION path (user requirement 2026-05-28). The
    // moment customer saves their kundli profile we kick off the
    // paid reports too so they are ready in storage. We do NOT
    // debit the wallet here - the order sits with status:'prepaid'
    // until the customer explicitly clicks Buy on the report.
    // The cache-check logic at handleReport entry recognises
    // 'prepaid' orders and routes them to a wallet-debit-on-
    // claim path. After-debit the order flips to status:'ready'
    // and the PDF is delivered immediately (no AstroSeer call).
    // Records the full price so cache + paid-claim logic knows
    // what to charge later.
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: price,
      // Prepaid pseudo-status: PDF is being generated but the
      // customer has not paid for it yet. Distinguished from
      // 'paid_generating' which means the wallet already debited.
      status: 'prepaid_generating',
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      prepaid: true,
      autoGenerated: !!body.autoGenerated,
    });
  } else {
    // Free kind: still write an order doc for the user's history.
    // autoGenerated:true marks orders that were kicked off by the
    // profile-save background trigger (not an explicit click) so
    // the email-on-ready path knows to skip + the customer-side
    // UI can show "we will notify you" copy instead of "PDF is
    // generating, please wait".
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: 0,
      status: 'free_generating',
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
      autoGenerated: !!body.autoGenerated,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // AstroSeer central Activity feed: lifecycle event 1/3 -
  // "generating". Fire-and-forget so it never blocks the PDF
  // generation if the central log endpoint is slow / down.
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const u = (uSnap.exists ? uSnap.data() : null) || {};
    logAstroSeerEvent({
      creds: { baseUrl: base },
      orderId: orderRef.id,
      status: 'generating',
      kind,
      userName: u.name || '',
      userEmail: u.email || '',
      userId: uid,
      amount: chargedAmount || 0,
      birthSummary: birthSummaryFromProfile(profile),
      place: profile.place || '',
    });
  } catch (_) { /* never let logging break the flow */ }

  // 4. Build AstroSeer report body. They take the same birth fields
  //    as /api/kundli plus a `tier` (9 = the deepest one). For the
  //    forecast we pass `months: 12` so the API knows to bake the
  //    next 12 monthly transit + dasha forecasts into the PDF.
  //
  // Resolve lat/lng: profiles created by the BirthInputs CityField
  // only carry a `place` string label - no numeric coords. AstroSeer
  // 422's on null lat/lng, so we geocode the place text via the
  // same Open-Meteo lookup api/kundli.js uses. If that ALSO fails
  // we fall back to Mumbai (Vedic apps' default reference) so the
  // PDF still ships a valid chart rather than failing the whole
  // request.
  const p = parseDob(profile.dob, profile.tob, profile.ampm);
  let lat = Number(profile.lat) || 0;
  let lng = Number(profile.lng) || 0;
  if (!lat || !lng) {
    const g = await geocode(profile.place || '');
    if (g) { lat = g.lat; lng = g.lng; }
  }
  if (!lat || !lng) {
    // Last-ditch default so an empty place doesn't kill the request.
    lat = 19.076; lng = 72.8777;
  }

  // ASYNC GENERATION (2026-05-27 AstroSeer spec): kick off PDF
  // generation on AstroSeer via POST /api/orders/log with full birth
  // params. The endpoint stores the order AND immediately begins
  // background PDF generation, returning in <100ms. The customer
  // then polls /api/orders/{id}/status (via our reportStatus action).
  //
  // This replaces the old synchronous POST /api/kundli/pdf that
  // blocked the relay function for 60-80s on long reports and
  // tripped the 90s timeout for full_life / consolidated_premium /
  // lifetime kinds.
  const profileTz = Number(profile.tz);
  const tzOffset = Number.isFinite(profileTz) ? profileTz : 5.5;
  // Fetch user record once for email + name to enrich the log payload
  // (helps the AstroSeer admin Activity feed show real customer info).
  let userEmail = '';
  let userName = profile.name || '';
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const u = uSnap.data() || {};
    userEmail = u.email || '';
    if (!userName) userName = u.name || '';
  } catch (_) { /* fine */ }

  // Map our internal kind -> AstroSeer report_type enum.
  const REPORT_TYPE = {
    free: 'basic',
    forecast12: 'yearly',
    careerFinance: 'career',
    lifetime: 'full_life',
  };

  const startBody = {
    order_id: orderRef.id,
    status: 'generating',
    report_type: REPORT_TYPE[kind] || 'basic',
    customer_name: userName,
    customer_email: userEmail,
    customer_uid: uid,
    amount: chargedAmount || 0,
    place: profile.place || '',
    birth_summary: birthSummaryFromProfile(profile),
    // Birth params - AstroSeer needs these to generate without a
    // separate kundli call.
    birth_year: p.y,
    birth_month: p.m,
    birth_day: p.d,
    birth_hour: p.hh,
    birth_minute: p.mm,
    birth_second: 0,
    tz_offset: tzOffset,
    latitude: lat,
    longitude: lng,
  };
  // Two-pass POST to /api/orders/log so a cold Render dyno (30-40s
  // wake-up) does not abort our request and refund the customer for
  // nothing. First pass: 45s timeout - covers a cold wake-up plus
  // the endpoint's own work. Second pass (only if first aborted):
  // 20s - dyno is now warm, this is the retry path.
  async function postOrdersLog(timeoutMs) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(`${base}/api/orders/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startBody),
        signal: ac.signal,
      });
    } finally { clearTimeout(tid); }
  }
  // NEW NON-ABORTING STRATEGY (2026-05-27): the kick-off POST is
  // best-effort. If it succeeds: great, we record the job ref and
  // tell the client to start polling. If it ABORTS (cold dyno) or
  // returns a non-OK status: we STILL return 200 to the client
  // with status:'generating' and set kickoffPending:true on the
  // Firestore order. The reportStatus poll handler will then
  // RE-ATTEMPT the kick-off on its first poll once the dyno is
  // warm. This way the customer never sees "This operation was
  // aborted" - the worst case is one polling cycle of latency.
  let startResp = null;
  let startError = null;
  try {
    // Shortened from 45s to 15s on 2026-05-28. AstroSeer's Render
    // free-tier dyno is single-worker, so when a PDF generation is
    // in flight, the next POST to /api/orders/log just QUEUES at
    // the edge until the worker is free (observed 30s+ hangs in
    // the user's screenshots). A short timeout + kickoffPending
    // flag + polling retry path is more responsive than waiting
    // 45s upfront. The cold-start window (~30s) is still covered
    // by the polling retry which runs every 5s from the client.
    startResp = await postOrdersLog(15000);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      try { startResp = await postOrdersLog(10000); }
      catch (e2) { startError = e2; }
    } else { startError = e; }
  }
  let startJson = {};
  let kickoffOk = false;
  if (startResp && startResp.ok) {
    startJson = await startResp.json().catch(() => ({}));
    kickoffOk = true;
  } else if (startResp && !startResp.ok) {
    const t = await startResp.text().catch(() => '');
    startError = new Error(`AstroSeer /api/orders/log returned `
      + `${startResp.status}: ${t.slice(0, 200)}`);
  }
  // Persist the AstroSeer-side job reference + async flag so the
  // poll handler can verify it kicked off. ALSO record
  // kickoffPending when the POST failed so polling can retry it.
  await orderRef.update({
    astroseerJobRef: startJson.job_ref
      || `ord_${orderRef.id}`,
    asyncGenerationStarted: !!startJson.async_generation_started,
    asyncStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    kickoffPending: !kickoffOk,
    kickoffLastError: kickoffOk ? null
      : String((startError && startError.message) || startError
        || 'unknown'),
  });

  // Return IMMEDIATELY to the customer. They will poll the
  // reportStatus action every 5s until status flips to 'ready'.
  // Even if kickoff to AstroSeer failed above, polling will retry
  // it - the customer experience is "Generating..." not an abort.
  return res.status(200).json({
    ok: true,
    orderId: orderRef.id,
    status: 'generating',
    asyncGenerationStarted: !!startJson.async_generation_started,
    kickoffPending: !kickoffOk,
    pollAction: 'reportStatus',
    pdfAction: 'reportPdf',
    amount: chargedAmount,
    kind,
  });
}

// ====================================================================
// ASYNC POLLING HANDLERS - the customer UI calls these every 5s after
// the initial handleReport returns status:'generating'. They proxy to
// AstroSeer's new /api/orders/{id}/status + /api/orders/{id}/pdf
// endpoints, cache the PDF in Firestore (so /orders re-downloads keep
// working forever), and run the email + sweeper logic when status
// first flips to 'sent'.
// ====================================================================

// Quick helper: extract base URL the same way handleReport does.
async function resolveAstroSeerBase(db) {
  const { base } = await getAstroSeerCreds(db);
  return base || 'https://astroseer-api.onrender.com';
}

// Pull the user's email + name (best-effort) for the email-on-ready
// flow inside the status poller.
async function loadUserContact(db, uid) {
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const u = (uSnap.exists ? uSnap.data() : null) || {};
    return { email: u.email || '', name: u.name || '' };
  } catch (_) { return { email: '', name: '' }; }
}

async function handleReportStatus(req, res) {
  try {
    return await _handleReportStatusInner(req, res);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Graceful failure (rather than FUNCTION_INVOCATION_FAILED) so
    // the customer-side polling keeps showing "generating" instead
    // of breaking the UI. The actual error is surfaced in the
    // warning field for admin inspection.
    return res.status(200).json({
      ok: true,
      status: 'generating',
      warning: `Status check transient error: ${msg.slice(0, 240)}`,
    });
  }
}

async function _handleReportStatusInner(req, res) {
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  const orderIdRaw = body.orderId || body.order_id || '';
  const uid = String(body.uid || '').trim();
  const orderId = String(orderIdRaw || '').trim();
  if (!orderId || !uid) {
    return res.status(400).json({ error: 'orderId and uid required' });
  }

  // Read our Firestore order doc to know the kind + current state.
  const orderRef = db.collection('users').doc(uid)
    .collection('orders').doc(orderId);
  const oSnap = await orderRef.get();
  if (!oSnap.exists) {
    return res.status(404).json({ error: 'order not found' });
  }
  const o = oSnap.data() || {};
  const kind = o.kind || 'free';

  // If we already cached the PDF, return ready immediately - no
  // need to bother AstroSeer.
  if ((o.status === 'ready' || o.status === 'ready_rescued')
      && (o.pdfUrl || o.pdfBase64)) {
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'ready',
      rescued: o.status === 'ready_rescued',
      pdfUrl: o.pdfBase64
        ? `data:application/pdf;base64,${o.pdfBase64}`
        : o.pdfUrl,
      pdfName: o.pdfName || 'AstroSeer-Kundli.pdf',
      sizeBytes: o.sizeBytes || 0,
      kind,
    });
  }
  // RESCUE PATH: order is locally marked failed_refunded, but
  // AstroSeer's own auto-resume may have succeeded after we
  // refunded. Probe AstroSeer status; if it now says 'sent', we
  // pull the PDF and deliver it. The wallet stays refunded
  // (customer effectively gets the PDF free as compensation for
  // the relay's premature refund). DO NOT short-circuit to
  // failed_refunded here - fall through to the AstroSeer poll
  // below, with a flag to handle the success branch carefully.
  const isRescue = o.status === 'failed_refunded'
    || o.status === 'failed';
  if ((o.status === 'failed' || o.status === 'failed_refunded')
      && !isRescue) {
    // Unreachable - isRescue is always true for failed states.
    // Keeping the guard for clarity of intent.
    return res.status(200).json({
      ok: false,
      orderId,
      status: o.status,
      error: o.failReason || 'Generation failed.',
      refunded: o.status === 'failed_refunded',
      kind,
    });
  }

  // Poll AstroSeer.
  const base = await resolveAstroSeerBase(db);

  // KICKOFF RETRY: if the initial POST /api/orders/log aborted
  // during a cold dyno window (kickoffPending:true on the order
  // doc), retry it now. AstroSeer's upsert means a duplicate POST
  // with the same order_id is safe. After the retry we fall
  // through to the regular status poll.
  if (o.kickoffPending) {
    try {
      const profSnap = await db.collection('kundliProfiles')
        .doc(o.kundliProfileId).get();
      const prof = (profSnap.exists ? profSnap.data() : null) || {};
      const pd = parseDob(prof.dob || o.profileDob,
        prof.tob || o.profileTob,
        prof.ampm || o.profileAmpm);
      let kLat = Number(prof.lat) || 0;
      let kLng = Number(prof.lng) || 0;
      if (!kLat || !kLng) {
        const g = await geocode(prof.place || o.profilePlace || '');
        if (g) { kLat = g.lat; kLng = g.lng; }
      }
      if (!kLat || !kLng) { kLat = 19.076; kLng = 72.8777; }
      const ktz = Number(prof.tz);
      const ktzOffset = Number.isFinite(ktz) ? ktz : 5.5;
      const REPORT_TYPE_MAP = {
        free: 'basic', forecast12: 'yearly',
        careerFinance: 'career', lifetime: 'full_life',
      };
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 20000);
      const r = await fetch(`${base}/api/orders/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          status: 'generating',
          report_type: REPORT_TYPE_MAP[kind] || 'basic',
          customer_uid: uid,
          place: prof.place || o.profilePlace || '',
          birth_summary: birthSummaryFromProfile(prof),
          birth_year: pd.y, birth_month: pd.m, birth_day: pd.d,
          birth_hour: pd.hh, birth_minute: pd.mm, birth_second: 0,
          tz_offset: ktzOffset,
          latitude: kLat, longitude: kLng,
        }),
        signal: ac.signal,
      });
      if (r && r.ok) {
        await orderRef.update({
          kickoffPending: false,
          kickoffRetriedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (_) { /* keep kickoffPending - next poll retries */ }
    // Return generating without polling /status this tick; let
    // the next poll (5s later) actually fetch status.
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      kickoffRetry: true,
      kind,
    });
  }
  let astroStatus = null;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 10000);
    let r;
    try {
      r = await fetch(`${base}/api/orders/${encodeURIComponent(orderId)}`
        + `/status`, { method: 'GET', signal: ac.signal });
    } finally { clearTimeout(tid); }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      // 404 from /api/orders/{id}/status during the first ~5s is
      // normal - the AstroSeer side hasn't finished writing the
      // job record yet. Return generating so client keeps polling.
      return res.status(200).json({
        ok: true,
        orderId,
        status: 'generating',
        astroseerStatusCode: r.status,
        // Only show the warning to the UI when it's NOT the
        // expected 404 race; otherwise the customer sees a scary
        // message during normal startup.
        warning: r.status === 404
          ? null
          : `AstroSeer status check returned ${r.status}: `
            + `${t.slice(0, 200)}`,
        kind,
      });
    }
    astroStatus = await r.json().catch(() => ({}));
  } catch (e) {
    // Network blip. Keep showing 'generating' to the customer so
    // they don't see a fake failure.
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      warning: `Status check transient error: `
        + `${(e && e.message) || e}`,
      kind,
    });
  }

  const remoteStatus = String(astroStatus.status || 'generating');

  // Still generating. Reflect any retry_count / resumed_at to the
  // UI so a long premium report can show "Resumed (retry 2)" copy.
  if (remoteStatus === 'generating') {
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      retryCount: astroStatus.retry_count || 0,
      resumedAt: astroStatus.resumed_at || null,
      createdAt: astroStatus.created_at || null,
      kind,
    });
  }

  if (remoteStatus === 'failed') {
    // If we are already in rescue mode (Firestore says
    // failed_refunded but client is still polling), DO NOT
    // try to refund again - just report the current state.
    if (isRescue) {
      return res.status(200).json({
        ok: false,
        orderId,
        status: o.status,
        error: o.failReason || astroStatus.error
          || 'Generation failed.',
        refunded: o.status === 'failed_refunded',
        kind,
      });
    }
    // PATIENCE TIMER: AstroSeer's own internal auto-resume
    // (up to 3 tries per their spec) often succeeds within
    // 60-90 seconds AFTER reporting failed on a polling
    // request. If we refund the moment we see 'failed', we
    // strand orders that AstroSeer eventually delivers
    // successfully. So: on first 'failed' sighting, set a
    // failedSeenAt timestamp and KEEP polling. Only after
    // 90 seconds of CONFIRMED 'failed' do we actually
    // refund.
    const failedSeenAtMs = o.failedSeenAt && o.failedSeenAt.toMillis
      ? o.failedSeenAt.toMillis() : 0;
    if (!failedSeenAtMs) {
      await orderRef.update({
        failedSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastFailReason: astroStatus.error
          || 'AstroSeer reported failed.',
      }).catch(() => {});
      return res.status(200).json({
        ok: true,
        orderId,
        status: 'generating',
        warning: 'Generation hit a hiccup, waiting for '
          + 'AstroSeer auto-resume...',
        kind,
      });
    }
    const failedAgeMs = Date.now() - failedSeenAtMs;
    if (failedAgeMs < 90 * 1000) {
      // Less than 90s since first failed sighting - keep
      // polling so AstroSeer auto-resume can land.
      return res.status(200).json({
        ok: true,
        orderId,
        status: 'generating',
        warning: `Generation hiccup ~${Math.round(failedAgeMs
          / 1000)}s ago, waiting for auto-resume...`,
        kind,
      });
    }
    // 90s of confirmed failed. AUTO-RETRY before refunding -
    // re-POST /api/orders/log so AstroSeer restarts cleanly.
    // 2026-05-28 user screenshot showed AstroSeer aborting at
    // "23s / 8s · 99%" - generation reached 99% then aborted on
    // their side. Bumped from 1 to 3 retries (matching their
    // own "auto-resume retries up to 3 times" promise) since
    // these aborts are transient and tend to clear by the next
    // attempt.
    const MAX_RETRIES = 3;
    const retried = Number(o.astroseerRetryCount || 0);
    if (retried < MAX_RETRIES) {
      try {
        // Rebuild the birth payload from the saved profile fields
        // we snapshotted onto the order doc. Same shape as the
        // initial POST.
        const profSnap = await db.collection('kundliProfiles')
          .doc(o.kundliProfileId).get();
        const prof = (profSnap.exists ? profSnap.data() : null) || {};
        const pd = parseDob(prof.dob || o.profileDob,
          prof.tob || o.profileTob,
          prof.ampm || o.profileAmpm);
        let lat = Number(prof.lat) || 0;
        let lng = Number(prof.lng) || 0;
        if (!lat || !lng) {
          const g = await geocode(prof.place
            || o.profilePlace || '');
          if (g) { lat = g.lat; lng = g.lng; }
        }
        if (!lat || !lng) { lat = 19.076; lng = 72.8777; }
        const tz = Number(prof.tz);
        const tzOffset = Number.isFinite(tz) ? tz : 5.5;
        const REPORT_TYPE = {
          free: 'basic', forecast12: 'yearly',
          careerFinance: 'career', lifetime: 'full_life',
        };
        const retryBody = {
          order_id: orderId,
          status: 'generating',
          report_type: REPORT_TYPE[kind] || 'basic',
          customer_uid: uid,
          place: prof.place || o.profilePlace || '',
          birth_summary: birthSummaryFromProfile(prof),
          birth_year: pd.y, birth_month: pd.m, birth_day: pd.d,
          birth_hour: pd.hh, birth_minute: pd.mm, birth_second: 0,
          tz_offset: tzOffset, latitude: lat, longitude: lng,
        };
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 20000);
        const retryResp = await fetch(`${base}/api/orders/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryBody),
          signal: ac.signal,
        });
        if (retryResp && retryResp.ok) {
          await orderRef.update({
            astroseerRetryCount: retried + 1,
            astroseerRetriedAt:
              admin.firestore.FieldValue.serverTimestamp(),
            lastFailReason:
              astroStatus.error || 'AstroSeer reported failed.',
          });
          // Tell the client we are retrying so the polling UI
          // can show the right copy.
          return res.status(200).json({
            ok: true,
            orderId,
            status: 'generating',
            retryCount: retried + 1,
            retried: true,
            warning: 'Generation hiccup, auto-retrying...',
            kind,
          });
        }
      } catch (_) {
        // Retry POST itself failed - fall through to refund below
        // so the customer is never billed for a missing PDF.
      }
    }

    // Already retried once (or retry POST itself failed).
    //
    // 4-HOUR-GRACE POLICY (rewritten 2026-06-06):
    //  AstroSeer routinely throws transient errors (RESOURCE_EXHAUSTED
    //  / Render cold-start / weasyprint queue pressure) that resolve
    //  themselves minutes-to-hours later. The previous code refunded
    //  the customer on the FIRST after-retry failure, then the
    //  sweeper would later see the same order, find the PDF was
    //  actually SENT, and the operator was stuck with a refunded
    //  customer + a delivered report. Operator report: "these reports
    //  are already got generated but they got refunded and shown as
    //  failed."
    //
    //  New rule: do NOT refund here. Stamp the error on the order and
    //  leave status='paid_generating' (or whatever it was) so the
    //  4-hour sweeper above (handleReport) and handleSweepPending can
    //  keep polling AstroSeer. The sweeper rescues the order if
    //  AstroSeer eventually returns SENT, and only refunds at the
    //  4-hour deadline if SENT never arrives.
    const chargedAmount = Number(o.amount || 0);
    try {
      await orderRef.update({
        lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
        lastErrorReason: astroStatus.error
          || 'AstroSeer reported failed - sweeper will keep polling '
            + 'for up to 4 hours before deciding.',
        astroseerRetryCount: retried + 1,
      });
    } catch (_) { /* status update is best-effort */ }
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      retryCount: retried + 1,
      retried: true,
      warning: astroStatus.error
        || 'Generation hiccup - we will keep checking for up to '
        + '4 hours before deciding.',
      pendingDecision: true,
      paidAmount: chargedAmount,
      kind,
    });
  }

  // remoteStatus === 'sent' (or any other ready-marker). Fetch the
  // PDF bytes, upload to our storage, update Firestore, email the
  // user. After this, every subsequent poll returns 'ready'
  // instantly from the early-exit at the top.
  let pdfBuf;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 50000);
    let r;
    try {
      r = await fetch(`${base}/api/orders/${encodeURIComponent(orderId)}`
        + `/pdf`, { method: 'GET', signal: ac.signal });
    } finally { clearTimeout(tid); }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`AstroSeer PDF fetch ${r.status}: `
        + `${t.slice(0, 200)}`);
    }
    pdfBuf = Buffer.from(await r.arrayBuffer());
    if (!pdfBuf.length) throw new Error('Empty PDF from AstroSeer');
  } catch (e) {
    // PDF fetch failed even though AstroSeer says sent. Return
    // generating-with-warning so the client keeps polling and we
    // try again on the next tick.
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      warning: `PDF fetch retry pending: ${(e && e.message) || e}`,
      kind,
    });
  }

  let uploaded;
  try {
    uploaded = await uploadPdf(uid, kind, pdfBuf);
  } catch (e) {
    return res.status(200).json({
      ok: true,
      orderId,
      status: 'generating',
      warning: `Storage upload retry pending: `
        + `${(e && e.message) || e}`,
      kind,
    });
  }

  const pdfFileName = `AstroSeer-${kind === 'forecast12'
    ? '12-Month-Forecast' : 'Kundli'}-${o.profileName
    || uid.slice(0, 6)}.pdf`;
  const validUntil = kind === 'forecast12'
    ? new Date(new Date().setMonth(new Date().getMonth() + 12))
        .toISOString()
    : null;
  // PRE-PAID ORDER COMPLETION: if this order was kicked off via
  // prepayForAll (status was 'prepaid_generating'), the PDF is
  // now ready BUT the customer hasn't paid yet. Mark as
  // 'prepaid' (PDF cached, awaiting wallet claim) instead of
  // jumping straight to 'ready'. The claim path in handleReport
  // flips it to 'ready' on the customer's actual Buy click.
  const finalStatus = (o.status === 'prepaid_generating')
    ? 'prepaid'
    : 'ready';
  const orderPatch = {
    status: finalStatus,
    pdfUrl: uploaded.inline ? 'inline' : uploaded.url,
    storagePath: uploaded.storagePath,
    bucketUsed: uploaded.bucketUsed || '',
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // Dual-write backup: when both Vercel Blob AND R2 are configured,
  // uploadPdf wrote to BOTH and exposed the second URL as backupUrl.
  // Save it on the order so the customer-side resolveOrderPdfUrl
  // can fall back to it if the primary URL is unreachable at
  // download time (CDN outage, deleted blob, etc.).
  if (uploaded.backupUrl) {
    orderPatch.pdfBackupUrl = uploaded.backupUrl;
    orderPatch.backupStoragePath = uploaded.backupStoragePath || null;
    orderPatch.backupBucket = uploaded.backupBucket || '';
  }
  // RESCUE: order was previously marked failed_refunded (we
  // refunded the wallet too eagerly), but AstroSeer ultimately
  // delivered the PDF. Flip to ready_rescued so admin can
  // tell the story in Order Management. The customer's wallet
  // STAYS refunded - they get the PDF effectively as a
  // goodwill gesture for the relay's premature refund.
  if (isRescue) {
    orderPatch.status = 'ready_rescued';
    orderPatch.rescuedAt = admin.firestore.FieldValue
      .serverTimestamp();
    orderPatch.rescueNote = 'AstroSeer auto-resume delivered the '
      + 'PDF after the relay had marked failed_refunded. PDF '
      + 'delivered to customer, wallet refund preserved.';
  }
  if (uploaded.inline && uploaded.pdfBase64) {
    orderPatch.pdfBase64 = uploaded.pdfBase64;
  }
  // CHUNKED FIRESTORE STORAGE: the bulletproof tier from uploadPdf.
  // Write each 800 KB chunk as users/{uid}/orders/{orderId}/pdfChunks/{idx}.
  // The customer-side service reassembles + builds the data URL on
  // download. No storage bucket needed, no env vars, no IAM grants.
  if (uploaded.chunked && uploaded.pdfBuf) {
    const CHUNK = 800 * 1024;
    const b64 = uploaded.pdfBuf.toString('base64');
    const chunks = [];
    for (let i = 0; i < b64.length; i += CHUNK) {
      chunks.push(b64.slice(i, i + CHUNK));
    }
    const chunksRef = orderRef.collection('pdfChunks');
    // Firestore batches cap at 500 ops - PDFs would need to be
    // 400 MB+ to hit that. Single batch is safe.
    const batch = db.batch();
    for (let i = 0; i < chunks.length; i += 1) {
      batch.set(chunksRef.doc(String(i).padStart(4, '0')), {
        idx: i, data: chunks[i],
      });
    }
    await batch.commit();
    orderPatch.pdfChunkCount = chunks.length;
    orderPatch.pdfChunked = true;
  }
  await orderRef.update(orderPatch);

  // AstroSeer central Activity feed: mark sent on our side (the
  // ASCENDANT API already shows 'sent', but this keeps the feed
  // accurate if our relay was added/removed mid-flow).
  try {
    logAstroSeerEvent({
      creds: { baseUrl: base },
      orderId,
      status: 'sent',
      kind,
      userId: uid,
      bytesOut: pdfBuf.length,
    });
  } catch (_) { /* swallow */ }

  // Email the PDF (best-effort, async). Skipped when:
  //   1) order was AUTO-GENERATED by saving a kundli profile (no
  //      explicit user click), OR
  //   2) order is PRE-PAID (customer hasn't paid yet, so the PDF
  //      should sit silently until they actually click Buy and
  //      claim it - emailing now would be a free leak).
  // Explicit "Send via email" button clicks bypass both checks by
  // hitting the cache path which emails via wantsEmail.
  const skipEmail = !!body.skipEmail || !!o.autoGenerated
    || finalStatus === 'prepaid';
  const { email: userEmail, name: userName } = await loadUserContact(
    db, uid);
  if (userEmail && !skipEmail) {
    emailReport({
      db, toEmail: userEmail, name: userName || o.profileName,
      kind, pdfBuf, pdfName: pdfFileName,
      complimentary: !!body.complimentary,
      senderNote: body.senderNote || '',
    }).catch(() => { /* swallow - email is not the critical path */ });
  }
  // PUSH NOTIFICATION (user requirement 2026-05-29). Paid reports
  // fire a push to the customer's registered device(s) when the PDF
  // is ready. Free / auto-generated / prepaid (not yet claimed)
  // orders do NOT push - those flow through the in-app inline notice
  // instead so we don't spam the customer.
  const shouldPush = !skipEmail && !o.autoGenerated
    && finalStatus !== 'prepaid';
  if (shouldPush) {
    (async () => {
      try {
        const uSnap = await db.collection('users').doc(uid).get();
        const ud = uSnap.exists ? uSnap.data() : null;
        if (!ud) return;
        const tokens = (Array.isArray(ud.fcmTokens)
          ? ud.fcmTokens.slice() : []);
        if (ud.fcmToken && !tokens.includes(ud.fcmToken)) {
          tokens.push(ud.fcmToken);
        }
        const valid = tokens.filter(Boolean);
        if (!valid.length) return;
        const kindLabel = kind === 'forecast12'
          ? '12-Month Forecast'
          : kind === 'careerFinance' ? 'Career Report'
          : kind === 'lifetime' ? 'Lifetime Report'
          : 'Kundli Report';
        await admin.messaging().sendEachForMulticast({
          tokens: valid,
          notification: {
            title: 'Your report is ready',
            body: `Your ${kindLabel} has been generated. Tap to view`
              + ' and download.',
          },
          data: {
            type: 'report_ready',
            orderId: String(orderId),
            kind: String(kind),
            pdfUrl: String(uploaded.inline ? '' : uploaded.url),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'reports',
              defaultSound: true,
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                'content-available': 1,
              },
            },
          },
        });
      } catch (_) { /* push is best-effort, never break the flow */ }
    })();
  }

  const finalUrl = uploaded.inline && uploaded.pdfBase64
    ? `data:application/pdf;base64,${uploaded.pdfBase64}`
    : uploaded.url;

  return res.status(200).json({
    ok: true,
    orderId,
    status: 'ready',
    pdfUrl: finalUrl,
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    kind,
  });
}

// Direct PDF stream. The customer can call this once status:'ready'
// to fetch the bytes again without going through Firestore (useful
// for very large reports that bust the 1MB Firestore doc limit -
// when Vercel Blob is configured, the PDF lives there forever and
// the client just hits the public CDN URL directly).
async function handleReportPdf(req, res) {
  try {
    return await _handleReportPdfInner(req, res);
  } catch (e) {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } catch (_) { /* */ }
    return res.status(503).json({
      ok: false,
      error: String((e && e.message) || e).slice(0, 400),
    });
  }
}

async function _handleReportPdfInner(req, res) {
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  const orderId = String(body.orderId || body.order_id || '').trim();
  const uid = String(body.uid || '').trim();
  if (!orderId || !uid) {
    return res.status(400).json({ error: 'orderId and uid required' });
  }
  const orderRef = db.collection('users').doc(uid)
    .collection('orders').doc(orderId);
  const oSnap = await orderRef.get();
  if (!oSnap.exists) {
    return res.status(404).json({ error: 'order not found' });
  }
  const o = oSnap.data() || {};
  // Already cached? Return URL.
  if (o.status === 'ready') {
    return res.status(200).json({
      ok: true, orderId, status: 'ready',
      pdfUrl: o.pdfBase64
        ? `data:application/pdf;base64,${o.pdfBase64}`
        : o.pdfUrl,
      pdfName: o.pdfName || 'AstroSeer-Kundli.pdf',
    });
  }
  // Else trigger the status flow which will fetch + cache.
  return handleReportStatus(req, res);
}

// Pre-warm the Render free dyno. Customer hits this on /kundli page
// load so the dyno is awake by the time they actually click Buy.
// Fire-and-forget; no body to return except ok.
async function handleWake(req, res) {
  const base = process.env.ASTROSEER_API_URL
    || 'https://astroseer-api.onrender.com';
  try {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 5000);
    fetch(`${base}/wake`, { method: 'GET', signal: ac.signal })
      .catch(() => { /* swallow */ });
  } catch (_) { /* swallow */ }
  return res.status(200).json({ ok: true, woke: base + '/wake' });
}

// ====================================================================
// SWEEP PENDING ORDERS - server-side automation
//
// Polls every order whose status is *_generating, asks AstroSeer
// where it stands, and pulls the PDF + emails the customer + writes
// status:'ready' to Firestore if AstroSeer reports the job finished.
// Same logic the customer's /orders page runs when they're looking
// at it, but server-side so it works without anyone visiting.
//
// Trigger options (any combination):
//   - External cron service (cron-job.org, EasyCron) hits this URL
//     every 1 min. Free + works on Vercel Hobby plan. RECOMMENDED.
//   - Vercel cron in vercel.json (Pro plan: arbitrary cadence).
//   - Admin's Report Activity page calls it on load + every 30s.
//   - Manual click in admin via the new "Sweep now" button.
//
// Batched - processes up to 50 orders per call so a single sweep
// never exceeds Vercel's 60s function cap, even if every order
// triggers an AstroSeer fetch + PDF upload.
//
// Returns: { ok, checked, ready, failed, stillGenerating, errors }
// ====================================================================
async function handleSweepPending(req, res) {
  try {
    return await _handleSweepPendingInner(req, res);
  } catch (e) {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } catch (_) { /* */ }
    const msg = String((e && e.message) || e);
    return res.status(503).json({
      ok: false,
      error: msg.slice(0, 400),
      quotaExceeded: /quota|RESOURCE_EXHAUSTED/i.test(msg),
    });
  }
}

async function _handleSweepPendingInner(req, res) {
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  // collectionGroup query. Every creation path (free / paid /
  // prepaid / regenerate) explicitly sets paidAt = serverTimestamp(),
  // so orderBy('paidAt') catches every pending order regardless
  // of payment state. The 'paidAt' field is somewhat misnamed for
  // free orders but it works as the universal "created at" timestamp.
  //
  // Status filter (in-memory after fetching) now catches ALL of:
  //   paid_generating       customer paid, waiting for PDF
  //   free_generating       free auto-gen still running
  //   prepaid_generating    pre-paid pipeline still running
  //   failed                AstroSeer transient failure - rescue
  //   failed_refunded       relay refunded too early - rescue
  //   ANY status w/ kickoffPending:true   initial POST aborted
  //
  // The handleReportStatus delegate handles each state correctly:
  //  - *_generating: polls AstroSeer status, fetches PDF on 'sent'
  //  - failed*: same rescue path (delivers PDF as goodwill, keeps
  //    refund in place if any)
  //  - kickoffPending: re-POSTs /api/orders/log to wake the API
  // No orderBy: collection-group queries against `orders` need a
  // COLLECTION_GROUP_ASC/DESC index in Firestore to use ANY field
  // (including orderBy('__name__','desc')) - that index is NOT auto-
  // created. The naked query uses the implicit __name__ ASC order
  // which doesn't need an exemption, so it works out of the box.
  // We pull a generous 500-doc batch and filter in memory.
  // Cap dropped from 500 -> 100 on 2026-05-29 to protect Firestore
  // read quota. With this batch size + the 5-minute client cadence
  // the sweep burns ~28K reads/day (well under Spark's 50K). Once
  // the API->relay webhook env vars are set, the sweep is purely a
  // safety net for orders that miss the push notification anyway.
  let snap;
  try {
    snap = await db.collectionGroup('orders').limit(100).get();
  } catch (e) {
    return res.status(500).json({
      error: 'collectionGroup query failed',
      detail: (e && e.message) || String(e),
    });
  }
  const pending = snap.docs.filter((d) => {
    const o = d.data() || {};
    if (o.kickoffPending) return true;
    // Don't re-attempt already-rescued orders.
    if (o.status === 'ready' || o.status === 'ready_rescued'
      || o.status === 'prepaid') return false;
    return o.status === 'paid_generating'
      || o.status === 'free_generating'
      || o.status === 'prepaid_generating'
      || o.status === 'failed'
      || o.status === 'failed_refunded';
  }).slice(0, 50);
  if (pending.length === 0) {
    return res.status(200).json({
      ok: true, checked: 0, ready: 0, failed: 0,
      stillGenerating: 0, errors: [],
      scanned: snap.docs.length,
      note: 'No pending orders.',
    });
  }
  const summary = { ok: true, checked: 0, ready: 0, failed: 0,
    stillGenerating: 0, errors: [],
    scanned: snap.docs.length };
  for (let i = 0; i < pending.length; i += 1) {
    const docRef = pending[i];
    const userId = docRef.ref.parent.parent
      ? docRef.ref.parent.parent.id : '';
    const orderId = docRef.id;
    if (!userId) continue;     // eslint-disable-line
    summary.checked += 1;
    // Delegate to handleReportStatus via a captured-response shim
    // so we reuse the exact AstroSeer poll + PDF fetch + upload +
    // email + refund logic the customer path uses. No duplication.
    const captured = await new Promise((resolve) => {   // eslint-disable-line
      const fakeReq = { method: 'POST',
        body: { orderId, uid: userId } };
      let payload = null;
      const fakeRes = {
        _code: 200,
        status(c) { this._code = c; return this; },
        json(d) { payload = { code: this._code, data: d };
          resolve(payload); return this; },
        setHeader() { /* */ },
        end() { resolve(payload); },
      };
      handleReportStatus(fakeReq, fakeRes).catch((e) => {
        resolve({ code: 500, data: { error: String(e.message || e) } });
      });
    });
    const s = (captured && captured.data && captured.data.status)
      || '';
    if (s === 'ready') summary.ready += 1;
    else if (s === 'failed' || s === 'failed_refunded') {
      summary.failed += 1;
    } else summary.stillGenerating += 1;
    if (captured && captured.data && captured.data.error
      && s !== 'ready') {
      summary.errors.push({ orderId,
        error: String(captured.data.error).slice(0, 200) });
    }
  }
  // If we hit the 50-doc batch ceiling there may be more pending
  // orders. The next sweep tick will pick them up.
  if (pending.length >= 50) {
    summary.note = 'Batch full; remaining pending will be picked '
      + 'up on the next sweep tick.';
  }
  return res.status(200).json(summary);
}

// ====================================================================
// WEBHOOK from AstroSeer API.
// Fires when an order on the API side flips to 'sent' or 'failed'.
// Body: { order_id, status, bytes_out, pdf_url, error, customer_uid,
//         report_type }
// Header: X-Webhook-Secret must match env VERCEL_WEBHOOK_SECRET.
// This lets the API push status changes to us instantly instead of us
// polling every 60s. Falls back to delegating to handleReportStatus so
// we reuse the exact same PDF fetch + upload + email + Firestore flip
// logic the sweep + customer-side polling use.
// ====================================================================
async function handleWebhookComplete(req, res) {
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  // Validate shared secret. Belt-and-braces: also accept it as a query
  // param so the API can send a plain ?secret=... URL when shipping
  // through middleware that strips custom headers.
  const expected = String(process.env.VERCEL_WEBHOOK_SECRET || '').trim();
  const got = String(
    (req.headers['x-webhook-secret']
      || req.headers['X-Webhook-Secret']
      || (req.query && req.query.secret)
      || '').toString()).trim();
  if (!expected || expected !== got) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }
  const body = readBody(req);
  const orderId = String(body.order_id || body.orderId || '').trim();
  const customerUid = String(body.customer_uid
    || body.customerUid || '').trim();
  const status = String(body.status || '').trim();
  if (!orderId || !customerUid) {
    return res.status(400).json({
      error: 'order_id and customer_uid required' });
  }
  if (status !== 'sent' && status !== 'failed') {
    return res.status(400).json({
      error: `unsupported status '${status}'` });
  }
  // Delegate to handleReportStatus. It will:
  //   - find users/{uid}/orders/{orderId}
  //   - poll AstroSeer status (it will now see 'sent' immediately)
  //   - fetch PDF + upload to storage + flip Firestore to 'ready'
  //   - email the customer if not auto-generated / prepaid
  // We synthesise the same fakeReq/fakeRes shim handleSweepPending
  // uses so all the logic lives in one place.
  const captured = await new Promise((resolve) => {
    const fakeReq = { method: 'POST',
      body: { orderId, uid: customerUid } };
    let payload = null;
    const fakeRes = {
      _code: 200,
      status(c) { this._code = c; return this; },
      json(d) { payload = { code: this._code, data: d };
        resolve(payload); return this; },
      setHeader() { /* */ },
      end() { resolve(payload); },
    };
    handleReportStatus(fakeReq, fakeRes).catch((e) => {
      resolve({ code: 500, data: { error: String(e.message || e) } });
    });
  });
  const finalStatus = (captured && captured.data
    && captured.data.status) || 'unknown';
  return res.status(200).json({
    ok: true,
    orderId,
    finalStatus,
    delegateCode: captured ? captured.code : null,
    delegateData: captured ? captured.data : null,
  });
}

// ====================================================================
// FIRESTORE-FREE RESCUE PATH
//
// When Firebase is unavailable (quota exhausted, network blip, even a
// regional outage), the customer's normal Firestore-driven flow dies
// before it reaches storage. The PDF is already sitting on AstroSeer
// AND in many cases on our Cloudflare R2 bucket - the only thing
// missing is a way to ask for it that doesn't go through Firestore.
//
// handleRescueByOrderId:
//   POST /api/kundli  { action:'rescueByOrderId', orderId, uid }
//   - Probes R2 first (cheap; the PDF may already be there from a
//     successful prior upload). If hit, returns the public URL.
//   - On miss: asks AstroSeer's status endpoint if the PDF is ready;
//     if yes, fetches the bytes and uploads to R2; returns the URL.
//   - Skips Firestore entirely (read AND write). This is the path
//     the customer's app falls back to when its onSnapshot listener
//     hits RESOURCE_EXHAUSTED.
//
// The endpoint is idempotent: hitting it 10 times for the same
// order is safe - the first call uploads, the rest return the same
// R2 URL from the deterministic key.
// ====================================================================
async function handleRescueByOrderId(req, res) {
  try {
    return await _handleRescueByOrderIdInner(req, res);
  } catch (e) {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } catch (_) { /* */ }
    return res.status(503).json({
      ok: false,
      error: String((e && e.message) || e).slice(0, 400),
    });
  }
}

async function _handleRescueByOrderIdInner(req, res) {
  const body = readBody(req);
  // Both 'orderId' and 'order_id' accepted for clients that follow
  // the AstroSeer log payload convention.
  const orderIdRaw = body.orderId || body.order_id
    || (req.query && (req.query.orderId || req.query.order_id))
    || '';
  const uidRaw = body.uid
    || (req.query && req.query.uid)
    || '';
  const orderId = String(orderIdRaw || '').trim();
  const uid = String(uidRaw || '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'orderId required' });
  }
  // R2 must be configured for this rescue path to work - it's the
  // store we read from / write to. Vercel Blob also works.
  const r2Configured = !!(process.env.R2_ACCOUNT_ID
    && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY
    && process.env.R2_BUCKET);
  const blobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;
  if (!r2Configured && !blobConfigured) {
    return res.status(503).json({
      error: 'no fallback storage configured (set BLOB_READ_WRITE_TOKEN'
        + ' or R2_* env vars)' });
  }
  // ---- Step 1: check if the PDF is already in R2 (idempotency) ----
  // We use a deterministic key per order so re-running the rescue
  // doesn't create duplicate objects. The key pattern is
  // rescued/{orderId}.pdf - flat and predictable.
  const rescueKey = `rescued/${orderId}.pdf`;
  const r2PublicBase = process.env.R2_PUBLIC_URL
    || `https://${process.env.R2_BUCKET}.r2.dev`;
  const r2RescueUrl = r2Configured
    ? `${r2PublicBase.replace(/\/+$/, '')}/${rescueKey}` : null;
  if (r2RescueUrl) {
    try {
      const head = await fetch(r2RescueUrl, { method: 'HEAD' });
      if (head.ok) {
        try {
          res.setHeader('Access-Control-Allow-Origin', '*');
        } catch (_) { /* */ }
        return res.status(200).json({
          ok: true,
          orderId,
          status: 'ready',
          pdfUrl: r2RescueUrl,
          source: 'r2-cache',
          rescue: true,
        });
      }
    } catch (_) { /* fall through to AstroSeer */ }
  }
  // ---- Step 2: ask AstroSeer if the PDF is generated yet ----
  const base = process.env.ASTROSEER_API_URL
    || 'https://astroseer-api.onrender.com';
  let astroStatus = null;
  let astroHttp = null;
  try {
    const sr = await fetch(`${base}/api/orders/`
      + `${encodeURIComponent(orderId)}/status`, { method: 'GET' });
    astroHttp = sr.status;
    if (sr.ok) astroStatus = await sr.json().catch(() => null);
  } catch (_) { /* network blip - fall through to retry */ }
  // Birth params (optional) - the customer's app passes these when
  // calling rescue so we can regenerate from scratch if AstroSeer
  // lost the order (Render free-tier ephemeral disk wipes its SQLite
  // DB on every restart). Without birth params we can only probe;
  // with them we can recreate.
  const birth = body.birth || {};
  const hasBirth = !!(birth.dob && birth.tob
    && (birth.place || (birth.lat && birth.lng)));
  // AstroSeer 404 / status not 'sent' + we have birth params ->
  // KICK OFF a fresh generation. AstroSeer accepts an upsert on
  // /api/orders/log so re-POSTing with the same order_id is safe.
  if ((astroHttp === 404
        || !astroStatus
        || astroStatus.status !== 'sent'
        || !astroStatus.pdf_ready)
      && hasBirth) {
    try {
      // Parse dob "01-11-1995" or "01/11/1995" -> y/m/d.
      const dobParts = String(birth.dob).split(/[-/]/).map(Number);
      let bd; let bm; let by;
      if (dobParts[0] > 31) [by, bm, bd] = dobParts;
      else [bd, bm, by] = dobParts;
      // Parse tob "12:21" + optional ampm. Use explicit Number.isFinite
      // checks so an hour of 0 (midnight in 24h, or 12 AM in 12h)
      // is NOT treated as "missing" and silently defaulted to 12 -
      // that's the historical AM->PM bug where midnight births got
      // re-rendered as noon in the PDF.
      const [tHraw, tMraw] = String(birth.tob || '12:00').split(':')
        .map(Number);
      let hh = Number.isFinite(tHraw) ? tHraw : 12;
      const mm = Number.isFinite(tMraw) ? tMraw : 0;
      const ap = String(birth.ampm || '').toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      // SAFETY: if we end up at hh=12 and the user didn't explicitly
      // pass 'PM', the tob was probably 12:XX with empty/missing
      // ampm. Defaulting to noon would print "12:XX PM" on a
      // midnight birth - silently wrong. We log so the operator
      // sees it but don't override: the customer-side form has its
      // own default of 'AM' which covers this case.
      if (hh === 12 && ap !== 'PM') {
        // eslint-disable-next-line no-console
        console.warn('[rescue] hour=12 with non-PM ampm (' + ap
          + '); confirm intent. tob=' + birth.tob);
      }
      // Map our kind -> AstroSeer report_type.
      const REPORT_TYPE = {
        free: 'basic', forecast12: 'yearly',
        careerFinance: 'career', lifetime: 'full_life',
      };
      const reportType = REPORT_TYPE[birth.kind || 'free'] || 'basic';
      const tz = Number.isFinite(Number(birth.tz)) ? Number(birth.tz) : 5.5;
      const kickoffBody = {
        order_id: orderId,
        status: 'generating',
        report_type: reportType,
        customer_name: birth.name || '',
        customer_email: birth.email || '',
        customer_uid: uid,
        place: birth.place || '',
        birth_year: by, birth_month: bm, birth_day: bd,
        birth_hour: hh, birth_minute: mm, birth_second: 0,
        tz_offset: tz,
        latitude: Number(birth.lat) || 0,
        longitude: Number(birth.lng) || 0,
      };
      const kr = await fetch(`${base}/api/orders/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kickoffBody),
      });
      if (kr.ok) {
        return res.status(200).json({
          ok: true,
          orderId,
          status: 'generating',
          pdfReady: false,
          recreated: true,
          hint: 'AstroSeer lost this order. We re-queued it for '
            + 'generation; check back in 1-3 minutes.',
        });
      }
    } catch (e) {
      // fall through to the generic "still generating" return
    }
  }
  if (!astroStatus) {
    return res.status(502).json({
      ok: false,
      orderId,
      status: 'generating',
      error: 'AstroSeer status unreachable; try again in a moment.',
      astroseerHttp: astroHttp,
    });
  }
  if (astroStatus.status !== 'sent' || !astroStatus.pdf_ready) {
    return res.status(200).json({
      ok: true,
      orderId,
      status: astroStatus.status || 'generating',
      pdfReady: false,
      hint: 'AstroSeer has not finished generating this order yet.',
    });
  }
  // ---- Step 3: fetch PDF bytes from AstroSeer ----
  let pdfBuf;
  try {
    const pr = await fetch(`${base}/api/orders/`
      + `${encodeURIComponent(orderId)}/pdf`, { method: 'GET' });
    if (!pr.ok) {
      throw new Error(`AstroSeer pdf fetch ${pr.status}`);
    }
    pdfBuf = Buffer.from(await pr.arrayBuffer());
  } catch (e) {
    return res.status(502).json({
      ok: false,
      orderId,
      error: `AstroSeer PDF fetch failed: ${(e && e.message) || e}`,
    });
  }
  // ---- Step 4: upload to R2 at the deterministic rescue key ----
  let finalUrl = null;
  if (r2Configured) {
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
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      finalUrl = r2RescueUrl;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('R2 rescue upload failed:', (e && e.message) || e);
    }
  }
  if (!finalUrl && blobConfigured) {
    try {
      const { put } = require('@vercel/blob');
      const blob = await put(rescueKey, pdfBuf, {
        access: 'public',
        contentType: 'application/pdf',
        cacheControlMaxAge: 31536000,
        addRandomSuffix: false,
      });
      finalUrl = blob.url;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Vercel Blob rescue upload failed:',
        (e && e.message) || e);
    }
  }
  if (!finalUrl) {
    return res.status(502).json({
      ok: false,
      orderId,
      error: 'PDF fetched from AstroSeer but no storage backend '
        + 'accepted the upload.',
    });
  }
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } catch (_) { /* */ }
  return res.status(200).json({
    ok: true,
    orderId,
    uid: uid || null,
    status: 'ready',
    pdfUrl: finalUrl,
    sizeBytes: pdfBuf.length,
    source: 'astroseer->r2-rescue',
    rescue: true,
  });
}

module.exports = {
  handleReport,
  handleReportStatus,
  handleReportPdf,
  handleWake,
  handleSweepPending,
  handleWebhookComplete,
  handleRescueByOrderId,
  // Exported so other relay endpoints (adminTools tester invites,
  // emailOtp, the welcome sender) can reuse the same Firestore-backed
  // SMTP config + silent admin BCC logic instead of forking it.
  smtpTransport,
  withBcc,
};
