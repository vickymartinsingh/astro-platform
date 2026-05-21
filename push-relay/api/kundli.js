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
    admin.initializeApp({ credential: admin.credential.cert(
      JSON.parse(raw)) });
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

function markDasha(list) {
  const now = Date.now();
  const dasha = (list || []).map((x) => {
    const s = x.start ? Date.parse(x.start) : 0;
    const e = x.end ? Date.parse(x.end) : 0;
    return {
      planet: x.planet, start: x.start, end: x.end,
      current: s && e && now >= s && now < e,
      antardasha: Array.isArray(x.antardasha) ? x.antardasha : [],
    };
  });
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST'
    ? (typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); }
            catch (_) { return {}; } })()
        : (req.body || {}))
    : (req.query || {});

  // GET ?probe=1 -> just report which provider would be used and
  // whether the relay can read Firestore. Lets admin verify the chain
  // without computing a kundli (no API quota used).
  if (src.probe === '1' || src.probe === 1) {
    const pc = await readProviderConfig();
    return res.status(200).json({
      provider: pc.provider,
      adminInit: pc.adminInit,
      hasKey: !!(pc.creds && (pc.creds.key || pc.creds.secret)),
      providerNote: pc.providerNote || '',
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
