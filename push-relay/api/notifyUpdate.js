// Admin endpoint: fan-out the "new app version available" push to
// every customer whose stored appBuild is less than the cutoff. Used
// when admin publishes a new build and wants existing customers to
// know there's an update on the Play Store.
//
// Body:
//   { minBuild?, package?, storeUrl?, version?, notes?, uid? }
//
//   minBuild  cutoff. users with appBuild < minBuild get the push.
//             Defaults to settings/config.app_latest_build.
//   uid       (optional) target a single user by uid. Skips the
//             outdated-user query and fires push regardless of
//             their tracked appBuild.
//   storeUrl  Play Store link. Defaults to
//             https://play.google.com/store/apps/details?id=com.astroseer.mobile
//   version   "1.0.80"  - shown in the push body.
//   notes     short text  - shown in the popup when the user opens.
//
// Auth: X-Push-Key header must match process.env.PUSH_RELAY_KEY.
//
// Returns: { ok, targeted, sent, failed, errors }.
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

function tokensFrom(ud) {
  const arr = Array.isArray(ud.fcmTokens) ? ud.fcmTokens.slice() : [];
  if (ud.fcmToken && !arr.includes(ud.fcmToken)) arr.push(ud.fcmToken);
  return arr.filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-push-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const key = process.env.PUSH_RELAY_KEY;
  if (key && req.headers['x-push-key'] !== key) {
    return res.status(401).json({ error: 'bad key' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const targetUid = String(body.uid || '').trim();
  const storeUrl = (body.storeUrl
    || 'https://play.google.com/store/apps/details?id=com.astroseer.mobile')
    .trim();
  const version = String(body.version || '').trim();
  const notes = String(body.notes
    || 'Tap to install the latest version.').trim();
  try {
    init();
    const db = admin.firestore();
    let targeted = [];
    if (targetUid) {
      const uSnap = await db.collection('users').doc(targetUid).get();
      if (uSnap.exists) targeted = [{ id: uSnap.id, data: uSnap.data() }];
    } else {
      // Determine cutoff. Either explicit minBuild OR latest_build
      // from settings/config.
      let minBuild = Number(body.minBuild || 0);
      if (!minBuild) {
        const cfg = await db.collection('settings').doc('config').get();
        const c = cfg.exists ? (cfg.data() || {}) : {};
        minBuild = Number(c.app_latest_build || 0);
      }
      if (!minBuild) {
        return res.status(400).json({
          error: 'minBuild required (and settings.app_latest_build empty)' });
      }
      const snap = await db.collection('users')
        .where('appBuild', '<', minBuild)
        .limit(1000)
        .get();
      targeted = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    }
    let sent = 0; let failed = 0;
    const errors = [];
    for (const u of targeted) {
      const tokens = tokensFrom(u.data || {});
      if (!tokens.length) continue;
      const msg = {
        tokens,
        notification: {
          title: version
            ? `AstroSeer ${version} is available`
            : 'A new version of AstroSeer is available',
          body: notes,
        },
        data: {
          type: 'app_update',
          storeUrl,
          version,
          notes,
        },
        android: {
          priority: 'high',
          notification: { channelId: 'updates',
            defaultSound: true },
        },
        apns: { payload: { aps: { sound: 'default' } } },
      };
      try {
        const r = await admin.messaging().sendEachForMulticast(msg);
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
      sent,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false, error: String((e && e.message) || e) });
  }
};
