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
  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Admin must set host / user / '
      + 'pass in /admin-email (settings/email) or via SMTP_HOST / '
      + 'SMTP_USER / SMTP_PASS env vars on the relay.');
  }
  const transporter = nodemailer.createTransport({
    host, port, secure, auth: { user, pass },
  });
  return { transporter, from };
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
    + `6px;background:#f3eeff;color:#6c2bd9;padding:18px 12px;`
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
      await transport.transporter.sendMail({
        from: transport.from, to: email, subject, text, html,
      });
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
    error: 'action must be "request" or "verify"' });
};
