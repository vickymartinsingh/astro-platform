// Gift cards (server-side so wallet credit is atomic + abuse-safe).
//
// POST { action: 'create'|'list'|'redeem', amount?, code? }
// Authorization: Bearer <Firebase ID token>
//   - create / list: caller must be an admin
//   - redeem: any signed-in user (credits THEIR wallet)
const admin = require('firebase-admin');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

// Owner allowlist mirrors shared/admins.js so a gift card can be
// generated even if the Firestore role drifted from 'admin'.
const ADMIN_EMAILS = [
  'vickymartinsingh@gmail.com',
  'vickymartinsing@gmail.com',
];
const isAdminEmail = (e) => ADMIN_EMAILS.includes(
  String(e || '').trim().toLowerCase());

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function genCode() {
  let c = '';
  for (let i = 0; i < 8; i++) {
    c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return c;
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
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!idToken) return res.status(401).json({ error: 'no token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const callerUid = decoded.uid;

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    const action = body.action;

    const callerDoc = await db.collection('users').doc(callerUid).get();
    const isAdmin = (callerDoc.exists
      && callerDoc.data().role === 'admin')
      || isAdminEmail(decoded.email)
      || (callerDoc.exists && isAdminEmail(callerDoc.data().email));

    if (action === 'create') {
      if (!isAdmin) return res.status(403).json({ error: 'not an admin' });
      const amount = Math.round(Number(body.amount));
      if (!(amount > 0)) {
        return res.status(400).json({ error: 'invalid amount' });
      }
      let code = genCode();
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        const ex = await db.collection('giftCards').doc(code).get();
        if (!ex.exists) break;
        code = genCode();
      }
      await db.collection('giftCards').doc(code).set({
        code,
        amount,
        redeemed: false,
        redeemedBy: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, code, amount });
    }

    if (action === 'list') {
      if (!isAdmin) return res.status(403).json({ error: 'not an admin' });
      const snap = await db.collection('giftCards')
        .orderBy('createdAt', 'desc').limit(100).get();
      const cards = snap.docs.map((d) => {
        const x = d.data() || {};
        return {
          code: x.code || d.id,
          amount: x.amount || 0,
          status: x.status || (x.redeemed ? 'used' : 'unused'),
          redeemed: !!x.redeemed,
          redeemedBy: x.redeemedBy || null,
          redeemedByName: x.redeemedByName || null,
          redeemedByEmail: x.redeemedByEmail || null,
          redeemedAt: x.redeemedAt || null,
          redeemedIp: x.redeemedIp || null,
          redeemedUa: x.redeemedUa || null,
          createdAt: x.createdAt || null,
        };
      });
      return res.status(200).json({ cards });
    }

    if (action === 'redeem') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: 'code required' });
      // Capture caller's compliance context (IP + UA) for audit.
      const ip = (req.headers['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req.headers['x-real-ip']
          || (req.connection && req.connection.remoteAddress) || '');
      const ua = String(req.headers['user-agent'] || '').slice(0, 400);
      const ref = db.collection('giftCards').doc(code);
      const out = await db.runTransaction(async (t) => {
        const g = await t.get(ref);
        if (!g.exists) throw new Error('Invalid gift card code');
        const gc = g.data() || {};
        if (gc.redeemed) throw new Error('This gift card was already used');
        const amount = Math.round(Number(gc.amount) || 0);
        if (!(amount > 0)) throw new Error('Invalid gift card');
        const uRef = db.collection('users').doc(callerUid);
        const u = await t.get(uRef);
        const wallet = Number((u.data() || {}).wallet || 0) + amount;
        t.update(uRef, { wallet });
        t.update(ref, {
          status: 'used',
          redeemed: true,
          redeemedBy: callerUid,
          redeemedByName: (u.data() || {}).name || null,
          redeemedByEmail: (u.data() || {}).email || decoded.email || null,
          redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
          redeemedIp: ip || '',
          redeemedUa: ua,
        });
        t.set(db.collection('transactions').doc(), {
          userId: callerUid,
          amount,
          type: 'credit',
          reason: 'gift card',
          referenceId: code,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { amount };
      });
      // In-app notification + push (best effort).
      try {
        await db.collection('notifications').add({
          userId: callerUid,
          title: 'Gift card redeemed',
          message: `+ Rs ${out.amount} added to your wallet (gift card).`,
          type: 'wallet',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      try {
        const u = await db.collection('users').doc(callerUid).get();
        const ud = u.data() || {};
        const toks = []
          .concat(Array.isArray(ud.fcmTokens) ? ud.fcmTokens : [])
          .concat(ud.fcmToken ? [ud.fcmToken] : [])
          .filter(Boolean);
        if (toks.length) {
          await admin.messaging().sendEachForMulticast({
            tokens: [...new Set(toks)],
            notification: {
              title: 'Gift card redeemed',
              body: `Rs ${out.amount} added to your wallet.`,
            },
            data: { type: 'wallet', route: '/transactions' },
            android: {
              priority: 'high',
              notification: { channelId: 'astro-default', sound: 'default' },
            },
          });
        }
      } catch (_) {}
      return res.status(200).json({ success: true, amount: out.amount });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
};
