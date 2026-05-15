// notificationService, blueprint 8.2
import {
  doc, updateDoc, collection, query, where, onSnapshot, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { updateUser } from './userService.js';

export async function saveFCMToken(uid, token) {
  if (!uid || !token) return;
  await updateUser(uid, { fcmToken: token });
}

const byCreatedDesc = (a, b) =>
  (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

// Single `in` filter (auto-indexed); ordered client-side so no composite
// index is required.
export async function getNotifications(uid) {
  const q = query(
    collection(db, 'notifications'),
    where('userId', 'in', [uid, 'all']),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byCreatedDesc);
}

export function listenNotifications(uid, callback) {
  const q = query(
    collection(db, 'notifications'),
    where('userId', 'in', [uid, 'all']),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort(byCreatedDesc)));
}

export async function markNotificationRead(id) {
  await updateDoc(doc(db, 'notifications', id), { read: true });
}
