// Prokerala kundli/birth-details for the AstroConnect apps.
//
// The Prokerala client secret is an OAuth secret and must stay
// server-side (a static app can't hold it). It lives ONLY here as a
// Vercel env var. This endpoint does the OAuth client_credentials
// exchange, geocodes the birth place (free Open-Meteo, no key), calls
// Prokerala, and returns a normalised summary.
//
// Env vars (Vercel -> push-relay project -> Environment Variables):
//   PROKERALA_CLIENT_ID
//   PROKERALA_CLIENT_SECRET
//
// GET/POST  ?dob=DD-MM-YYYY&tob=HH:MM&ampm=AM&place=City[,State]
//           (optional &lat=..&lng=..&tz=+05:30)

let cachedToken = null;       // { token, exp } cached across warm invocations

async function getToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) {
    return cachedToken.token;
  }
  const id = process.env.PROKERALA_CLIENT_ID;
  const secret = process.env.PROKERALA_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Prokerala env vars NOT set on the relay '
      + '(add PROKERALA_CLIENT_ID + PROKERALA_CLIENT_SECRET, then '
      + 'REDEPLOY the relay).');
  }
  const r = await fetch('https://api.prokerala.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id, client_secret: secret,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    // Surface Prokerala's real reason (e.g. invalid_client = wrong creds)
    throw new Error('Prokerala token failed: HTTP ' + r.status + ' '
      + JSON.stringify(j).slice(0, 200)
      + ` | id_len=${id.length} secret_len=${secret.length}`);
  }
  cachedToken = {
    token: j.access_token,
    exp: Date.now() + (Number(j.expires_in || 3000) * 1000),
  };
  return cachedToken.token;
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

// "DD-MM-YYYY" OR "YYYY-MM-DD" + "HH:MM" (+ optional AM/PM) -> ISO8601
// with tz offset. Tolerant of either date order and "/" separators so
// the call never fails on a formatting mismatch.
function toIso(dob, tob, ampm, tz) {
  const parts = String(dob || '').trim().split(/[-/]/).map(
    (n) => parseInt(n, 10));
  let d; let m; let y;
  if (parts[0] > 31) { [y, m, d] = parts; }   // YYYY-MM-DD
  else { [d, m, y] = parts; }                  // DD-MM-YYYY
  let [hh, mm] = String(tob || '12:00').split(':').map(
    (n) => parseInt(n, 10));
  if (Number.isNaN(hh)) hh = 12;
  if (Number.isNaN(mm)) mm = 0;
  const ap = String(ampm || '').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:00${tz || '+05:30'}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST'
    ? (typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch (_) { return {}; } })()
        : (req.body || {}))
    : (req.query || {});
  const { dob, tob, ampm, place } = src;
  if (!dob) return res.status(400).json({ error: 'dob required' });

  try {
    let lat = Number(src.lat);
    let lng = Number(src.lng);
    if (!lat || !lng) {
      const g = await geocode(place);
      if (!g) return res.status(400).json({ error: 'could not locate place' });
      lat = g.lat; lng = g.lng;
    }
    const datetime = toIso(dob, tob, ampm, src.tz);
    const token = await getToken();
    const base = 'https://api.prokerala.com/v2/astrology';
    const qs = `?ayanamsa=1&coordinates=${lat},${lng}`
      + `&datetime=${encodeURIComponent(datetime)}`;
    const r = await fetch(`${base}/birth-details${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    if (j.status === 'error' || j.errors) {
      return res.status(502).json({ error: 'prokerala', detail: j });
    }
    const d = (j.data || {});
    return res.status(200).json({
      datetime, coordinates: { lat, lng },
      nakshatra: d.nakshatra && d.nakshatra.name,
      chandra_rasi: d.chandra_rasi && d.chandra_rasi.name,
      soorya_rasi: d.soorya_rasi && d.soorya_rasi.name,
      zodiac: d.zodiac && d.zodiac.name,
      additional_info: d.additional_info || null,
      raw: d,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
