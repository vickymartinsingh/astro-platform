// Admin -> Play Console tester management bridge.
//
// Uses the Google Play Developer API to list / add / remove tester
// email addresses on a track, then SMTP-sends the Play Store opt-in
// URL to each new tester so they can install the build.
//
// Auth (env vars set on push-relay project):
//   PLAY_SERVICE_ACCOUNT   JSON blob of the same service account
//                          play-publish.mjs uses (contents of
//                          play-publisher/<project>.json).
//   PLAY_PACKAGES          comma-separated list of package ids the
//                          admin is allowed to manage. Defaults to
//                          com.astroseer.mobile,com.astroseer.astrologer,com.astroseer.admin.
//   ADMIN_RELAY_KEY        shared secret for X-Admin-Key. Admin
//                          panel sends this on every call.
//
// Body shapes:
//   { action: 'list',   package, track }
//   { action: 'add',    package, track, email, sendInvite?, optInUrl? }
//   { action: 'remove', package, track, email }
//
// Track values: 'internal' | 'alpha' | 'beta'
//
// Returns: { ok, testers: [...], invited?: boolean, ... }
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

let _publisher = null;
function publisher() {
  if (_publisher) return _publisher;
  const raw = process.env.PLAY_SERVICE_ACCOUNT;
  if (!raw) throw new Error('PLAY_SERVICE_ACCOUNT env var not set');
  const sa = JSON.parse(raw);
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  _publisher = google.androidpublisher({ version: 'v3', auth });
  return _publisher;
}

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return;
  try {
    const sa = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (_) { /* */ }
}

const ALLOWED_PACKAGES = (process.env.PLAY_PACKAGES
  || 'com.astroseer.mobile,com.astroseer.astrologer,com.astroseer.admin')
  .split(',').map((s) => s.trim()).filter(Boolean);

function pkgAllowed(p) {
  return ALLOWED_PACKAGES.includes(String(p || '').trim());
}

// Read the current testers.userEmails for the track. We do this
// inside a temporary edit so the read is consistent. We never commit
// when only listing.
async function readTesters(packageName, track) {
  const pub = publisher();
  const edit = (await pub.edits.insert({ packageName })).data;
  const editId = edit.id;
  try {
    const t = (await pub.edits.tracks.get({
      packageName, editId, track,
    })).data;
    const emails = (t && t.testers && t.testers.userEmails) || [];
    return emails;
  } finally {
    try { await pub.edits.delete({ packageName, editId }); }
    catch (_) { /* swallow */ }
  }
}

async function writeTesters(packageName, track, emails) {
  const pub = publisher();
  const edit = (await pub.edits.insert({ packageName })).data;
  const editId = edit.id;
  // Get the current track to preserve existing release info.
  const current = (await pub.edits.tracks.get({
    packageName, editId, track,
  })).data;
  const next = {
    track,
    testers: { userEmails: emails },
  };
  if (current && current.releases) next.releases = current.releases;
  await pub.edits.tracks.update({
    packageName, editId, track, requestBody: next,
  });
  await pub.edits.commit({ packageName, editId });
  return emails;
}

async function smtpTransport() {
  initAdmin();
  let cfg = null;
  try {
    if (admin.apps.length) {
      const s = await admin.firestore().collection('settings')
        .doc('email').get();
      cfg = s.exists ? s.data() : null;
    }
  } catch (_) { /* */ }
  cfg = cfg || {};
  const host = cfg.host || process.env.SMTP_HOST;
  const port = Number(cfg.port || process.env.SMTP_PORT || 587);
  const user = cfg.user || process.env.SMTP_USER;
  const pass = cfg.pass || process.env.SMTP_PASS;
  const from = cfg.from || process.env.SMTP_FROM
    || 'AstroSeer <support@astroseer.in>';
  if (!host || !user || !pass) return null;
  return {
    transporter: nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user, pass },
    }),
    from,
  };
}

function inviteHtml({ optInUrl, packageName, track }) {
  const appName = packageName === 'com.astroseer.mobile'
    ? 'AstroSeer Connect'
    : packageName === 'com.astroseer.astrologer'
      ? 'AstroSeer for Astrologers'
      : packageName === 'com.astroseer.admin'
        ? 'AstroSeer Admin' : 'AstroSeer';
  const tier = track === 'internal' ? 'Internal Testing'
    : track === 'alpha' ? 'Closed Testing (Alpha)'
      : track === 'beta' ? 'Closed Testing (Beta)' : track;
  return `<div style="font-family:system-ui,Inter,Arial,sans-serif;
    max-width:560px;margin:24px auto;color:#1a1a1a;line-height:1.55">
    <div style="background:linear-gradient(135deg,#D4A12A,#7F2020);
      color:#fff;padding:24px;border-radius:14px 14px 0 0">
      <div style="font-size:22px;font-weight:700">${appName}</div>
      <div style="opacity:.9;margin-top:4px;font-size:13px">
        You're invited to test the upcoming release</div>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #eee;
      border-top:0;border-radius:0 0 14px 14px">
      <p>Hi,</p>
      <p>You have been added as a tester for the
        <b>${appName}</b> Android app
        (<b>${tier}</b> track).</p>
      <p>To install the test build, tap the button below from
        your Android device. Sign in with the same Google account
        you gave to our team, accept the invite, then download from
        Play Store.</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${optInUrl}" style="display:inline-block;
          background:#7F2020;color:#fff;padding:12px 24px;
          border-radius:999px;text-decoration:none;font-weight:700">
          Accept invite & install</a></p>
      <p style="font-size:12px;color:#666">
        If the button doesn't open, copy this link into your
        Android browser:<br>
        <span style="word-break:break-all">${optInUrl}</span></p>
      <p style="font-size:12px;color:#666;margin-top:20px">
        Thanks for helping us ship a great app.<br>
        - The AstroSeer team</p>
    </div></div>`;
}

async function sendInvite({ toEmail, optInUrl, packageName, track }) {
  if (!toEmail || !optInUrl) return { ok: false, error: 'missing fields' };
  const t = await smtpTransport();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  await t.transporter.sendMail({
    from: t.from,
    to: toEmail,
    subject: 'You\'re invited to test AstroSeer',
    html: inviteHtml({ optInUrl, packageName, track }),
  });
  return { ok: true };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const key = process.env.ADMIN_RELAY_KEY;
  if (key && req.headers['x-admin-key'] !== key) {
    return res.status(401).json({ error: 'bad admin key' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const action = String(body.action || '').toLowerCase();
  const packageName = String(body.package || '').trim();
  const track = String(body.track || 'internal').trim().toLowerCase();
  if (!pkgAllowed(packageName)) {
    return res.status(400).json({
      error: `package not allowed; pick one of ${ALLOWED_PACKAGES.join(',')}` });
  }
  if (!['internal', 'alpha', 'beta'].includes(track)) {
    return res.status(400).json({
      error: 'track must be internal | alpha | beta' });
  }
  try {
    if (action === 'list') {
      const testers = await readTesters(packageName, track);
      return res.status(200).json({ ok: true, package: packageName,
        track, testers });
    }
    if (action === 'add') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'valid email required' });
      }
      const current = await readTesters(packageName, track);
      if (!current.includes(email)) {
        current.push(email);
        await writeTesters(packageName, track, current);
      }
      let invited = false;
      let inviteError = null;
      if (body.sendInvite !== false && body.optInUrl) {
        try {
          const r = await sendInvite({
            toEmail: email, optInUrl: body.optInUrl,
            packageName, track,
          });
          if (r && r.ok) invited = true;
          else inviteError = (r && r.error) || 'send failed';
        } catch (e) {
          inviteError = String((e && e.message) || e);
        }
      }
      return res.status(200).json({
        ok: true, package: packageName, track,
        testers: current, invited, inviteError,
      });
    }
    // INVITE-ONLY: send the opt-in URL email without touching the
    // Play Console list. Useful for resending an invitation to a
    // tester who already exists or who missed the first email.
    if (action === 'invite') {
      const emailsRaw = body.email || body.emails;
      const list = (Array.isArray(emailsRaw) ? emailsRaw
        : [String(emailsRaw || '')])
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (!list.length) {
        return res.status(400).json({
          error: 'at least one valid email required' });
      }
      if (!body.optInUrl) {
        return res.status(400).json({
          error: 'optInUrl required so the email can link to the install page' });
      }
      let invited = 0; const errors = [];
      for (const e of list) {
        try {
          const r = await sendInvite({
            toEmail: e, optInUrl: body.optInUrl,
            packageName, track,
          });
          if (r && r.ok) invited += 1;
          else errors.push({ email: e,
            error: (r && r.error) || 'send failed' });
        } catch (err) {
          errors.push({ email: e,
            error: String((err && err.message) || err) });
        }
      }
      return res.status(200).json({
        ok: true, invited, total: list.length, errors });
    }
    // BULK ADD: same as add but takes an array of emails.
    if (action === 'addBulk') {
      const emailsRaw = body.emails || [];
      const incoming = (Array.isArray(emailsRaw) ? emailsRaw
        : String(emailsRaw).split(/[\s,;]+/))
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
      if (!incoming.length) {
        return res.status(400).json({
          error: 'no valid emails in input' });
      }
      const current = await readTesters(packageName, track);
      const added = [];
      for (const e of incoming) {
        if (!current.includes(e)) { current.push(e); added.push(e); }
      }
      if (added.length) {
        await writeTesters(packageName, track, current);
      }
      let invited = 0;
      const inviteErrors = [];
      if (body.sendInvite !== false && body.optInUrl
        && added.length) {
        for (const e of added) {
          try {
            const r = await sendInvite({
              toEmail: e, optInUrl: body.optInUrl,
              packageName, track,
            });
            if (r && r.ok) invited += 1;
            else inviteErrors.push({ email: e,
              error: (r && r.error) || 'send failed' });
          } catch (err) {
            inviteErrors.push({ email: e,
              error: String((err && err.message) || err) });
          }
        }
      }
      return res.status(200).json({
        ok: true, package: packageName, track,
        testers: current,
        addedCount: added.length,
        added,
        invited,
        inviteErrors,
      });
    }
    if (action === 'remove') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: 'email required' });
      }
      const current = await readTesters(packageName, track);
      const next = current.filter((e) => String(e).toLowerCase()
        !== email);
      if (next.length !== current.length) {
        await writeTesters(packageName, track, next);
      }
      return res.status(200).json({
        ok: true, package: packageName, track, testers: next,
      });
    }
    return res.status(400).json({
      error: 'action must be list | add | remove' });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String((e && (e.errors || e.message)) || e).slice(0, 600),
    });
  }
};
