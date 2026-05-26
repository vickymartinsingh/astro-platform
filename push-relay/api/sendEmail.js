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

// Same template renderer the client uses, so admin previews match
// production exactly. We require the bundled CJS build that
// shared/index.js exports under @astro/shared.
function loadTemplates() {
  try {
    // The relay deploys with the same shared lib symlinked at
    // ../../shared, so this require resolves at deploy time.
    // eslint-disable-next-line global-require
    return require('../../shared/services/emailService.js');
  } catch (_) { return null; }
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
    const tpl = loadTemplates();
    if (tpl && tpl.renderTemplate) {
      const out = tpl.renderTemplate(body.kind, body.vars || {});
      if (!subject) subject = out.subject;
      if (!html && out.html) html = out.html;
      if (!text) text = out.body || out.text || '';
    }
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
