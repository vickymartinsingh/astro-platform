// sessionService, blueprint 8.2 & Section 7 (session lifecycle).
// States: requesting -> accepted -> active -> ended | rejected | missed
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where,
  getDocs, serverTimestamp, runTransaction, addDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase.js';
import { sendPushToUser } from './pushService.js';
import { notifyWallet } from './walletNotify.js';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function getConfig() {
  try {
    const s = await getDoc(doc(db, 'settings', 'config'));
    return s.exists() ? s.data() : {};
  } catch { return {}; }
}

// DEMO settlement (no Cloud Functions). Phase 1: when the session ends,
// the CLIENT pays. Charges the client wallet for the connected time
// (respecting any free seconds), records a debit transaction, and writes
// the computed astrologer earning onto the session for the astrologer to
// collect in phase 2.
export async function endAndSettleClient(sessionId) {
  const sRef = doc(db, 'sessions', sessionId);
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) return;
  const s = sSnap.data();
  if (s.clientSettled) return;
  if (!['accepted', 'active', 'requesting'].includes(s.status)
      && s.status !== 'ended') return;

  const cfg = await getConfig();
  // BILLING RULE: a client is charged ONLY for time after the astrologer
  // accepted (which sets startTime). No startTime => the consultation
  // never actually connected => duration 0 => cost 0. Never fall back to
  // the request-creation time (that billed people who were never
  // connected / cancelled).
  const startMs = s.startTime?.toMillis ? s.startTime.toMillis()
    : (s.startTime instanceof Date ? s.startTime.getTime() : 0);
  const endMs = s.endTime?.toMillis ? s.endTime.toMillis() : Date.now();
  let duration = startMs > 0
    ? Math.max(0, Math.floor((endMs - startMs) / 1000)) : 0;

  // GRACE PERIOD: if the consultation lasted under 40 seconds (dropped
  // call / quick disconnect) the client is NOT charged at all. duration
  // is recorded for history but billing is zero.
  const GRACE_SECS = 40;
  const undersGrace = duration < GRACE_SECS;

  // Free seconds apply ONLY to the user's one eligible first session.
  const freeSecs = !s.freeEligible ? 0 : (s.type === 'chat'
    ? Number(cfg.free_chat_seconds || 0)
    : Number(cfg.free_call_seconds || 0));
  const billableSecs = undersGrace
    ? 0 : Math.max(0, duration - freeSecs);
  // Billed PER MINUTE (any started minute counts as a full minute).
  const billedMinutes = Math.ceil(billableSecs / 60);
  const perMin = Number(s.pricePerMinute
    || Math.round(Number(s.ratePerSecond || 0) * 60));

  let cost = round2(perMin * billedMinutes);

  // Per-astrologer commission overrides the global default.
  let commissionPct = Number(cfg.commission_percent ?? 30);
  try {
    const a = await getDoc(doc(db, 'astrologers', s.astroId));
    if (a.exists() && a.data().commissionPercent != null) {
      commissionPct = Number(a.data().commissionPercent);
    }
  } catch (_) {}

  await runTransaction(db, async (t) => {
    const uRef = doc(db, 'users', s.userId);
    const uSnap = await t.get(uRef);
    const wallet = Number((uSnap.data() || {}).wallet || 0);
    if (cost > wallet) cost = round2(wallet); // never negative
    const astrologerEarning = round2(cost * (1 - commissionPct / 100));

    if (cost > 0) {
      t.update(uRef, { wallet: round2(wallet - cost) });
      t.set(doc(collection(db, 'transactions')), {
        userId: s.userId, amount: -cost, type: 'debit',
        reason: 'session', referenceId: sessionId,
        createdAt: serverTimestamp(),
      });
    }
    t.update(sRef, {
      status: 'ended', endTime: serverTimestamp(),
      duration, cost, commissionPercent: commissionPct,
      astrologerEarning, clientSettled: true,
    });
  });
  if (cost > 0) {
    await notifyWallet(s.userId, -cost,
      `${s.type || 'consultation'} consultation`);
  }
}

// Phase 2: the astrologer collects their post-commission earning into
// their own wallet + earnings (runs when they view ended sessions).
export async function collectAstrologerEarnings(astroUid) {
  const snap = await getDocs(query(collection(db, 'sessions'),
    where('astroId', '==', astroUid), where('status', '==', 'ended')));
  let collected = 0;
  for (const d of snap.docs) {
    const s = d.data();
    const earn = Number(s.astrologerEarning || 0);
    if (s.astroSettled || earn <= 0) continue;
    try {
      await runTransaction(db, async (t) => {
        const aRef = doc(db, 'astrologers', astroUid);
        const uRef = doc(db, 'users', astroUid);
        const sRef = doc(db, 'sessions', d.id);
        const [aS, uS, sS] = await Promise.all(
          [t.get(aRef), t.get(uRef), t.get(sRef)]);
        if ((sS.data() || {}).astroSettled) return;
        t.set(aRef, {
          earnings: round2(Number((aS.data() || {}).earnings || 0) + earn),
          totalSessions: Number((aS.data() || {}).totalSessions || 0) + 1,
        }, { merge: true });
        if (uS.exists()) {
          t.update(uRef, {
            wallet: round2(Number(uS.data().wallet || 0) + earn) });
        }
        t.set(doc(collection(db, 'transactions')), {
          userId: astroUid, amount: earn, type: 'credit',
          reason: 'earning', referenceId: d.id,
          createdAt: serverTimestamp(),
        });
        t.update(sRef, { astroSettled: true });
      });
      collected += earn;
      await notifyWallet(astroUid, earn, 'consultation earning');
    } catch (_) {}
  }
  // Session(s) finished, so the astrologer is available again.
  try {
    const aRef = doc(db, 'astrologers', astroUid);
    const aSnap = await getDoc(aRef);
    if (aSnap.exists() && aSnap.data().status === 'busy') {
      await updateDoc(aRef, { status: 'online' });
    }
    await updateDoc(doc(db, 'users', astroUid), { isOnCall: false })
      .catch(() => {});
  } catch (_) {}
  return collected;
}

// createSessionRequest: wallet sufficiency MUST be re-checked server-side
// before billing starts; this only creates the request record.
export async function createSessionRequest(data) {
  const ref = doc(collection(db, 'sessions'));
  const ratePerMin = Number(data.pricePerMinute || 0);
  // First-session-free is a ONE-TIME perk: it applies only if this user
  // has never started a session before. We snapshot the decision onto the
  // session (freeEligible) and immediately mark the user as having used
  // their free session, so even a 1-minute first chat consumes it and the
  // FREE badge never shows for them again.
  // Admin controls (settings/config): free_enabled master switch,
  // free_scope ('new' = only first-time users | 'all' = every user gets
  // one free session), and free_grant_uids = a curated list (uid / phone
  // / email) that ALWAYS gets a free session until the admin removes them
  // (for old or specific users). Defaults preserve current behaviour.
  let freeEligible = false;
  try {
    const cfg = await getConfig();
    if (cfg.free_enabled !== false) {
      const uRef = doc(db, 'users', data.userId);
      const uSnap = await getDoc(uRef);
      const u = uSnap.exists() ? uSnap.data() : {};
      const grant = (Array.isArray(cfg.free_grant_uids)
        ? cfg.free_grant_uids : []).map((x) => String(x).trim()
        .toLowerCase()).filter(Boolean);
      const ids = [data.userId, u.phone, u.email]
        .filter(Boolean).map((x) => String(x).trim().toLowerCase());
      if (grant.some((g) => ids.includes(g))) {
        freeEligible = true;            // specific user: always free
      } else {
        // 'new' (default) and 'all' are both one-time per user here.
        freeEligible = !u.freeUsed;
        if (freeEligible) await updateDoc(uRef, { freeUsed: true });
      }
    }
  } catch (_) { freeEligible = false; }
  await setDoc(ref, {
    userId: data.userId,
    astroId: data.astroId,
    type: data.type,                       // chat | call | video
    purpose: data.purpose || '',
    kundliId: data.kundliId || null,
    ratePerSecond: ratePerMin / 60,
    pricePerMinute: ratePerMin,
    status: 'requesting',
    freeEligible,
    duration: 0,
    cost: 0,
    createdAt: serverTimestamp(),
  });
  // Lock-screen "incoming call" push to the astrologer. data.kind +
  // channelId tell the relay/app to treat it as a high-priority call
  // (calls channel, ring sound, heads-up) and the app to open the
  // full-screen incoming-call screen.
  const clientName = await resolveName(data.userId) || 'A client';
  const tLabel = data.type === 'video' ? 'video call'
    : data.type === 'call' ? 'voice call' : 'chat';
  sendPushToUser({
    toUid: data.astroId,
    title: `${clientName} is calling`,
    body: `Incoming ${tLabel} on AstroConnect. Tap to answer.`,
    priority: 'high',
    data: {
      type: 'session',
      kind: 'incoming_call',
      sessionId: ref.id,
      sessionType: data.type,
      route: '/astro-dashboard',
      from: clientName,
      channelId: 'astro-calls',
    },
  });
  return ref.id;
}

// Resolve a display name (astrologer profile first, then user record).
async function resolveName(uid) {
  try {
    const a = await getDoc(doc(db, 'astrologers', uid));
    if (a.exists() && a.data().name) return a.data().name;
  } catch (_) {}
  try {
    const u = await getDoc(doc(db, 'users', uid));
    if (u.exists() && u.data().name) return u.data().name;
  } catch (_) {}
  return '';
}

export async function updateSessionStatus(id, status, extra = {}) {
  await updateDoc(doc(db, 'sessions', id), { status, ...extra });
  // When the astrologer accepts, alert the client on their lock screen.
  if (status === 'accepted') {
    try {
      const s = (await getDoc(doc(db, 'sessions', id))).data();
      if (s && s.userId) {
        const astroName = await resolveName(s.astroId) || 'Your astrologer';
        sendPushToUser({
          toUid: s.userId,
          title: `${astroName} accepted your ${s.type || ''}`.trim(),
          body: `${astroName} is ready - your ${s.type || ''} `
            + 'consultation is starting.',
          data: { type: 'session', sessionId: id, route: '/dashboard',
            from: astroName },
        });
      }
    } catch (_) { /* best-effort */ }
  }
}

// Generic patch (e.g. mark introSent) without touching status.
export async function setSessionMeta(id, data) {
  await updateDoc(doc(db, 'sessions', id), data || {});
}

export async function getSession(id) {
  const snap = await getDoc(doc(db, 'sessions', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function listenSession(id, callback) {
  return onSnapshot(doc(db, 'sessions', id), (s) =>
    callback(s.exists() ? { id: s.id, ...s.data() } : null));
}

// endSession: authoritative finaliser runs in the Cloud Function
// (computes duration, cost, commission, astrologer earnings, reverts
// astrologer status). The browser only requests the end.
export async function endSession(id) {
  const fn = httpsCallable(functions, 'endSession');
  const res = await fn({ sessionId: id });
  return res.data;
}

// An astrologer listens for incoming requests addressed to them.
// Single equality filter (auto-indexed); status filtered client-side so
// no composite index is needed.
export function listenIncomingRequests(astroId, callback) {
  const q = query(
    collection(db, 'sessions'),
    where('astroId', '==', astroId),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.status === 'requesting')));
}

// Live "current sessions" for the astrologer: anything still actionable
// (incoming requesting + accepted + active) so they never miss a call
// or chat.
export function listenActiveForAstro(astroId, callback) {
  const q = query(
    collection(db, 'sessions'),
    where('astroId', '==', astroId),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => ['requesting', 'accepted', 'active']
        .includes(s.status))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0)
        - (a.createdAt?.toMillis?.() || 0))));
}

const byCreatedDesc = (a, b) =>
  (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

export async function getUserSessions(userId, type) {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
  );
  const snap = await getDocs(q);
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort(byCreatedDesc);
  if (type) list = list.filter((s) => s.type === type);
  return list;
}

export async function getAstrologerSessions(astroId) {
  const q = query(
    collection(db, 'sessions'),
    where('astroId', '==', astroId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort(byCreatedDesc);
}
