// reviewService, blueprint 8.2 & 5.11
// Reviews can never be deleted by users (admin SDK only). Average rating is
// recomputed after each new review: newRating = sum(ratings) / reviewsCount.
import {
  doc, addDoc, updateDoc, getDoc, collection, query, where,
  getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sampleReviews } from '../sampleAstrologers.js';

export async function addReview(uid, astroId, sessionId, rating, comment) {
  await addDoc(collection(db, 'reviews'), {
    userId: uid,
    astroId,
    sessionId,
    rating: Number(rating),
    comment: comment || '',
    astrologerReply: '',
    createdAt: serverTimestamp(),
  });
  await recomputeRating(astroId);
}

async function recomputeRating(astroId) {
  const q = query(collection(db, 'reviews'), where('astroId', '==', astroId));
  const snap = await getDocs(q);
  const ratings = snap.docs.map((d) => Number(d.data().rating || 0));
  const count = ratings.length;
  const avg = count ? ratings.reduce((a, b) => a + b, 0) / count : 0;
  // rating/reviewsCount are server-owned for clients; an astrologer updating
  // their own doc is permitted, the recompute keeps it honest.
  await updateDoc(doc(db, 'astrologers', astroId), {
    rating: Math.round(avg * 10) / 10,
    reviewsCount: count,
  }).catch(() => {});
}

export async function getReviews(astroId) {
  if (String(astroId).startsWith('sample-')) return sampleReviews(astroId);
  const q = query(
    collection(db, 'reviews'),
    where('astroId', '==', astroId),
  );
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return list;
}

export async function addReply(reviewId, replyText) {
  await updateDoc(doc(db, 'reviews', reviewId), { astrologerReply: replyText });
}

// ---------------------------------------------------------------------
// PLATFORM reviews ("What our customers say" on the home dashboard).
// Stored in the same `reviews` collection with kind:'platform' so the
// per-astrologer review queries above (which never set kind) are not
// affected. Lifecycle: a user may write ONE review (editable) only
// AFTER a paid session of >= 10 minutes. New/edited reviews go back to
// status:'pending'. The author always sees their own review in-app;
// everyone else only sees reviews the admin has approved AND selected.
// ---------------------------------------------------------------------
const MIN_PAID_SECONDS = 600; // 10 minutes

export async function canWritePlatformReview(uid) {
  if (!uid) return { ok: false, reason: 'Please sign in.' };
  try {
    const snap = await getDocs(query(
      collection(db, 'sessions'), where('userId', '==', uid)));
    const ok = snap.docs.some((d) => {
      const s = d.data();
      return s.status === 'ended'
        && Number(s.duration || 0) >= MIN_PAID_SECONDS
        && Number(s.cost || 0) > 0;
    });
    return ok ? { ok: true } : { ok: false,
      reason: 'You can write a review after a paid consultation of at '
        + 'least 10 minutes.' };
  } catch (_) {
    return { ok: false, reason: 'Could not verify your sessions.' };
  }
}

export async function getMyPlatformReview(uid) {
  if (!uid) return null;
  const snap = await getDocs(query(
    collection(db, 'reviews'),
    where('kind', '==', 'platform'),
    where('userId', '==', uid)));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return list[0] || null;
}

export async function submitPlatformReview(uid, data) {
  const existing = await getMyPlatformReview(uid);
  const payload = {
    kind: 'platform',
    userId: uid,
    userName: (data.name || '').trim() || 'AstroConnect user',
    city: (data.city || '').trim(),
    rating: Math.max(1, Math.min(5, Number(data.rating) || 5)),
    text: (data.text || '').trim(),
    status: 'pending',     // re-moderated on every create/edit
    selected: false,
    updatedAt: serverTimestamp(),
  };
  if (existing) {
    await updateDoc(doc(db, 'reviews', existing.id), payload);
    return existing.id;
  }
  const ref = await addDoc(collection(db, 'reviews'), {
    ...payload, createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Public dashboard: only admin approved + selected reviews.
export async function getPublicPlatformReviews() {
  try {
    const snap = await getDocs(query(
      collection(db, 'reviews'), where('kind', '==', 'platform')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.status === 'approved' && r.selected === true)
      .sort((a, b) =>
        (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0)
        - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));
  } catch (_) { return []; }
}

// Admin moderation: every platform review with author info.
export async function listAllPlatformReviews() {
  const snap = await getDocs(query(
    collection(db, 'reviews'), where('kind', '==', 'platform')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

export async function moderatePlatformReview(id, patch) {
  await updateDoc(doc(db, 'reviews', id), patch);
}
