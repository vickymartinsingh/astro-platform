// Gateway-agnostic wallet recharge. Reads the ACTIVE payment gateway +
// keys the admin saved in the admin portal (settings/payments) and
// creates / verifies a payment with that gateway, then credits the
// wallet server-side (atomic). Wired: Razorpay, Cashfree. Adding
// another gateway = add one adapter here; admin config stays the same.
const admin = require('firebase-admin');
const crypto = require('crypto');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({ credential: admin.credential.cert(
    JSON.parse(raw)) });
}

async function gateways() {
  const s = await admin.firestore()
    .collection('settings').doc('payments').get();
  return s.exists ? (s.data() || {}) : {};
}

async function creditWallet(uid, amount, gateway, meta) {
  const db = admin.firestore();
  const amt = Math.round(Number(amount));
  const m = meta || {};
  // Permanent, audit-grade payment record. The `payments` collection
  // is admin-only writable and is NEVER deleted/reset (the admin
  // revenue "reset" only moves a dashboard cutoff) - so the gateway
  // recharge history with full user + transaction details survives.
  const payRef = db.collection('payments').doc();
  await db.runTransaction(async (t) => {
    const uRef = db.collection('users').doc(uid);
    const u = await t.get(uRef);
    const ud = u.data() || {};
    const w = Number(ud.wallet || 0) + amt;
    t.update(uRef, { wallet: w });
    t.set(db.collection('transactions').doc(), {
      userId: uid, amount: amt, type: 'credit', reason: 'recharge',
      referenceId: payRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    t.set(payRef, {
      userId: uid,
      userName: ud.name || '',
      userEmail: ud.email || '',
      userPhone: ud.phone || '',
      userCode: ud.userCode || '',
      amount: amt,
      currency: 'INR',
      gateway,
      paymentId: m.paymentId || '',
      orderId: m.orderId || '',
      status: 'success',
      invoiceNo: 'INV-' + Date.now().toString(36).toUpperCase(),
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  try {
    await db.collection('notifications').add({
      userId: uid, title: 'Money added to your wallet',
      message: `+ Rs ${amt} added to your wallet (recharge via `
        + `${gateway}).`,
      type: 'wallet', read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) {}
  return payRef.id;
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
    const uid = decoded.uid;

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};
    const cfg = await gateways();
    const active = cfg.active || 'razorpay';
    const g = cfg[active] || {};
    const action = body.action;

    // ---- RAZORPAY ----
    if (active === 'razorpay') {
      const keyId = g.field0; const keySecret = g.field1;
      if (!keyId || !keySecret) {
        return res.status(400).json({
          error: 'Razorpay keys not set in admin Payment Gateways' });
      }
      const basic = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`)
        .toString('base64');
      if (action === 'create') {
        const amount = Math.round(Number(body.amount));
        const r = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: { Authorization: basic,
            'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount * 100, currency: 'INR',
            receipt: `w_${uid}_${Date.now()}` }),
        });
        const j = await r.json();
        if (!j.id) {
          return res.status(400).json({
            error: 'Razorpay order failed: '
              + JSON.stringify(j).slice(0, 160) });
        }
        return res.status(200).json({
          gateway: 'razorpay', orderId: j.id, keyId, amount });
      }
      if (action === 'verify') {
        const { orderId, paymentId, signature, amount } = body;
        const expect = crypto.createHmac('sha256', keySecret)
          .update(`${orderId}|${paymentId}`).digest('hex');
        if (expect !== signature) {
          return res.status(400).json({ error: 'signature mismatch' });
        }
        const payId = await creditWallet(uid, amount, 'razorpay',
          { paymentId, orderId });
        return res.status(200).json({ success: true, amount, payId });
      }
    }

    // ---- CASHFREE ----
    if (active === 'cashfree') {
      const appId = g.field0; const secret = g.field1;
      if (!appId || !secret) {
        return res.status(400).json({
          error: 'Cashfree keys not set in admin Payment Gateways' });
      }
      const H = {
        'x-client-id': appId,
        'x-client-secret': secret,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      };
      const baseUrl = g.extra && /sandbox/i.test(g.extra)
        ? 'https://sandbox.cashfree.com/pg'
        : 'https://api.cashfree.com/pg';
      if (action === 'create') {
        const amount = Math.round(Number(body.amount));
        const orderId = `w_${uid}_${Date.now()}`;
        const r = await fetch(`${baseUrl}/orders`, {
          method: 'POST',
          headers: H,
          body: JSON.stringify({
            order_id: orderId,
            order_amount: amount,
            order_currency: 'INR',
            customer_details: {
              customer_id: uid,
              customer_phone: body.phone || '9999999999',
              customer_email: body.email || 'user@astroconnect.app',
              customer_name: body.name || 'AstroSeer User',
            },
            order_meta: { return_url: `${body.returnUrl || ''}` },
          }),
        });
        const j = await r.json();
        if (!j.payment_session_id) {
          return res.status(400).json({
            error: 'Cashfree order failed: '
              + JSON.stringify(j).slice(0, 160) });
        }
        return res.status(200).json({
          gateway: 'cashfree',
          orderId,
          paymentSessionId: j.payment_session_id,
        });
      }
      if (action === 'verify') {
        const { orderId } = body;
        const r = await fetch(`${baseUrl}/orders/${orderId}`,
          { headers: H });
        const j = await r.json();
        if (j.order_status === 'PAID') {
          const payId = await creditWallet(uid, j.order_amount,
            'cashfree', { orderId, paymentId: j.cf_order_id || '' });
          return res.status(200).json({
            success: true, amount: j.order_amount, payId });
        }
        return res.status(200).json({
          success: false, status: j.order_status || 'PENDING' });
      }
    }

    return res.status(400).json({
      error: `Gateway "${active}" has no adapter yet. Wired: `
        + 'Razorpay, Cashfree.' });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }
};
