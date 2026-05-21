// Instant refund endpoint.
//
// Astrologers cannot write to users.wallet client-side (Firestore rules
// only allow admins). So when an astrologer initiates a refund we POST
// here with their Firebase ID token; we verify the token, confirm the
// caller is either the session's astroId OR an admin, then atomically:
//   1. credit the customer's wallet by session.cost
//   2. write a /transactions ledger entry (type='credit', reason='refund')
//   3. set session.refundRequest.{status:'processed',processedBy,processedAt}
//      and session.refundedAmount = cost
//   4. drop a notifications doc for admin records ("internal review")
//
// Env: FIREBASE_SERVICE_ACCOUNT (same as sendPush.js / adminUser.js).
const admin = require('firebase-admin');

const ADMIN_EMAILS = [
  'vickymartinsingh@gmail.com',
  'vickymartinsing@gmail.com',
];
const isAdminEmail = (e) => ADMIN_EMAILS.includes(
  String(e || '').trim().toLowerCase());

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    init();

    // 1. Verify caller.
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'no token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;

    const fs = admin.firestore();
    const callerSnap = await fs.collection('users').doc(callerUid).get();
    const callerData = callerSnap.exists ? callerSnap.data() : {};
    const callerIsAdmin = callerData.role === 'admin'
      || isAdminEmail(decoded.email) || isAdminEmail(callerData.email);

    // 2. Parse body.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    const { sessionId } = body;
    const reason = String(body.reason || 'Other').slice(0, 120);
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    // 3. Load the session and authorise.
    const sessRef = fs.collection('sessions').doc(sessionId);
    const sessSnap = await sessRef.get();
    if (!sessSnap.exists) {
      return res.status(404).json({ error: 'session not found' });
    }
    const sess = sessSnap.data();
    const callerIsAstro = sess.astroId
      && String(sess.astroId) === String(callerUid);
    if (!callerIsAdmin && !callerIsAstro) {
      return res.status(403).json({
        error: 'caller is not this session\'s astrologer or an admin',
      });
    }

    // Idempotent: if already processed, return that result.
    const prev = sess.refundRequest || {};
    if (prev.status === 'processed') {
      return res.status(200).json({
        ok: true, refunded: Number(sess.refundedAmount || 0),
        already: true,
      });
    }

    const cost = Number(sess.cost || 0);

    // 4. Atomic credit + ledger + session update.
    await fs.runTransaction(async (t) => {
      if (cost > 0 && sess.userId) {
        const uRef = fs.collection('users').doc(sess.userId);
        const u = await t.get(uRef);
        const w = Number((u.exists ? u.data() : {}).wallet || 0) + cost;
        t.update(uRef, { wallet: w });
        t.set(fs.collection('transactions').doc(), {
          userId: sess.userId, amount: cost, type: 'credit',
          reason: 'refund', referenceId: sessionId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      t.update(sessRef, {
        refundRequested: true,
        refundRequest: {
          by: callerUid,
          byRole: callerIsAdmin ? 'admin' : 'astrologer',
          reason,
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'processed',
          processedBy: callerUid,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        refundedAmount: cost,
      });
    });

    // 5. Admin notification record (internal review trail).
    try {
      await fs.collection('notifications').add({
        type: 'refund_processed',
        title: 'Refund processed',
        body: `${callerIsAdmin ? 'Admin' : 'Astrologer'} refunded `
          + `₹${cost} on session ${String(sessionId).slice(-6)}`
          + ` - ${reason}`,
        sessionId,
        amount: cost,
        requestedBy: callerUid,
        toRole: 'admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      });
    } catch (_) { /* best-effort */ }

    return res.status(200).json({ ok: true, refunded: cost });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e),
    });
  }
};
