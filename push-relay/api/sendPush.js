// Serverless FCM relay for the AstroSeer apps.
//
// Why this exists: a phone can only receive a lock-screen push from a
// TRUSTED server (Firebase rule). The apps cannot send pushes themselves.
// This tiny function holds the Firebase service account and is the only
// thing allowed to call FCM. Deploy it free on Vercel as its own project.
//
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  - the full service-account JSON (one line)
//   PUSH_RELAY_KEY            - optional shared secret; if set, callers
//                               must send it as the x-push-key header
//
// POST JSON body:
//   { toUid }                              - push to one user, OR
//   { target: 'all'|'clients'|'astrologers'|'admins'|'user', userId }
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

    // Treat anyone who is an astrologer (role OR the isAstrologer flag)
    // as an astrologer; everyone else as a client. This makes the
    // "Clients only" / "Astrologers only" targeting exact and mutually
    // exclusive (the previous code leaked to both).
    const isAstro = (d) => d.role === 'astrologer' || d.isAstrologer === true;

    const col = db.collection('users');
    if (toUid) {
      const s = await col.doc(toUid).get();
      if (s.exists) users.push(s);
    } else if (target === 'user' && userId) {
      const s = await col.doc(userId).get();
      if (s.exists) users.push(s);
    } else if (target === 'astrologers') {
      // Targeted queries (no full-collection scan): role OR flag.
      const [byRole, byFlag] = await Promise.all([
        col.where('role', '==', 'astrologer').get(),
        col.where('isAstrologer', '==', true).get(),
      ]);
      byRole.forEach((d) => users.push(d));
      byFlag.forEach((d) => users.push(d));
    } else if (target === 'admins') {
      (await col.where('role', '==', 'admin').get())
        .forEach((d) => users.push(d));
    } else if (target === 'clients') {
      // Clients = everyone who is not an astrologer; this one still
      // needs a scan (no "not equal" + flag query in Firestore).
      (await col.get()).forEach((d) => {
        if (!isAstro(d.data() || {})) users.push(d);
      });
    } else { // 'all' or unspecified broadcast
      (await col.get()).forEach((d) => users.push(d));
    }

    // De-dupe users, collect tokens.
    const seen = new Set();
    let tokens = [];
    for (const u of users) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      tokens = tokens.concat(tokensFrom(u));
    }

    // ONLY a true "all" broadcast also fans out to anonymous devices
    // (deviceTokens). Role-targeted (clients / astrologers) and single
    // user sends must NOT, otherwise the wrong audience receives it.
    const isBroadcast = !toUid && (target === 'all' || !target);
    if (isBroadcast) {
      try {
        const dt = await db.collection('deviceTokens').get();
        dt.forEach((d) => {
          const v = (d.data() || {}).token || d.id;
          if (v) tokens.push(v);
        });
      } catch (_) { /* collection may not exist yet */ }
    }
    tokens = [...new Set(tokens)];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no tokens' });

    // Is this an incoming call? Then we push it as a CALL notification:
    // bypass Doze (priority high), max importance channel, lock-screen
    // visible, long vibrate pattern, sticky tag so it isn't coalesced.
    const isCall = !!(data && (data.kind === 'incoming_call'
      || data.channelId === 'astro-calls'));
    const channelId = (data && data.channelId)
      || (isCall ? 'astro-calls' : 'astro-default');

    const androidNotif = {
      sound: 'default',
      channelId,
      defaultSound: true,
      defaultVibrateTimings: true,
      visibility: 'PUBLIC',
      notificationPriority: 'PRIORITY_MAX',
    };
    if (isCall) {
      // WhatsApp/Skype-style call ring: long-running vibrate pattern,
      // sticky (won't auto-dismiss), and a per-session tag so a second
      // call from the same astro just refreshes - never piles up.
      androidNotif.tag = `call_${(data && data.sessionId) || Date.now()}`;
      androidNotif.sticky = true;
      androidNotif.defaultVibrateTimings = false;
      androidNotif.vibrateTimings = [
        '0s', '0.8s', '0.4s', '0.8s', '0.4s', '0.8s', '0.4s', '0.8s',
        '0.4s', '0.8s', '0.4s', '0.8s',
      ];
      // Hint Android this is a phone-call-class event.
      androidNotif.eventTimestamp = new Date().toISOString();
    }

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
        ttl: isCall ? 60 * 1000 : 3600 * 1000,  // calls: 60s, else 1h
        notification: androidNotif,
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': isCall ? 'voip' : 'alert',
        },
        payload: {
          aps: {
            sound: 'default',
            'interruption-level': isCall ? 'time-sensitive'
              : 'time-sensitive',
            category: isCall ? 'INCOMING_CALL' : undefined,
          },
        },
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
