// payoutService - blueprint 8.2 / 5.9 / 6.32.
//
// Rewritten 2026-06-06 to cover the full payout lifecycle requested
// by the operator:
//   - Phase A: scheduling config (global + per-astrologer override)
//   - Phase B: Instant Payment Request (70 percent cap, bank snap)
//   - Phase C: KYC + bank details with approval gate
//   - Phase D: status workflow initiated -> processing -> completed
//              / rejected with mode + UTR + receipt
//   - Phase E: edit + restore through astrologers/{id}/history
//
// payouts/{id} schema:
//   astroId, amount, type ('instant'|'scheduled'),
//   bankSnap (locked copy of bank details at request time so we can
//     prove WHERE the money was sent even after the astrologer
//     changes their bank record later),
//   status ('initiated'|'processing'|'completed'|'rejected'),
//   mode ('NEFT'|'RTGS'|'UPI'|''), utr, processedAt, processedBy,
//   receiptUrl (internal-only, never echoed to astrologer view),
//   narration, adminNote, createdAt, completedAt.

import {
  addDoc, collection, query, where, getDocs, getDoc, doc,
  serverTimestamp, updateDoc, setDoc, runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase.js';

const INSTANT_CAP_PCT = 0.7; // 70 percent rule from the spec.

// ---- Schedule -------------------------------------------------------

export const DEFAULT_SCHEDULE = {
  frequency: 'monthly',  // monthly | weekly | biweekly | fixed
  dayOfMonth: 1,
  dayOfWeek: 1,          // 0=Sun
  anchorIso: '',
  active: true,
};

export async function getGlobalSchedule() {
  try {
    const s = await getDoc(doc(db, 'settings', 'payoutSchedule'));
    return s.exists() ? { ...DEFAULT_SCHEDULE, ...s.data() }
      : DEFAULT_SCHEDULE;
  } catch (_) { return DEFAULT_SCHEDULE; }
}

export async function setGlobalSchedule(patch) {
  await setDoc(doc(db, 'settings', 'payoutSchedule'),
    { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

export async function setAstrologerSchedule(astroId, schedule) {
  await updateDoc(doc(db, 'astrologers', astroId), {
    payoutSchedule: { ...schedule, updatedAt: new Date().toISOString() },
  });
}

export function mergeSchedule(global, astro) {
  return { ...DEFAULT_SCHEDULE, ...(global || {}),
    ...((astro && astro.payoutSchedule) || {}) };
}

export function describeSchedule(s) {
  if (!s || s.active === false) return 'Manual only';
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  if (s.frequency === 'weekly') {
    return `Every ${dows[s.dayOfWeek || 1]}`;
  }
  if (s.frequency === 'biweekly') {
    return `Every other ${dows[s.dayOfWeek || 1]}`;
  }
  if (s.frequency === 'fixed' && s.anchorIso) {
    return `Same date each month (${s.anchorIso.slice(0,10)})`;
  }
  const d = Math.max(1, Math.min(31, Number(s.dayOfMonth || 1)));
  const suf = (d % 10 === 1 && d !== 11) ? 'st'
    : (d % 10 === 2 && d !== 12) ? 'nd'
    : (d % 10 === 3 && d !== 13) ? 'rd' : 'th';
  return `${d}${suf} of every month`;
}

// ---- Bank snapshot --------------------------------------------------

export async function getBankSnap(astroId) {
  const s = await getDoc(doc(db, 'astrologers', astroId));
  if (!s.exists()) throw new Error('astrologer not found');
  const b = s.data().bank || {};
  const missing = ['accountHolder','bankName','accountNumber','ifsc']
    .filter((k) => !String(b[k] || '').trim());
  if (missing.length) {
    const ex = new Error(`Bank details incomplete: ${missing.join(', ')}`);
    ex.code = 'bank_incomplete';
    throw ex;
  }
  return {
    accountHolder: String(b.accountHolder || '').trim(),
    bankName: String(b.bankName || '').trim(),
    accountNumber: String(b.accountNumber || '').trim(),
    ifsc: String(b.ifsc || '').trim().toUpperCase(),
    branch: String(b.branch || '').trim(),
    upi: String(b.upi || '').trim(),
  };
}

// ---- Instant request (astrologer-side) -----------------------------

export async function getInstantQuote(astroId) {
  const astroSnap = await getDoc(doc(db, 'astrologers', astroId));
  const a = astroSnap.exists() ? astroSnap.data() : {};
  const earnings = Number(a.earnings || 0);
  const ps = await getDocs(query(collection(db, 'payouts'),
    where('astroId', '==', astroId)));
  let locked = 0;
  ps.forEach((d) => {
    const p = d.data() || {};
    if (p.status === 'rejected') return;
    locked += Number(p.amount || 0);
  });
  const available = Math.max(0, earnings - locked);
  const cap = Math.floor(available * INSTANT_CAP_PCT);
  return {
    earnings, locked, available,
    instantMax: cap,
    capPct: INSTANT_CAP_PCT,
    kycRequired: !(a.kyc && a.kyc.status === 'approved'),
  };
}

export async function requestInstantPayout(astroId, amount, narration) {
  const amt = Math.round(Number(amount || 0));
  if (!amt || amt <= 0) throw new Error('Enter a positive amount.');
  const quote = await getInstantQuote(astroId);
  if (quote.kycRequired) {
    const ex = new Error('Complete KYC before requesting a payout.');
    ex.code = 'kyc_required';
    throw ex;
  }
  if (amt > quote.instantMax) {
    const ex = new Error(`Instant payout is capped at 70 percent of `
      + `available earnings (${quote.instantMax}).`);
    ex.code = 'over_cap';
    throw ex;
  }
  const bankSnap = await getBankSnap(astroId);
  const ref = await addDoc(collection(db, 'payouts'), {
    astroId,
    amount: amt,
    type: 'instant',
    requestedBy: 'astrologer',
    bankSnap,
    status: 'initiated',
    mode: '',
    utr: '',
    receiptUrl: '',
    narration: narration || 'Instant payout (70% rule)',
    adminNote: '',
    createdAt: serverTimestamp(),
    processedAt: null,
    completedAt: null,
    processedBy: '',
  });
  return { id: ref.id };
}

// Legacy/back-compat - the old version stored a free-text bankDetails
// string. Keep the export so older callers don't crash; new flows
// must use requestInstantPayout.
export async function requestPayout(astroId, amount, bankDetails) {
  await addDoc(collection(db, 'payouts'), {
    astroId,
    amount: Number(amount),
    bankDetails: bankDetails || '',
    type: 'scheduled',
    status: 'initiated',
    adminNote: '',
    createdAt: serverTimestamp(),
    processedAt: null,
  });
}

// ---- Astrologer reads ----------------------------------------------

// receiptUrl is internal-only per the spec - never expose it.
function stripInternal(p) {
  // eslint-disable-next-line no-unused-vars
  const { receiptUrl, adminNote, processedBy, ...safe } = p;
  return { ...safe, _hasReceipt: !!receiptUrl };
}

export async function getPayouts(astroId) {
  const snap = await getDocs(query(collection(db, 'payouts'),
    where('astroId', '==', astroId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    .map(stripInternal);
}

// ---- Admin lifecycle -----------------------------------------------

export async function markProcessing(payoutId, by) {
  await updateDoc(doc(db, 'payouts', payoutId), {
    status: 'processing',
    processedBy: by || '',
    processingAt: serverTimestamp(),
  });
}

export async function completePayout(payoutId, fields) {
  const { mode, utr, datetime, receiptUrl, narration, by } = fields || {};
  if (!mode) throw new Error('Pick a payment mode (NEFT/RTGS/UPI).');
  if (!utr || !String(utr).trim()) {
    throw new Error('UTR / reference number is required.');
  }
  const at = datetime ? new Date(datetime).toISOString()
    : new Date().toISOString();
  await updateDoc(doc(db, 'payouts', payoutId), {
    status: 'completed',
    mode, utr: String(utr).trim(),
    receiptUrl: receiptUrl || '',
    narration: narration || '',
    completedAt: serverTimestamp(),
    completedAtIso: at,
    processedBy: by || '',
  });
}

export async function rejectPayout(payoutId, reason, by) {
  await updateDoc(doc(db, 'payouts', payoutId), {
    status: 'rejected',
    adminNote: reason || '',
    processedBy: by || '',
    rejectedAt: serverTimestamp(),
  });
}

// ---- KYC + bank ----------------------------------------------------

export async function updateBank(astroId, bank, by, reason) {
  const ref = doc(db, 'astrologers', astroId);
  const cur = await getDoc(ref);
  const prev = (cur.exists() && cur.data().bank) || null;
  await runTransaction(db, async (t) => {
    t.update(ref, { bank: { ...bank, updatedAt: new Date().toISOString() } });
    t.set(doc(collection(db, 'astrologers', astroId, 'history')), {
      field: 'bank', before: prev, after: bank,
      at: serverTimestamp(), by: by || '',
      reason: reason || 'bank update',
    });
  });
}

export async function setKyc(astroId, patch, by) {
  const ref = doc(db, 'astrologers', astroId);
  const cur = await getDoc(ref);
  const prev = (cur.exists() && cur.data().kyc) || null;
  const next = { ...(prev || {}), ...patch };
  await runTransaction(db, async (t) => {
    t.update(ref, { kyc: next });
    t.set(doc(collection(db, 'astrologers', astroId, 'history')), {
      field: 'kyc', before: prev, after: next,
      at: serverTimestamp(), by: by || '',
      reason: patch.status ? `kyc.${patch.status}` : 'kyc update',
    });
  });
}

// ---- Phase E: history + restore ------------------------------------

export async function getHistory(astroId) {
  const snap = await getDocs(collection(db,
    'astrologers', astroId, 'history'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) =>
      (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
}

export async function restoreField(astroId, historyId, by) {
  const hRef = doc(db, 'astrologers', astroId, 'history', historyId);
  const h = await getDoc(hRef);
  if (!h.exists()) throw new Error('history entry not found');
  const { field, before } = h.data();
  if (!field) throw new Error('history row has no field');
  const aRef = doc(db, 'astrologers', astroId);
  const cur = await getDoc(aRef);
  await runTransaction(db, async (t) => {
    t.update(aRef, { [field]: before });
    t.set(doc(collection(db, 'astrologers', astroId, 'history')), {
      field, before: (cur.exists() && cur.data()[field]) || null,
      after: before,
      at: serverTimestamp(), by: by || '',
      reason: `restore from history/${historyId}`,
      restoreOf: historyId,
    });
  });
}
