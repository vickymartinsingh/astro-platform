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
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp,
  increment, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { notifyFollowers, pushFollowers } from './followService.js';

// ---- Live engagement (admin-configurable, settings/features) ----
// live_views_per_min : simulated viewers added per minute (0 = off)
// live_fake_enabled  : show filler comments when real ones are sparse
// live_fake_every_sec: seconds between filler comments (default 12)
// live_fake_comments : newline list (admin-editable) of filler texts
const FILLER_NAMES = ['Priya', 'Rahul', 'Anjali', 'Vikram', 'Sneha',
  'Amit', 'Pooja', 'Ravi', 'Neha', 'Karan', 'Divya', 'Arjun', 'Meera',
  'Sahil', 'Kavya', 'Rohit', 'Isha', 'Manish', 'Tara', 'Dev'];
export const DEFAULT_FILLER_COMMENTS = [
  'Pranam guruji', 'How is my career going?', 'Please guide me',
  'When will I get married?', 'Thank you so much', 'Jai Mata Di',
  'Very accurate reading', 'Please see my kundli', 'Om Namah Shivaya',
  'What about my love life?', 'When will my problems end?',
  'You are amazing guruji', 'Please reply to me', 'Health concerns',
  'Money problems guruji', 'Blessed to be here', 'Namaste',
  'My job situation?', 'Family issues please', 'Truly grateful'];

export function liveFillerPool(feat) {
  const raw = feat && feat.live_fake_comments;
  let arr = [];
  if (Array.isArray(raw)) arr = raw.filter(Boolean);
  else if (typeof raw === 'string') {
    arr = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return arr.length ? arr : DEFAULT_FILLER_COMMENTS;
}

let _fillerSeq = 0;
// Next synthetic comment - sequence + occasional random so it looks
// like fresh, varied chatter. Pure display only (never written to DB).
export function nextFillerComment(feat) {
  const pool = liveFillerPool(feat);
  const i = _fillerSeq;
  _fillerSeq += 1;
  const text = Math.random() < 0.5
    ? pool[i % pool.length]
    : pool[Math.floor(Math.random() * pool.length)];
  const name = FILLER_NAMES[Math.floor(Math.random() * FILLER_NAMES.length)];
  return {
    id: `f_${Date.now()}_${i}`, type: 'comment', name, text,
    _fake: true, _ts: Date.now(),
  };
}

// Displayed viewer count = real + admin-rate * minutes-since-start.
// Deterministic from startedAt so every client shows ~the same number
// and there are NO extra DB writes.
export function liveSimViewers(info, feat) {
  const real = Math.max(0, Number(info && info.viewers) || 0);
  const perMin = Number(feat && feat.live_views_per_min) || 0;
  const startMs = info && info.startedAt && info.startedAt.toMillis
    ? info.startedAt.toMillis() : 0;
  if (perMin <= 0 || !startMs) return real;
  const mins = Math.max(0, (Date.now() - startMs) / 60000);
  return real + Math.floor(mins * perMin);
}

export function liveChannel(astroUid) { return `live_${astroUid}`; }
function liveDoc(astroUid) { return doc(db, 'chats', `live_${astroUid}`); }
function schedDoc(astroUid) {
  return doc(db, 'chats', `livesched_${astroUid}`);
}
function liveMsgs(astroUid) {
  return collection(db, 'chats', `live_${astroUid}`, 'messages');
}

// Wipe the previous session's comments/joins so a NEW live starts
// with a fresh, empty feed (the broadcaster is signed in -> allowed).
export async function clearLiveMessages(astroUid) {
  try {
    const snap = await getDocs(liveMsgs(astroUid));
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }
  } catch (_) { /* best effort */ }
}

export async function goLive(astroUid, info = {}) {
  await clearLiveMessages(astroUid);
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

// Compliance Team display picture (settings/config.compliance_dp).
export function watchComplianceDp(callback) {
  try {
    return onSnapshot(doc(db, 'settings', 'config'), (s) =>
      callback((s.exists() && s.data().compliance_dp) || ''));
  } catch (_) { if (callback) callback(''); return () => {}; }
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
      name: user.team ? 'Compliance Team' : (user.name || 'Guest'),
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
      name: user?.team ? 'Compliance Team' : (user?.name || 'Guest'),
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
