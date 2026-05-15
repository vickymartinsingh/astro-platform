// Core billing engine, Hard Rules 3-8.
// Billing happens here only (server-side); the browser can never alter it.
const functions = require('firebase-functions');
const { db, FieldValue } = require('./lib/admin');
const { getConfig, money } = require('./lib/utils');

function nowMs() { return Date.now(); }
function tsToMs(ts) { return ts && ts.toMillis ? ts.toMillis() : null; }

// Bill the elapsed interval for one active session inside a transaction.
// Returns { ended: bool }. Never lets wallet go negative; charges only for
// real connected time between status=active and status=ended.
async function billSessionOnce(sessionId) {
  const cfg = await getConfig();
  return db.runTransaction(async (t) => {
    const sRef = db.collection('sessions').doc(sessionId);
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return { ended: true };
    const s = sSnap.data();
    if (s.status !== 'active') return { ended: true };

    const uRef = db.collection('users').doc(s.userId);
    const uSnap = await t.get(uRef);
    if (!uSnap.exists) return { ended: true };
    const user = uSnap.data();
    let wallet = Number(user.wallet || 0);

    const startMs = tsToMs(s.lastBilledAt) || tsToMs(s.startTime) || nowMs();
    const elapsedSec = Math.max(0, Math.floor((nowMs() - startMs) / 1000));
    if (elapsedSec <= 0) return { ended: false };

    // First-session free seconds (blueprint 6.11 / settings/config).
    let freeLeft = s.freeSecondsRemaining;
    if (freeLeft === undefined) {
      if (s.type === 'chat' && !user.hasUsedFreeChat)
        freeLeft = cfg.free_chat_seconds;
      else if (s.type !== 'chat' && !user.hasUsedFreeCall)
        freeLeft = cfg.free_call_seconds;
      else freeLeft = 0;
    }
    const freeApplied = Math.min(freeLeft, elapsedSec);
    const billableSec = elapsedSec - freeApplied;

    const rate = Number(s.ratePerSecond || 0);
    let deduct = money(rate * billableSec);
    if (deduct > wallet) deduct = money(wallet); // never negative

    const newWallet = money(wallet - deduct);

    t.update(uRef, { wallet: newWallet, isOnCall: true });
    t.update(sRef, {
      lastBilledAt: FieldValue.serverTimestamp(),
      duration: Number(s.duration || 0) + elapsedSec,
      cost: money(Number(s.cost || 0) + deduct),
      freeSecondsRemaining: freeLeft - freeApplied,
    });
    if (deduct > 0) {
      // Hard Rule 6, a transaction for every wallet change.
      t.set(db.collection('transactions').doc(), {
        userId: s.userId,
        amount: -deduct,
        type: 'debit',
        reason: 'session',
        referenceId: sessionId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { ended: newWallet <= 0 };
  });
}

// Finalise a session: settle, compute commission + astrologer earnings,
// revert statuses. Idempotent, safe to call from anywhere.
async function endSessionInternal(sessionId, endedBy = 'system') {
  // Settle the final partial interval first.
  try { await billSessionOnce(sessionId); } catch (_) {}

  const cfg = await getConfig();
  await db.runTransaction(async (t) => {
    const sRef = db.collection('sessions').doc(sessionId);
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const s = sSnap.data();
    if (s.status === 'ended') return; // idempotent

    const astroRef = db.collection('astrologers').doc(s.astroId);
    const aSnap = await t.get(astroRef);

    // Per-astrologer commission override falls back to global config.
    const commissionPct = aSnap.exists && aSnap.data().commissionPercent != null
      ? Number(aSnap.data().commissionPercent)
      : cfg.commission_percent;

    const cost = money(s.cost || 0);
    const adminEarning = money(cost * (commissionPct / 100));
    const astrologerEarning = money(cost - adminEarning);

    t.update(sRef, {
      status: 'ended',
      endTime: FieldValue.serverTimestamp(),
      commissionPercent: commissionPct,
      adminEarning,
      astrologerEarning,
      endedBy,
    });

    if (aSnap.exists) {
      t.update(astroRef, {
        earnings: money(Number(aSnap.data().earnings || 0) + astrologerEarning),
        status: 'online',           // revert busy -> online (blueprint 5.5)
        totalSessions: FieldValue.increment(1),
      });
    }

    // Clear in-session flags + mark free usage consumed.
    const uRef = db.collection('users').doc(s.userId);
    const uSnap = await t.get(uRef);
    if (uSnap.exists) {
      const patch = { isOnCall: false };
      const usedFree =
        s.freeSecondsRemaining !== undefined &&
        Number(s.cost || 0) >= 0; // free was at least partially offered
      if (usedFree && s.type === 'chat') patch.hasUsedFreeChat = true;
      if (usedFree && s.type !== 'chat') patch.hasUsedFreeCall = true;
      t.update(uRef, patch);
    }
    const astroUserRef = db.collection('users').doc(s.astroId);
    const auSnap = await t.get(astroUserRef);
    if (auSnap.exists) t.update(astroUserRef, { isOnCall: false });
  });
  return { success: true };
}

// pubsub schedule, free-tier resolution is 1 minute; billing is computed
// from real elapsed time so a coarse tick still bills accurately.
exports.billingEngine = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    const snap = await db.collection('sessions')
      .where('status', '==', 'active').get();
    for (const doc of snap.docs) {
      try {
        const { ended } = await billSessionOnce(doc.id);
        if (ended) await endSessionInternal(doc.id, 'balance-zero');
      } catch (e) {
        console.error('billing error', doc.id, e);
      }
    }
    return null;
  });

exports.endSession = functions.https.onCall(async (data, context) => {
  if (!data || !data.sessionId) throw new functions.https.HttpsError(
    'invalid-argument', 'sessionId required');
  const by = context.auth ? context.auth.uid : 'system';
  return endSessionInternal(data.sessionId, by);
});

// requesting > 65s with no astrologer action -> missed (blueprint 4.10).
exports.sessionTimeout = functions.pubsub
  .schedule('every 2 minutes')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 65 * 1000);
    const snap = await db.collection('sessions')
      .where('status', '==', 'requesting').get();
    const batch = db.batch();
    snap.docs.forEach((d) => {
      const created = d.data().createdAt;
      if (created && created.toDate && created.toDate() < cutoff) {
        batch.update(d.ref, { status: 'missed' });
      }
    });
    await batch.commit();
    return null;
  });

module.exports.endSessionInternal = endSessionInternal;
module.exports.billSessionOnce = billSessionOnce;
