// Live streaming. An astrologer "goes live": we flag astrologers/{uid}
// (isLive) and create a lives/{uid} doc. Clients see only astrologers
// who are live, watch the Agora broadcast (channel = live_<uid>), and
// can comment / like in real time.
import {
  doc, setDoc, updateDoc, deleteDoc, collection, addDoc, query,
  where, orderBy, limit, onSnapshot, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export function liveChannel(astroUid) { return `live_${astroUid}`; }

export async function goLive(astroUid, info = {}) {
  await setDoc(doc(db, 'lives', astroUid), {
    astroUid,
    name: info.name || 'Astrologer',
    photo: info.photo || '',
    title: info.title || 'Live consultation',
    live: true,
    viewers: 0,
    likes: 0,
    startedAt: serverTimestamp(),
  }, { merge: true });
  try {
    await updateDoc(doc(db, 'astrologers', astroUid), { isLive: true });
  } catch (_) {}
}

export async function endLive(astroUid) {
  try {
    await updateDoc(doc(db, 'lives', astroUid),
      { live: false, endedAt: serverTimestamp() });
  } catch (_) {}
  try {
    await updateDoc(doc(db, 'astrologers', astroUid), { isLive: false });
  } catch (_) {}
  try { await deleteDoc(doc(db, 'lives', astroUid)); } catch (_) {}
}

// All currently-live astrologers (no composite index: filter live only).
export function listenLiveAstrologers(callback) {
  return onSnapshot(
    query(collection(db, 'lives'), where('live', '==', true)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function listenLive(astroUid, callback) {
  return onSnapshot(doc(db, 'lives', astroUid), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

export async function likeLive(astroUid) {
  try {
    await updateDoc(doc(db, 'lives', astroUid), { likes: increment(1) });
  } catch (_) {}
}

export async function setViewers(astroUid, n) {
  try {
    await updateDoc(doc(db, 'lives', astroUid),
      { viewers: Math.max(0, n) });
  } catch (_) {}
}

export async function addLiveComment(astroUid, user, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  await addDoc(collection(db, 'lives', astroUid, 'comments'), {
    name: user?.team ? 'Complace Team' : (user?.name || 'Guest'),
    uid: user?.uid || null,
    team: !!user?.team,        // shown with a verified badge
    text: clean.slice(0, 240),
    createdAt: serverTimestamp(),
  });
}

export function listenLiveComments(astroUid, callback) {
  return onSnapshot(
    query(collection(db, 'lives', astroUid, 'comments'),
      orderBy('createdAt', 'desc'), limit(60)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .reverse()));
}
