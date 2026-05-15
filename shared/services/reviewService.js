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
