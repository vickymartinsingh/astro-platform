// Email OTP for signup verification.
//
// Two actions on the same endpoint (body.action):
//   request: generate a 6-digit code, store it in emailOtps/{email}
//            with a 10-minute expiry + zero attempts, and send it via
//            SMTP using the admin-managed settings/email config.
//            From address defaults to support@astroseer.in.
//   verify:  check the code against the latest unused doc for that
//            email. If valid, mark the doc used + flip the Firebase
//            Auth user's emailVerified flag to true. Caps at 5 wrong
//            attempts per code, after which the user must request a
//            new one.
//
// SMTP credentials are read from `settings/email` Firestore doc
// (saved via admin / Email & Alerts page) so the operator can swap
// providers without redeploying. Required fields:
//   { smtpHost, smtpPort, smtpUser, smtpPass,
//     smtpSecure (bool, default smtpPort==465),
//     fromAddress (default "AstroSeer <support@astroseer.in>") }
//
// Safe to call repeatedly. Idempotent on the verify path (a second
// verify with the same code returns ok: true, alreadyVerified: true).

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
  });
}

const OTP_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const MAX_ATTEMPTS = 5;                   // wrong tries per code
const RESEND_COOLDOWN_MS = 30 * 1000;     // can re-request after 30s

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (_) { b = {}; }
  }
  return b || {};
}

function normaliseEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function genCode() {
  // 6-digit zero-padded, cryptographically OK for OTP (Math.random is
  // fine here - the doc TTL + 5-try cap make brute force pointless,
  // and the email itself is the security channel).
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

async function smtpTransport(db) {
  // 1) Try the admin-managed Firestore config first (preferred - the
  // operator sets these in /admin-email without redeploying).
  let cfg = {};
  try {
    const s = await db.collection('settings').doc('email').get();
    if (s.exists) cfg = s.data() || {};
  } catch (_) { /* env-only mode */ }

  const host = cfg.smtpHost || process.env.SMTP_HOST || '';
  const port = Number(cfg.smtpPort || process.env.SMTP_PORT || 587);
  const user = cfg.smtpUser || process.env.SMTP_USER || '';
  const pass = cfg.smtpPass || process.env.SMTP_PASS || '';
  const secure = typeof cfg.smtpSecure === 'boolean'
    ? cfg.smtpSecure : port === 465;
  const from = cfg.fromAddress || cfg.smtpFrom || process.env.MAIL_FROM
    || 'AstroSeer <support@astroseer.in>';
  // Silent admin BCC. Stored in settings/email as { bccEnabled, bccTo }.
  // Recipient never sees it because the BCC header is stripped from
  // their copy by the SMTP server.
  const bccEnabled = !!cfg.bccEnabled;
  const bccTo = String(cfg.bccTo || '').trim();
  const bcc = (bccEnabled && /.+@.+\..+/.test(bccTo)) ? bccTo : '';
  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Admin must set host / user / '
      + 'pass in /admin-email (settings/email) or via SMTP_HOST / '
      + 'SMTP_USER / SMTP_PASS env vars on the relay.');
  }
  const transporter = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
  });
  return { transporter, from, bcc, cfg };
}

// Attach the silent admin BCC (if configured) to a nodemailer
// mailOptions object. Centralised so every send path picks it up
// without each caller remembering.
function withBcc(opts, t) {
  if (!t || !t.bcc) return opts;
  const next = { ...opts };
  next.bcc = opts.bcc ? `${opts.bcc}, ${t.bcc}` : t.bcc;
  return next;
}

function bodyForCode(code, name) {
  const subject = `${code} is your AstroSeer verification code`;
  const text = `Hi ${name || 'there'},\n\n`
    + `Your AstroSeer email verification code is:\n\n   ${code}\n\n`
    + 'This code expires in 10 minutes. If you did not request it, '
    + 'please ignore this email.\n\n- AstroSeer Support';
  const html = `<div style="font-family:Inter,Arial,sans-serif;`
    + `max-width:480px;margin:auto;padding:24px;color:#1a1a2e">`
    + `<h2 style="margin:0 0 12px 0">Verify your email</h2>`
    + `<p style="margin:0 0 8px 0;font-size:14px;color:#555">`
    + `Hi ${name || 'there'}, your AstroSeer verification code is:`
    + `</p><div style="font-size:36px;font-weight:700;letter-spacing:`
    + `6px;background:#FBF7EE;color:#7F2020;padding:18px 12px;`
    + `border-radius:14px;text-align:center;margin:12px 0">`
    + `${code}</div><p style="font-size:12px;color:#777;margin-top:`
    + `12px">This code expires in 10 minutes. If you did not request `
    + `it, you can safely ignore this email.</p><p style="font-size:`
    + `12px;color:#aaa;margin-top:24px">- AstroSeer Support</p></div>`;
  return { subject, text, html };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    init();
  } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  const action = String(body.action || '').toLowerCase();

  // ---------- SEND (generic email) ------------------------------------
  // Folded in here so the relay stays under Vercel Hobby's 12-function
  // cap. Used by:
  //   - Admin "Resend kundli via email" (/admin-orders)
  //   - Admin "Send test email" (/admin-email)
  //   - Auto-send after kundli PDF generation
  // Body: { action: 'send', to, kind?, vars?, subject?, html?, text?,
  //         attachment? }
  if (action === 'send') {
    return handleSend(req, res, db, body);
  }

  // ---------- WELCOME (new-signup touch) -----------------------------
  // Fired right after the client finishes signup. Honors the admin
  // toggle (welcomeEnabled) and pulls the custom subject line
  // (welcomeSubject) from settings/email. Silently no-ops if the
  // admin has disabled it - the caller still gets {ok:true,
  // skipped:'disabled'} so signup flow does not fail.
  if (action === 'welcome') {
    return handleWelcome(req, res, db, body);
  }

  const email = normaliseEmail(body.email);
  if (!email || !/.+@.+\..+/.test(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }

  // ---------- REQUEST ------------------------------------------------
  if (action === 'request') {
    const otpRef = db.collection('emailOtps').doc(email);
    const prev = await otpRef.get();
    if (prev.exists) {
      const p = prev.data() || {};
      const sentAt = (p.createdAt && p.createdAt.toMillis
        && p.createdAt.toMillis()) || 0;
      if (sentAt && Date.now() - sentAt < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil(
          (RESEND_COOLDOWN_MS - (Date.now() - sentAt)) / 1000);
        return res.status(429).json({
          error: `Please wait ${waitSec}s before requesting a new code.`,
          waitSec });
      }
    }
    const code = genCode();
    await otpRef.set({
      email,
      code,
      used: false,
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + OTP_TTL_MS),
    });

    // Send the email.
    let transport;
    try { transport = await smtpTransport(db); }
    catch (e) {
      return res.status(503).json({
        error: String((e && e.message) || e) });
    }
    const name = String(body.name || '').slice(0, 60);
    const { subject, text, html } = bodyForCode(code, name);
    try {
      await transport.transporter.sendMail(withBcc({
        from: transport.from, to: email, subject, text, html,
      }, transport));
    } catch (e) {
      // Keep the doc around so the operator can read the code from
      // the database if email delivery itself failed.
      return res.status(502).json({
        error: 'Could not send verification email: '
          + String((e && e.message) || e) });
    }
    return res.status(200).json({ ok: true, sent: true,
      expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
  }

  // ---------- VERIFY -------------------------------------------------
  if (action === 'verify') {
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Code must be 6 digits.' });
    }
    const otpRef = db.collection('emailOtps').doc(email);
    const snap = await otpRef.get();
    if (!snap.exists) {
      return res.status(400).json({
        error: 'No code on file for this email. Request a new one.' });
    }
    const o = snap.data() || {};
    if (o.used) {
      // Idempotency: a successful verify can be replayed safely.
      return res.status(200).json({ ok: true, alreadyVerified: true });
    }
    const expMs = (o.expiresAt && o.expiresAt.toMillis
      && o.expiresAt.toMillis()) || 0;
    if (expMs && Date.now() > expMs) {
      return res.status(410).json({
        error: 'This code has expired. Request a new one.' });
    }
    if (Number(o.attempts || 0) >= MAX_ATTEMPTS) {
      return res.status(429).json({
        error: 'Too many wrong attempts. Request a new code.' });
    }
    if (String(o.code) !== code) {
      await otpRef.update({
        attempts: admin.firestore.FieldValue.increment(1),
      });
      return res.status(400).json({
        error: 'Incorrect code. Please check the email and try again.',
        remaining: Math.max(0, MAX_ATTEMPTS - 1 - Number(o.attempts || 0)) });
    }

    // Match - mark the OTP used + flip emailVerified on the Auth user
    // so the rest of the app can rely on user.emailVerified.
    await otpRef.update({
      used: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    try {
      const userRec = await admin.auth().getUserByEmail(email);
      await admin.auth().updateUser(userRec.uid, { emailVerified: true });
      // Mirror onto the users/{uid} profile doc for client-side gating.
      await db.collection('users').doc(userRec.uid).set({
        emailVerified: true,
      }, { merge: true });
    } catch (_) { /* user might not exist yet at OTP time */ }

    return res.status(200).json({ ok: true, verified: true });
  }

  return res.status(400).json({
    error: 'action must be "request", "verify" or "send"' });
};

// ============================================================
// Generic email send (kundli reports + admin resends + tests)
// ============================================================

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
  if (kind === 'welcome') {
    const name = v.name || 'there';
    const appUrl = v.appUrl || 'https://astroseer.in';
    const subject = v.subject || 'Welcome to AstroSeer';
    const text = `Namaste ${name},\n\n`
      + 'Welcome to AstroSeer - your home for authentic Vedic '
      + 'astrology, kundli reports, tarot readings and 1:1 '
      + 'consultations with verified astrologers.\n\n'
      + 'A few things you can do right now:\n'
      + '  * Generate your free Vedic kundli with chart + dashas\n'
      + '  * Talk or chat with an astrologer in minutes\n'
      + '  * Read your daily horoscope and tarot pull\n'
      + '  * Explore numerology, kundli matching and remedies\n\n'
      + `Open the app: ${appUrl}\n\n`
      + 'With blessings,\nTeam AstroSeer\n'
      + 'support@astroseer.in - astroseer.in';
    const html = renderHtmlEmail({
      preheader: 'Welcome to AstroSeer - your Vedic astrology home.',
      heading: 'Welcome to AstroSeer',
      lead: `Namaste <b>${escapeHtml(name)}</b>, welcome aboard. `
        + 'Your AstroSeer account is ready. We are honoured to have '
        + 'you join us on this journey of Vedic insight, kundli '
        + 'wisdom and trusted astrological guidance.',
      bullets: [
        'Generate your free Vedic kundli with chart + dashas',
        'Talk or chat with verified astrologers in minutes',
        'Read your daily horoscope and tarot pull',
        'Explore numerology, kundli matching and remedies',
      ],
      ctaLabel: 'Open AstroSeer',
      ctaUrl: appUrl,
      footnote: 'If you have any questions, just reply to this '
        + 'email - a real human from our team will get back to you.',
    });
    return { subject, text, html };
  }
  if (kind === 'kundli_report_ready' || kind === 'kundli_report_resend') {
    const name = v.name || 'there';
    const profileName = v.profileName || '';
    const kindLabel = v.kindLabel || 'Vedic Kundli Report';
    const ordersUrl = v.ordersUrl || 'https://astroseer.in/orders';
    const isResend = kind === 'kundli_report_resend';
    const baseSubject = `Your ${kindLabel} is ready`
      + (profileName ? ` - ${profileName}` : '');
    const subject = isResend
      ? `Re-sending: ${baseSubject}` : baseSubject;
    const opener = isResend
      ? 'As requested, we are re-sending your kundli report '
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
  return { subject: '', text: '', html: '' };
}

async function handleSend(req, res, db, body) {
  const to = String(body.to || '').trim();
  if (!to || !/.+@.+\..+/.test(to)) {
    return res.status(400).json({ error: 'valid `to` required' });
  }
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

  // Persist the rendered content so /admin-email can show admin
  // exactly what landed in the customer's inbox (text + html +
  // attachment metadata + final status). The actual binary content
  // of the attachment is NOT stored - only the filename + mime so
  // we don't bloat Firestore docs past the 1 MB limit.
  const attachMeta = (body.attachment && body.attachment.contentBase64)
    ? [{ filename: body.attachment.filename || 'attachment',
      contentType: body.attachment.contentType
        || 'application/octet-stream',
      sizeBytes: Math.round(
        body.attachment.contentBase64.length * 0.75) }]
    : [];
  const auditRef = db.collection('chats').doc();
  await auditRef.set({
    isEmailDoc: true,
    to,
    kind: body.kind || 'generic',
    subject,
    body: text || '',
    html: html || '',
    attachments: attachMeta,
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

  const attachments = [];
  if (body.attachment && body.attachment.contentBase64) {
    attachments.push({
      filename: body.attachment.filename || 'attachment.pdf',
      content: Buffer.from(body.attachment.contentBase64, 'base64'),
      contentType: body.attachment.contentType || 'application/pdf',
    });
  }
  try {
    const info = await transport.transporter.sendMail(withBcc({
      from: transport.from, to, subject,
      text: text || undefined, html: html || undefined,
      attachments,
    }, transport));
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
}

// ============================================================
// Welcome email (fires once on successful signup)
// ============================================================
//
// Honours two admin toggles in settings/email:
//   welcomeEnabled  - master on/off for this flow
//   welcomeSubject  - custom subject (default "Welcome to AstroSeer")
//
// Idempotency: we set `welcomeEmailSentAt` on users/{uid} when the
// send succeeds and short-circuit if already set, so a flaky client
// or a duplicate signup retry does not spam the user. Looked up by
// uid when provided, else by email.
async function handleWelcome(req, res, db, body) {
  const to = normaliseEmail(body.email);
  if (!to || !/.+@.+\..+/.test(to)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  const uid = String(body.uid || '').trim();
  const name = String(body.name || '').slice(0, 60);

  // Read admin settings + early-out if disabled.
  let cfg = {};
  try {
    const s = await db.collection('settings').doc('email').get();
    if (s.exists) cfg = s.data() || {};
  } catch (_) { /* tolerate */ }
  // Default: welcomeEnabled is true unless admin explicitly set false.
  if (cfg.welcomeEnabled === false) {
    return res.status(200).json({ ok: true, skipped: 'disabled' });
  }
  const customSubject = String(cfg.welcomeSubject || '').trim();

  // Idempotency guard.
  let userRef = null;
  if (uid) {
    userRef = db.collection('users').doc(uid);
    try {
      const u = await userRef.get();
      if (u.exists && u.data() && u.data().welcomeEmailSentAt) {
        return res.status(200).json({
          ok: true, skipped: 'already-sent' });
      }
    } catch (_) { /* tolerate */ }
  }

  const tpl = renderTemplate('welcome', {
    name, appUrl: 'https://astroseer.in',
    subject: customSubject || 'Welcome to AstroSeer',
  });

  // Audit row so /admin-email shows the welcome touch alongside
  // every other outbound email.
  const auditRef = db.collection('chats').doc();
  try {
    await auditRef.set({
      isEmailDoc: true,
      to,
      kind: 'welcome',
      subject: tpl.subject,
      body: tpl.text,
      html: tpl.html,
      attachments: [],
      status: 'sending',
      ts: Date.now(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) { /* best-effort audit */ }

  let transport;
  try { transport = await smtpTransport(db); }
  catch (e) {
    try { await auditRef.update({ status: 'failed',
      error: String((e && e.message) || e) }); } catch (_) {}
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  try {
    const info = await transport.transporter.sendMail(withBcc({
      from: transport.from, to,
      subject: tpl.subject, text: tpl.text, html: tpl.html,
    }, transport));
    try { await auditRef.update({
      status: 'sent', messageId: info.messageId || '',
      response: String(info.response || '').slice(0, 200),
    }); } catch (_) {}
    if (userRef) {
      try { await userRef.set({
        welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }); } catch (_) {}
    }
    return res.status(200).json({
      ok: true, sent: true, messageId: info.messageId || '' });
  } catch (e) {
    try { await auditRef.update({ status: 'failed',
      error: String((e && e.message) || e).slice(0, 500) }); } catch (_) {}
    return res.status(502).json({
      error: String((e && e.message) || e) });
  }
}
