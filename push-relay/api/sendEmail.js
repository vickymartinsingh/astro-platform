// Generic outbound email endpoint. Used by:
//   - Admin "Resend kundli via email" button (admin-orders)
//   - Admin "Send test email" panel (admin-email)
//   - Auto-send after kundli PDF generation (relay -> SMTP)
//
// Body:
//   {
//     to:           "recipient@example.com" (required),
//     kind?:        emailService template key (kundli_report_ready,
//                   kundli_report_resend, generic, ...) — when
//                   present, vars are rendered server-side via the
//                   same shared/services/emailService.js template
//                   that the client uses, so admin-rendered preview
//                   and final delivery match exactly.
//     vars?:        template variables object,
//     subject?:     override the rendered subject,
//     html?:        override the rendered HTML body,
//     text?:        override the rendered plain-text body,
//     attachment?:  { filename, contentBase64, contentType } — used
//                   to attach the PDF to a kundli email.
//   }
//
// SMTP credentials come from the admin-managed settings/email
// Firestore doc (same source the OTP endpoint reads, so flipping
// providers in /admin-email instantly affects this endpoint too).
//
// Writes an audit row into chats/{id} with isEmailDoc=true, the
// rendered subject, status and any SMTP error so /admin-email-log
// can show the whole history.

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Self-contained template renderer. We can't require the shared
// emailService.js because it's ES-module + imports Firebase Web SDK
// which doesn't load in a serverless Node.js context. So we mirror
// the kundli templates here. Any change to wording / signature on
// shared/services/emailService.js must be reflected here too (and
// vice versa) to keep admin preview = final delivery.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderHtmlEmail({
  preheader = '', heading = '', lead = '', bullets = [],
  ctaLabel = '', ctaUrl = '', footnote = '',
}) {
  const bulletHtml = bullets.length === 0 ? '' : (
    '<ul style="margin:16px 0;padding-left:20px;color:#1A1A2E;'
    + 'font-size:14px;line-height:1.65">'
    + bullets.map((b) =>
      `<li style="margin:4px 0">${escapeHtml(b)}</li>`).join('')
    + '</ul>');
  const ctaHtml = (!ctaLabel || !ctaUrl) ? '' : (
    '<div style="margin:24px 0;text-align:center">'
    + `<a href="${escapeHtml(ctaUrl)}" `
    + 'style="display:inline-block;padding:12px 28px;border-radius:'
    + '999px;background:#7F2020;color:#ffffff;text-decoration:none;'
    + `font-weight:700;font-size:14px">${escapeHtml(ctaLabel)}</a>`
    + '</div>');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(heading || 'AstroSeer')}</title></head>
<body style="margin:0;padding:0;background:#F5F1EA;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
  Helvetica,Arial,sans-serif;color:#1A1A2E">
<span style="display:none!important;visibility:hidden;opacity:0;
  height:0;width:0;overflow:hidden">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0"
  cellspacing="0" style="background:#F5F1EA"><tr><td align="center"
  style="padding:24px 12px">
  <table role="presentation" width="600"
    style="max-width:600px;background:#ffffff;border-radius:16px;
    overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.06)">
  <tr><td style="background:linear-gradient(135deg,#7F2020,#A52A2A);
    padding:28px 32px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:2px;text-transform:
      uppercase;opacity:.85">AstroSeer</div>
    <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.3">
      ${escapeHtml(heading)}</h1>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0;font-size:15px;line-height:1.6;color:#1A1A2E">
      ${lead}
    </p>
    ${bulletHtml}
    ${ctaHtml}
    ${footnote ? `<p style="margin:16px 0 0 0;font-size:13px;`
      + `line-height:1.6;color:#555">${escapeHtml(footnote)}</p>`
      : ''}
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
}
function renderTemplate(kind, v) {
  v = v || {};
  if (kind === 'kundli_report_ready' || kind === 'kundli_report_resend') {
    const name = v.name || 'there';
    const profileName = v.profileName || '';
    const kindLabel = v.kindLabel || 'Vedic Kundli Report';
    const ordersUrl = v.ordersUrl || 'https://astroseer.in/orders';
    const isResend = kind === 'kundli_report_resend';
    const baseSubject = `Your ${kindLabel} is ready`
      + (profileName ? ` — ${profileName}` : '');
    const subject = isResend
      ? `Re-sending: ${baseSubject}` : baseSubject;
    const opener = isResend
      ? `As requested, we are re-sending your kundli report `
        + '(no additional charge has been applied).\n\nNamaste '
        + `${name},\n\n`
      : `Namaste ${name},\n\n`;
    const text = opener
      + `Your ${kindLabel}${profileName
        ? ` for ${profileName}` : ''} is ready and attached to `
      + 'this email as a PDF.\n\n'
      + 'Inside you will find:\n'
      + '  * Birth, Avakhada and Panchang details\n'
      + '  * Lagna chart and 16 divisional charts\n'
      + '  * Planetary positions, nakshatras and dignities\n'
      + '  * Full Vimshottari dasha tree and current periods\n'
      + '  * Yogas, doshas and ascendant analysis\n\n'
      + `Re-download anytime from your Orders: ${ordersUrl}\n\n`
      + 'With blessings,\n'
      + 'Team AstroSeer\n'
      + 'support@astroseer.in - astroseer.in';
    const leadHtml = (isResend
      ? '<i>As requested, we are re-sending your kundli report '
        + '(no additional charge has been applied).</i><br/><br/>'
      : '')
      + `Namaste ${escapeHtml(name)}, your `
      + `${escapeHtml(kindLabel)}${profileName
        ? ` for <b>${escapeHtml(profileName)}</b>` : ''} is ready `
      + 'and attached to this email as a PDF.';
    const html = renderHtmlEmail({
      preheader: `Your ${kindLabel} is attached to this email.`,
      heading: isResend
        ? `Re-sending: Your ${kindLabel}`
        : `Your ${kindLabel} is ready`,
      lead: leadHtml,
      bullets: [
        'Birth, Avakhada and Panchang details',
        'Lagna chart and 16 divisional charts',
        'Planetary positions, nakshatras and dignities',
        'Full Vimshottari dasha tree and current periods',
        'Yogas, doshas and ascendant analysis',
      ],
      ctaLabel: 'View in My Orders',
      ctaUrl: ordersUrl,
      footnote: 'If a particular life area calls for a deeper look, '
        + 'our astrologers are one tap away on the AstroSeer app.',
    });
    return { subject, text, html };
  }
  // Fallback / unknown kind: caller is expected to pass explicit
  // subject + html / text in the request body.
  return { subject: '', text: '', html: '' };
}

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
  });
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (_) { b = {}; }
  }
  return b || {};
}

async function smtpTransport(db) {
  let cfg = {};
  try {
    const s = await db.collection('settings').doc('email').get();
    if (s.exists) cfg = s.data() || {};
  } catch (_) {}
  const host = cfg.smtpHost || process.env.SMTP_HOST || '';
  const port = Number(cfg.smtpPort || process.env.SMTP_PORT || 587);
  const user = cfg.smtpUser || process.env.SMTP_USER || '';
  const pass = cfg.smtpPass || process.env.SMTP_PASS || '';
  const secure = typeof cfg.smtpSecure === 'boolean'
    ? cfg.smtpSecure : port === 465;
  const from = cfg.fromAddress || cfg.smtpFrom || process.env.MAIL_FROM
    || 'AstroSeer <support@astroseer.in>';
  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Set host/user/pass in '
      + '/admin-email (settings/email) or via SMTP_HOST/SMTP_USER/'
      + 'SMTP_PASS env vars on the relay.');
  }
  const transporter = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
  });
  return { transporter, from };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  const to = String(body.to || '').trim();
  if (!to || !/.+@.+\..+/.test(to)) {
    return res.status(400).json({ error: 'valid `to` required' });
  }

  // Render via the shared template renderer when a kind is provided;
  // any explicit subject/html/text on the body overrides the
  // rendered output (lets the admin preview-and-send flow edit before
  // sending without re-implementing the template).
  let subject = body.subject || '';
  let html = body.html || '';
  let text = body.text || '';
  if (body.kind) {
    const out = renderTemplate(body.kind, body.vars || {});
    if (!subject && out.subject) subject = out.subject;
    if (!html && out.html) html = out.html;
    if (!text && out.text) text = out.text;
  }
  if (!subject) subject = 'AstroSeer update';
  if (!html && !text) text = '(empty)';

  // Audit row first so we can see attempts even if SMTP throws.
  const auditRef = db.collection('chats').doc();
  await auditRef.set({
    isEmailDoc: true,
    to,
    kind: body.kind || 'generic',
    subject,
    status: 'sending',
    ts: Date.now(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let transport;
  try { transport = await smtpTransport(db); }
  catch (e) {
    await auditRef.update({ status: 'failed',
      error: String((e && e.message) || e) });
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }

  // Attachment: caller passes { filename, contentBase64, contentType }
  // so we don't have to keep PDF bytes in the request body twice.
  const attachments = [];
  if (body.attachment && body.attachment.contentBase64) {
    attachments.push({
      filename: body.attachment.filename || 'attachment.pdf',
      content: Buffer.from(body.attachment.contentBase64, 'base64'),
      contentType: body.attachment.contentType || 'application/pdf',
    });
  }

  try {
    const info = await transport.transporter.sendMail({
      from: transport.from, to, subject,
      text: text || undefined, html: html || undefined,
      attachments,
    });
    await auditRef.update({
      status: 'sent', messageId: info.messageId || '',
      response: String(info.response || '').slice(0, 200),
    });
    return res.status(200).json({
      ok: true, messageId: info.messageId || '', auditId: auditRef.id });
  } catch (e) {
    await auditRef.update({ status: 'failed',
      error: String((e && e.message) || e).slice(0, 500) });
    return res.status(502).json({
      error: String((e && e.message) || e) });
  }
};
