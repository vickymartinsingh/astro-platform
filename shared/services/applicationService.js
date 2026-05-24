// Astrologer self-registration / recruitment + onboarding pipeline.
//
// Customers (or anyone with the link) can submit an application via
// /register-as-astrologer. Admin reviews them in
// /admin-astro-applications and progresses them through the HRMS
// pipeline:
//
//   submitted
//      -> reviewing      (recruitment team is screening)
//      -> interview      (screening call scheduled / done)
//      -> kyc            (applicant must upload PAN + Aadhaar)
//      -> bank           (applicant must add bank details for payouts)
//      -> declaration    (applicant must sign code-of-conduct)
//      -> approved       (astrologer account created, login emailed)
//      -> rejected       (at any stage)
//
// Each transition writes a `history` entry and (when configured) sends
// the applicant an email so they always know where they stand. The
// applicant can resume their onboarding from the URL emailed on signup
// using their reference token (no login required).
import {
  doc, setDoc, getDoc, updateDoc, getDocs, query, where, orderBy,
  collection, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { queueEmail } from './emailService.js';

// Ordered list of stages so the UI can render chips/progress bars and
// so we can compute "what is the next stage after X" generically.
export const STAGES = [
  'submitted',
  'reviewing',
  'interview',
  'kyc',
  'bank',
  'declaration',
  'approved',
];
export const STAGE_LABEL = {
  submitted: 'New',
  reviewing: 'Reviewing',
  interview: 'Interview',
  kyc: 'KYC',
  bank: 'Bank',
  declaration: 'Declaration',
  approved: 'Approved',
  rejected: 'Rejected',
};
export function nextStage(s) {
  const i = STAGES.indexOf(s);
  if (i < 0 || i >= STAGES.length - 1) return null;
  return STAGES[i + 1];
}

// Stable short token shown to the applicant in the success screen + the
// email confirmation, so they have a reference if they ever need to
// follow up with support OR resume onboarding via /astro-onboarding/.
function shortToken() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i += 1) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// Build the public onboarding URL emailed to the applicant. Falls back
// to the customer site under astroseer.in if no env var is set.
function onboardUrl(token) {
  const base = (typeof process !== 'undefined' && process.env
    && (process.env.NEXT_PUBLIC_ONBOARD_URL
      || process.env.NEXT_PUBLIC_CUSTOMER_URL))
    || 'https://astroseer.in';
  return `${base.replace(/\/$/, '')}/astro-onboarding/${token}`;
}

// Submit a new application. Returns the new doc id + token. Also
// queues a confirmation email to the applicant with their token + the
// onboarding URL.
export async function submitApplication(data) {
  const ref = doc(collection(db, 'astroApplications'));
  const token = shortToken();
  const email = String(data.email || '').trim().toLowerCase();
  const fullName = String(data.fullName || '').trim();
  await setDoc(ref, {
    token,
    fullName,
    email,
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
    // Onboarding sub-state (filled in by the applicant via the
    // /astro-onboarding/[token] page once recruitment moves the
    // application into the kyc / bank / declaration stages).
    kyc: null,         // { panNumber, panUrl, aadhaarNumber, aadhaarUrl }
    bank: null,        // { holder, accountNo, ifsc, bankName, branch }
    declaration: null, // { signedAt, signature, ip }
    history: [{
      at: Date.now(), stage: 'submitted', by: 'applicant',
      note: 'Application submitted via public form.',
    }],
    createdAt: serverTimestamp(),
  });
  // Best-effort: email applicant with the token + onboarding URL.
  try {
    if (email) {
      await queueEmail({
        to: email,
        kind: 'astro_application_received',
        vars: { name: fullName, token, onboardUrl: onboardUrl(token) },
      });
    }
  } catch (_) { /* never block submission on email queue */ }
  return { id: ref.id, token, onboardUrl: onboardUrl(token) };
}

// Admin: list applications, newest first. Optional status filter
// matches the simple status string (back-compat with the old pipeline).
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

// Public resume-by-token lookup. Used by /astro-onboarding/[token]
// so applicants can come back later (e.g. from the email) without
// needing to log in.
export async function getApplicationByToken(token) {
  if (!token) return null;
  try {
    const snap = await getDocs(query(
      collection(db, 'astroApplications'),
      where('token', '==', String(token).toUpperCase()),
    ));
    const d = snap.docs[0];
    return d ? { id: d.id, ...d.data() } : null;
  } catch (_) { return null; }
}

// Admin: set status (any stage including reviewing / interview / kyc /
// bank / declaration / approved / rejected) + optional note. Also
// notifies the applicant by email so they know what is expected from
// them next.
export async function updateApplicationStatus(id, status, note = '',
  by = 'admin') {
  const cur = await getApplication(id);
  const token = cur && cur.token;
  const email = cur && cur.email;
  const name = cur && cur.fullName;
  await updateDoc(doc(db, 'astroApplications', id), {
    status,
    note: String(note || '').slice(0, 1000),
    decidedAt: serverTimestamp(),
    history: arrayUnion({
      at: Date.now(), stage: status, by,
      note: String(note || '').slice(0, 500),
    }),
  });
  // Best-effort applicant notification.
  if (email && status !== 'approved' && status !== 'rejected') {
    const stage = STAGE_LABEL[status] || status;
    const action = {
      kyc: 'Upload your PAN + Aadhaar documents.',
      bank: 'Add your bank account details for payouts.',
      declaration: 'Read and sign the code-of-conduct declaration.',
      interview: 'Our team will contact you to schedule a screening call.',
      reviewing: '',
    }[status] || '';
    try {
      await queueEmail({
        to: email,
        kind: 'astro_application_stage',
        vars: { name, token, stage,
          onboardUrl: onboardUrl(token), action, note },
      });
    } catch (_) { /* ignore */ }
  }
  return { success: true };
}

// Email-only: notify applicant of final approval (login + temp pwd).
export async function notifyApproved(id, password) {
  const cur = await getApplication(id);
  if (!cur || !cur.email) return false;
  try {
    await queueEmail({
      to: cur.email,
      kind: 'astro_application_approved',
      vars: { name: cur.fullName, email: cur.email, password },
    });
    return true;
  } catch (_) { return false; }
}

export async function notifyRejected(id, note) {
  const cur = await getApplication(id);
  if (!cur || !cur.email) return false;
  try {
    await queueEmail({
      to: cur.email,
      kind: 'astro_application_rejected',
      vars: { name: cur.fullName, note },
    });
    return true;
  } catch (_) { return false; }
}

// Onboarding submissions from the public /astro-onboarding/[token]
// page. Each call merges into the application doc and writes a
// history entry, so admin can audit who entered what when.

export async function saveKyc(id, kyc, by = 'applicant') {
  await updateDoc(doc(db, 'astroApplications', id), {
    kyc: {
      panNumber: String(kyc.panNumber || '').trim().toUpperCase(),
      panUrl: kyc.panUrl || '',
      aadhaarNumber: String(kyc.aadhaarNumber || '').trim(),
      aadhaarUrl: kyc.aadhaarUrl || '',
      savedAt: Date.now(),
    },
    history: arrayUnion({
      at: Date.now(), stage: 'kyc-submitted', by,
      note: 'Applicant submitted KYC details.',
    }),
  });
  return { success: true };
}

export async function saveBank(id, bank, by = 'applicant') {
  await updateDoc(doc(db, 'astroApplications', id), {
    bank: {
      holder: String(bank.holder || '').trim(),
      accountNo: String(bank.accountNo || '').trim(),
      ifsc: String(bank.ifsc || '').trim().toUpperCase(),
      bankName: String(bank.bankName || '').trim(),
      branch: String(bank.branch || '').trim(),
      savedAt: Date.now(),
    },
    history: arrayUnion({
      at: Date.now(), stage: 'bank-submitted', by,
      note: 'Applicant submitted bank details.',
    }),
  });
  return { success: true };
}

export async function saveDeclaration(id, decl, by = 'applicant') {
  await updateDoc(doc(db, 'astroApplications', id), {
    declaration: {
      signedAt: Date.now(),
      signature: String(decl.signature || '').trim(),
      ip: decl.ip || '',
      ua: decl.ua || (typeof navigator !== 'undefined'
        ? navigator.userAgent : ''),
      version: decl.version || 'v1',
    },
    history: arrayUnion({
      at: Date.now(), stage: 'declaration-signed', by,
      note: `Signed by "${String(decl.signature || '').trim()}".`,
    }),
  });
  return { success: true };
}

// Counts per stage, used by the HR dashboard. Returns a map keyed by
// stage label plus a `total`.
export async function pipelineCounts() {
  try {
    const snap = await getDocs(collection(db, 'astroApplications'));
    const out = { total: snap.size, rejected: 0 };
    STAGES.forEach((s) => { out[s] = 0; });
    snap.docs.forEach((d) => {
      const s = (d.data() && d.data().status) || 'submitted';
      out[s] = (out[s] || 0) + 1;
    });
    return out;
  } catch (_) { return { total: 0 }; }
}
