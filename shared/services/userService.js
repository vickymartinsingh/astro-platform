// userService, blueprint 8.2
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where,
  getDocs, serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, getFunctionsLazy } from '../firebase.js';
import { isAdminEmail } from '../admins.js';

// Fallback for when the createUser Cloud Function isn't deployed (Spark/no
// Blaze). On first sign-in, create the Firestore user doc client-side so
// the whole app works. Firestore rules allow a user to create their OWN
// doc; wallet stays 0 (signup bonus only applies when the function runs).
export async function ensureUserDoc(authUser) {
  if (!authUser) return null;
  const ref = doc(db, 'users', authUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const u = snap.data();
    // DELETED-ACCOUNT GUARD. /admin-users.deleteUser flips the doc
    // to status='deleted' instead of hard-deleting, BECAUSE without
    // this guard the next sign-in by the same Firebase Auth user
    // would recreate a fresh doc here and the admin's delete looked
    // undone. We sign the auth user out immediately and refuse to
    // return a profile so the rest of the app treats them as a
    // signed-out guest.
    if (String(u.status || '').toLowerCase() === 'deleted') {
      try {
        const { getAuth, signOut } = await import('firebase/auth');
        await signOut(getAuth());
      } catch (_) { /* tolerate */ }
      return null;
    }
    // Lazy migration: old long codes (e.g. 9 digits) -> new short
    // 6-char ALL-CAPS alphanumeric, saved to the user's own doc.
    if (!/^[A-Z0-9]{6}$/.test(String(u.userCode || ''))) {
      let nc;
      try {
        nc = await generateUniqueUserCode(
          u.name || u.email || authUser.email);
      } catch { nc = randCode(6); }
      try { await updateDoc(ref, { userCode: nc }); } catch (_) {}
      return { uid: snap.id, ...u, userCode: nc };
    }
    return { uid: snap.id, ...u };
  }

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
  const fns = await getFunctionsLazy();
  if (!fns) throw new Error('Cloud Functions unavailable.');
  const fn = httpsCallable(fns, 'applyReferral');
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

// Admin-only: set a user's role. Unlike updateUser (which strips role
// because Firestore rules forbid self role changes), an admin caller
// passes the isAdmin() rule so writing `role` directly is allowed.
export async function adminSetUserRole(uid, role) {
  if (!uid || !role) return;
  await updateDoc(doc(db, 'users', uid), { role });
}

// Find a user doc by exact email (admin Team Access lookup).
export async function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const snap = await getDocs(
    query(collection(db, 'users'), where('email', '==', e)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

export async function setOnline(uid) {
  // Pull a public-IP best-effort. ipify is free, cacheable, no key.
  // If the fetch fails (offline / blocked), we just skip the field.
  let ip = '';
  try {
    if (typeof fetch !== 'undefined') {
      const r = await fetch('https://api.ipify.org?format=json',
        { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j && j.ip) ip = String(j.ip).slice(0, 64);
      }
    }
  } catch (_) { /* no-op */ }
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent)
    ? String(navigator.userAgent).slice(0, 240) : '';
  const lang = (typeof navigator !== 'undefined' && navigator.language)
    ? String(navigator.language).slice(0, 16) : '';
  const platform = (typeof navigator !== 'undefined'
    && navigator.platform) ? String(navigator.platform).slice(0, 64) : '';
  const screen = (typeof window !== 'undefined' && window.screen)
    ? `${window.screen.width}x${window.screen.height}` : '';
  await updateDoc(doc(db, 'users', uid), {
    isOnline: true,
    lastSeenAt: serverTimestamp(),
    lastIp: ip || null,
    lastUserAgent: ua || null,
    lastLanguage: lang || null,
    lastPlatform: platform || null,
    lastScreen: screen || null,
  });
  // Also append to a per-user session history so admin can audit
  // every login + device combination over time. Soft-cap: we
  // append one row per setOnline call (typically one per session),
  // which is bounded by usage.
  try {
    const { addDoc, collection: col } = await import('firebase/firestore');
    await addDoc(col(db, 'users', uid, 'sessions'), {
      at: serverTimestamp(),
      ip: ip || null,
      ua: ua || null,
      platform: platform || null,
      screen: screen || null,
    });
  } catch (_) { /* never block presence on history append */ }
}

// User-initiated account deletion request (Google Play requires this).
// Sets a flag on the user doc; an admin processes it within 30 days
// (consultation/payment records kept for legal compliance, then purged).
// Self-write (isSelf passes Firestore rules); role stays untouched.
export async function requestAccountDeletion(uid, reason) {
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), {
    pendingDeletion: true,
    deletionRequestedAt: serverTimestamp(),
    deletionReason: String(reason || '').slice(0, 500),
  });
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
