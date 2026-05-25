// chatService, blueprint 8.2 & 4.8
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, onSnapshot, getDocs, serverTimestamp,
} from 'firebase/firestore';
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL,
} from 'firebase/storage';
import { db, storage, auth } from '../firebase.js';
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

// Browser-side image downscale. Phones routinely produce 5-10 MB
// photos that take forever to upload (and sometimes hit storage size
// limits). Re-encode anything wider than `maxW` as a JPEG so the
// upload is small enough to feel instant. Returns the original Blob
// untouched if the helper can't run (SSR, unsupported types, etc).
async function downscaleImage(file, maxW = 1600, quality = 0.85) {
  if (typeof window === 'undefined' || !file
    || !file.type || !/^image\/(jpeg|png|webp)/i.test(file.type)
    || file.size <= 900 * 1024) return file;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('read failed'));
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode failed'));
      i.src = dataUrl;
    });
    const sc = Math.min(1, maxW / (img.width || maxW));
    const w = Math.max(1, Math.round((img.width || maxW) * sc));
    const h = Math.max(1, Math.round((img.height || maxW) * sc));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => cv.toBlob(
      (b) => resolve(b), 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    blob.name = (file.name || 'photo').replace(/\.[a-z]+$/i, '.jpg');
    return blob;
  } catch (_) { return file; }
}

// Send a photo in the chat (the "+" -> Choose Picture sheet). Uploads
// to Storage then writes an image message. THROWS a real Error with
// a human-readable message on failure so the chat page can show the
// user what actually went wrong (auth / rules / file size / network)
// instead of the old generic "check your connection".
export async function sendImageMessage(chatId, senderId, file) {
  if (!chatId || !senderId || !file) {
    throw new Error('Missing chat or file.');
  }
  // Hard cap so Firebase Storage doesn't reject huge uploads. Modern
  // phones routinely produce 5-10 MB photos.
  const HARD_MAX = 12 * 1024 * 1024;            // 12 MB
  if (file.size > HARD_MAX) {
    throw new Error(`Photo is too large (${Math.round(file.size / 1024 / 1024)
      } MB). Please pick one under ${HARD_MAX / 1024 / 1024} MB.`);
  }
  // Re-encode/scale before upload to keep it snappy + stay well inside
  // any per-file limit. Falls back to original on any failure.
  const blob = await downscaleImage(file);

  // Auth check: signed-in users only. Storage rules require it; we
  // surface a clear message instead of a 403.
  if (auth && !auth.currentUser) {
    throw new Error('You need to sign in again before sending photos.');
  }

  // Use the media/ prefix: Storage rules already allow any signed-in
  // user to write there.
  const path = `media/chat/${chatId}/${Date.now()}_${
    String(file.name || 'photo').replace(/[^\w.\-]/g, '')}`;
  const r = storageRef(storage, path);
  // Resumable upload with a "no-progress for 20s" watchdog. The watch-
  // dog catches the specific case where Firebase Storage hangs because
  // the bucket's CORS doesn't allow the origin (e.g. http://localhost
  // on a new .firebasestorage.app bucket) - the previous fixed-30s
  // timeout looked indistinguishable from a slow network, which led
  // to a vague "Upload timed out" message with no idea what was wrong.
  await new Promise((resolve, reject) => {
    let lastTransferred = 0;
    let stuckSince = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - stuckSince > 20000) {
        clearInterval(watchdog);
        try { task.cancel(); } catch (_) { /* ignore */ }
        reject(new Error('storage/cors-or-network'));
      }
    }, 1000);
    const task = uploadBytesResumable(r, blob,
      { contentType: blob.type || file.type || 'image/jpeg' });
    task.on('state_changed',
      (snap) => {
        if (snap.bytesTransferred > lastTransferred) {
          lastTransferred = snap.bytesTransferred;
          stuckSince = Date.now();
        }
      },
      (err) => { clearInterval(watchdog); reject(err); },
      () => { clearInterval(watchdog); resolve(); });
  }).catch((e) => {
    const code = (e && e.code) || (e && e.message) || '';
    if (code === 'storage/unauthorized'
      || /unauthor/i.test(code)) {
      throw new Error('Photo upload was blocked (storage rules). '
        + 'Admin needs to allow media/ writes for signed-in users.');
    }
    if (code === 'storage/canceled') throw new Error('Upload cancelled.');
    if (code === 'storage/quota-exceeded'
      || /quota/i.test(code)) {
      throw new Error('Storage is full. Contact support.');
    }
    if (code === 'storage/unauthenticated'
      || /unauthenticated/i.test(code)) {
      throw new Error('You need to sign in again before sending photos.');
    }
    if (/cors-or-network|preflight|cors/i.test(code)) {
      throw new Error('Photo upload stalled - the storage bucket is '
        + 'not configured to accept uploads from this origin (CORS). '
        + 'Try again on the live site, or contact admin to allow '
        + 'this origin on the bucket.');
    }
    throw new Error(`Upload failed: ${(e && e.message)
      || code || 'network error'}.`);
  });
  // getDownloadURL with a 15s ceiling - same Promise.race pattern as
  // before but inline since we dropped the helper above.
  let url;
  try {
    url = await Promise.race([
      getDownloadURL(r),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error('Fetch URL timed out')), 15000)),
    ]);
  } catch (e) {
    throw new Error(`Photo uploaded but link could not be fetched: ${
      (e && e.message) || 'unknown'}.`);
  }
  try {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId, text: '', imageUrl: url, createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: '📷 Photo', updatedAt: serverTimestamp(),
    });
  } catch (e) {
    throw new Error(`Could not post the photo to chat: ${
      (e && e.message) || 'firestore error'}.`);
  }
  if (senderId !== 'system') {
    const toUid = String(chatId).split('_').find(
      (p) => p && p !== senderId);
    if (toUid) {
      try {
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
      } catch (_) { /* push is best-effort, message already delivered */ }
    }
  }
  return true;
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
    // Use the right file extension for the actual mimeType so iOS Safari
    // (which uses mp4) and Android Chrome (webm) both play back cleanly
    // from the same Storage URL.
    const type = (blob.type || 'audio/webm').toLowerCase();
    const ext = type.includes('mp4') ? 'mp4'
      : type.includes('aac') ? 'aac'
        : type.includes('ogg') ? 'ogg'
          : type.includes('wav') ? 'wav'
            : 'webm';
    const path = `media/chat/${chatId}/${Date.now()}_voice.${ext}`;
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

// Live list of every chat this user participates in (no composite index;
// single array-contains filter). Used by the astrologer AI auto-responder
// so it can watch ALL conversations, not just an open chat screen.
export function listenUserChats(userId, callback) {
  const q = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', userId),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
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
