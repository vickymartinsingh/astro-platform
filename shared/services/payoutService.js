// payoutService, blueprint 8.2 & 5.9 / 6.32
import {
  addDoc, collection, query, where, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export async function requestPayout(astroId, amount, bankDetails) {
  await addDoc(collection(db, 'payouts'), {
    astroId,
    amount: Number(amount),
    bankDetails: bankDetails || '',
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    processedAt: null,
  });
}

export async function getPayouts(astroId) {
  const q = query(
    collection(db, 'payouts'),
    where('astroId', '==', astroId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}
