// adminService, blueprint 8.2 & Section 6.
// Each privileged action TRIES the Cloud Function first; if Functions are
// not deployed (Spark / no Blaze) it falls back to a direct Firestore
// write. Firestore rules permit these writes for users whose role=admin,
// so the admin panel is fully functional without Cloud Functions.
import {
  collection, query, where, orderBy, getDocs, limit, doc, getDoc, setDoc,
  updateDoc, addDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

async function tryCloud(name, payload, local) {
  try {
    const fn = httpsCallable(functions, name);
    return (await fn(payload)).data;
  } catch (e) {
    // Functions unavailable or errored, do it client-side (admin-gated).
    return local();
  }
}

export async function getAllUsers(filters = {}) {
  const snap = await getDocs(query(collection(db, 'users'),
    orderBy('createdAt', 'desc')));
  let list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  if (filters.role) list = list.filter((u) => u.role === filters.role);
  if (filters.status) list = list.filter((u) => u.status === filters.status);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    list = list.filter((u) =>
      (u.name || '').toLowerCase().includes(s) ||
      (u.email || '').toLowerCase().includes(s) ||
      String(u.userCode || '').includes(s));
  }
  return list;
}

export async function getAllTransactions(filters = {}) {
  const snap = await getDocs(query(collection(db, 'transactions'),
    orderBy('createdAt', 'desc'), limit(500)));
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (filters.type) list = list.filter((t) => t.type === filters.type);
  if (filters.reason) list = list.filter((t) => t.reason === filters.reason);
  return list;
}

export function blockUser(uid, blocked = true) {
  return tryCloud('adminBlockUser', { uid, blocked }, async () => {
    await updateDoc(doc(db, 'users', uid), {
      isBlocked: !!blocked, status: blocked ? 'suspended' : 'active' });
    return { success: true };
  });
}

export function approveAstrologer(astroId, approved = true) {
  return tryCloud('adminApproveAstrologer', { astroId, approved }, async () => {
    await updateDoc(doc(db, 'astrologers', astroId), { approved: !!approved });
    return { success: true };
  });
}

export function adjustWallet(uid, amount, reason) {
  const amt = Number(amount);
  return tryCloud('adminAdjustWallet', { uid, amount: amt, reason },
    async () => {
      await runTransaction(db, async (t) => {
        const ref = doc(db, 'users', uid);
        const s = await t.get(ref);
        const w = Number((s.data() || {}).wallet || 0) + amt;
        t.update(ref, { wallet: w < 0 ? 0 : w });
        t.set(doc(collection(db, 'transactions')), {
          userId: uid, amount: amt, type: amt >= 0 ? 'credit' : 'debit',
          reason: reason || 'admin_adjust', referenceId: 'admin_adjust',
          createdAt: serverTimestamp() });
      });
      return { success: true };
    });
}

export function forceEndSession(sessionId) {
  return tryCloud('adminForceEndSession', { sessionId }, async () => {
    await updateDoc(doc(db, 'sessions', sessionId),
      { status: 'ended', endTime: new Date(), endedBy: 'admin' });
    return { success: true };
  });
}

export function updateSettings(docName, values) {
  return tryCloud('adminUpdateSettings', { docName, values }, async () => {
    await setDoc(doc(db, 'settings', docName), values || {}, { merge: true });
    return { success: true };
  });
}

export function sendNotification(payload) {
  return tryCloud('sendNotification', payload, async () => {
    await addDoc(collection(db, 'notifications'), {
      userId: payload.target === 'user' ? payload.userId : 'all',
      title: payload.title, message: payload.message,
      type: 'offer', read: false, createdAt: serverTimestamp() });
    // Also fire a real lock-screen push. The relay fans out by target
    // (all / clients / astrologers / a specific user) server-side.
    await sendPushToUser({
      target: payload.target,
      userId: payload.userId || null,
      title: payload.title,
      body: payload.message,
      data: { type: 'offer', route: '/notifications' },
    });
    return { sent: 1, local: true };
  });
}

export function processPayout(payoutId, approve, note) {
  return tryCloud('adminProcessPayout', { payoutId, approve, note },
    async () => {
      await updateDoc(doc(db, 'payouts', payoutId), {
        status: approve ? 'approved' : 'rejected',
        adminNote: note || '', processedAt: serverTimestamp() });
      return { success: true };
    });
}

export function resolveDispute(disputeId, resolution, refundAmount) {
  return tryCloud('adminResolveDispute',
    { disputeId, resolution, refundAmount }, async () => {
      const dRef = doc(db, 'disputes', disputeId);
      const dSnap = await getDoc(dRef);
      const d = dSnap.data() || {};
      await updateDoc(dRef, {
        status: 'resolved', resolution: resolution || '',
        refundAmount: Number(refundAmount || 0) });
      if (Number(refundAmount) > 0 && d.userId) {
        await runTransaction(db, async (t) => {
          const uRef = doc(db, 'users', d.userId);
          const s = await t.get(uRef);
          const w = Number((s.data() || {}).wallet || 0)
            + Number(refundAmount);
          t.update(uRef, { wallet: w });
          t.set(doc(collection(db, 'transactions')), {
            userId: d.userId, amount: Number(refundAmount), type: 'credit',
            reason: 'refund', referenceId: disputeId,
            createdAt: serverTimestamp() });
        });
      }
      return { success: true };
    });
}

export function saveCoupon(id, coupon) {
  return tryCloud('adminSaveCoupon', { id, coupon }, async () => {
    const ref = id ? doc(db, 'coupons', id)
      : doc(collection(db, 'coupons'));
    await setDoc(ref, { ...coupon, createdAt: serverTimestamp() },
      { merge: true });
    return { success: true };
  });
}

async function listAll(name, order = 'createdAt') {
  try {
    const snap = await getDocs(query(collection(db, name),
      orderBy(order, 'desc'), limit(500)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(collection(db, name), limit(500)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export function savePage(payload) {
  return tryCloud('adminSavePage', payload, async () => {
    const id = payload.id || payload.slug;
    await setDoc(doc(db, 'pages', id), {
      name: payload.name || payload.slug, slug: payload.slug,
      draftVersion: payload.draft || [], updatedAt: serverTimestamp(),
    }, { merge: true });
    return { success: true, id };
  });
}
export function publishPage(id) {
  return tryCloud('adminPublishPage', { id }, async () => {
    const ref = doc(db, 'pages', id);
    const s = await getDoc(ref);
    const p = s.data() || {};
    const history = Array.isArray(p.history) ? p.history : [];
    if (p.publishedVersion) {
      history.unshift({ components: p.publishedVersion });
    }
    await updateDoc(ref, {
      publishedVersion: p.draftVersion || [],
      history: history.slice(0, 10),
      lastPublishedAt: serverTimestamp() });
    return { success: true };
  });
}
export function rollbackPage(id, index) {
  return tryCloud('adminRollbackPage', { id, index }, async () => {
    const ref = doc(db, 'pages', id);
    const s = await getDoc(ref);
    const h = (s.data().history || [])[index];
    if (h) {
      await updateDoc(ref, {
        publishedVersion: h.components, draftVersion: h.components,
        lastPublishedAt: serverTimestamp() });
    }
    return { success: true };
  });
}

// Create a loginable astrologer from the admin panel. Uses a SECONDARY
// Firebase app so the admin's own session is not replaced. If the email
// already exists (e.g. it is a client), the SAME account is extended to
// also be an astrologer (one login works for both portals).
export async function createAstrologer(data) {
  const primary = getApps()[0];
  const secondary = getApps().find((a) => a.name === 'admin-secondary')
    || initializeApp(primary.options, 'admin-secondary');
  const secAuth = getAuth(secondary);
  const email = data.email.trim();
  let uid;
  let attached = false;
  try {
    const cred = await createUserWithEmailAndPassword(
      secAuth, email, data.password || 'admin123');
    uid = cred.user.uid;
    await setDoc(doc(db, 'users', uid), {
      name: data.name, email, phone: data.phone || '', role: 'astrologer',
      isAstrologer: true,
      userCode: String(Math.floor(1e8 + Math.random() * 9e8)),
      wallet: 0, isOnline: false, isOnCall: false, isBlocked: false,
      hasSeenTour: true, status: 'active', createdAt: serverTimestamp(),
    });
  } catch (err) {
    if (err.code !== 'auth/email-already-in-use') throw err;
    // Existing account (likely a client). Find its uid by email and
    // extend it: same login now also works in the astrologer portal.
    const us = await getDocs(query(collection(db, 'users'),
      where('email', '==', email), limit(1)));
    if (us.empty) {
      const e = new Error(
        'That email already has a login but no user record was found. '
        + 'Have them sign in once on the client app, then retry.');
      e.code = 'no-user-doc';
      throw e;
    }
    uid = us.docs[0].id;
    attached = true;
    await updateDoc(doc(db, 'users', uid), { isAstrologer: true });
  }

  await setDoc(doc(db, 'astrologers', uid), {
    name: data.name, userId: uid, bio: data.bio || '',
    skills: data.skills || [], languages: data.languages || [],
    experience: Number(data.experience || 0),
    priceChat: Number(data.priceChat || 20),
    priceCall: Number(data.priceCall || 30),
    priceVideo: Number(data.priceVideo || 40),
    discountPercent: Number(data.discountPercent || 0),
    rating: 0, reviewsCount: 0, totalSessions: 0, responseRate: 100,
    approved: true, status: 'offline',
    chat_enabled: false, call_enabled: false, video_enabled: false,
    earnings: 0,
    profileImage: 'https://api.dicebear.com/7.x/notionists/svg?seed='
      + encodeURIComponent(data.name) + '&backgroundColor=ede9fe',
    createdAt: serverTimestamp(),
  });
  await signOut(secAuth).catch(() => {});
  return { uid, email, attached };
}

// Admin edits to any user or astrologer profile (client-side; allowed by
// the isAdmin() Firestore rules).
export function updateUserProfile(uid, data) {
  return tryCloud('adminUpdateUser', { uid, data }, async () => {
    await updateDoc(doc(db, 'users', uid), data || {});
    return { success: true };
  });
}
export function updateAstrologerProfile(id, data) {
  return tryCloud('adminUpdateAstrologer', { id, data }, async () => {
    await setDoc(doc(db, 'astrologers', id), data || {}, { merge: true });
    return { success: true };
  });
}

export const getAllPayouts = () => listAll('payouts');
export const getAllDisputes = () => listAll('disputes');
export const getAllCoupons = () => listAll('coupons', 'code');
export const getAuditLogs = () => listAll('logs', 'timestamp');

export async function globalSearch(queryStr) {
  const term = String(queryStr || '').trim();
  if (!term) return { users: [], astrologers: [], sessions: [] };
  const [users, astro] = await Promise.all([
    getDocs(query(collection(db, 'users'), limit(200))),
    getDocs(query(collection(db, 'astrologers'), limit(200))),
  ]);
  const t = term.toLowerCase();
  return {
    users: users.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => (u.name || '').toLowerCase().includes(t) ||
        (u.email || '').toLowerCase().includes(t) ||
        String(u.userCode || '').includes(t)).slice(0, 10),
    astrologers: astro.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => (a.name || '').toLowerCase().includes(t) ||
        (a.skills || []).join(' ').toLowerCase().includes(t)).slice(0, 10),
    sessions: [],
  };
}
