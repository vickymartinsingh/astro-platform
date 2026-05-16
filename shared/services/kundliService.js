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

// Real kundli via the relay (Prokerala API; secret stays server-side).
// Endpoint derives from the push relay URL, or NEXT_PUBLIC_KUNDLI_ENDPOINT.
// Returns null if not configured / on any failure (caller shows the
// basic zodiac instead — never throws).
function kundliEndpoint() {
  const env = typeof process !== 'undefined' && process.env;
  const explicit = (env && env.NEXT_PUBLIC_KUNDLI_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (env && env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/kundli') : '';
}

export async function getProkeralaKundli(birth) {
  const url = kundliEndpoint();
  if (!url || !birth || !birth.dob) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dob: birth.dob, tob: birth.tob, ampm: birth.ampm,
        place: birth.place,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && !j.error ? j : null;
  } catch (_) { return null; }
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
  const lines = [
    kundli.name,
    `DOB: ${kundli.dob}`,
    `Time of birth: ${kundli.tob || '--'} ${kundli.ampm || ''}`.trim(),
    `Place of birth: ${kundli.place || '--'}`,
  ];
  if (kundli.zodiac) lines.push(`Sign: ${kundli.zodiac}`);
  await sendMessage(chatId, systemSenderId, lines.join('\n'));
}
