// createUser, auth.onCreate trigger (blueprint 8.4).
// Creates the Firestore user record with safe defaults and applies the
// signup bonus (with a matching credit transaction, Hard Rule 6).
const functions = require('firebase-functions');
const { db, FieldValue } = require('./lib/admin');
const { generateUserCode, getConfig, requireAuth } = require('./lib/utils');
const { addMoney } = require('./payments');

exports.createUser = functions.auth.user().onCreate(async (user) => {
  const cfg = await getConfig();
  const signupBonus = Number(cfg.signup_bonus || 0);

  // Ensure the 9-digit code is unique.
  let userCode = generateUserCode();
  for (let i = 0; i < 5; i++) {
    const dup = await db.collection('users')
      .where('userCode', '==', userCode).limit(1).get();
    if (dup.empty) break;
    userCode = generateUserCode();
  }

  await db.collection('users').doc(user.uid).set({
    name: user.displayName || '',
    email: user.email || '',
    phone: user.phoneNumber || '',
    role: 'client',
    userCode,
    wallet: signupBonus,
    isOnline: false,
    isOnCall: false,
    isBlocked: false,
    hasSeenTour: false,
    hasUsedFreeChat: false,
    hasUsedFreeCall: false,
    status: 'active',
    fcmToken: '',
    createdAt: FieldValue.serverTimestamp(),
  });

  if (signupBonus > 0) {
    await db.collection('transactions').add({
      userId: user.uid,
      amount: signupBonus,
      type: 'credit',
      reason: 'bonus',
      referenceId: 'signup_bonus',
      createdAt: FieldValue.serverTimestamp(),
    });
  }
});

// applyReferral, blueprint 6.13 / 9.9. Called once right after signup with
// a referrer's 9-digit userCode. Referrer gets ₹X, the new user gets ₹Y
// (amounts from settings/config). Both credits go through addMoney so each
// has a paired transaction (Hard Rule 6). Idempotent + abuse-guarded.
exports.applyReferral = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const code = String((data && data.code) || '').trim();
  if (!code) return { applied: false };

  const cfg = await getConfig();
  const referrerBonus = Number(cfg.referral_referrer_bonus || 0);
  const refereeBonus = Number(cfg.referral_referee_bonus || 0);
  if (referrerBonus <= 0 && refereeBonus <= 0) return { applied: false };

  const meRef = db.collection('users').doc(uid);
  const meSnap = await meRef.get();
  if (!meSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'user not found');
  }
  if (meSnap.data().referralApplied) return { applied: false };

  const refSnap = await db.collection('users')
    .where('userCode', '==', code).limit(1).get();
  if (refSnap.empty) {
    throw new functions.https.HttpsError('not-found', 'Invalid referral code');
  }
  const referrer = refSnap.docs[0];
  if (referrer.id === uid) {
    throw new functions.https.HttpsError(
      'invalid-argument', 'Cannot refer yourself');
  }

  // Lock the referee first so concurrent calls can't double-apply.
  await meRef.update({ referralApplied: true, referredBy: referrer.id });
  if (refereeBonus > 0) {
    await addMoney(uid, refereeBonus, 'referral', referrer.id);
  }
  if (referrerBonus > 0) {
    await addMoney(referrer.id, referrerBonus, 'referral', uid);
  }
  return { applied: true, refereeBonus };
});
