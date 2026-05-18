// Live streaming. An astrologer "goes live"; clients watch the Agora
// broadcast (channel = live_<uid>) and comment / like / join in real
// time.
//
// IMPORTANT: live state is stored under chats/live_<uid> (+ its
// messages subcollection) because the Firestore rules already allow any
// signed-in user to read/write chats. A dedicated `lives` collection
// has no rule and is denied by default - which is why joins/comments
// were not appearing. No rules redeploy is needed this way.
import {
  doc, setDoc, updateDoc, deleteDoc, collection, addDoc, query,
  where, orderBy, limit, onSnapshot, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { notifyFollowers } from './followService.js';

export function liveChannel(astroUid) { return `live_${astroUid}`; }
function liveDoc(astroUid) { return doc(db, 'chats', `live_${astroUid}`); }
function liveMsgs(astroUid) {
  return collection(db, 'chats', `live_${astroUid}`, 'messages');
}

export async function goLive(astroUid, info = {}) {
  await setDoc(liveDoc(astroUid), {
    isLiveDoc: true,
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
  notifyFollowers(astroUid, 'Live', `/live-view/${astroUid}`);
}

export async function endLive(astroUid) {
  try {
    await updateDoc(liveDoc(astroUid),
      { live: false, endedAt: serverTimestamp() });
  } catch (_) {}
  try {
    await updateDoc(doc(db, 'astrologers', astroUid), { isLive: false });
  } catch (_) {}
  try { await deleteDoc(liveDoc(astroUid)); } catch (_) {}
}

// All currently-live astrologers.
export function listenLiveAstrologers(callback) {
  return onSnapshot(
    query(collection(db, 'chats'), where('live', '==', true)),
    (snap) => callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.isLiveDoc && x.astroUid)));
}

export function listenLive(astroUid, callback) {
  return onSnapshot(liveDoc(astroUid), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

export async function likeLive(astroUid) {
  try {
    await updateDoc(liveDoc(astroUid), { likes: increment(1) });
  } catch (_) {}
}

export async function setViewers(astroUid, n) {
  try {
    await updateDoc(liveDoc(astroUid), { viewers: Math.max(0, n) });
  } catch (_) {}
}

export async function bumpViewers(astroUid, delta) {
  try {
    await updateDoc(liveDoc(astroUid), { viewers: increment(delta) });
  } catch (_) {}
}

// "<name> joined" event in the live feed (shown to everyone).
export async function announceJoin(astroUid, user) {
  if (!astroUid || !user) return;
  try {
    await addDoc(liveMsgs(astroUid), {
      type: 'join',
      name: user.team ? 'Complace Team' : (user.name || 'Guest'),
      uid: user.uid || null,
      code: user.code || null,
      team: !!user.team,
      text: '',
      createdAt: serverTimestamp(),
    });
  } catch (_) {}
}

// "<name> started following you" event in the live feed.
export async function announceFollow(astroUid, user) {
  if (!astroUid || !user) return;
  try {
    await addDoc(liveMsgs(astroUid), {
      type: 'follow',
      name: user.name || 'Someone',
      uid: user.uid || null,
      code: user.code || null,
      text: '',
      createdAt: serverTimestamp(),
    });
  } catch (_) {}
}

export async function addLiveComment(astroUid, user, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  try {
    await addDoc(liveMsgs(astroUid), {
      type: 'comment',
      name: user?.team ? 'Complace Team' : (user?.name || 'Guest'),
      uid: user?.uid || null,
      code: user?.code || null,
      team: !!user?.team,
      text: clean.slice(0, 240),
      createdAt: serverTimestamp(),
    });
  } catch (_) {}
}

export function listenLiveComments(astroUid, callback) {
  return onSnapshot(
    query(liveMsgs(astroUid),
      orderBy('createdAt', 'desc'), limit(80)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .reverse()));
}
