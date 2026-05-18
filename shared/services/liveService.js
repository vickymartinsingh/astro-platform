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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query,
  where, orderBy, limit, onSnapshot, serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { notifyFollowers, pushFollowers } from './followService.js';

export function liveChannel(astroUid) { return `live_${astroUid}`; }
function liveDoc(astroUid) { return doc(db, 'chats', `live_${astroUid}`); }
function schedDoc(astroUid) {
  return doc(db, 'chats', `livesched_${astroUid}`);
}
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
  // Going live now clears any pending scheduled live.
  try { await deleteDoc(schedDoc(astroUid)); } catch (_) {}
  notifyFollowers(astroUid, 'Live', `/live-view/${astroUid}`);
}

export async function endLive(astroUid) {
  let started = 0;
  let info = {};
  try {
    const s = await getDoc(liveDoc(astroUid));
    if (s.exists()) {
      info = s.data();
      const st = info.startedAt;
      started = st && st.toMillis ? st.toMillis() : 0;
    }
  } catch (_) { /* ignore */ }
  try {
    await updateDoc(liveDoc(astroUid),
      { live: false, endedAt: serverTimestamp() });
  } catch (_) {}
  try {
    await updateDoc(doc(db, 'astrologers', astroUid), { isLive: false });
  } catch (_) {}
  // Append a live-history record (top-level chats doc so the astrologer
  // sees their own and admin sees everyone's, with no rules redeploy).
  try {
    const endedAt = Date.now();
    await addDoc(collection(db, 'chats'), {
      isLiveHistDoc: true,
      status: 'ended',
      astroUid,
      name: info.name || 'Astrologer',
      photo: info.photo || '',
      title: info.title || 'Live consultation',
      viewers: info.viewers || 0,
      likes: info.likes || 0,
      startedAtMs: started || endedAt,
      endedAtMs: endedAt,
      durationSec: started
        ? Math.max(0, Math.round((endedAt - started) / 1000)) : 0,
      ts: endedAt,
      createdAt: serverTimestamp(),
    });
  } catch (_) { /* ignore */ }
  try { await deleteDoc(liveDoc(astroUid)); } catch (_) {}
}

// ---- Scheduled lives ----
// One upcoming scheduled live per astrologer (chats/livesched_<uid>).
export async function scheduleLive(astroUid, info = {}) {
  const startAt = Number(info.startAt) || 0;
  await setDoc(schedDoc(astroUid), {
    scheduledLive: true,
    astroUid,
    name: info.name || 'Astrologer',
    photo: info.photo || '',
    title: info.title || 'Live consultation',
    startAt,
    createdAt: serverTimestamp(),
  }, { merge: true });
  const when = startAt
    ? new Date(startAt).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }) : 'soon';
  pushFollowers(
    astroUid,
    `${info.name || 'Your astrologer'} scheduled a Live`,
    `${info.title || 'Live consultation'} on ${when}. Tap for details.`,
    '/live');
}

export async function cancelScheduledLive(astroUid) {
  // Record the cancellation so it shows in the live activity history.
  try {
    const s = await getDoc(schedDoc(astroUid));
    if (s.exists()) {
      const d = s.data();
      const nowMs = Date.now();
      await addDoc(collection(db, 'chats'), {
        isLiveHistDoc: true,
        status: 'cancelled',
        astroUid,
        name: d.name || 'Astrologer',
        photo: d.photo || '',
        title: d.title || 'Live consultation',
        viewers: 0,
        likes: 0,
        startedAtMs: d.startAt || nowMs,
        endedAtMs: nowMs,
        durationSec: 0,
        ts: nowMs,
        createdAt: serverTimestamp(),
      });
    }
  } catch (_) { /* ignore */ }
  try { await deleteDoc(schedDoc(astroUid)); } catch (_) {}
}

export function listenScheduledLive(astroUid, callback) {
  return onSnapshot(schedDoc(astroUid), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

// All upcoming scheduled lives (for the client "Upcoming" rail).
export function listenScheduledLives(callback) {
  return onSnapshot(
    query(collection(db, 'chats'),
      where('scheduledLive', '==', true)),
    (snap) => callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.astroUid
        && (x.startAt || 0) > Date.now() - 60 * 60 * 1000)
      .sort((a, b) => (a.startAt || 0) - (b.startAt || 0))));
}

// Live history. Astrologer sees own; admin sees all (no limit).
export function listenLiveHistory(astroUid, callback) {
  return onSnapshot(
    query(collection(db, 'chats'),
      where('isLiveHistDoc', '==', true)),
    (snap) => callback(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => !astroUid || x.astroUid === astroUid)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))));
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
