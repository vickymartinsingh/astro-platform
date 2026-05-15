// astrologerService, blueprint 8.2
import {
  doc, getDoc, updateDoc, onSnapshot, collection, query, where, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { SAMPLE_ASTROLOGERS } from '../sampleAstrologers.js';

// getAstrologers(filters): approved only. Ordering (online-first, then
// rating desc) is done client-side so the query needs no composite index.
// Falls back to built-in samples when the collection is empty (or the
// query fails) so the marketplace always has content.
export async function getAstrologers(filters = {}) {
  let list = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'astrologers'), where('approved', '==', true)));
    list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) { list = []; }
  if (list.length === 0) list = [...SAMPLE_ASTROLOGERS];

  if (filters.skill)
    list = list.filter((a) => (a.skills || []).includes(filters.skill));
  if (filters.language)
    list = list.filter((a) => (a.languages || []).includes(filters.language));
  if (filters.minRating)
    list = list.filter((a) => (a.rating || 0) >= filters.minRating);
  if (filters.maxPrice)
    list = list.filter((a) => (a.priceChat || 0) <= filters.maxPrice);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    list = list.filter((a) => (a.name || '').toLowerCase().includes(s));
  }

  const rank = { online: 0, idle: 1, busy: 2, offline: 3 };
  list.sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
    (b.rating || 0) - (a.rating || 0));
  return list;
}

export async function getAstrologer(id) {
  if (String(id).startsWith('sample-')) {
    return SAMPLE_ASTROLOGERS.find((a) => a.id === id) || null;
  }
  const snap = await getDoc(doc(db, 'astrologers', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenAstrologer(id, callback) {
  if (String(id).startsWith('sample-')) {
    callback(SAMPLE_ASTROLOGERS.find((a) => a.id === id) || null);
    return () => {};
  }
  return onSnapshot(doc(db, 'astrologers', id), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

// updateAvailability(id, options): go online/offline + service toggles.
// earnings/rating/approved are blocked by Firestore rules.
export async function updateAvailability(id, options) {
  await updateDoc(doc(db, 'astrologers', id), options);
}

export async function updateAstrologer(id, data) {
  const { earnings, rating, approved, ...safe } = data || {};
  await updateDoc(doc(db, 'astrologers', id), safe);
}
