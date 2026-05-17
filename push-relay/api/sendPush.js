// Serverless FCM relay for the AstroConnect apps.
//
// Why this exists: a phone can only receive a lock-screen push from a
// TRUSTED server (Firebase rule). The apps cannot send pushes themselves.
// This tiny function holds the Firebase service account and is the only
// thing allowed to call FCM. Deploy it free on Vercel as its own project.
//
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  – the full service-account JSON (one line)
//   PUSH_RELAY_KEY            – optional shared secret; if set, callers
//                               must send it as the x-push-key header
//
// POST JSON body:
//   { toUid }                              – push to one user, OR
//   { target: 'all'|'clients'|'astrologers'|'user', userId }
//   + title, body, data?
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
  const creds = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(creds) });
}

function tokensFrom(doc) {
  const d = doc.data() || {};
  const arr = Array.isArray(d.fcmTokens) ? d.fcmTokens.slice() : [];
  if (d.fcmToken && !arr.includes(d.fcmToken)) arr.push(d.fcmToken);
  return arr.filter(Boolean);
}

module.exports = async (req, res) => {
  // CORS (native app origin is capacitor://localhost / https://localhost).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-push-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.PUSH_RELAY_KEY;
  if (key && req.headers['x-push-key'] !== key) {
    return res.status(401).json({ error: 'bad key' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const { toUid, target, userId, title, data } = body;
  const msgBody = body.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    init();
    const db = admin.firestore();
    const users = [];

    if (toUid) {
      const s = await db.collection('users').doc(toUid).get();
      if (s.exists) users.push(s);
    } else if (target === 'user' && userId) {
      const s = await db.collection('users').doc(userId).get();
      if (s.exists) users.push(s);
    } else if (target === 'clients') {
      (await db.collection('users').where('role', '==', 'client').get())
        .forEach((d) => users.push(d));
    } else if (target === 'astrologers') {
      (await db.collection('users').where('role', '==', 'astrologer').get())
        .forEach((d) => users.push(d));
      (await db.collection('users').where('isAstrologer', '==', true).get())
        .forEach((d) => users.push(d));
    } else { // 'all' or unspecified broadcast
      (await db.collection('users').get()).forEach((d) => users.push(d));
    }

    // De-dupe users, collect tokens.
    const seen = new Set();
    let tokens = [];
    for (const u of users) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      tokens = tokens.concat(tokensFrom(u));
    }
    tokens = [...new Set(tokens)];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no tokens' });

    const message = {
      notification: { title: String(title), body: String(msgBody || '') },
      // Mirror title/body into data so the app can re-raise the banner
      // itself when the push arrives in the FOREGROUND (OS suppresses
      // the system banner in that state).
      data: {
        ...Object.fromEntries(
          Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
        title: String(title),
        body: String(msgBody || ''),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'astro-default',     // high-importance -> heads-up
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: 'PUBLIC',           // show on lock screen
          notificationPriority: 'PRIORITY_MAX',
        },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } },
      },
    };

    let sent = 0; let failed = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const r = await admin.messaging().sendEachForMulticast({
        ...message, tokens: batch });
      sent += r.successCount; failed += r.failureCount;
    }
    return res.status(200).json({ sent, failed, recipients: seen.size });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
