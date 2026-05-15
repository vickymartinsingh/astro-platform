// kundliService, blueprint 8.2 & 4.13
import {
  doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { zodiacFromDOB } from '../theme.js';
import { sendMessage } from './chatService.js';

function parseZodiac(dob) {
  // dob expected as DD-MM-YYYY (blueprint example "12-05-1998")
  const [d, m] = String(dob || '').split('-').map(Number);
  if (!d || !m) return '';
  return zodiacFromDOB(d, m);
}

export async function saveKundli(uid, data) {
  const ref = doc(collection(db, 'kundliProfiles'));
  await setDoc(ref, {
    userId: uid,
    name: data.name || '',
    dob: data.dob || '',
    tob: data.tob || '',
    ampm: data.ampm || 'AM',
    place: data.place || '',
    zodiac: parseZodiac(data.dob),
    isDefault: !!data.isDefault,
    createdAt: serverTimestamp(),
  });
  if (data.isDefault) await setDefaultKundli(uid, ref.id);
  return ref.id;
}

export async function getKundliProfiles(uid) {
  const q = query(collection(db, 'kundliProfiles'), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDefaultKundli(uid) {
  const list = await getKundliProfiles(uid);
  return list.find((k) => k.isDefault) || list[0] || null;
}

// Only one default per user, clears the flag on every other profile.
export async function setDefaultKundli(uid, kundliId) {
  const list = await getKundliProfiles(uid);
  const batch = writeBatch(db);
  list.forEach((k) =>
    batch.update(doc(db, 'kundliProfiles', k.id), { isDefault: k.id === kundliId }));
  await batch.commit();
}

export async function deleteKundli(id) {
  await deleteDoc(doc(db, 'kundliProfiles', id));
}

// Auto-shared as the first chat message when a session starts (blueprint 4.8).
export async function autoSendKundliToChat(chatId, systemSenderId, kundli) {
  if (!kundli) return;
  const line =
    `Client: ${kundli.name} | DOB: ${kundli.dob} | ` +
    `TOB: ${kundli.tob} ${kundli.ampm} | Place: ${kundli.place}`;
  await sendMessage(chatId, systemSenderId, line);
}
