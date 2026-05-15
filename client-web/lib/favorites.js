// Favourites, favorites/{uid} { astrologerIds: [...] } (blueprint 4.17).
import { db } from '@astro/shared';
import {
  doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';

export async function getFavorites(uid) {
  const snap = await getDoc(doc(db, 'favorites', uid));
  return snap.exists() ? (snap.data().astrologerIds || []) : [];
}

export async function toggleFavorite(uid, astroId, isFav) {
  const ref = doc(db, 'favorites', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { astrologerIds: isFav ? [] : [astroId] });
    return;
  }
  await updateDoc(ref, {
    astrologerIds: isFav ? arrayRemove(astroId) : arrayUnion(astroId),
  });
}
