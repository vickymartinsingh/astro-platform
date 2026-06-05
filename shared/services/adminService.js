// adminService, blueprint 8.2 & Section 6.
// Each privileged action TRIES the Cloud Function first; if Functions are
// not deployed (Spark / no Blaze) it falls back to a direct Firestore
// write. Firestore rules permit these writes for users whose role=admin,
// so the admin panel is fully functional without Cloud Functions.
import {
  collection, query, where, orderBy, getDocs, limit, doc, getDoc, setDoc,
  updateDoc, addDoc, runTransaction, serverTimestamp, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, sendEmailVerification,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { db, auth, getFunctionsLazy } from '../firebase.js';
import { sendPushToUser } from './pushService.js';
import { notifyWallet } from './walletNotify.js';

// NOTE: Next.js only inlines the LITERAL `process.env.NEXT_PUBLIC_*`
// expression at build time. Reading it through an alias (const env =
// process.env; env.NEXT_PUBLIC_X) is NOT replaced and is undefined in
// the static/APK build. So we must reference it directly.
function pushEndpoint() {
  return (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
}

// Relay endpoint for admin tools. Now points at /api/adminTools (a
// multi-tool dispatcher) - old /api/adminUser was merged into it so
// the relay stays under Vercel Hobby's 12-function cap.
function adminRelay() {
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_ADMIN_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = pushEndpoint();
  return push ? push.replace(/\/sendPush\/?$/, '/adminTools') : '';
}

// Change a user's LOGIN email / password (Firebase Auth) via the relay,
// authenticated with the current admin's Firebase ID token.
export async function adminUpdateAuthUser(uid, { email, password } = {}) {
  const url = adminRelay();
  if (!url) {
    throw new Error('Email-change service not configured. Set '
      + 'NEXT_PUBLIC_PUSH_ENDPOINT and deploy the relay.');
  }
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Not signed in.');
  // Need ADMIN_RELAY_KEY for the multi-tool endpoint. Falls back to
  // empty string for setups still relying on idToken-only auth.
  const relayKey = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_ADMIN_RELAY_KEY) || '';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(relayKey ? { 'x-admin-key': relayKey } : {}),
    },
    body: JSON.stringify({ tool: 'updateUser', uid, email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Update failed');
  return j;
}

async function tryCloud(name, payload, local) {
  try {
    const fns = await getFunctionsLazy();
    if (!fns) return local();
    const fn = httpsCallable(fns, name);
    return (await fn(payload)).data;
  } catch (e) {
    // Functions unavailable or errored, do it client-side (admin-gated).
    return local();
  }
}

export async function getAllUsers(filters = {}) {
  const snap = await getDocs(query(collection(db, 'users'),
    orderBy('createdAt', 'desc')));
  let list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  if (filters.role) list = list.filter((u) => u.role === filters.role);
  if (filters.status) list = list.filter((u) => u.status === filters.status);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    list = list.filter((u) =>
      (u.name || '').toLowerCase().includes(s) ||
      (u.email || '').toLowerCase().includes(s) ||
      String(u.userCode || '').includes(s));
  }
  return list;
}

export async function getAllTransactions(filters = {}) {
  const snap = await getDocs(query(collection(db, 'transactions'),
    orderBy('createdAt', 'desc'), limit(500)));
  let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (filters.type) list = list.filter((t) => t.type === filters.type);
  if (filters.reason) list = list.filter((t) => t.reason === filters.reason);
  return list;
}

export function blockUser(uid, blocked = true) {
  return tryCloud('adminBlockUser', { uid, blocked }, async () => {
    await updateDoc(doc(db, 'users', uid), {
      isBlocked: !!blocked, status: blocked ? 'suspended' : 'active' });
    return { success: true };
  });
}

// Merge two user accounts.
//
// Two customers were independently created (a common situation when
// someone signs up via email once, loses access to the email, then
// signs up again via phone). Admin picks PRIMARY (the survivor) and
// SECONDARY (the one being absorbed) + an optional `picks` map that
// says which value wins for each shared field (e.g. picks.email =
// 'secondary' means the survivor takes the secondary's email).
//
// What happens:
//   1. Wallet balances are summed onto primary; a transaction row
//      records the move.
//   2. sessions, transactions, kundliProfiles, reviews are RE-
//      assigned: secondary uid is rewritten to the primary uid.
//      Each collection is paged in batches of 400.
//   3. orders subcollection is copied from users/{sec}/orders to
//      users/{pri}/orders. Originals stay until secondary is
//      tombstoned.
//   4. Optional field picks are applied to the primary user doc.
//      Default = primary keeps its existing values; admin can flip
//      any field to take the secondary's value instead.
//   5. Secondary user doc is tombstoned with
//      status='merged_into:<primary uid>' so ensureUserDoc kicks
//      the auth user out on next sign-in (no resurrection).
//
// Returns { success, movedSessions, movedTxns, movedKundli,
//          movedOrders, walletMoved }.
export async function mergeAccounts(primaryUid, secondaryUid, picks = {}) {
  if (!primaryUid || !secondaryUid) {
    throw new Error('Both primary and secondary uids are required.');
  }
  if (primaryUid === secondaryUid) {
    throw new Error('Primary and secondary cannot be the same uid.');
  }
  return tryCloud('adminMergeAccounts',
    { primaryUid, secondaryUid, picks }, async () => {
      const pRef = doc(db, 'users', primaryUid);
      const sRef = doc(db, 'users', secondaryUid);
      const [pSnap, sSnap] = await Promise.all([
        getDoc(pRef), getDoc(sRef),
      ]);
      if (!pSnap.exists()) throw new Error('Primary user not found.');
      if (!sSnap.exists()) {
        throw new Error('Secondary user not found.');
      }
      const p = pSnap.data();
      const s = sSnap.data();

      // 1) Wallet move.
      const sWallet = Number(s.wallet || 0);
      const pWallet = Number(p.wallet || 0);
      const newWallet = pWallet + Math.max(0, sWallet);
      let walletMoved = 0;
      if (sWallet > 0) {
        await updateDoc(pRef, { wallet: newWallet });
        try {
          await addDoc(collection(db, 'transactions'), {
            userId: primaryUid,
            amount: sWallet,
            type: 'credit',
            reason: `merge_from:${secondaryUid}`,
            referenceId: secondaryUid,
            createdAt: serverTimestamp(),
          });
        } catch (_) { /* swallow */ }
        walletMoved = sWallet;
      }

      // 2) Reassign sessions / transactions / kundliProfiles /
      //    reviews to the primary uid.
      async function reassign(name, field = 'userId') {
        let moved = 0;
        const snap = await getDocs(query(collection(db, name),
          where(field, '==', secondaryUid)));
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => {
            batch.update(d.ref, { [field]: primaryUid });
          });
          // eslint-disable-next-line no-await-in-loop
          await batch.commit();
          moved += Math.min(400, docs.length - i);
        }
        return moved;
      }
      const movedSessions = await reassign('sessions', 'userId');
      const movedTxns = await reassign('transactions', 'userId');
      const movedKundli = await reassign('kundliProfiles', 'userId');
      try { await reassign('reviews', 'userId'); } catch (_) {}

      // 3) Copy secondary's orders subcollection into primary's.
      //    Orders sit under users/<uid>/orders so they don't have a
      //    flat userId field; we walk them by hand.
      let movedOrders = 0;
      try {
        const oSnap = await getDocs(collection(db,
          'users', secondaryUid, 'orders'));
        const oDocs = oSnap.docs;
        for (let i = 0; i < oDocs.length; i += 400) {
          const batch = writeBatch(db);
          oDocs.slice(i, i + 400).forEach((d) => {
            batch.set(doc(db, 'users', primaryUid, 'orders', d.id),
              d.data(), { merge: true });
          });
          // eslint-disable-next-line no-await-in-loop
          await batch.commit();
          movedOrders += Math.min(400, oDocs.length - i);
        }
      } catch (_) { /* swallow - orders are nice-to-have */ }

      // 4) Apply field picks to the primary doc. Only the listed
      //    fields are updatable here; everything else stays as-is
      //    on the primary record.
      const FIELDS = ['name', 'email', 'phone', 'dob', 'tob',
        'placeOfBirth', 'gender', 'profileImage'];
      const patch = {};
      for (const f of FIELDS) {
        if (picks && picks[f] === 'secondary' && s[f] != null) {
          patch[f] = s[f];
        }
      }
      if (Object.keys(patch).length > 0) {
        await updateDoc(pRef, patch);
      }

      // 5) Tombstone secondary.
      try {
        await updateDoc(sRef, {
          status: `merged_into:${primaryUid}`,
          mergedAt: serverTimestamp(),
          isBlocked: true,
        });
      } catch (_) { /* swallow */ }
      // Remove astrologer marketplace listing if the secondary had one.
      try {
        await deleteDoc(doc(db, 'astrologers', secondaryUid));
      } catch (_) {}

      return {
        success: true,
        walletMoved,
        movedSessions,
        movedTxns,
        movedKundli,
        movedOrders,
      };
    });
}

// Permanently delete a user (and their astrologer profile if any).
//
// IMPORTANT: we do NOT hard-delete users/{uid}. Hard-deleting only
// removed the Firestore doc, but Firebase Auth still held the
// account. The next time that account signed in on ANY device, the
// client's ensureUserDoc() ran, saw a missing doc, and RECREATED it
// from scratch - the user reappeared in /admin-users like a ghost.
// That was the "I deleted them, they came back" bug.
//
// New behaviour: mark the doc with status='deleted' (and a tombstone
// timestamp). ensureUserDoc treats that as a hard NO and signs the
// account back out; admin lists hide it by default. The doc keeps
// the original uid so audit / archive recovery still resolves the
// account, and a future "Restore" admin action can flip the flag.
export function deleteUser(uid) {
  return tryCloud('adminDeleteUser', { uid }, async () => {
    try {
      await updateDoc(doc(db, 'users', uid), {
        status: 'deleted',
        deletedAt: serverTimestamp(),
        isBlocked: true,
      });
    } catch (e) {
      // Doc may not exist (rare) - fall back to create-as-tombstone
      // so a future ensureUserDoc still sees the status='deleted'
      // signal and refuses to recreate.
      try {
        await setDoc(doc(db, 'users', uid), {
          status: 'deleted',
          deletedAt: serverTimestamp(),
          isBlocked: true,
        }, { merge: true });
      } catch (_) { /* swallow */ }
    }
    // Astrologer doc, if any, is fully removed - the marketplace
    // listing must not surface a deleted account.
    try { await deleteDoc(doc(db, 'astrologers', uid)); } catch (_) {}
    return { success: true };
  });
}

// ---------------------------------------------------------------------
// ACCOUNT RESET (admin). Selectively wipe a user's / astrologer's data,
// or "reset as default" (everything + profile). Each part maps to the
// collections it owns. Direct, admin-gated Firestore writes (no Cloud
// Function needed). Returns a per-part count of deleted/updated docs.
// ---------------------------------------------------------------------
// The selectable categories shown in the admin UI.
export const RESET_PARTS = [
  ['chats', 'Chats & messages'],
  ['calls', 'Calls & video logs'],
  ['history', 'Consultation history (all sessions)'],
  ['kundli', 'Kundli profiles'],
  ['remedy', 'Remedies (astrologer)'],
  ['reviews', 'Reviews & ratings'],
  ['complaint', 'Complaints / disputes'],
  ['notification', 'Notifications'],
  ['transaction', 'All transactions'],
  ['recharge', 'Recharges'],
  ['refund', 'Refunds'],
  ['wallet', 'Wallet balance'],
  ['profile', 'Profile (reset to default)'],
];

// ---- Archive helpers --------------------------------------------------
// Every reset now writes the deleted docs into `archives/{archiveId}/items`
// FIRST, then deletes from the live collection. Restore reads the items
// back and rewrites them to their original paths.
async function archiveAndDeleteSnap(archiveId, coll, snap, filter) {
  const docs = snap.docs.filter((d) => !filter || filter(d.data() || {}));
  let n = 0;
  for (let i = 0; i < docs.length; i += 200) {
    const slice = docs.slice(i, i + 200);
    // 1) archive
    const aBatch = writeBatch(db);
    slice.forEach((d) => {
      const aRef = doc(collection(db, `archives/${archiveId}/items`));
      aBatch.set(aRef, { coll, docId: d.id, data: d.data() || {},
        archivedAt: serverTimestamp() });
    });
    await aBatch.commit();
    // 2) delete the originals
    const dBatch = writeBatch(db);
    slice.forEach((d) => { dBatch.delete(d.ref); n += 1; });
    await dBatch.commit();
  }
  return n;
}

async function archiveAndDeleteAll(archiveId, coll, qy) {
  const snap = await getDocs(qy);
  return archiveAndDeleteSnap(archiveId, coll, snap);
}

async function archiveAndDeleteSessions(archiveId, uid, types) {
  let n = 0;
  for (const field of ['userId', 'astroId']) {
    const snap = await getDocs(query(collection(db, 'sessions'),
      where(field, '==', uid)));
    n += await archiveAndDeleteSnap(archiveId, 'sessions', snap,
      (data) => !types || types.includes(data.type));
  }
  return n;
}

// Chats: archive each chat doc AND every message in its subcollection
// (we record coll = `chats/{chatId}/messages` so restore can put them
// back into the right subcollection).
async function archiveAndDeleteChats(archiveId, uid) {
  const snap = await getDocs(query(collection(db, 'chats'),
    where('participants', 'array-contains', uid)));
  let n = 0;
  for (const c of snap.docs) {
    try {
      const msgs = await getDocs(collection(db, 'chats', c.id, 'messages'));
      const subColl = `chats/${c.id}/messages`;
      for (let i = 0; i < msgs.docs.length; i += 200) {
        const slice = msgs.docs.slice(i, i + 200);
        const aBatch = writeBatch(db);
        slice.forEach((m) => {
          const aRef = doc(collection(db, `archives/${archiveId}/items`));
          aBatch.set(aRef, { coll: subColl, docId: m.id,
            data: m.data() || {},
            archivedAt: serverTimestamp() });
        });
        await aBatch.commit();
        const dBatch = writeBatch(db);
        slice.forEach((m) => dBatch.delete(m.ref));
        await dBatch.commit();
      }
    } catch (_) { /* ignore message wipe errors */ }
    try {
      const aRef = doc(collection(db, `archives/${archiveId}/items`));
      await setDoc(aRef, { coll: 'chats', docId: c.id,
        data: c.data() || {},
        archivedAt: serverTimestamp() });
      await deleteDoc(c.ref); n += 1;
    } catch (_) { /* ignore */ }
  }
  return n;
}

async function archiveAndDeleteTxns(archiveId, uid, match) {
  const snap = await getDocs(query(collection(db, 'transactions'),
    where('userId', '==', uid)));
  return archiveAndDeleteSnap(archiveId, 'transactions', snap, match);
}

// Reset one account. `parts` is an array of RESET_PARTS keys. `role`
// ('client'|'astrologer') decides which profile doc to reset. Every
// deleted doc is FIRST archived into archives/{archiveId}/items so admin
// can review and restore later via the archive browser.
export async function resetAccountData(uid, { role = 'client', parts = [],
  archiveId: providedArchive = null } = {}) {
  if (!uid) throw new Error('uid required');
  const want = new Set(parts);
  const out = {};

  // Create / reuse the archive doc up front so all this reset's deletions
  // are grouped together under one archiveId for clean restore.
  let archiveId = providedArchive;
  let archiveRef = null;
  if (!archiveId) {
    archiveRef = doc(collection(db, 'archives'));
    archiveId = archiveRef.id;
    await setDoc(archiveRef, {
      uid, role, parts: [...want], counts: {},
      createdAt: serverTimestamp(), restored: false,
    });
  }

  // Also snapshot the BEFORE state of any profile docs that "profile" or
  // "wallet" will mutate, so restore can put back the original profile +
  // wallet too.
  if (want.has('profile') || want.has('wallet') || want.has('remedy')) {
    try {
      const u = await getDoc(doc(db, 'users', uid));
      if (u.exists()) {
        const aRef = doc(collection(db, `archives/${archiveId}/items`));
        await setDoc(aRef, { coll: 'users', docId: uid,
          data: u.data(), archivedAt: serverTimestamp() });
      }
    } catch (_) { /* ignore */ }
    if (role === 'astrologer') {
      try {
        const a = await getDoc(doc(db, 'astrologers', uid));
        if (a.exists()) {
          const aRef = doc(collection(db, `archives/${archiveId}/items`));
          await setDoc(aRef, { coll: 'astrologers', docId: uid,
            data: a.data(), archivedAt: serverTimestamp() });
        }
      } catch (_) { /* ignore */ }
    }
  }

  if (want.has('chats')) {
    out.chats = await archiveAndDeleteChats(archiveId, uid);
  }
  if (want.has('history')) {
    out.history = await archiveAndDeleteSessions(archiveId, uid);
  } else if (want.has('calls')) {
    out.calls = await archiveAndDeleteSessions(archiveId, uid,
      ['call', 'video']);
  }
  if (want.has('kundli')) {
    out.kundli = await archiveAndDeleteAll(archiveId, 'kundliProfiles',
      query(collection(db, 'kundliProfiles'),
        where('userId', '==', uid)));
  }
  if (want.has('notification')) {
    out.notification = await archiveAndDeleteAll(archiveId,
      'notifications', query(collection(db, 'notifications'),
        where('userId', '==', uid)));
  }
  if (want.has('complaint')) {
    let n = 0;
    for (const field of ['userId', 'astroId']) {
      n += await archiveAndDeleteAll(archiveId, 'disputes',
        query(collection(db, 'disputes'), where(field, '==', uid)));
    }
    out.complaint = n;
  }
  if (want.has('reviews')) {
    let n = 0;
    for (const field of ['userId', 'astroId']) {
      try {
        n += await archiveAndDeleteAll(archiveId, 'reviews',
          query(collection(db, 'reviews'), where(field, '==', uid)));
      } catch (_) { /* ignore */ }
    }
    out.reviews = n;
  }
  if (want.has('transaction')) {
    out.transaction = await archiveAndDeleteTxns(archiveId, uid);
  } else {
    if (want.has('recharge')) {
      out.recharge = await archiveAndDeleteTxns(archiveId, uid, (t) =>
        /recharge|topup|top-up|add/i.test(`${t.type} ${t.reason}`));
    }
    if (want.has('refund')) {
      out.refund = await archiveAndDeleteTxns(archiveId, uid, (t) =>
        /refund/i.test(`${t.type} ${t.reason}`));
    }
  }
  if (want.has('remedy') && role === 'astrologer') {
    try {
      await updateDoc(doc(db, 'astrologers', uid), { remedies: [] });
      out.remedy = 1;
    } catch (_) { out.remedy = 0; }
  }
  if (want.has('wallet')) {
    try {
      await updateDoc(doc(db, 'users', uid), { wallet: 0 });
      if (role === 'astrologer') {
        try {
          await updateDoc(doc(db, 'astrologers', uid),
            { wallet: 0, earnings: 0 });
        } catch (_) {}
      }
      out.wallet = 0;
    } catch (_) {}
  }
  if (want.has('profile')) {
    // WALLET-ZERO REGRESSION FIX. This reset object used to include
    // `wallet: 0`, which meant ANY reset that touched the profile
    // part silently wiped the user's wallet while the admin's credit
    // history stayed intact - matching the operator's report of
    // "wallet shows zero but admin transactions show credit". The
    // 'wallet' reset part above is the ONLY place that should ever
    // zero the field; the profile reset must not.
    const reset = {
      name: '', gender: '', dob: '', tob: '', timeOfBirth: '',
      place: '', placeOfBirth: '', language: '', bio: '',
      profileImage: '', avatar: '', status: 'active',
      isBlocked: false, updatedAt: serverTimestamp(),
    };
    try { await updateDoc(doc(db, 'users', uid), reset); } catch (_) {}
    if (role === 'astrologer') {
      try {
        await updateDoc(doc(db, 'astrologers', uid), {
          remedies: [], bio: '', updatedAt: serverTimestamp(),
        });
      } catch (_) {}
    }
    out.profile = 1;
  }

  // Stamp summary on the archive (or merge into provided one).
  try {
    await setDoc(doc(db, 'archives', archiveId), {
      counts: out,
      lastUpdatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (_) {}

  return { success: true, uid, archiveId, parts: [...want], counts: out };
}

// Reset MANY accounts at once. `uids` (optional) limits it to a subset
// of clients/astrologers; if omitted, applies to every account of that
// role. Each uid gets its own archive doc so restore is per-account.
export async function resetAllAccounts({ role = 'client', parts = [],
  uids = null } = {}) {
  let targets;
  if (Array.isArray(uids) && uids.length) {
    targets = uids.map((u) => ({ uid: u }));
  } else {
    const users = await getAllUsers(
      role === 'astrologer' ? { role: 'astrologer' } : {});
    targets = role === 'astrologer' ? users
      : users.filter((u) => (u.role || 'client') === 'client');
  }
  let done = 0;
  const archiveIds = [];
  for (const u of targets) {
    try {
      const r = await resetAccountData(u.uid, { role, parts });
      if (r && r.archiveId) archiveIds.push(r.archiveId);
      done += 1;
    } catch (_) { /* continue */ }
  }
  return { success: true, total: targets.length, done, archiveIds };
}

// ---- Archive browser + restore ---------------------------------------
// List most-recent archives (admin "View resets / Restore" page).
export async function listArchives({ limit: lim = 50 } = {}) {
  const snap = await getDocs(query(collection(db, 'archives'),
    orderBy('createdAt', 'desc'), limit(lim)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Get a single archive doc + its items (the deleted records).
export async function getArchive(archiveId) {
  const meta = await getDoc(doc(db, 'archives', archiveId));
  if (!meta.exists()) return null;
  const items = await getDocs(
    collection(db, `archives/${archiveId}/items`));
  return {
    id: archiveId,
    ...meta.data(),
    items: items.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// Restore everything in an archive back to its original collections.
// Idempotent: re-restoring sets the same docs again. Marks archive
// `restored: true` so the UI can show its state.
export async function restoreArchive(archiveId) {
  const arch = await getArchive(archiveId);
  if (!arch) throw new Error('Archive not found.');
  let restored = 0;
  for (const item of arch.items || []) {
    if (!item.coll || !item.docId || !item.data) continue;
    try {
      // coll may be a subcollection path like "chats/abc/messages" or a
      // simple collection like "transactions". doc() handles both as long
      // as the path resolves to a document (even segments => collection).
      await setDoc(doc(db, item.coll, item.docId), item.data);
      restored += 1;
    } catch (_) { /* skip bad items */ }
  }
  try {
    await setDoc(doc(db, 'archives', archiveId), {
      restored: true, restoredAt: serverTimestamp(),
      restoredCount: restored,
    }, { merge: true });
  } catch (_) {}
  return { success: true, archiveId, restored };
}

// Hard-delete an archive (purges the safety net). Use with care.
export async function deleteArchive(archiveId) {
  const items = await getDocs(
    collection(db, `archives/${archiveId}/items`));
  for (let i = 0; i < items.docs.length; i += 400) {
    const b = writeBatch(db);
    items.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await deleteDoc(doc(db, 'archives', archiveId));
  return { success: true };
}

// Permanent erase: nukes the archive AND the tombstoned users/{uid}
// doc (status='deleted') AND any other archives we hold for that uid.
// Used by the admin "Erase forever" action on /admin-archive when the
// operator is sure they will never want this user back. Soft-delete is
// reversible from Restore; permanent-erase is not.
export async function permanentlyEraseArchive(archiveId) {
  const meta = await getDoc(doc(db, 'archives', archiveId));
  if (!meta.exists()) throw new Error('Archive not found.');
  const uid = meta.data().uid;
  // 1) Purge this archive + its items.
  await deleteArchive(archiveId);
  if (!uid) return { success: true, erasedUser: false, otherArchives: 0 };
  // 2) Purge every other archive we have for this uid.
  const otherSnap = await getDocs(query(collection(db, 'archives'),
    where('uid', '==', uid)));
  for (const a of otherSnap.docs) {
    try { await deleteArchive(a.id); } catch (_) {}
  }
  // 3) Hard-delete the tombstoned users/{uid}. (deleteUser sets
  //    status='deleted' so ensureUserDoc bounces the auth user on next
  //    sign-in - permanent erase removes that tombstone too.)
  let erasedUser = false;
  try {
    await deleteDoc(doc(db, 'users', uid));
    erasedUser = true;
  } catch (_) {}
  return {
    success: true,
    erasedUser,
    otherArchives: otherSnap.docs.length,
  };
}

export function approveAstrologer(astroId, approved = true) {
  return tryCloud('adminApproveAstrologer', { astroId, approved }, async () => {
    await updateDoc(doc(db, 'astrologers', astroId), { approved: !!approved });
    return { success: true };
  });
}

// Permanently remove an astrologer: their public profile + their user
// record (so duplicates / unwanted accounts can be cleaned from admin).
export function deleteAstrologer(astroId) {
  return tryCloud('adminDeleteAstrologer', { astroId }, async () => {
    await deleteDoc(doc(db, 'astrologers', astroId));
    try { await deleteDoc(doc(db, 'users', astroId)); } catch (_) {}
    return { success: true };
  });
}

export function adjustWallet(uid, amount, reason) {
  const amt = Number(amount);
  return tryCloud('adminAdjustWallet', { uid, amount: amt, reason },
    async () => {
      let beforeW = 0;
      let afterW = 0;
      await runTransaction(db, async (t) => {
        const ref = doc(db, 'users', uid);
        const s = await t.get(ref);
        beforeW = Number((s.data() || {}).wallet || 0);
        const w = beforeW + amt;
        afterW = w < 0 ? 0 : w;
        t.update(ref, { wallet: afterW });
        t.set(doc(collection(db, 'transactions')), {
          userId: uid, amount: amt, type: amt >= 0 ? 'credit' : 'debit',
          reason: reason || 'admin_adjust', referenceId: 'admin_adjust',
          createdAt: serverTimestamp() });
        // Paper-trail subcollection. EVERY wallet move from this
        // function now leaves a row in users/{uid}/walletAudit so
        // future "wallet shows zero" reports can be traced to the
        // exact actor + reason without grepping logs.
        t.set(doc(collection(db, 'users', uid, 'walletAudit')), {
          before: beforeW, delta: amt, after: afterW,
          reason: reason || 'admin_adjust',
          source: 'adjustWallet',
          at: serverTimestamp(),
        });
      });
      await notifyWallet(uid, amt, reason || 'admin adjustment');
      return { success: true, before: beforeW, after: afterW };
    });
}

// Gift cards run through the relay (server-side admin SDK) so the
// wallet credit on redeem is atomic and abuse-safe.
function giftRelay() {
  const push = pushEndpoint();
  return push ? push.replace(/\/sendPush\/?$/, '/giftCard') : '';
}
async function giftCall(payload) {
  const url = giftRelay();
  if (!url) {
    throw new Error('Gift card service not configured. Set '
      + 'NEXT_PUBLIC_PUSH_ENDPOINT and deploy the relay.');
  }
  const token = auth && auth.currentUser
    ? await auth.currentUser.getIdToken() : null;
  if (!token) throw new Error('Not signed in.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Request failed');
  return j;
}

// Admin: generate a shareable gift card (8 uppercase alphanumeric).
export function createGiftCard(amount) {
  return giftCall({ action: 'create', amount: Math.round(Number(amount)) });
}
export async function listGiftCards() {
  const j = await giftCall({ action: 'list' });
  return j.cards || [];
}

// Assign one or more roles to a user. Primary `role` stays a single
// value (used by gating) = admin > astrologer > support > client; the
// full set is stored in `roles` (checked by hasRole / isAdminUser).
export function setUserRoles(uid, roles) {
  const list = Array.from(new Set((roles || []).filter(Boolean)));
  const primary = list.includes('admin') ? 'admin'
    : list.includes('astrologer') ? 'astrologer'
    : list.includes('support') ? 'support'
    : 'client';
  return tryCloud('adminSetUserRoles', { uid, roles: list }, async () => {
    await updateDoc(doc(db, 'users', uid), { role: primary, roles: list });
    if (list.includes('astrologer')) {
      await setDoc(doc(db, 'astrologers', uid),
        { approved: true }, { merge: true }).catch(() => {});
    }
    return { success: true, role: primary, roles: list };
  });
}

export function forceEndSession(sessionId) {
  return tryCloud('adminForceEndSession', { sessionId }, async () => {
    await updateDoc(doc(db, 'sessions', sessionId),
      { status: 'ended', endTime: new Date(), endedBy: 'admin' });
    return { success: true };
  });
}

export function updateSettings(docName, values) {
  return tryCloud('adminUpdateSettings', { docName, values }, async () => {
    await setDoc(doc(db, 'settings', docName), values || {}, { merge: true });
    return { success: true };
  });
}

export function sendNotification(payload) {
  return tryCloud('sendNotification', payload, async () => {
    await addDoc(collection(db, 'notifications'), {
      userId: payload.target === 'user' ? payload.userId : 'all',
      title: payload.title, message: payload.message,
      type: 'offer', read: false, createdAt: serverTimestamp() });
    // Also fire a real lock-screen push. The relay fans out by target
    // (all / clients / astrologers / a specific user) server-side.
    await sendPushToUser({
      target: payload.target,
      userId: payload.userId || null,
      title: payload.title,
      body: payload.message,
      data: { type: 'offer', route: '/notifications' },
    });
    return { sent: 1, local: true };
  });
}

export function processPayout(payoutId, approve, note) {
  return tryCloud('adminProcessPayout', { payoutId, approve, note },
    async () => {
      await updateDoc(doc(db, 'payouts', payoutId), {
        status: approve ? 'approved' : 'rejected',
        adminNote: note || '', processedAt: serverTimestamp() });
      return { success: true };
    });
}

export function resolveDispute(disputeId, resolution, refundAmount) {
  return tryCloud('adminResolveDispute',
    { disputeId, resolution, refundAmount }, async () => {
      const dRef = doc(db, 'disputes', disputeId);
      const dSnap = await getDoc(dRef);
      const d = dSnap.data() || {};
      await updateDoc(dRef, {
        status: 'resolved', resolution: resolution || '',
        refundAmount: Number(refundAmount || 0) });
      if (Number(refundAmount) > 0 && d.userId) {
        await runTransaction(db, async (t) => {
          const uRef = doc(db, 'users', d.userId);
          const s = await t.get(uRef);
          const w = Number((s.data() || {}).wallet || 0)
            + Number(refundAmount);
          t.update(uRef, { wallet: w });
          t.set(doc(collection(db, 'transactions')), {
            userId: d.userId, amount: Number(refundAmount), type: 'credit',
            reason: 'refund', referenceId: disputeId,
            createdAt: serverTimestamp() });
        });
      }
      return { success: true };
    });
}

export function saveCoupon(id, coupon) {
  return tryCloud('adminSaveCoupon', { id, coupon }, async () => {
    const ref = id ? doc(db, 'coupons', id)
      : doc(collection(db, 'coupons'));
    await setDoc(ref, { ...coupon, createdAt: serverTimestamp() },
      { merge: true });
    return { success: true };
  });
}

async function listAll(name, order = 'createdAt') {
  try {
    const snap = await getDocs(query(collection(db, name),
      orderBy(order, 'desc'), limit(500)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(collection(db, name), limit(500)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export function savePage(payload) {
  return tryCloud('adminSavePage', payload, async () => {
    const id = payload.id || payload.slug;
    await setDoc(doc(db, 'pages', id), {
      name: payload.name || payload.slug, slug: payload.slug,
      draftVersion: payload.draft || [], updatedAt: serverTimestamp(),
    }, { merge: true });
    return { success: true, id };
  });
}
export function publishPage(id) {
  return tryCloud('adminPublishPage', { id }, async () => {
    const ref = doc(db, 'pages', id);
    const s = await getDoc(ref);
    const p = s.data() || {};
    const history = Array.isArray(p.history) ? p.history : [];
    if (p.publishedVersion) {
      history.unshift({ components: p.publishedVersion });
    }
    await updateDoc(ref, {
      publishedVersion: p.draftVersion || [],
      history: history.slice(0, 10),
      lastPublishedAt: serverTimestamp() });
    return { success: true };
  });
}
export function rollbackPage(id, index) {
  return tryCloud('adminRollbackPage', { id, index }, async () => {
    const ref = doc(db, 'pages', id);
    const s = await getDoc(ref);
    const h = (s.data().history || [])[index];
    if (h) {
      await updateDoc(ref, {
        publishedVersion: h.components, draftVersion: h.components,
        lastPublishedAt: serverTimestamp() });
    }
    return { success: true };
  });
}

// Create a loginable astrologer from the admin panel. Uses a SECONDARY
// Firebase app so the admin's own session is not replaced. If the email
// already exists (e.g. it is a client), the SAME account is extended to
// also be an astrologer (one login works for both portals).
export async function createAstrologer(data) {
  const primary = getApps()[0];
  const secondary = getApps().find((a) => a.name === 'admin-secondary')
    || initializeApp(primary.options, 'admin-secondary');
  const secAuth = getAuth(secondary);
  const email = data.email.trim();
  let uid;
  let attached = false;
  try {
    const cred = await createUserWithEmailAndPassword(
      secAuth, email, data.password || 'admin123');
    uid = cred.user.uid;
    // Fire the Firebase email-verification mail. Caller can opt out
    // by passing skipEmailVerification:true (e.g. seed scripts). The
    // mail is best-effort: a network blip here must not block the
    // astrologer account from being created.
    if (!data.skipEmailVerification) {
      try { await sendEmailVerification(cred.user); }
      catch (_) { /* swallow - the doc-level flag still gates login */ }
    }
    await setDoc(doc(db, 'users', uid), {
      name: data.name, email, phone: data.phone || '', role: 'astrologer',
      isAstrologer: true,
      userCode: ((s) => {
        const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const b = String(s || '').toUpperCase()
          .replace(/[^A-Z0-9]/g, '').slice(0, 3);
        let r = b;
        while (r.length < 6) {
          r += C[Math.floor(Math.random() * C.length)];
        }
        return r.slice(0, 6);
      })(data.name || email),
      wallet: 0, isOnline: false, isOnCall: false, isBlocked: false,
      hasSeenTour: true, status: 'active', createdAt: serverTimestamp(),
      // Referral pointer copied from the approved application so the
      // session-end hook can credit the referrer once the new
      // astrologer completes their first 30-min paid session.
      referredByCode: data.referredByCode || '',
      referredByUserId: data.referredByUserId || '',
      referralBonusPaid: false,
    });
    // If the referrer is a real platform user, drop a pending-bonus
    // row that the session-end hook in callService/chatService can
    // pick up. settings/config.astro_to_astro_amount controls the
    // payout amount + on/off switch.
    if (data.referredByUserId) {
      await setDoc(doc(db, 'astroReferralPending', uid), {
        newAstrologerUid: uid,
        newAstrologerEmail: email,
        referrerUid: data.referredByUserId,
        referrerCode: data.referredByCode || '',
        createdAt: serverTimestamp(),
        status: 'pending',  // -> 'paid' when bonus credits
      }, { merge: true });
    }
  } catch (err) {
    if (err.code !== 'auth/email-already-in-use') throw err;
    // Existing account (likely a client). Find its uid by email and
    // extend it: same login now also works in the astrologer portal.
    const us = await getDocs(query(collection(db, 'users'),
      where('email', '==', email), limit(1)));
    if (us.empty) {
      const e = new Error(
        'That email already has a login but no user record was found. '
        + 'Have them sign in once on the client app, then retry.');
      e.code = 'no-user-doc';
      throw e;
    }
    uid = us.docs[0].id;
    attached = true;
    await updateDoc(doc(db, 'users', uid), { isAstrologer: true });
  }

  // Gender-aware default illustrated avatar (free DiceBear). Female ->
  // lorelei, male -> notionists, other/unspecified -> personas. Seed
  // is the uid, so every astrologer's image is unique.
  const g = String(data.gender || 'other').toLowerCase();
  const style = g === 'female' ? 'lorelei'
    : g === 'male' ? 'notionists' : 'personas';
  await setDoc(doc(db, 'astrologers', uid), {
    name: data.name, userId: uid, bio: data.bio || '',
    gender: g,
    skills: data.skills || [], languages: data.languages || [],
    experience: Number(data.experience || 0),
    priceChat: Number(data.priceChat || 20),
    priceCall: Number(data.priceCall || 30),
    priceVideo: Number(data.priceVideo || 40),
    priceLive: Number(data.priceLive || 0),
    discountPercent: Number(data.discountPercent || 0),
    rating: 0, reviewsCount: 0, totalSessions: 0, responseRate: 100,
    approved: true, status: 'offline',
    chat_enabled: false, call_enabled: false, video_enabled: false,
    earnings: 0,
    // Force-change-password + email-verification gates. Admin sets
    // these true when minting a new account; astro-web's auth gate
    // unlocks the dashboard only after the astrologer has set their
    // own password and verified their email.
    mustChangePassword: data.mustChangePassword !== false,
    needsEmailVerification: data.needsEmailVerification !== false,
    profileImage: `https://api.dicebear.com/9.x/${style}/svg?seed=`
      + `${encodeURIComponent(uid)}&backgroundType=gradientLinear`,
    createdAt: serverTimestamp(),
  });
  await signOut(secAuth).catch(() => {});
  return { uid, email, attached };
}

// Admin edits to any user or astrologer profile (client-side; allowed by
// the isAdmin() Firestore rules).
export function updateUserProfile(uid, data) {
  return tryCloud('adminUpdateUser', { uid, data }, async () => {
    await updateDoc(doc(db, 'users', uid), data || {});
    return { success: true };
  });
}
export function updateAstrologerProfile(id, data) {
  return tryCloud('adminUpdateAstrologer', { id, data }, async () => {
    await setDoc(doc(db, 'astrologers', id), data || {}, { merge: true });
    return { success: true };
  });
}

export const getAllPayouts = () => listAll('payouts');
export const getAllDisputes = () => listAll('disputes');
export const getAllCoupons = () => listAll('coupons', 'code');
export const getAuditLogs = () => listAll('logs', 'timestamp');

export async function globalSearch(queryStr) {
  const term = String(queryStr || '').trim();
  if (!term) return { users: [], astrologers: [], sessions: [] };
  const [users, astro] = await Promise.all([
    getDocs(query(collection(db, 'users'), limit(200))),
    getDocs(query(collection(db, 'astrologers'), limit(200))),
  ]);
  const t = term.toLowerCase();
  return {
    users: users.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => (u.name || '').toLowerCase().includes(t) ||
        (u.email || '').toLowerCase().includes(t) ||
        String(u.userCode || '').includes(t)).slice(0, 10),
    astrologers: astro.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => (a.name || '').toLowerCase().includes(t) ||
        (a.skills || []).join(' ').toLowerCase().includes(t)).slice(0, 10),
    sessions: [],
  };
}
