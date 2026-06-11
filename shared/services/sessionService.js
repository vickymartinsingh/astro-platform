// sessionService, blueprint 8.2 & Section 7 (session lifecycle).
// States: requesting -> accepted -> active -> ended | rejected | missed
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where,
  getDocs, serverTimestamp, runTransaction, addDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, getFunctionsLazy } from '../firebase.js';
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
// Generate an unused 8-digit numeric session id. The numeric form is
// what every customer- and admin-facing surface (consultations,
// admin-recordings, support tickets) shows; the Firestore doc id IS
// this number, so there is no parallel id mapping table.
//
// 8 digits = 9*10^7 = 90 million possible ids. With a few thousand
// sessions in flight the collision probability per draw is tiny, but
// we still do a getDoc collision check + retry (max 6) so a launch
// surge can never duplicate. Existing pre-migration sessions keep
// their Firestore-autogenerated ids - both lookup paths coexist.
//
// Session id format: ONE letter prefix + 8-digit number. The letter
// makes the type readable at a glance in admin lists + receipts:
//   T<8digits> -> Talk (voice call)
//   C<8digits> -> Chat
//   V<8digits> -> Video
//   L<8digits> -> Live
//   O<8digits> -> Order (kundli PDF order)
// Unknown / legacy types fall back to plain numeric id.
function typePrefix(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'call' || t === 'voice' || t === 'talk') return 'T';
  if (t === 'chat') return 'C';
  if (t === 'video') return 'V';
  if (t === 'live') return 'L';
  if (t === 'order') return 'O';
  return '';
}
async function newSessionId(type) {
  const p = typePrefix(type);
  for (let i = 0; i < 6; i += 1) {
    // Strong random across 10000000-99999999.
    const n = 10000000 + Math.floor(Math.random() * 90000000);
    const id = `${p}${n}`;
    // eslint-disable-next-line no-await-in-loop
    const snap = await getDoc(doc(db, 'sessions', id));
    if (!snap.exists()) return id;
  }
  // Truly impossible-statistically fallback: append a millis suffix so
  // we never block the customer. Still letter+numeric.
  return `${p}${String(Date.now()).slice(-9)}`;
}

export async function createSessionRequest(data) {
  const sid = await newSessionId(data.type);
  const ref = doc(db, 'sessions', sid);
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
    body: `Incoming ${tLabel} on AstroSeer. Tap to answer.`,
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
  const update = { status, ...extra };
  // ALWAYS stamp startTime with serverTimestamp() when a session goes
  // active, overriding any client-supplied Date. Reasons:
  //   1. serverTimestamp() is resolved on the Firestore server so it
  //      cannot be off by device clock skew.
  //   2. The manual-accept path passes { startTime: new Date() }
  //      which is fine, but serverTimestamp() is more reliable.
  //   3. The auto-accept path uses .catch(()=>{}) so if the write
  //      silently fails, startTime stays null and endAndSettleClient
  //      computes duration=0 and charges nothing.
  // Billing depends entirely on startTime, so we force it here.
  if (status === 'active') {
    update.startTime = serverTimestamp();
  }
  await updateDoc(doc(db, 'sessions', id), update);
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

// Stamp the customer's last activity on the session. Called from the
// chat screen on every send (text or image) so the server-side
// inactivity guard knows the user is alive. Failure is non-fatal -
// the chat continues even if the stamp fails, the server-side cron
// is the safety net.
export async function stampCustomerActivity(sessionId) {
  if (!sessionId) return;
  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      lastCustomerActivityAt: serverTimestamp(),
    });
  } catch (_) { /* best effort */ }
}

// Force-end a chat session because the customer went idle for 3 mins
// (CHAT_IDLE_MS on the relay). Server is authoritative: it reads
// lastCustomerActivityAt and refuses if the customer was active
// within the threshold, so a rogue client can never trigger this.
// Server also handles the no-activity refund + same-session-id
// transaction so the customer can trace it in their statement.
export async function endChatForInactivity(sessionId) {
  if (!sessionId) throw new Error('Missing session id');
  const baseEnv = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  const base = baseEnv
    || 'https://astro-platform-push-relay.vercel.app/api/sendPush';
  const url = base.replace(/\/sendPush\/?$/, '/kundli')
    + '?action=endChatForInactivity';
  let idToken = '';
  try {
    const mod = await import('../firebase.js');
    const u = mod.auth && mod.auth.currentUser;
    if (u && u.getIdToken) idToken = await u.getIdToken();
  } catch (_) {}
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ sessionId }),
  });
  return res.json().catch(() => ({}));
}

// endSession: authoritative finaliser runs in the Cloud Function
// (computes duration, cost, commission, astrologer earnings, reverts
// astrologer status). The browser only requests the end.
export async function endSession(id) {
  const fns = await getFunctionsLazy();
  if (!fns) throw new Error('Cloud Functions unavailable.');
  const fn = httpsCallable(fns, 'endSession');
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

// Live: a CUSTOMER's in-flight sessions (requesting / accepted / active)
// so the app can show a "rejoin your session" bar if they navigate away
// from a live chat/call by accident.
export function listenActiveForUser(userId, callback) {
  if (!userId) { if (callback) callback([]); return () => {}; }
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => ['requesting', 'accepted', 'active']
        .includes(s.status))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0)
        - (a.createdAt?.toMillis?.() || 0))), () => {});
}

const byCreatedDesc = (a, b) =>
  (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

// ---- Refunds (astrologer- or admin-initiated) -----------------------
// Standard reasons surfaced as a dropdown in the apps.
export const REFUND_REASONS = [
  'Technical issue',
  'Astrologer unavailable',
  'Poor network / disconnection',
  'Customer request',
  'Duplicate / accidental session',
  'Quality not as expected',
  'Other',
];

// Short, human Ref no for a session (used in dropdowns and receipts).
export function sessionRefNo(idOrSession) {
  const id = typeof idOrSession === 'string'
    ? idOrSession : (idOrSession && idOrSession.id) || '';
  if (!id) return '';
  // CURRENT format: ONE letter prefix (T/C/V/L/O) + 8-digit number,
  // shown in full so the customer-facing ref encodes the type
  // (TALK / CHAT / VIDEO / LIVE / ORDER) at a glance.
  if (/^[TCVLO]\d{6,12}$/.test(id)) return id;
  // EARLIER 8-digit numeric format, also shown in full.
  if (/^\d{6,12}$/.test(id)) return id;
  // LEGACY Firestore-autogenerated UUIDs - sliced to the last 6
  // chars + uppercased so old receipts stay recognisable.
  return id.slice(-6).toUpperCase();
}

// Astrologer or admin asks for a full refund of an ended consultation.
// Writes the request onto the session (already writable by both via
// rules) and drops a notification for admin review. The wallet credit
// runs from processRefund (admin-only, matches Firestore rules).
export async function requestRefund(sessionId, byUid, byRole, reason) {
  if (!sessionId || !byUid) return;
  const r = String(reason || 'Other').slice(0, 120);
  await updateDoc(doc(db, 'sessions', sessionId), {
    refundRequested: true,
    refundRequest: {
      by: byUid,
      byRole: byRole || 'astrologer',
      reason: r,
      requestedAt: serverTimestamp(),
      status: 'pending',
    },
  });
  try {
    await addDoc(collection(db, 'notifications'), {
      type: 'refund_request',
      title: 'Refund request',
      body: `${byRole || 'Astrologer'} requested a refund for `
        + `session #${sessionRefNo(sessionId)} - ${r}`,
      sessionId,
      requestedBy: byUid,
      toRole: 'admin',
      createdAt: serverTimestamp(),
      read: false,
    });
  } catch (_) { /* notifications best-effort */ }
}

// Astrologer-initiated INSTANT refund. The relay verifies the caller's
// Firebase ID token, confirms they are the session's astroId (or an
// admin), and runs the credit + ledger + session update atomically
// with the Admin SDK - so the customer wallet is credited NOW. The
// admin notification is dropped server-side too for the record.
// Falls back to requestRefund (pending queue) if the relay endpoint
// isn't reachable, so the call never fails silently.
export async function instantRefund(sessionId, reason) {
  if (!sessionId) throw new Error('Missing session id');
  // Resolve endpoint from the push endpoint (same Vercel deployment).
  const baseEnv = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  const base = baseEnv
    || 'https://astro-platform-push-relay.vercel.app/api/sendPush';
  const url = base.replace(/\/sendPush\/?$/, '/refund');

  // Get a fresh Firebase ID token from the SDK in this app.
  let idToken = '';
  try {
    const mod = await import('../firebase.js');
    const u = mod.auth && mod.auth.currentUser;
    if (u && u.getIdToken) idToken = await u.getIdToken();
  } catch (_) { /* ignore */ }
  if (!idToken) throw new Error('Not signed in');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ sessionId, reason: reason || 'Other' }),
    });
  } catch (e) {
    // Network/CORS/endpoint missing - record as pending so admin sees it.
    await requestRefund(sessionId,
      (await import('../firebase.js')).auth.currentUser.uid,
      'astrologer', reason);
    return { ok: false, queued: true, refunded: 0 };
  }
  if (!res.ok) {
    await requestRefund(sessionId,
      (await import('../firebase.js')).auth.currentUser.uid,
      'astrologer', reason);
    return { ok: false, queued: true, status: res.status, refunded: 0 };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, refunded: Number(data.refunded || 0),
    already: !!data.already };
}

// Live admin queue: all sessions with a pending refund request.
export function listenPendingRefunds(callback) {
  return onSnapshot(
    query(collection(db, 'sessions'),
      where('refundRequested', '==', true)),
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const pending = all.filter((s) => (s.refundRequest
        && s.refundRequest.status === 'pending'));
      if (callback) callback(pending);
    }, () => {});
}

// Admin-only: process a pending refund. Credits the customer wallet
// (atomic), records the transaction, marks refundRequest.status as
// processed. Idempotent on a processed refund.
export async function processRefund(sessionId, adminUid) {
  if (!sessionId) throw new Error('Missing session id');
  const sRef = doc(db, 'sessions', sessionId);
  const result = await runTransaction(db, async (t) => {
    const s = await t.get(sRef);
    if (!s.exists()) throw new Error('Session not found');
    const d = s.data();
    const status = d.refundRequest && d.refundRequest.status;
    if (status === 'processed') return { refunded: 0, already: true };
    const cost = Number(d.cost || 0);
    if (cost > 0 && d.userId) {
      const uRef = doc(db, 'users', d.userId);
      const u = await t.get(uRef);
      const w = Number((u.data() || {}).wallet || 0) + cost;
      t.update(uRef, { wallet: w });
      t.set(doc(collection(db, 'transactions')), {
        userId: d.userId, amount: cost, type: 'credit',
        reason: 'refund', referenceId: sessionId,
        createdAt: serverTimestamp(),
      });
    }
    t.update(sRef, {
      'refundRequest.status': 'processed',
      'refundRequest.processedBy': adminUid || 'admin',
      'refundRequest.processedAt': serverTimestamp(),
      refundedAmount: cost,
    });
    return { refunded: cost, already: false };
  });
  if (result.refunded > 0) {
    try {
      const fresh = await getDoc(sRef);
      await notifyWallet((fresh.data() || {}).userId,
        result.refunded, 'Refund for your consultation');
    } catch (_) { /* notify best-effort */ }
  }
  return result;
}

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
