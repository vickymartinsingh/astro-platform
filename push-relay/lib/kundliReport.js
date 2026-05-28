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
      logo_url: 'https://astroseer.in/logo.png',
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

// Storage backend (tiered, ZERO setup required):
//
//   1. Vercel Blob - used IF BLOB_READ_WRITE_TOKEN is set on the
//      relay. Best path: permanent CDN URL, no Firestore read on
//      re-download. Only kicks in if the operator has actually
//      created + connected a Blob store in the Vercel dashboard.
//
//   2. Firestore inline base64 (default fallback) - used otherwise.
//      Writes the PDF base64 onto users/{uid}/orders/{id}.pdfBase64
//      and returns a `data:application/pdf;base64,...` URL the
//      browser can download immediately. Works on Spark (free)
//      with zero external setup. Firestore allows 1 MB per doc;
//      AstroSeer PDFs are ~60 KB (~80 KB base64) so we have ~12x
//      headroom. The /orders page re-builds the data URL from the
//      same pdfBase64 field on re-download.
//
// Caller gets back { url, storagePath, bucketUsed } as before so
// the rest of handleReport doesn't change. inline === true on the
// return value tells the caller to also write pdfBase64 onto the
// order doc.
async function uploadPdf(uid, kind, buf) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
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
      // Don't fail the whole report on a Blob blip - fall through
      // to the inline path so the user always gets their PDF.
      // eslint-disable-next-line no-console
      console.warn('Vercel Blob upload failed, falling back to '
        + 'inline Firestore storage:', (e && e.message) || e);
    }
  }
  // Fallback: encode the PDF bytes as base64 and return a data
  // URL the browser can download directly. The base64 string is
  // ALSO written onto the order doc by the caller so /orders can
  // re-build the same data URL forever without a relay call.
  const b64 = Buffer.from(buf).toString('base64');
  const dataUrl = `data:application/pdf;base64,${b64}`;
  if (b64.length > 950 * 1024) {
    // Firestore caps a doc at 1 MB. Leave headroom for the other
    // order fields. If a future AstroSeer tier produces a bigger
    // PDF, the operator will have to set up Blob (above) or we
    // chunk across multiple docs.
    throw new Error('PDF is too large to store inline '
      + `(${(b64.length / 1024).toFixed(0)} KB base64). Set `
      + 'BLOB_READ_WRITE_TOKEN on the relay to enable Vercel Blob '
      + 'storage instead.');
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
  };
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
    return t.transporter.sendMail(opts);
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
  function birthSig(p) {
    return [p.dob, p.tob, p.ampm, p.place]
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
    const ready = cached.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.status === 'ready'
        && o.kundliProfileId === profileId
        && o.pdfUrl)
      .sort((a, b) => {
        const at = (a.deliveredAt && a.deliveredAt.toMillis
          && a.deliveredAt.toMillis()) || 0;
        const bt = (b.deliveredAt && b.deliveredAt.toMillis
          && b.deliveredAt.toMillis()) || 0;
        return bt - at;
      })[0];
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

  // 1c. Stuck-order sweeper. Any *_generating order from this user
  //     older than 5 minutes is considered failed - the relay's
  //     previous run timed out before the PDF landed. (Threshold
  //     extended from 90s to 300s on 2026-05-27 to accommodate
  //     long premium reports like full_life / consolidated_premium
  //     which legitimately take 60-90s on Render free tier.) Mark it
  //     failed_timeout AND refund the wallet (paid kinds only) so
  //     the customer is not stuck with a debit + the admin Order
  //     Management list does not show "Generating..." indefinitely.
  //
  // Best-effort: any error here is swallowed; we still attempt the
  // fresh generation below.
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
      if (!paidMs || (now - paidMs) < 300 * 1000) return;
      const refundAmount = Number(o.amount || 0);
      writes.push((async () => {
        if (refundAmount > 0) {
          // Atomic refund + status update.
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
                failReason: 'Generation timed out (>90s); '
                  + 'wallet auto-refunded.',
              });
              const txRef = db.collection('transactions').doc();
              tx.set(txRef, {
                userId: uid, amount: refundAmount, type: 'credit',
                reason: 'Kundli report refund (generation timeout)',
                referenceId: d.id,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            });
          } catch (_) { /* leave for next sweep */ }
        } else {
          await d.ref.update({
            status: 'failed',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failReason: 'Generation timed out (>90s).',
          }).catch(() => {});
        }
        // Mirror the failure to the AstroSeer central Activity
        // feed so admin sees the same red rows there too.
        try {
          logAstroSeerEvent({
            orderId: d.id,
            status: 'failed',
            kind: o.kind,
            userId: uid,
            error: 'Generation timed out (>90s)'
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

  // 3. For paid kinds: atomic wallet deduct + order placeholder.
  //
  // REGENERATE EXCEPTION: when body.regenerate is true (admin
  // Regenerate button, or any retry), we are NOT selling a new
  // report - the customer already paid for this chart in a prior
  // order. Skip the wallet deduct entirely and just create a new
  // order doc with amount:0. Without this, every Regenerate click
  // would re-charge the wallet ₹299, which is what the user just
  // reported as a bug.
  let orderRef = db.collection('users').doc(uid).collection('orders').doc();
  let chargedAmount = 0;
  if (price > 0 && !body.regenerate) {
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
  } else {
    // Free kind: still write an order doc for the user's history.
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: 0,
      status: 'free_generating',
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
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
    startResp = await postOrdersLog(45000);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      try { startResp = await postOrdersLog(20000); }
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

    // Already retried once (or retry POST itself failed). Atomic
    // refund if this was a paid order that hadn't been marked
    // failed_refunded yet.
    const chargedAmount = Number(o.amount || 0);
    try {
      if (chargedAmount > 0 && o.status !== 'failed_refunded') {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const w = Number((uSnap.data() || {}).wallet || 0);
          tx.update(uRef, {
            wallet: w + chargedAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          tx.update(orderRef, {
            status: 'failed_refunded',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failReason: astroStatus.error
              || 'AstroSeer reported failed after retry.',
          });
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            userId: uid, amount: chargedAmount, type: 'credit',
            reason: 'Kundli report refund (generation failed)',
            referenceId: orderId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } else if (o.status !== 'failed') {
        await orderRef.update({
          status: 'failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          failReason: astroStatus.error
            || 'AstroSeer reported failed after retry.',
        });
      }
    } catch (_) { /* refund retry is next poll's job */ }
    return res.status(200).json({
      ok: false,
      orderId,
      status: chargedAmount > 0 ? 'failed_refunded' : 'failed',
      error: astroStatus.error
        || 'Generation failed after auto-retry.',
      refunded: chargedAmount > 0,
      retried: retried >= 1,
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
  const orderPatch = {
    status: 'ready',
    pdfUrl: uploaded.inline ? 'inline' : uploaded.url,
    storagePath: uploaded.storagePath,
    bucketUsed: uploaded.bucketUsed || '',
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  };
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

  // Email the PDF (best-effort, async).
  const { email: userEmail, name: userName } = await loadUserContact(
    db, uid);
  if (userEmail) {
    emailReport({
      db, toEmail: userEmail, name: userName || o.profileName,
      kind, pdfBuf, pdfName: pdfFileName,
      complimentary: !!body.complimentary,
      senderNote: body.senderNote || '',
    }).catch(() => { /* swallow - email is not the critical path */ });
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

module.exports = {
  handleReport,
  handleReportStatus,
  handleReportPdf,
  handleWake,
};
