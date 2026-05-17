// Help & Support chat. One thread per user, stored under the chats
// collection (chats/support_<uid> + messages) so it works with the
// existing Firestore rules (signed-in read/write; admin reads all).
// Client + astrologer raise tickets; the admin replies as "support".
import {
  doc, setDoc, updateDoc, collection, addDoc, query, where,
  orderBy, limit, onSnapshot, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

function tid(uid) { return `support_${uid}`; }

export async function ensureTicket(uid, info = {}) {
  if (!uid) return;
  await setDoc(doc(db, 'chats', tid(uid)), {
    isSupport: true,
    userId: uid,
    name: info.name || 'User',
    role: info.role || 'client',
    status: 'open',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function sendSupport(uid, senderId, text, info = {}) {
  const clean = String(text || '').trim();
  if (!uid || !clean) return;
  await ensureTicket(uid, info);
  await addDoc(collection(db, 'chats', tid(uid), 'messages'), {
    senderId, text: clean.slice(0, 1000),
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'chats', tid(uid)), {
    lastMessage: clean.slice(0, 120),
    status: senderId === 'support' ? 'answered' : 'open',
    updatedAt: serverTimestamp(),
  });
  // Notify the other side.
  if (senderId === 'support') {
    sendPushToUser({ toUid: uid, title: 'Support replied',
      body: clean.slice(0, 120),
      data: { type: 'support', route: '/support' } });
  }
}

export function listenSupport(uid, cb) {
  return onSnapshot(
    query(collection(db, 'chats', tid(uid), 'messages'),
      orderBy('createdAt', 'asc'), limit(200)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Admin: every support ticket.
export function listenAllTickets(cb) {
  return onSnapshot(
    query(collection(db, 'chats'), where('isSupport', '==', true)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0)
        - (a.updatedAt?.toMillis?.() || 0))));
}

export async function getAllTicketsOnce() {
  const s = await getDocs(
    query(collection(db, 'chats'), where('isSupport', '==', true)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
