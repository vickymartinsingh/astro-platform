// Per-service online / offline hour tracking for astrologers.
//
// Every availability change (Chat / Call / Video toggled on or off) is
// appended as a timestamped point under chats/avail_<uid>/messages, so
// the existing permissive chats rules apply (no rules redeploy). From
// the ordered points we can reconstruct, for any date range, how long
// each service was Online and Offline.
import {
  doc, setDoc, collection, addDoc, query, orderBy, getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

function availDoc(uid) { return doc(db, 'chats', `avail_${uid}`); }
function availMsgs(uid) {
  return collection(db, 'chats', `avail_${uid}`, 'messages');
}

// Record the NEW per-service state at this moment.
export async function logAvailability(uid, state) {
  if (!uid || !state) return;
  try {
    await setDoc(availDoc(uid), {
      isAvailLog: true, astroUid: uid, updatedAt: serverTimestamp(),
    }, { merge: true });
    await addDoc(availMsgs(uid), {
      chat: !!state.chat, call: !!state.call, video: !!state.video,
      at: serverTimestamp(), ts: Date.now(),
    });
  } catch (_) { /* best effort */ }
}

export async function getAvailLogs(uid) {
  if (!uid) return [];
  try {
    const s = await getDocs(query(availMsgs(uid), orderBy('ts', 'asc')));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) { return []; }
}

// Online milliseconds per service within [from, to]. Each point holds
// the state that was in effect from that point until the next one.
// Offline = window length minus Online (clamped at 0).
export function computeHours(logs, from, to) {
  const svcs = ['chat', 'call', 'video'];
  const res = { chat: 0, call: 0, video: 0 };
  const pts = (logs || [])
    .filter((l) => typeof l.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < pts.length; i += 1) {
    const cur = pts[i];
    const nextTs = i + 1 < pts.length ? pts[i + 1].ts : to;
    const segStart = Math.max(cur.ts, from);
    const segEnd = Math.min(nextTs, to);
    if (segEnd <= segStart) continue;
    svcs.forEach((s) => { if (cur[s]) res[s] += segEnd - segStart; });
  }
  const win = Math.max(0, to - from);
  return {
    onlineMs: res,
    offlineMs: {
      chat: Math.max(0, win - res.chat),
      call: Math.max(0, win - res.call),
      video: Math.max(0, win - res.video),
    },
    windowMs: win,
  };
}

// Live online milliseconds from live-history records in [from, to].
// Only completed ('ended') lives have a duration; cancelled = 0.
export function liveMs(history, from, to) {
  return (history || []).reduce((a, h) => {
    const t = h.ts || h.endedAtMs || 0;
    if (h.status === 'cancelled') return a;
    if (t < from || t > to) return a;
    return a + (Number(h.durationSec) || 0) * 1000;
  }, 0);
}

// Start/end ms for a named range. kind = 'day' | 'week' | 'month'.
export function rangeBounds(kind, now = Date.now()) {
  const d = new Date(now);
  if (kind === 'week') {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6);
  } else if (kind === 'month') {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 29);
  } else {
    d.setHours(0, 0, 0, 0); // day (today)
  }
  return { from: d.getTime(), to: now };
}

export function fmtHrs(ms) {
  const totalMin = Math.round((ms || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
