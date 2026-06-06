// Admin-only multi-tool endpoint. Merged from notifyUpdate.js +
// playTesters.js to stay under Vercel Hobby's 12-function cap.
//
// Body shape:
//   { tool: 'notifyUpdate', minBuild?, uid?, version, notes, storeUrl }
//   { tool: 'playTesters',  action: 'list'|'add'|'remove'|'invite'|'addBulk',
//                           package, track, email|emails, optInUrl, sendInvite? }
//
// Auth (env var on push-relay):
//   ADMIN_RELAY_KEY   shared secret sent as X-Admin-Key.
//
// For notifyUpdate tool: requires PLAY_PACKAGES + FIREBASE_SERVICE_ACCOUNT.
// For playTesters tool: requires PLAY_SERVICE_ACCOUNT + SMTP_* (for emails).
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ---------- shared init ----------
function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return;
  try {
    const sa = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } catch (_) { /* */ }
}

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

// =================================================================
// TOOL: notifyUpdate  - fan-out a 'new app version' push.
// =================================================================
function tokensFrom(ud) {
  const arr = Array.isArray(ud.fcmTokens) ? ud.fcmTokens.slice() : [];
  if (ud.fcmToken && !arr.includes(ud.fcmToken)) arr.push(ud.fcmToken);
  return arr.filter(Boolean);
}

async function runNotifyUpdate(body, res) {
  initAdmin();
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT not set' });
  }
  const db = admin.firestore();
  const targetUid = String(body.uid || '').trim();
  const storeUrl = (body.storeUrl
    || 'https://play.google.com/store/apps/details?id=com.astroseer.mobile')
    .trim();
  const version = String(body.version || '').trim();
  const notes = String(body.notes
    || 'Tap to install the latest version.').trim();
  let targeted = [];
  if (targetUid) {
    const uSnap = await db.collection('users').doc(targetUid).get();
    if (uSnap.exists) targeted = [{ id: uSnap.id, data: uSnap.data() }];
  } else {
    let minBuild = Number(body.minBuild || 0);
    if (!minBuild) {
      const cfg = await db.collection('settings').doc('config').get();
      minBuild = Number((cfg.exists ? cfg.data() : {}).app_latest_build || 0);
    }
    if (!minBuild) {
      return res.status(400).json({
        error: 'minBuild required (and settings.app_latest_build empty)' });
    }
    const snap = await db.collection('users')
      .where('appBuild', '<', minBuild).limit(1000).get();
    targeted = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  let sent = 0; let failed = 0; const errors = [];
  for (const u of targeted) {
    const tokens = tokensFrom(u.data || {});
    if (!tokens.length) continue;
    try {
      const r = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: version
            ? `AstroSeer ${version} is available`
            : 'A new version of AstroSeer is available',
          body: notes,
        },
        data: { type: 'app_update', storeUrl, version, notes },
        android: { priority: 'high',
          notification: { channelId: 'updates', defaultSound: true } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      sent += r.successCount || 0;
      failed += r.failureCount || 0;
    } catch (e) {
      failed += 1;
      errors.push({ uid: u.id, error: String(e.message || e) });
    }
  }
  return res.status(200).json({
    ok: true,
    targeted: targeted.length,
    sent, failed,
    errors: errors.slice(0, 10),
  });
}

// =================================================================
// TOOL: playTesters  - manage Play Console testers + invite emails.
// =================================================================
const ALLOWED_PACKAGES = (process.env.PLAY_PACKAGES
  || 'com.astroseer.mobile,com.astroseer.astrologer,com.astroseer.admin')
  .split(',').map((s) => s.trim()).filter(Boolean);

function pkgAllowed(p) {
  return ALLOWED_PACKAGES.includes(String(p || '').trim());
}

async function readTesters(packageName, track) {
  const pub = publisher();
  const edit = (await pub.edits.insert({ packageName })).data;
  const editId = edit.id;
  try {
    const t = (await pub.edits.tracks.get({
      packageName, editId, track,
    })).data;
    return (t && t.testers && t.testers.userEmails) || [];
  } finally {
    try { await pub.edits.delete({ packageName, editId }); }
    catch (_) { /* */ }
  }
}

async function writeTesters(packageName, track, emails) {
  const pub = publisher();
  const edit = (await pub.edits.insert({ packageName })).data;
  const editId = edit.id;
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
  // Read both the new (smtp*) and legacy (host/user/pass/from) field
  // names so we stay compatible with what admin-email.js actually
  // writes today plus any older docs still hanging around.
  const host = cfg.smtpHost || cfg.host || process.env.SMTP_HOST;
  const port = Number(cfg.smtpPort || cfg.port
    || process.env.SMTP_PORT || 587);
  const user = cfg.smtpUser || cfg.user || process.env.SMTP_USER;
  const pass = cfg.smtpPass || cfg.pass || process.env.SMTP_PASS;
  const secure = typeof cfg.smtpSecure === 'boolean'
    ? cfg.smtpSecure : port === 465;
  const from = cfg.smtpFrom || cfg.fromAddress || cfg.from
    || process.env.SMTP_FROM || process.env.MAIL_FROM
    || 'AstroSeer <support@astroseer.in>';
  // BCC policy: ADMIN-CONFIGURABLE ONLY. The previously hard-coded
  // compliance BCC (vickymartinsingh@outlook.com) has been removed.
  const bccEnabled = !!cfg.bccEnabled;
  const bccTo = String(cfg.bccTo || '').trim();
  const adminBcc = (bccEnabled && /.+@.+\..+/.test(bccTo))
    ? bccTo : '';
  const bcc = adminBcc;
  if (!host || !user || !pass) return null;
  return {
    transporter: nodemailer.createTransport({
      host, port, secure,
      auth: { user, pass },
    }),
    from,
    bcc,
    cfg,
  };
}

// Merge silent BCC into a nodemailer mailOptions object. Caller
// passes the transport object (which carries the resolved bcc).
function withBcc(opts, t) {
  if (!t || !t.bcc) return opts;
  const next = { ...opts };
  next.bcc = opts.bcc ? `${opts.bcc}, ${t.bcc}` : t.bcc;
  return next;
}

function inviteHtml({ optInUrl, packageName, track }) {
  const appName = packageName === 'com.astroseer.mobile'
    ? 'AstroSeer'
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
        <b>${appName}</b> Android app (<b>${tier}</b> track).</p>
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
  await t.transporter.sendMail(withBcc({
    from: t.from,
    to: toEmail,
    subject: 'You\'re invited to test AstroSeer',
    html: inviteHtml({ optInUrl, packageName, track }),
  }, t));
  return { ok: true };
}

async function runPlayTesters(body, res) {
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
    let invited = false; let inviteError = null;
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
        error: 'optInUrl required' });
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
  if (action === 'addbulk') {
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
    let invited = 0; const inviteErrors = [];
    if (body.sendInvite !== false && body.optInUrl && added.length) {
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
      addedCount: added.length, added,
      invited, inviteErrors,
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
    error: 'action must be list | add | remove | invite | addBulk' });
}

// ---------- HTTP entrypoint ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-admin-key, x-push-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  // Accept either header name (legacy notifyUpdate clients used
  // x-push-key, new admin-web uses x-admin-key).
  const expected = process.env.ADMIN_RELAY_KEY
    || process.env.PUSH_RELAY_KEY;
  const got = req.headers['x-admin-key'] || req.headers['x-push-key'];
  if (expected && got !== expected) {
    return res.status(401).json({ error: 'bad admin key' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const tool = String(body.tool || '').toLowerCase();
  try {
    if (tool === 'notifyupdate') return runNotifyUpdate(body, res);
    if (tool === 'playtesters') return runPlayTesters(body, res);
    if (tool === 'updateuser') return runUpdateUser(req, body, res);
    return res.status(400).json({
      error: 'tool must be notifyUpdate | playTesters | updateUser' });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String((e && (e.errors || e.message)) || e).slice(0, 600),
    });
  }
};

// =================================================================
// TOOL: updateUser  - change a user's login email / password.
// Backwards-compatible with the old /api/adminUser endpoint.
// =================================================================
const ADMIN_EMAILS = [
  'vickymartinsingh@gmail.com',
  'vickymartinsing@gmail.com',
];
const isAdminEmail = (e) => ADMIN_EMAILS.includes(
  String(e || '').trim().toLowerCase());

async function runUpdateUser(req, body, res) {
  initAdmin();
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'FIREBASE_SERVICE_ACCOUNT not set' });
  }
  // Caller must send their Firebase ID token.
  const authz = req.headers.authorization || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!idToken) return res.status(401).json({ error: 'no token' });
  const decoded = await admin.auth().verifyIdToken(idToken);
  const callerDoc = await admin.firestore()
    .collection('users').doc(decoded.uid).get();
  const ok = (callerDoc.exists && callerDoc.data().role === 'admin')
    || isAdminEmail(decoded.email)
    || (callerDoc.exists && isAdminEmail(callerDoc.data().email));
  if (!ok) return res.status(403).json({ error: 'not an admin' });
  const { uid, email, password } = body || {};
  if (!uid || (!email && !password)) {
    return res.status(400).json({ error: 'uid + email/password required' });
  }
  const patch = {};
  if (email) patch.email = String(email).trim();
  if (password) patch.password = String(password);
  await admin.auth().updateUser(uid, patch);
  if (email) {
    await admin.firestore().collection('users').doc(uid)
      .set({ email: patch.email }, { merge: true });
  }
  return res.status(200).json({ success: true, uid, email: patch.email });
}
