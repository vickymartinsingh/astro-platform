// adminService, blueprint 8.2 & Section 6.
// Privileged mutations (block/approve/wallet-adjust) are performed by
// Cloud Functions with the Admin SDK; the panel triggers callables.
import {
  collection, query, where, orderBy, getDocs, limit,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';

export async function getAllUsers(filters = {}) {
  let q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
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
  const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'),
    limit(500));
  const snap = await getDocs(q);
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (filters.type) list = list.filter((t) => t.type === filters.type);
  if (filters.reason) list = list.filter((t) => t.reason === filters.reason);
  return list;
}

export async function blockUser(uid, blocked = true) {
  const fn = httpsCallable(functions, 'adminBlockUser');
  return (await fn({ uid, blocked })).data;
}

export async function approveAstrologer(astroId, approved = true) {
  const fn = httpsCallable(functions, 'adminApproveAstrologer');
  return (await fn({ astroId, approved })).data;
}

export async function adjustWallet(uid, amount, reason) {
  const fn = httpsCallable(functions, 'adminAdjustWallet');
  return (await fn({ uid, amount, reason })).data;
}

export async function forceEndSession(sessionId) {
  const fn = httpsCallable(functions, 'adminForceEndSession');
  return (await fn({ sessionId })).data;
}

export async function updateSettings(docName, values) {
  const fn = httpsCallable(functions, 'adminUpdateSettings');
  return (await fn({ docName, values })).data;
}

export async function sendNotification(payload) {
  const fn = httpsCallable(functions, 'sendNotification');
  return (await fn(payload)).data;
}

export async function processPayout(payoutId, approve, note) {
  const fn = httpsCallable(functions, 'adminProcessPayout');
  return (await fn({ payoutId, approve, note })).data;
}

export async function resolveDispute(disputeId, resolution, refundAmount) {
  const fn = httpsCallable(functions, 'adminResolveDispute');
  return (await fn({ disputeId, resolution, refundAmount })).data;
}

export async function saveCoupon(id, coupon) {
  const fn = httpsCallable(functions, 'adminSaveCoupon');
  return (await fn({ id, coupon })).data;
}

async function listAll(name, order = 'createdAt') {
  const snap = await getDocs(query(collection(db, name),
    orderBy(order, 'desc'), limit(500)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function savePage(payload) {
  const fn = httpsCallable(functions, 'adminSavePage');
  return (await fn(payload)).data;
}
export async function publishPage(id) {
  const fn = httpsCallable(functions, 'adminPublishPage');
  return (await fn({ id })).data;
}
export async function rollbackPage(id, index) {
  const fn = httpsCallable(functions, 'adminRollbackPage');
  return (await fn({ id, index })).data;
}

export const getAllPayouts = () => listAll('payouts');
export const getAllDisputes = () => listAll('disputes');
export const getAllCoupons = () => listAll('coupons', 'code');
export const getAuditLogs = () => listAll('logs', 'timestamp');

// Multi-collection search (blueprint 6.3). Indexed prefix queries.
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
