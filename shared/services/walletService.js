// walletService, blueprint 8.2: READ ONLY for balance/transactions.
// Every wallet mutation happens server-side in Cloud Functions
// (Hard Rules 3-6). The client may only *trigger* those functions.
import {
  doc, getDoc, onSnapshot, collection, query, where, getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, getFunctionsLazy } from '../firebase.js';

// Tiny helper: lazy-loads firebase/functions on first call so the
// 25+ KB module never lands in the boot bundle. Throws a friendly
// error if Cloud Functions isn't available (env-less CI build).
async function callable(name) {
  const fns = await getFunctionsLazy();
  if (!fns) throw new Error('Cloud Functions unavailable. Try again later.');
  return httpsCallable(fns, name);
}

export async function getWallet(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? Number(snap.data().wallet || 0) : 0;
}

export function listenWallet(uid, callback) {
  return onSnapshot(doc(db, 'users', uid), (s) =>
    callback(s.exists() ? Number(s.data().wallet || 0) : 0));
}

export async function getTransactions(uid) {
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// ---- Recharge: trigger server-side Razorpay flow only ----
// 1) Ask the Cloud Function to create a Razorpay order.
export async function createRechargeOrder(amount, couponCode) {
  const fn = await callable('createRazorpayOrder');
  const res = await fn({ amount, couponCode: couponCode || null });
  return res.data; // { orderId, amount, keyId }
}

// 2) After Razorpay checkout resolves, hand the signature to the server.
//    Wallet is credited ONLY if the HMAC signature verifies (Hard Rule 5).
export async function verifyRecharge({ orderId, paymentId, signature, amount }) {
  const fn = await callable('verifyPayment');
  const res = await fn({ orderId, paymentId, signature, amount });
  return res.data; // { success: true }
}

// Gateway-agnostic recharge via the relay (uses whatever gateway the
// admin set active in the admin Payment Gateways page).
export async function payCall(payload) {
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  const url = push ? push.replace(/\/sendPush\/?$/, '/pay') : '';
  if (!url) throw new Error('Payment service not configured.');
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Please sign in first.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Payment failed');
  return j;
}

// Validate a coupon code client-side BEFORE the user hits Pay, so we
// can show the discount preview ("SAVE10 applied, ₹10 bonus on top")
// the moment they tap Apply. The actual bonus credit + usedCount
// increment happens server-side in the relay's /api/pay verify path
// (atomic, can't be tampered with from the browser), so this client
// check is purely UX. Server is the source of truth.
//
// Coupon doc shape (from admin-coupons): {
//   code, discountPercent, maxDiscount, expiry (YYYY-MM-DD),
//   usageLimit, usedCount, active,
//   title?, description?,        // browsable copy in the customer UI
//   minAmount?,                  // minimum recharge for this coupon
//   firstRechargeOnly?: boolean, // per-user; checked vs payments coll
// }
// Returns: { valid, code, bonus, percent, maxDiscount, message }
export async function validateCoupon(rawCode, amount) {
  const code = String(rawCode || '').trim().toUpperCase();
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  if (!code) return { valid: false, message: 'Enter a coupon code.' };
  if (amt <= 0) {
    return { valid: false, code,
      message: 'Enter a recharge amount first.' };
  }
  try {
    const snap = await getDocs(query(
      collection(db, 'coupons'), where('code', '==', code)));
    if (snap.empty) {
      return { valid: false, code,
        message: `Coupon "${code}" not found.` };
    }
    const c = { id: snap.docs[0].id, ...snap.docs[0].data() };
    if (c.active === false) {
      return { valid: false, code,
        message: `Coupon "${code}" is not active right now.` };
    }
    if (c.expiry) {
      const exp = new Date(c.expiry);
      if (!Number.isNaN(exp.getTime())
        && exp.getTime() < new Date().setHours(0, 0, 0, 0)) {
        return { valid: false, code,
          message: `Coupon "${code}" expired on ${c.expiry}.` };
      }
    }
    if (c.usageLimit && Number(c.usedCount || 0) >= Number(c.usageLimit)) {
      return { valid: false, code,
        message: `Coupon "${code}" has reached its usage limit.` };
    }
    const minAmt = Math.max(0, Number(c.minAmount || 0));
    if (minAmt > 0 && amt < minAmt) {
      return { valid: false, code,
        message: `${code} needs a minimum recharge of ₹${minAmt}.` };
    }
    // PER-USER first-recharge enforcement. Client-side check is a
    // friendliness optimisation - the relay's pay handler does the
    // SAME query before crediting, so a user cannot bypass this by
    // calling the API directly.
    if (c.firstRechargeOnly && auth && auth.currentUser) {
      try {
        const prior = await getDocs(query(
          collection(db, 'payments'),
          where('userId', '==', auth.currentUser.uid),
          where('status', '==', 'success')));
        if (!prior.empty) {
          return { valid: false, code,
            message: `${code} is a first-recharge offer and your wallet `
              + 'already has a successful recharge on it.' };
        }
      } catch (_) { /* fall through - server validator catches it */ }
    }
    const percent = Math.max(0, Number(c.discountPercent || 0));
    const cap = Math.max(0, Number(c.maxDiscount || 0));
    const raw = Math.floor((amt * percent) / 100);
    const bonus = cap ? Math.min(raw, cap) : raw;
    if (bonus <= 0) {
      return { valid: false, code,
        message: `Coupon "${code}" has no discount for this amount.` };
    }
    return {
      valid: true, code, bonus, percent, maxDiscount: cap,
      title: c.title || '', description: c.description || '',
      firstRechargeOnly: !!c.firstRechargeOnly,
      minAmount: minAmt,
      message: `${code} applied. You will get an extra ₹${bonus} `
        + 'as bonus credit on top of your recharge.',
    };
  } catch (e) {
    return { valid: false, code,
      message: `Could not check coupon: ${e.message || e}` };
  }
}

// Public listing of every coupon the customer is eligible for RIGHT
// NOW. Powers the Swiggy/BigBasket-style "Available offers" panel on
// the wallet page. Filters out:
//   - inactive coupons
//   - expired coupons
//   - coupons that have hit their global usage limit
//   - first-recharge coupons where the signed-in user has already
//     completed a successful recharge
// Returns an array sorted by best-discount-first (so the headline
// 100% cashback always shows on top).
export async function listAvailableCoupons() {
  try {
    const snap = await getDocs(collection(db, 'coupons'));
    const now = new Date().setHours(0, 0, 0, 0);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.active !== false)
      .filter((c) => {
        if (!c.expiry) return true;
        const exp = new Date(c.expiry).getTime();
        return Number.isNaN(exp) ? true : exp >= now;
      })
      .filter((c) => !(c.usageLimit
        && Number(c.usedCount || 0) >= Number(c.usageLimit)));
    // Per-user first-recharge filter (asks payments collection ONCE).
    let usedFirstRecharge = false;
    if (auth && auth.currentUser
      && rows.some((c) => c.firstRechargeOnly)) {
      try {
        const prior = await getDocs(query(
          collection(db, 'payments'),
          where('userId', '==', auth.currentUser.uid),
          where('status', '==', 'success')));
        usedFirstRecharge = !prior.empty;
      } catch (_) { usedFirstRecharge = false; }
    }
    return rows
      .filter((c) => !(c.firstRechargeOnly && usedFirstRecharge))
      .sort((a, b) => {
        const pa = Number(a.discountPercent || 0);
        const pb = Number(b.discountPercent || 0);
        if (pa !== pb) return pb - pa;
        return Number(b.maxDiscount || 0) - Number(a.maxDiscount || 0);
      });
  } catch (_) { return []; }
}

// Redeem a gift card code into the wallet (server-side via the relay,
// so the credit is atomic and a code can never be used twice).
export async function redeemGiftCard(code) {
  // Must reference process.env.NEXT_PUBLIC_* DIRECTLY (Next inlines only
  // the literal form; an aliased read is undefined in the APK build).
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  const url = push ? push.replace(/\/sendPush\/?$/, '/giftCard') : '';
  if (!url) throw new Error('Gift card service not configured.');
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Please sign in first.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'redeem',
      code: String(code || '').trim().toUpperCase(),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Redeem failed');
  return j; // { success:true, amount }
}
