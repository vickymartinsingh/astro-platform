const { db } = require('./admin');

function generateUserCode() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

async function getConfig() {
  const snap = await db.collection('settings').doc('config').get();
  const c = snap.exists ? snap.data() : {};
  return {
    commission_percent: Number(c.commission_percent ?? 30),
    signup_bonus: Number(c.signup_bonus ?? 0),
    min_recharge: Number(c.min_recharge ?? 100),
    free_chat_seconds: Number(c.free_chat_seconds ?? 0),
    free_call_seconds: Number(c.free_call_seconds ?? 0),
    referral_referrer_bonus: Number(c.referral_referrer_bonus ?? 0),
    referral_referee_bonus: Number(c.referral_referee_bonus ?? 0),
    ...c,
  };
}

// Round to 2 decimals to avoid floating-point wallet drift.
function money(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function requireAuth(context) {
  if (!context.auth) {
    const e = new Error('Authentication required');
    e.code = 'unauthenticated';
    throw e;
  }
  return context.auth.uid;
}

async function requireAdmin(context) {
  const uid = requireAuth(context);
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    const e = new Error('Admin privilege required');
    e.code = 'permission-denied';
    throw e;
  }
  return uid;
}

module.exports = { generateUserCode, getConfig, money, requireAuth, requireAdmin };
