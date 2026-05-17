// chatService, blueprint 8.2 & 4.8
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, onSnapshot, getDocs, serverTimestamp,
} from 'firebase/firestore';
import {
  ref as storageRef, uploadBytes, getDownloadURL,
} from 'firebase/storage';
import { db, storage } from '../firebase.js';
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
  // separators ('system') never trigger a push. The title carries the
  // SENDER's name (astrologer name when the astrologer messages a client).
  if (senderId && senderId !== 'system') {
    const toUid = String(chatId).split('_').find((p) => p && p !== senderId);
    if (toUid) {
      const senderName = await resolveName(senderId);
      sendPushToUser({
        toUid,
        title: senderName ? `${senderName}` : 'New message',
        body: clean.slice(0, 140),
        data: { type: 'chat', chatId, from: senderName || '' },
      });
    }
  }
}

// Send a photo in the chat (the "+" -> Choose Picture sheet). Uploads
// to Storage then writes an image message. Returns true on success;
// callers show a friendly message on false so text chat never breaks.
export async function sendImageMessage(chatId, senderId, file) {
  if (!chatId || !senderId || !file) return false;
  try {
    const path = `chat/${chatId}/${Date.now()}_${
      String(file.name || 'photo').replace(/[^\w.\-]/g, '')}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
    const url = await getDownloadURL(r);
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId, text: '', imageUrl: url, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: '📷 Photo', updatedAt: serverTimestamp(),
    });
    if (senderId !== 'system') {
      const toUid = String(chatId).split('_').find(
        (p) => p && p !== senderId);
      if (toUid) {
        const senderName = await resolveName(senderId);
        sendPushToUser({
          toUid,
          title: senderName || 'New message',
          body: '📷 Photo',
          data: { type: 'chat', chatId, from: senderName || '' },
        });
      }
    }
    return true;
  } catch (_) { return false; }
}

// Resolve a person's display name (astrologer profile first, then user).
async function resolveName(uid) {
  try {
    const a = await getDoc(doc(db, 'astrologers', uid));
    if (a.exists() && a.data().name) return a.data().name;
  } catch (_) {}
  try {
    const u = await getDoc(doc(db, 'users', uid));
    if (u.exists() && u.data().name) return u.data().name;
  } catch (_) {}
  return '';
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
