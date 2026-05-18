// Records the customer's tarot question for ADMIN review only (the
// customer never sees their stored question again). Saved in the chats
// collection (signed-in write is allowed - no rules redeploy) with
// isTarotQ:true so the admin can list them.
import {
  doc, setDoc, collection, getDocs, query, where, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export async function saveTarotQuestion(data) {
  try {
    const id = `tarotq_${data.userId || 'anon'}_${Date.now()}`;
    await setDoc(doc(db, 'chats', id), {
      isTarotQ: true,
      userId: data.userId || '',
      name: data.name || '',
      aspect: data.aspect || '',
      question: String(data.question || '').slice(0, 300),
      spread: data.spread || 'single',
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (_) { return null; }
}

export async function listTarotQuestions() {
  try {
    const s = await getDocs(query(
      collection(db, 'chats'), where('isTarotQ', '==', true)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0)
        - (a.createdAt?.toMillis?.() || 0));
  } catch (_) { return []; }
}
