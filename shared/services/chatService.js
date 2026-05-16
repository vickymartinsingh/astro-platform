// chatService, blueprint 8.2 & 4.8
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, onSnapshot, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

// Deterministic conversation id prevents duplicate threads (blueprint 4.8):
// smaller_uid + '_' + larger_uid
export function conversationId(userId, astroId) {
  return [userId, astroId].sort().join('_');
}

export async function getOrCreateConversation(userId, astroId) {
  const chatId = conversationId(userId, astroId);
  const ref = doc(db, 'chats', chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      participants: [userId, astroId],
      lastMessage: '',
      updatedAt: serverTimestamp(),
    });
  }
  return chatId;
}

export async function sendMessage(chatId, senderId, text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    senderId,
    text: clean,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'chats', chatId), {
    lastMessage: clean.slice(0, 120),
    updatedAt: serverTimestamp(),
  });
  // Lock-screen push to the OTHER participant. chatId is the two UIDs
  // joined with '_' (Firebase UIDs contain no underscore). System
  // separators ('system') never trigger a push.
  if (senderId && senderId !== 'system') {
    const toUid = String(chatId).split('_').find((p) => p && p !== senderId);
    if (toUid) {
      sendPushToUser({
        toUid,
        title: 'New message',
        body: clean.slice(0, 140),
        data: { type: 'chat', chatId },
      });
    }
  }
}

export function listenMessages(chatId, callback) {
  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getUserChats(userId) {
  // Single array-contains filter (auto-indexed); sort client-side so no
  // composite index is required.
  const q = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', userId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
}
