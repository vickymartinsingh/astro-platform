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
//   3. Generate PDF via AstroSeer /api/report/pdf (tier 9 for free,
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
  const body = {
    year: p.y, month: p.m, day: p.d, hour: p.hh, minute: p.mm,
    tz_offset: tz,
    latitude: safeLat,
    longitude: safeLng,
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
// AstroSeer's /api/report/pdf insists on numeric latitude+longitude
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

// AstroSeer's /api/report/pdf returns the PDF bytes directly. We
// stream them straight to Storage so the relay's memory stays low.
async function callAstroSeerPdf({ base, key, body }) {
  // Same stale-key recovery as the kundli JSON path: try WITH the
  // key first, retry WITHOUT on 401. AstroSeer rejects an invalid
  // key but accepts unauthenticated calls.
  const url = `${base}/api/report/pdf`;
  const payload = JSON.stringify(body);
  const withKey = {
    'Content-Type': 'application/json',
    ...(key ? { 'X-API-Key': key } : {}),
  };
  const noKey = { 'Content-Type': 'application/json' };
  let r = await fetch(url, {
    method: 'POST', headers: withKey, body: payload,
  });
  if (r.status === 401 && key) {
    r = await fetch(url, {
      method: 'POST', headers: noKey, body: payload,
    });
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
  try {
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
      return res.status(200).json({
        ok: true,
        orderId: ready.id,
        pdfUrl: realUrl,
        pdfName: ready.pdfName || 'AstroSeer-Kundli.pdf',
        sizeBytes: ready.sizeBytes || 0,
        amount: 0, // never bill twice for the same chart
        kind,
        emailed: false, // was emailed once at original generate
        validUntil: ready.validUntil || null,
        cached: true,
      });
    }
  } catch (_) {
    // Never block PDF delivery on a cache-lookup failure - fall
    // through to fresh generation. The original-flow refund/email
    // guarantees still apply.
  }

  // 2. Resolve price + check we have AstroSeer creds.
  const price = await getReportPrice(db, kind);
  const { base, key } = await getAstroSeerCreds(db);

  // 3. For paid kinds: atomic wallet deduct + order placeholder.
  let orderRef = db.collection('users').doc(uid).collection('orders').doc();
  let chargedAmount = 0;
  if (price > 0) {
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
        return res.status(402).json({
          error: 'Insufficient wallet balance.',
          wallet: e.wallet, price: e.price });
      }
      throw e;
    }
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
  const reqBody = astroSeerBody(kind, p, lat, lng, profile);

  // 5. Generate + upload + email. If ANY step throws after the
  //    wallet was charged, reverse the charge so we never bill the
  //    user for a missing PDF.
  let pdfBuf;
  try {
    pdfBuf = await callAstroSeerPdf({ base, key, body: reqBody });
  } catch (e) {
    if (chargedAmount > 0) {
      try {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const w = Number((uSnap.data() || {}).wallet || 0);
          tx.update(uRef, { wallet: w + chargedAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          tx.update(orderRef, { status: 'failed_refunded',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failReason: String((e && e.message) || e) });
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            userId: uid, amount: chargedAmount, type: 'credit',
            reason: 'Kundli report refund (generation failed)',
            referenceId: orderRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (_) { /* refund retry is admin's job */ }
    } else {
      await orderRef.update({ status: 'failed',
        failReason: String((e && e.message) || e) }).catch(() => {});
    }
    return res.status(502).json({
      error: 'Report generation failed',
      detail: String((e && e.message) || e),
      refunded: chargedAmount > 0,
    });
  }

  let uploaded;
  try {
    uploaded = await uploadPdf(uid, kind, pdfBuf);
  } catch (e) {
    // Same refund-on-failure path.
    if (chargedAmount > 0) {
      try {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const w = Number((uSnap.data() || {}).wallet || 0);
          tx.update(uRef, { wallet: w + chargedAmount });
          tx.update(orderRef, { status: 'failed_refunded',
            failReason: 'storage upload failed' });
        });
      } catch (_) { /* ignore */ }
    }
    return res.status(502).json({
      error: 'Could not save the PDF',
      detail: String((e && e.message) || e),
      refunded: chargedAmount > 0,
    });
  }

  const pdfFileName = `AstroSeer-${kind === 'forecast12'
    ? '12-Month-Forecast' : 'Kundli'}-${profile.name
    || uid.slice(0, 6)}.pdf`;

  // 6. Order doc → final state. Email the PDF in parallel
  //    (best-effort). When the storage backend is inline (no Blob
  //    token set), the actual PDF bytes are kept on the order doc
  //    as base64 so /orders re-downloads can re-build the same
  //    data: URL without a relay call. Cache lookup also serves
  //    from this field on the next View Full Kundli click.
  const validUntil = kind === 'forecast12'
    ? new Date(new Date().setMonth(new Date().getMonth() + 12)).toISOString()
    : null;
  const orderPatch = {
    status: 'ready',
    // For inline storage, store a SHORT marker on pdfUrl (the real
    // bytes live on pdfBase64). For Vercel Blob, store the actual
    // CDN URL. This stops the doc from carrying a redundant ~80 KB
    // copy of the base64 (~80 KB pdfUrl + ~80 KB pdfBase64 was
    // pushing toward the 1 MB Firestore limit).
    pdfUrl: uploaded.inline ? 'inline' : uploaded.url,
    storagePath: uploaded.storagePath,
    bucketUsed: uploaded.bucketUsed || '',
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (uploaded.inline && uploaded.pdfBase64) {
    orderPatch.pdfBase64 = uploaded.pdfBase64;
  }
  await orderRef.update(orderPatch);

  // Get the user's email for the SMTP send.
  let userEmail = '';
  let userName = profile.name || '';
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const u = uSnap.data() || {};
    userEmail = u.email || '';
    if (!userName) userName = u.name || '';
  } catch (_) { /* fine */ }
  // `complimentary` + `senderNote` come from the admin "Email kundli"
  // button; the customer-initiated path leaves them unset, so the
  // email body reads as normal "your report is ready". When admin
  // sends, the template flips to gift-wording and labels the report
  // as a complimentary AstroSeer kundli.
  let emailed = false;
  let emailMode = null;
  let emailError = null;
  let attachmentError = null;
  let linkOnlyError = null;
  if (userEmail) {
    const r = await emailReport({
      db, toEmail: userEmail, name: userName,
      kind, pdfBuf, pdfName: pdfFileName,
      complimentary: !!body.complimentary,
      senderNote: body.senderNote || '',
    });
    if (r && r.ok) {
      emailed = true;
      emailMode = r.mode || 'link-only';
      attachmentError = r.attachmentError || null;
      linkOnlyError = r.linkOnlyError || null;
    } else {
      emailError = (r && r.error) || 'unknown email error';
      attachmentError = (r && r.attachmentError) || null;
      linkOnlyError = (r && r.linkOnlyError) || null;
    }
  } else {
    emailError = 'no email on file for this user';
  }

  return res.status(200).json({
    ok: true,
    orderId: orderRef.id,
    pdfUrl: uploaded.url,
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    amount: chargedAmount,
    kind,
    emailed,
    emailMode,
    emailError,
    attachmentError,
    linkOnlyError,
    validUntil,
  });
}

module.exports = { handleReport };
