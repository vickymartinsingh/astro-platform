// notificationService, blueprint 8.2
import {
  doc, updateDoc, setDoc, collection, query, where, onSnapshot,
  getDocs, arrayUnion, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { updateUser } from './userService.js';

// Store the latest token AND keep a de-duplicated array of every device
// the user has signed in on, so the relay can push to all of them.
export async function saveFCMToken(uid, token) {
  if (!uid || !token) return;
  await updateUser(uid, {
    fcmToken: token,
    fcmTokens: arrayUnion(token),
  });
}

// Register the raw device token even when NOBODY is signed in, so the
// relay can still deliver broadcast / announcement pushes to every
// device that has opened the app at least once. Keyed by the token so
// it is naturally de-duplicated.
export async function saveDeviceToken(token, uid) {
  if (!token) return;
  try {
    await setDoc(doc(db, 'deviceTokens', token), {
      token,
      uid: uid || null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (_) { /* best effort, never block the app */ }
}

const byCreatedDesc = (a, b) =>
  (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

// Dedupe broadcast notifications.
//
// The admin "Send broadcast" button on /admin-notifications has no
// rate-limit, so an accidental double-click (or 48 of them) used to
// produce 48 identical "Welcome" notifications in every customer's
// inbox. Until that page gets a server-side dedupe, collapse
// duplicates here: for each broadcast (userId === 'all') we keep only
// the NEWEST entry for any given (type, title, message) tuple.
// Per-user notifications (incoming call, low balance, etc.) are kept
// as-is - those are not user-clickable spam.
function dedupeBroadcasts(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {                       // rows are already newest-first
    if (r.userId === 'all') {
      const key = `${r.type || ''}|${(r.title || '').trim()}|`
        + `${(r.message || '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

// Single `in` filter (auto-indexed); ordered client-side so no composite
// index is required.
export async function getNotifications(uid) {
  const q = query(
    collection(db, 'notifications'),
    where('userId', 'in', [uid, 'all']),
  );
  const snap = await getDocs(q);
  return dedupeBroadcasts(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byCreatedDesc));
}

export function listenNotifications(uid, callback) {
  const q = query(
    collection(db, 'notifications'),
    where('userId', 'in', [uid, 'all']),
  );
  return onSnapshot(q, (snap) =>
    callback(dedupeBroadcasts(snap.docs.map(
      (d) => ({ id: d.id, ...d.data() })).sort(byCreatedDesc))));
}

export async function markNotificationRead(id) {
  await updateDoc(doc(db, 'notifications', id), { read: true });
}
