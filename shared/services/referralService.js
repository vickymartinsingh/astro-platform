// Astrologer-refers-astrologer referral bonus engine.
//
// Flow:
//   1. Recruit form: applicant enters someone's userCode in
//      "Referred by". Stored on astroApplications/{id}.referredBy.
//   2. Admin approves application → adminService.createAstrologer
//      copies referredByCode + referredByUserId onto users/{uid}
//      AND drops an astroReferralPending/{uid} row.
//   3. New astrologer completes their first paid call/chat of at
//      least N minutes (N from settings/config.astro_to_astro_min_minutes,
//      default 30). callService / chatService end-of-session calls
//      maybeCreditAstroReferral(astrologerUid, durationMinutes).
//   4. We check the pending row, settings/config flags, the session
//      duration, and credit the referrer's wallet in a Firestore
//      transaction. The pending row flips to status='paid' so we
//      never double-credit.
import {
  doc, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp,
  collection,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { resolveReferral } from '../astroProfile.js';

// Read the admin-managed referral config once. Caller can pass
// a pre-fetched cfg (avoids an extra Firestore read on hot paths).
async function loadConfig(cfg) {
  if (cfg) return resolveReferral(cfg);
  try {
    const s = await getDoc(doc(db, 'settings', 'config'));
    return resolveReferral((s.exists() && s.data()) || {});
  } catch (_) { return resolveReferral({}); }
}

// Called from callService / chatService when a paid session ends.
// `durationMinutes` should already exclude any refunded inactivity.
// Returns { credited, amount, reason }. Never throws - failures are
// logged into the pending doc and reported back so the session-end
// path doesn't surface money errors to the customer.
export async function maybeCreditAstroReferral(astrologerUid,
  durationMinutes, opts = {}) {
  if (!astrologerUid) {
    return { credited: false, reason: 'noAstrologer' };
  }
  const cfg = await loadConfig(opts.cfg);
  if (!cfg.astro_to_astro_enabled) {
    return { credited: false, reason: 'disabled' };
  }
  if (Number(durationMinutes || 0) < cfg.astro_to_astro_min_minutes) {
    return { credited: false, reason: 'tooShort',
      need: cfg.astro_to_astro_min_minutes };
  }
  const pendingRef = doc(db, 'astroReferralPending', astrologerUid);
  const pSnap = await getDoc(pendingRef);
  if (!pSnap.exists()) {
    return { credited: false, reason: 'noPendingRow' };
  }
  const pending = pSnap.data() || {};
  if (pending.status === 'paid') {
    return { credited: false, reason: 'alreadyPaid' };
  }
  const referrerUid = pending.referrerUid;
  if (!referrerUid) {
    return { credited: false, reason: 'noReferrer' };
  }
  const amount = cfg.astro_to_astro_amount;
  if (!(amount > 0)) {
    return { credited: false, reason: 'zeroAmount' };
  }
  // Atomic credit: bump referrer's wallet + flip pending row to paid
  // in one transaction so a crash mid-way can't double-pay.
  try {
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', referrerUid);
      const uSnap = await tx.get(userRef);
      const pSnap2 = await tx.get(pendingRef);
      if (!pSnap2.exists()
        || (pSnap2.data() && pSnap2.data().status === 'paid')) {
        throw new Error('alreadyPaidRace');
      }
      const wallet = Number((uSnap.exists()
        && uSnap.data().wallet) || 0);
      tx.set(userRef,
        { wallet: wallet + amount }, { merge: true });
      tx.set(pendingRef, {
        status: 'paid',
        amount,
        paidAt: serverTimestamp(),
        triggerSessionDurationMinutes: Number(durationMinutes),
      }, { merge: true });
      const txRef = doc(collection(db, 'walletTransactions'));
      tx.set(txRef, {
        userId: referrerUid,
        type: 'astroReferralBonus',
        amount,
        balanceAfter: wallet + amount,
        meta: {
          referredAstrologerUid: astrologerUid,
          durationMinutes: Number(durationMinutes),
        },
        createdAt: serverTimestamp(),
      });
    });
    return { credited: true, amount,
      referrerUid, referredAstrologerUid: astrologerUid };
  } catch (e) {
    try {
      await updateDoc(pendingRef, {
        lastError: String((e && e.message) || e),
        lastErrorAt: serverTimestamp(),
      });
    } catch (_) { /* swallow */ }
    return { credited: false, reason: 'txFailed',
      error: String((e && e.message) || e) };
  }
}

// Inspect a pending bonus (used by an admin viewer / debug UI).
export async function getPendingReferral(astrologerUid) {
  if (!astrologerUid) return null;
  const s = await getDoc(doc(db, 'astroReferralPending', astrologerUid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Admin can force-credit (e.g. an exception case where the auto-rule
// didn't fire). Same transaction semantics as the auto path.
export async function forceCreditAstroReferral(astrologerUid, by = 'admin') {
  return maybeCreditAstroReferral(astrologerUid, Number.POSITIVE_INFINITY,
    { admin: by });
}
