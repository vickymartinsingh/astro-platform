// Admin-only: change a user's LOGIN email (and optionally password).
//
// Changing the sign-in email lives in Firebase Auth, not Firestore, so
// it needs the Admin SDK (server-side). The caller must send their
// Firebase ID token; we verify it and require that caller to be an
// admin (users/{callerUid}.role === 'admin') before doing anything.
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
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
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'no token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerDoc = await admin.firestore()
      .collection('users').doc(decoded.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'not an admin' });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
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
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
