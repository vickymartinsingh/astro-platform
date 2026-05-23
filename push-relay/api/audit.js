// Server-side audit logger. Called by the client apps on signup/login/
// logout/recharge/etc. Writes to `audits/{auto}` with the user's uid
// (verified via their Firebase ID token), the request IP from the proxy
// header (Vercel sets x-forwarded-for / x-real-ip), and the user agent.
//
// This is admin-only data - the audit collection should be read-only to
// admins. Customers and astrologers never see their own log; it's for
// compliance / fraud review.
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.headers['x-real-ip']
    || (req.connection && req.connection.remoteAddress)
    || '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  try {
    init();
    const db = admin.firestore();

    // Bearer ID token is recommended but not required: signup happens
    // before the token is minted, so the caller may pass `uid` in the
    // body for that flow only. For everything else we prefer the token.
    let uid = null;
    let email = null;
    const authz = req.headers.authorization || '';
    const tokenStr = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (tokenStr) {
      try {
        const decoded = await admin.auth().verifyIdToken(tokenStr);
        uid = decoded.uid; email = decoded.email || null;
      } catch (_) { /* fall through to body uid */ }
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    if (!uid && body.uid) uid = String(body.uid);
    if (!uid) return res.status(401).json({ error: 'no uid' });

    const type = String(body.type || 'event').slice(0, 40);
    const meta = (body.meta && typeof body.meta === 'object')
      ? body.meta : {};
    const app = String(body.app || 'web').slice(0, 24);
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 400);

    // Write the per-event audit log row.
    const docRef = await db.collection('audits').add({
      uid, email, type, app, meta, ip, ua,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Also stamp the user doc with their LAST device + IP + sign-in for
    // quick compliance visibility on the admin profile page.
    if (type === 'login' || type === 'signup') {
      try {
        await db.collection('users').doc(uid).set({
          lastSignInAt: admin.firestore.FieldValue.serverTimestamp(),
          lastSignInIp: ip || '',
          lastSignInUa: ua,
          lastSignInApp: app,
        }, { merge: true });
      } catch (_) { /* non-fatal */ }
    }
    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }
};
