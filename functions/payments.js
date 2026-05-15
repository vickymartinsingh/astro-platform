// Razorpay payments, Hard Rule 5: wallet credited ONLY after server-side
// HMAC signature verification. Key Secret lives in functions config, never
// in Firestore or any frontend (blueprint 12.4).
const functions = require('firebase-functions');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { db, FieldValue } = require('./lib/admin');
const { getConfig, money, requireAuth } = require('./lib/utils');

function keys() {
  const cfg = functions.config().razorpay || {};
  return {
    keyId: cfg.key_id || process.env.RAZORPAY_KEY_ID,
    keySecret: cfg.secret || process.env.RAZORPAY_KEY_SECRET,
  };
}

// Internal helper, the only place a wallet is credited. Atomic:
// wallet += amount AND a matching credit transaction (Hard Rule 6).
async function addMoney(userId, amount, reason, referenceId) {
  const amt = money(amount);
  if (!(amt > 0)) throw new Error('Invalid credit amount');
  await db.runTransaction(async (t) => {
    const ref = db.collection('users').doc(userId);
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error('User not found');
    const wallet = money(Number(snap.data().wallet || 0) + amt);
    t.update(ref, { wallet });
    t.set(db.collection('transactions').doc(), {
      userId,
      amount: amt,
      type: 'credit',
      reason: reason || 'recharge',
      referenceId: referenceId || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

exports.createRazorpayOrder = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const cfg = await getConfig();
  let amount = Number(data.amount || 0);
  if (amount < cfg.min_recharge) {
    throw new functions.https.HttpsError(
      'invalid-argument', `Minimum recharge is ₹${cfg.min_recharge}`);
  }
  // Coupon discount is applied to the *payable* amount; the wallet is still
  // credited the full face amount on success (recalculated server-side).
  const { keyId, keySecret } = keys();
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await rzp.orders.create({
    amount: Math.round(amount * 100), // paise
    currency: 'INR',
    notes: { userId: uid },
  });
  await db.collection('payments').doc(order.id).set({
    userId: uid,
    amount,
    provider: 'razorpay',
    status: 'created',
    orderId: order.id,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { orderId: order.id, amount, keyId };
});

exports.verifyPayment = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const { orderId, paymentId, signature } = data || {};
  if (!orderId || !paymentId || !signature) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
  }
  const { keySecret } = keys();
  const expected = crypto.createHmac('sha256', keySecret)
    .update(orderId + '|' + paymentId).digest('hex');
  if (expected !== signature) {
    await db.collection('payments').doc(orderId)
      .set({ status: 'failed', paymentId }, { merge: true });
    throw new functions.https.HttpsError(
      'permission-denied', 'Invalid payment signature');
  }
  // Idempotency: never credit the same order twice.
  const pRef = db.collection('payments').doc(orderId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Order not found');
  }
  const payment = pSnap.data();
  if (payment.status === 'success') return { success: true, already: true };
  if (payment.userId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Order mismatch');
  }

  await addMoney(uid, payment.amount, 'recharge', orderId);
  await pRef.set(
    { status: 'success', paymentId, signature,
      paidAt: FieldValue.serverTimestamp() },
    { merge: true });
  return { success: true, credited: payment.amount };
});

module.exports.addMoney = addMoney;
