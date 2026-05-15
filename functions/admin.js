// Privileged admin actions. NOT in the blueprint's 6-file list, but required:
// the admin panel must mutate wallet/approval server-side (Hard Rules 4 & 6).
// Each callable verifies the caller is an admin and writes an audit log.
const functions = require('firebase-functions');
const { db, FieldValue } = require('./lib/admin');
const { requireAdmin, money } = require('./lib/utils');
const { addMoney } = require('./payments');

async function auditLog(adminId, action, target, before, after) {
  await db.collection('logs').add({
    adminId, action, target,
    before: before || null,
    after: after || null,
    timestamp: FieldValue.serverTimestamp(),
  });
}

exports.adminBlockUser = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { uid, blocked } = data || {};
  await db.collection('users').doc(uid)
    .update({ isBlocked: !!blocked, status: blocked ? 'suspended' : 'active' });
  await auditLog(adminId, blocked ? 'blocked_user' : 'unblocked_user', uid);
  return { success: true };
});

exports.adminApproveAstrologer = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { astroId, approved } = data || {};
  await db.collection('astrologers').doc(astroId)
    .update({ approved: !!approved });
  await auditLog(adminId,
    approved ? 'approved_astrologer' : 'rejected_astrologer', astroId);
  return { success: true };
});

// Manual wallet adjustment, always paired with a transaction (Hard Rule 6).
exports.adminAdjustWallet = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { uid, amount, reason } = data || {};
  const amt = Number(amount);
  if (!amt || Number.isNaN(amt)) {
    throw new functions.https.HttpsError('invalid-argument', 'amount required');
  }
  if (amt > 0) {
    await addMoney(uid, amt, reason || 'admin_credit', 'admin_adjust');
  } else {
    await db.runTransaction(async (t) => {
      const ref = db.collection('users').doc(uid);
      const snap = await t.get(ref);
      const wallet = money(Number(snap.data().wallet || 0) + amt);
      t.update(ref, { wallet: wallet < 0 ? 0 : wallet });
      t.set(db.collection('transactions').doc(), {
        userId: uid, amount: amt, type: 'debit',
        reason: reason || 'admin_debit', referenceId: 'admin_adjust',
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  }
  await auditLog(adminId, 'adjusted_wallet', uid, null, { amount: amt, reason });
  return { success: true };
});

// settings/* is write:false for clients (blueprint 12.3), admins edit it
// here via the Admin SDK, with an audit log entry.
exports.adminUpdateSettings = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { docName, values } = data || {};
  if (!['config', 'email', 'features', 'payments', 'announcement']
    .includes(docName)) {
    throw new functions.https.HttpsError('invalid-argument', 'bad settings doc');
  }
  await db.collection('settings').doc(docName)
    .set(values || {}, { merge: true });
  await auditLog(adminId, 'changed_settings', docName, null, values);
  return { success: true };
});

exports.adminForceEndSession = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { endSessionInternal } = require('./billing');
  await endSessionInternal(data.sessionId, 'admin');
  await auditLog(adminId, 'force_ended_session', data.sessionId);
  return { success: true };
});

// Payout approve/reject (blueprint 6.32). Approval here marks the request;
// the actual bank/UPI transfer is done externally by the admin.
exports.adminProcessPayout = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { payoutId, approve, note } = data || {};
  const ref = db.collection('payouts').doc(payoutId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'payout not found');
  }
  await ref.update({
    status: approve ? 'approved' : 'rejected',
    adminNote: note || '',
    processedAt: FieldValue.serverTimestamp(),
  });
  await auditLog(adminId, approve ? 'approved_payout' : 'rejected_payout',
    payoutId, null, { amount: snap.data().amount });
  return { success: true };
});

// Resolve a dispute, optionally issuing a refund. A refund is a wallet
// credit, so it goes through addMoney (Hard Rule 6, paired transaction).
exports.adminResolveDispute = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { disputeId, resolution, refundAmount } = data || {};
  const ref = db.collection('disputes').doc(disputeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'dispute not found');
  }
  const d = snap.data();
  const amt = Number(refundAmount || 0);
  if (amt > 0) await addMoney(d.userId, amt, 'refund', disputeId);
  await ref.update({
    status: 'resolved',
    resolution: resolution || '',
    refundAmount: amt,
  });
  await auditLog(adminId, 'resolved_dispute', disputeId, null,
    { refundAmount: amt });
  return { success: true };
});

exports.adminSaveCoupon = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { id, coupon } = data || {};
  const payload = {
    code: String(coupon.code || '').toUpperCase(),
    discountPercent: Number(coupon.discountPercent || 0),
    maxDiscount: Number(coupon.maxDiscount || 0),
    expiry: coupon.expiry ? new Date(coupon.expiry) : null,
    usageLimit: Number(coupon.usageLimit || 0),
    usedCount: Number(coupon.usedCount || 0),
    active: coupon.active !== false,
  };
  if (id) await db.collection('coupons').doc(id).set(payload, { merge: true });
  else await db.collection('coupons').add(payload);
  await auditLog(adminId, 'saved_coupon', payload.code);
  return { success: true };
});
