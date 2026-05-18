// userService, blueprint 8.2
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where,
  getDocs, serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';
import { isAdminEmail } from '../admins.js';

// Fallback for when the createUser Cloud Function isn't deployed (Spark/no
// Blaze). On first sign-in, create the Firestore user doc client-side so
// the whole app works. Firestore rules allow a user to create their OWN
// doc; wallet stays 0 (signup bonus only applies when the function runs).
export async function ensureUserDoc(authUser) {
  if (!authUser) return null;
  const ref = doc(db, 'users', authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { uid: snap.id, ...snap.data() };

  let userCode;
  try {
    userCode = await generateUniqueUserCode(
      authUser.displayName || authUser.email);
  } catch { userCode = randCode(6); }

  const data = {
    name: authUser.displayName || '',
    email: authUser.email || '',
    phone: authUser.phoneNumber || '',
    // Owner emails are always admin; never downgrade them to client.
    role: isAdminEmail(authUser.email) ? 'admin' : 'client',
    userCode,
    wallet: 0,
    isOnline: true,
    isOnCall: false,
    isBlocked: false,
    hasSeenTour: false,
    hasUsedFreeChat: false,
    hasUsedFreeCall: false,
    status: 'active',
    fcmToken: '',
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data, { merge: true });
  return { uid: authUser.uid, ...data };
}

// Apply a referrer's userCode after signup (credits both, server-side).
export async function applyReferral(code) {
  const fn = httpsCallable(functions, 'applyReferral');
  return (await fn({ code })).data;
}

export async function getUser(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

export function listenUser(uid, callback) {
  return onSnapshot(doc(db, 'users', uid), (s) =>
    callback(s.exists() ? { uid: s.id, ...s.data() } : null));
}

// NOTE: wallet & role are rejected by Firestore rules from the client.
// updateUser is for profile fields only (name, phone, profileImage, etc).
export async function updateUser(uid, data) {
  const { wallet, role, ...safe } = data || {};
  await updateDoc(doc(db, 'users', uid), safe);
}

export async function setOnline(uid) {
  await updateDoc(doc(db, 'users', uid), { isOnline: true });
}

export async function setOffline(uid) {
  await updateDoc(doc(db, 'users', uid), { isOnline: false });
}

// Short 6-character user code: ALL CAPS letters + digits, seeded from
// the customer's name (or email) so it is meaningful, e.g. "VIC4K9".
// Collision-checked against existing users.
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function randCode(n) {
  let o = '';
  for (let i = 0; i < n; i += 1) {
    o += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return o;
}
export async function generateUniqueUserCode(seed) {
  const base = String(seed || '').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 3);
  for (let i = 0; i < 14; i += 1) {
    const code = (base + randCode(6 - base.length)).slice(0, 6);
    /* eslint-disable no-await-in-loop */
    const snap = await getDocs(query(
      collection(db, 'users'), where('userCode', '==', code)));
    /* eslint-enable no-await-in-loop */
    if (snap.empty) return code;
  }
  throw new Error('Could not generate a unique user code');
}
