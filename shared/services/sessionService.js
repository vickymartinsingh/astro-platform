// sessionService, blueprint 8.2 & Section 7 (session lifecycle).
// States: requesting -> accepted -> active -> ended | rejected | missed
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where,
  getDocs, serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';

// createSessionRequest: wallet sufficiency MUST be re-checked server-side
// before billing starts; this only creates the request record.
export async function createSessionRequest(data) {
  const ref = doc(collection(db, 'sessions'));
  const ratePerMin = Number(data.pricePerMinute || 0);
  await setDoc(ref, {
    userId: data.userId,
    astroId: data.astroId,
    type: data.type,                       // chat | call | video
    purpose: data.purpose || '',
    kundliId: data.kundliId || null,
    ratePerSecond: ratePerMin / 60,
    pricePerMinute: ratePerMin,
    status: 'requesting',
    duration: 0,
    cost: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSessionStatus(id, status, extra = {}) {
  await updateDoc(doc(db, 'sessions', id), { status, ...extra });
}

// Generic patch (e.g. mark introSent) without touching status.
export async function setSessionMeta(id, data) {
  await updateDoc(doc(db, 'sessions', id), data || {});
}

export async function getSession(id) {
  const snap = await getDoc(doc(db, 'sessions', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenSession(id, callback) {
  return onSnapshot(doc(db, 'sessions', id), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

// endSession: authoritative finaliser runs in the Cloud Function
// (computes duration, cost, commission, astrologer earnings, reverts
// astrologer status). The browser only requests the end.
export async function endSession(id) {
  const fn = httpsCallable(functions, 'endSession');
  const res = await fn({ sessionId: id });
  return res.data;
}

// An astrologer listens for incoming requests addressed to them.
// Single equality filter (auto-indexed); status filtered client-side so
// no composite index is needed.
export function listenIncomingRequests(astroId, callback) {
  const q = query(
    collection(db, 'sessions'),
    where('astroId', '==', astroId),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.status === 'requesting')));
}

const byCreatedDesc = (a, b) =>
  (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

export async function getUserSessions(userId, type) {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
  );
  const snap = await getDocs(q);
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort(byCreatedDesc);
  if (type) list = list.filter((s) => s.type === type);
  return list;
}

export async function getAstrologerSessions(astroId) {
  const q = query(
    collection(db, 'sessions'),
    where('astroId', '==', astroId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort(byCreatedDesc);
}
