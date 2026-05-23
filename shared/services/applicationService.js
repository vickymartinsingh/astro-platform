// Astrologer self-registration / recruitment applications.
//
// Customers (or anyone with the link) can submit an application via
// /register-as-astrologer. Admin reviews them in /admin-astro-applications
// and either approves (creates a real astrologer account) or rejects.
//
// Each application is a doc in `astroApplications` with status:
//   'submitted' -> 'reviewing' -> 'approved' | 'rejected'
import {
  doc, setDoc, getDoc, updateDoc, getDocs, query, where, orderBy,
  collection, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// Stable short token shown to the applicant in the success screen + the
// email confirmation, so they have a reference if they ever need to
// follow up with support.
function shortToken() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i += 1) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// Submit a new application. Returns the new doc id + token.
export async function submitApplication(data) {
  const ref = doc(collection(db, 'astroApplications'));
  const token = shortToken();
  await setDoc(ref, {
    token,
    fullName: String(data.fullName || '').trim(),
    email: String(data.email || '').trim().toLowerCase(),
    phone: String(data.phone || '').trim(),
    gender: data.gender || 'other',
    dob: data.dob || '',
    city: data.city || '',
    languages: data.languages || '',
    skills: data.skills || '',
    experienceYears: Number(data.experienceYears || 0),
    bio: data.bio || '',
    why: data.why || '', // "Why are you joining AstroSeer?"
    expectedRate: Number(data.expectedRate || 0),
    referredBy: data.referredBy || '',
    status: 'submitted',
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, token };
}

// Admin: list applications, newest first.
export async function listApplications({ status = null } = {}) {
  let q;
  try {
    q = status
      ? query(collection(db, 'astroApplications'),
        where('status', '==', status), orderBy('createdAt', 'desc'))
      : query(collection(db, 'astroApplications'),
        orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // Fallback if composite index missing.
    const snap = await getDocs(collection(db, 'astroApplications'));
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) list = list.filter((a) => a.status === status);
    return list.sort((a, b) =>
      ((b.createdAt && b.createdAt.toMillis && b.createdAt.toMillis())
        || 0)
      - ((a.createdAt && a.createdAt.toMillis && a.createdAt.toMillis())
        || 0));
  }
}

export async function getApplication(id) {
  const s = await getDoc(doc(db, 'astroApplications', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Admin: set status (reviewing / approved / rejected) + optional note.
export async function updateApplicationStatus(id, status, note = '') {
  await updateDoc(doc(db, 'astroApplications', id), {
    status,
    note: String(note || '').slice(0, 1000),
    decidedAt: serverTimestamp(),
  });
  return { success: true };
}
