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
      // Deep link: tapping the notification opens the right thread in
      // whichever app received it (astrologer app vs client app).
      let route = `/chat/${senderId}`;
      try {
        const aSnap = await getDoc(doc(db, 'astrologers', toUid));
        if (aSnap.exists()) route = `/astro-chat/${senderId}`;
      } catch (_) {}
      sendPushToUser({
        toUid,
        title: senderName ? `${senderName}` : 'New message',
        body: clean.slice(0, 140),
        data: { type: 'chat', chatId, from: senderName || '', route },
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
    // Use the media/ prefix: Storage rules already allow any signed-in
    // user to write there, so photo send works with no rules redeploy.
    const path = `media/chat/${chatId}/${Date.now()}_${
      String(file.name || 'photo').replace(/[^\w.\-]/g, '')}`;
    const r = storageRef(storage, path);
    // Never hang the UI: if Storage is unreachable / rules block the
    // write, fail after 30s so the spinner stops and we can tell the
    // user instead of spinning forever.
    const withTimeout = (p, ms) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(
        () => rej(new Error('timeout')), ms)),
    ]);
    await withTimeout(
      uploadBytes(r, file, { contentType: file.type || 'image/jpeg' }),
      30000);
    const url = await withTimeout(getDownloadURL(r), 15000);
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
        let route = `/chat/${senderId}`;
        try {
          const aSnap = await getDoc(doc(db, 'astrologers', toUid));
          if (aSnap.exists()) route = `/astro-chat/${senderId}`;
        } catch (_) {}
        sendPushToUser({
          toUid,
          title: senderName || 'New message',
          body: '📷 Photo',
          data: { type: 'chat', chatId, from: senderName || '', route },
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

// Voice note: record on the device, upload, send an audio message.
export async function sendAudioMessage(chatId, senderId, blob) {
  if (!chatId || !senderId || !blob) return false;
  try {
    const path = `media/chat/${chatId}/${Date.now()}_voice.webm`;
    const r = storageRef(storage, path);
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((_, rej) => setTimeout(
        () => rej(new Error('timeout')), ms)),
    ]);
    await withTimeout(uploadBytes(r, blob,
      { contentType: blob.type || 'audio/webm' }), 30000);
    const url = await withTimeout(getDownloadURL(r), 15000);
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId, text: '', audioUrl: url, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: 'Voice message', updatedAt: serverTimestamp(),
    });
    if (senderId !== 'system') {
      const toUid = String(chatId).split('_').find(
        (p) => p && p !== senderId);
      if (toUid) {
        const senderName = await resolveName(senderId);
        let route = `/chat/${senderId}`;
        try {
          const aSnap = await getDoc(doc(db, 'astrologers', toUid));
          if (aSnap.exists()) route = `/astro-chat/${senderId}`;
        } catch (_) {}
        sendPushToUser({
          toUid,
          title: senderName || 'New message',
          body: 'Voice message',
          data: { type: 'chat', chatId, from: senderName || '', route },
        });
      }
    }
    return true;
  } catch (_) { return false; }
}

// Typing indicator: write a per-user timestamp on the chat doc; the
// other side shows "typing..." while it is fresh (< 6s old).
export async function setTyping(chatId, uid, isTyping) {
  if (!chatId || !uid) return;
  try {
    await setDoc(doc(db, 'chats', chatId), {
      typing: { [uid]: isTyping ? Date.now() : 0 },
    }, { merge: true });
  } catch (_) { /* non-critical */ }
}

export function listenChat(chatId, callback) {
  return onSnapshot(doc(db, 'chats', chatId), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
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
