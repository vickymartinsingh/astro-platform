// walletService, blueprint 8.2: READ ONLY for balance/transactions.
// Every wallet mutation happens server-side in Cloud Functions
// (Hard Rules 3-6). The client may only *trigger* those functions.
import {
  doc, getDoc, onSnapshot, collection, query, where, getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';

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
  const fn = httpsCallable(functions, 'createRazorpayOrder');
  const res = await fn({ amount, couponCode: couponCode || null });
  return res.data; // { orderId, amount, keyId }
}

// 2) After Razorpay checkout resolves, hand the signature to the server.
//    Wallet is credited ONLY if the HMAC signature verifies (Hard Rule 5).
export async function verifyRecharge({ orderId, paymentId, signature, amount }) {
  const fn = httpsCallable(functions, 'verifyPayment');
  const res = await fn({ orderId, paymentId, signature, amount });
  return res.data; // { success: true }
}
