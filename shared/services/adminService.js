// adminService, blueprint 8.2 & Section 6.
// Each privileged action TRIES the Cloud Function first; if Functions are
// not deployed (Spark / no Blaze) it falls back to a direct Firestore
// write. Firestore rules permit these writes for users whose role=admin,
// so the admin panel is fully functional without Cloud Functions.
import {
  collection, query, where, orderBy, getDocs, limit, doc, getDoc, setDoc,
  updateDoc, addDoc, runTransaction, serverTimestamp, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../firebase.js';
import { sendPushToUser } from './pushService.js';
import { notifyWallet } from './walletNotify.js';

// NOTE: Next.js only inlines the LITERAL `process.env.NEXT_PUBLIC_*`
// expression at build time. Reading it through an alias (const env =
// process.env; env.NEXT_PUBLIC_X) is NOT replaced and is undefined in
// the static/APK build. So we must reference it directly.
function pushEndpoint() {
  return (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
}

// Relay endpoint for admin Auth operations (derives from push endpoint).
function adminRelay() {
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_ADMIN_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = pushEndpoint();
  return push ? push.replace(/\/sendPush\/?$/, '/adminUser') : '';
}

// Change a user's LOGIN email / password (Firebase Auth) via the relay,
// authenticated with the current admin's Firebase ID token.
export async function adminUpdateAuthUser(uid, { email, password } = {}) {
  const url = adminRelay();
  if (!url) {
    throw new Error('Email-change service not configured. Set '
      + 'NEXT_PUBLIC_PUSH_ENDPOINT and deploy the relay.');
  }
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Not signed in.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid, email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Update failed');
  return j;
}

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

// Permanently delete a user (and their astrologer profile if any).
export function deleteUser(uid) {
  return tryCloud('adminDeleteUser', { uid }, async () => {
    await deleteDoc(doc(db, 'users', uid));
    try { await deleteDoc(doc(db, 'astrologers', uid)); } catch (_) {}
    return { success: true };
  });
}

// ---------------------------------------------------------------------
// ACCOUNT RESET (admin). Selectively wipe a user's / astrologer's data,
// or "reset as default" (everything + profile). Each part maps to the
// collections it owns. Direct, admin-gated Firestore writes (no Cloud
// Function needed). Returns a per-part count of deleted/updated docs.
// ---------------------------------------------------------------------
// The selectable categories shown in the admin UI.
export const RESET_PARTS = [
  ['chats', 'Chats & messages'],
  ['calls', 'Calls & video logs'],
  ['history', 'Consultation history (all sessions)'],
  ['kundli', 'Kundli profiles'],
  ['remedy', 'Remedies (astrologer)'],
  ['reviews', 'Reviews & ratings'],
  ['complaint', 'Complaints / disputes'],
  ['notification', 'Notifications'],
  ['transaction', 'All transactions'],
  ['recharge', 'Recharges'],
  ['refund', 'Refunds'],
  ['wallet', 'Wallet balance'],
  ['profile', 'Profile (reset to default)'],
];

// Delete every doc returned by a query, in batches (Firestore limit 500).
async function deleteAllDocs(qy) {
  const snap = await getDocs(qy);
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => { batch.delete(d.ref); n += 1; });
    await batch.commit();
  }
  return n;
}

// Sessions involving this uid as the client (userId) OR the astrologer
// (astroId). Optionally filtered to certain session types.
async function deleteSessionsFor(uid, types) {
  let n = 0;
  for (const field of ['userId', 'astroId']) {
    const snap = await getDocs(query(
      collection(db, 'sessions'), where(field, '==', uid)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => {
        const t = (d.data() || {}).type;
        if (!types || types.includes(t)) { batch.delete(d.ref); n += 1; }
      });
      await batch.commit();
    }
  }
  return n;
}

// Chats where the uid is a participant + their messages subcollection.
async function deleteChatsFor(uid) {
  const snap = await getDocs(query(collection(db, 'chats'),
    where('participants', 'array-contains', uid)));
  let n = 0;
  for (const d of snap.docs) {
    try {
      const msgs = await getDocs(collection(db, 'chats', d.id, 'messages'));
      for (let i = 0; i < msgs.docs.length; i += 400) {
        const b = writeBatch(db);
        msgs.docs.slice(i, i + 400).forEach((m) => b.delete(m.ref));
        await b.commit();
      }
    } catch (_) { /* ignore message wipe errors, still drop the chat */ }
    try { await deleteDoc(d.ref); n += 1; } catch (_) { /* ignore */ }
  }
  return n;
}

async function deleteTxnsFor(uid, match) {
  const snap = await getDocs(query(collection(db, 'transactions'),
    where('userId', '==', uid)));
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => {
      if (!match || match(d.data() || {})) { batch.delete(d.ref); n += 1; }
    });
    await batch.commit();
  }
  return n;
}

// Reset one account. `parts` is an array of RESET_PARTS keys.
// `role` ('client' | 'astrologer') decides which profile doc to reset.
export async function resetAccountData(uid, { role = 'client',
  parts = [] } = {}) {
  if (!uid) throw new Error('uid required');
  const want = new Set(parts);
  const out = {};

  if (want.has('chats')) out.chats = await deleteChatsFor(uid);
  if (want.has('history')) out.history = await deleteSessionsFor(uid);
  else if (want.has('calls')) {
    out.calls = await deleteSessionsFor(uid, ['call', 'video']);
  }
  if (want.has('kundli')) {
    out.kundli = await deleteAllDocs(query(collection(db, 'kundliProfiles'),
      where('userId', '==', uid)));
  }
  if (want.has('notification')) {
    out.notification = await deleteAllDocs(query(
      collection(db, 'notifications'), where('userId', '==', uid)));
  }
  if (want.has('complaint')) {
    let n = 0;
    for (const field of ['userId', 'astroId']) {
      n += await deleteAllDocs(query(collection(db, 'disputes'),
        where(field, '==', uid)));
    }
    out.complaint = n;
  }
  if (want.has('reviews')) {
    let n = 0;
    for (const field of ['userId', 'astroId']) {
      try {
        n += await deleteAllDocs(query(collection(db, 'reviews'),
          where(field, '==', uid)));
      } catch (_) { /* field may not exist on every review */ }
    }
    out.reviews = n;
  }
  if (want.has('transaction')) out.transaction = await deleteTxnsFor(uid);
  else {
    if (want.has('recharge')) {
      out.recharge = await deleteTxnsFor(uid, (t) =>
        /recharge|topup|top-up|add/i.test(`${t.type} ${t.reason}`));
    }
    if (want.has('refund')) {
      out.refund = await deleteTxnsFor(uid, (t) =>
        /refund/i.test(`${t.type} ${t.reason}`));
    }
  }
  if (want.has('remedy') && role === 'astrologer') {
    try {
      await updateDoc(doc(db, 'astrologers', uid), { remedies: [] });
      out.remedy = 1;
    } catch (_) { out.remedy = 0; }
  }
  if (want.has('wallet')) {
    try {
      await updateDoc(doc(db, 'users', uid), { wallet: 0 });
      if (role === 'astrologer') {
        try {
          await updateDoc(doc(db, 'astrologers', uid),
            { wallet: 0, earnings: 0 });
        } catch (_) { /* astrologer doc may not track wallet */ }
      }
      out.wallet = 0;
    } catch (_) { /* ignore */ }
  }
  if (want.has('profile')) {
    // Reset to a clean default profile but KEEP the login identity
    // (uid, email, role, createdAt) so the person can still sign in.
    const reset = {
      name: '', gender: '', dob: '', tob: '', timeOfBirth: '',
      place: '', placeOfBirth: '', language: '', bio: '',
      profileImage: '', avatar: '', wallet: 0, status: 'active',
      isBlocked: false, updatedAt: serverTimestamp(),
    };
    try { await updateDoc(doc(db, 'users', uid), reset); } catch (_) {}
    if (role === 'astrologer') {
      try {
        await updateDoc(doc(db, 'astrologers', uid), {
          remedies: [], bio: '', updatedAt: serverTimestamp(),
        });
      } catch (_) {}
    }
    out.profile = 1;
  }
  return { success: true, uid, parts: [...want], counts: out };
}

// Reset MANY accounts at once (every client or every astrologer). Heavy
// and irreversible - the UI must require a typed confirmation.
export async function resetAllAccounts({ role = 'client', parts = [] } = {}) {
  const users = await getAllUsers(
    role === 'astrologer' ? { role: 'astrologer' } : {});
  const targets = role === 'astrologer'
    ? users
    : users.filter((u) => (u.role || 'client') === 'client');
  let done = 0;
  for (const u of targets) {
    try { await resetAccountData(u.uid, { role, parts }); done += 1; }
    catch (_) { /* continue with the rest */ }
  }
  return { success: true, total: targets.length, done };
}

export function approveAstrologer(astroId, approved = true) {
  return tryCloud('adminApproveAstrologer', { astroId, approved }, async () => {
    await updateDoc(doc(db, 'astrologers', astroId), { approved: !!approved });
    return { success: true };
  });
}

// Permanently remove an astrologer: their public profile + their user
// record (so duplicates / unwanted accounts can be cleaned from admin).
export function deleteAstrologer(astroId) {
  return tryCloud('adminDeleteAstrologer', { astroId }, async () => {
    await deleteDoc(doc(db, 'astrologers', astroId));
    try { await deleteDoc(doc(db, 'users', astroId)); } catch (_) {}
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
      await notifyWallet(uid, amt, reason || 'admin adjustment');
      return { success: true };
    });
}

// Gift cards run through the relay (server-side admin SDK) so the
// wallet credit on redeem is atomic and abuse-safe.
function giftRelay() {
  const push = pushEndpoint();
  return push ? push.replace(/\/sendPush\/?$/, '/giftCard') : '';
}
async function giftCall(payload) {
  const url = giftRelay();
  if (!url) {
    throw new Error('Gift card service not configured. Set '
      + 'NEXT_PUBLIC_PUSH_ENDPOINT and deploy the relay.');
  }
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Not signed in.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Request failed');
  return j;
}

// Admin: generate a shareable gift card (8 uppercase alphanumeric).
export function createGiftCard(amount) {
  return giftCall({ action: 'create', amount: Math.round(Number(amount)) });
}
export async function listGiftCards() {
  const j = await giftCall({ action: 'list' });
  return j.cards || [];
}

// Assign one or more roles to a user. Primary `role` stays a single
// value (used by gating) = admin > astrologer > support > client; the
// full set is stored in `roles` (checked by hasRole / isAdminUser).
export function setUserRoles(uid, roles) {
  const list = Array.from(new Set((roles || []).filter(Boolean)));
  const primary = list.includes('admin') ? 'admin'
    : list.includes('astrologer') ? 'astrologer'
    : list.includes('support') ? 'support'
    : 'client';
  return tryCloud('adminSetUserRoles', { uid, roles: list }, async () => {
    await updateDoc(doc(db, 'users', uid), { role: primary, roles: list });
    if (list.includes('astrologer')) {
      await setDoc(doc(db, 'astrologers', uid),
        { approved: true }, { merge: true }).catch(() => {});
    }
    return { success: true, role: primary, roles: list };
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
      userCode: ((s) => {
        const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const b = String(s || '').toUpperCase()
          .replace(/[^A-Z0-9]/g, '').slice(0, 3);
        let r = b;
        while (r.length < 6) {
          r += C[Math.floor(Math.random() * C.length)];
        }
        return r.slice(0, 6);
      })(data.name || email),
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
