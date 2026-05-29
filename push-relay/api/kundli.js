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

async function readProviderConfig() {
  const adminOk = initAdmin();
  if (!adminOk) {
    return { provider: 'prokerala', creds: {},
      adminInit: false,
      providerNote: 'FIREBASE_SERVICE_ACCOUNT env var not set on the '
        + 'relay - cannot read settings/kundliApi from Firestore. '
        + 'Falling back to Prokerala env credentials.' };
  }
  try {
    const s = await admin.firestore()
      .collection('settings').doc('kundliApi').get();
    const d = s.exists ? (s.data() || {}) : {};
    const provider = d.provider || 'prokerala';
    const creds = d[provider] || {};
    const note = (!creds.key && !creds.secret
      && provider !== 'prokerala')
      ? `Provider ${provider} is selected but has no key saved in `
        + 'settings/kundliApi.' + provider + '.key - cannot use it.'
      : '';
    return { provider, creds, adminInit: true, providerNote: note };
  } catch (e) {
    return { provider: 'prokerala', creds: {},
      adminInit: true,
      providerNote: 'Firestore read failed: '
        + String((e && e.message) || e) };
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
    return res.status(200).json({
      // Build marker - bumped on every deploy so admin can verify
      // exactly which relay version is live (especially when chasing
      // a stuck Vercel build).
      relayBuild: 'fb-storage-dual-bucket-2026-05-29T00:58',
      provider: pc.provider,
      adminInit: pc.adminInit,
      hasKey: !!(pc.creds && (pc.creds.key || pc.creds.secret))
        || (pc.provider === 'astroseer'
          && !!process.env.ASTROSEER_API_KEY),
      providerNote: pc.providerNote || '',
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
