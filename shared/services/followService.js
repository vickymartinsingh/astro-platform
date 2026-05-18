// Follow astrologers. The user's follow list lives in
// favorites/{uid}.followingIds (isSelf rule - no rules redeploy). The
// astrologer doc keeps followerUids (signed-in update is allowed as
// long as earnings/approved/status are unchanged) so we can notify
// every follower when the astrologer goes Live / Online.
import {
  doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, deleteField,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

export async function getFollowing(uid) {
  if (!uid) return [];
  const s = await getDoc(doc(db, 'favorites', uid));
  return s.exists() ? (s.data().followingIds || []) : [];
}

export async function isFollowing(uid, astroId) {
  if (!uid || !astroId) return false;
  return (await getFollowing(uid)).includes(astroId);
}

// The astrologer can see this limited follower card (no full profile).
export async function getFollowers(astroId) {
  if (!astroId) return [];
  const s = await getDoc(doc(db, 'astrologers', astroId));
  const m = (s.exists() && s.data().followers) || {};
  return Object.entries(m).map(([uid, v]) => ({
    uid, name: v.name || 'User', code: v.code || '',
    dp: v.dp || '', at: v.at || 0,
  })).sort((a, b) => (b.at || 0) - (a.at || 0));
}

// currentlyFollowing = the state BEFORE the tap. Returns the new state.
export async function toggleFollow(uid, astroId, currentlyFollowing) {
  const fref = doc(db, 'favorites', uid);
  const fsnap = await getDoc(fref);
  if (!fsnap.exists()) {
    await setDoc(fref, {
      followingIds: currentlyFollowing ? [] : [astroId],
    });
  } else {
    await updateDoc(fref, {
      followingIds: currentlyFollowing
        ? arrayRemove(astroId) : arrayUnion(astroId),
    });
  }
  // Limited follower record on the astrologer doc (name / code / dp /
  // date) - never the full customer profile.
  let me = {};
  try {
    const us = await getDoc(doc(db, 'users', uid));
    if (us.exists()) {
      const u = us.data();
      me = { name: u.name || 'User', code: u.userCode || '',
        dp: u.profileImage || '' };
    }
  } catch (_) { /* ignore */ }
  try {
    await updateDoc(doc(db, 'astrologers', astroId), {
      followerUids: currentlyFollowing
        ? arrayRemove(uid) : arrayUnion(uid),
      [`followers.${uid}`]: currentlyFollowing
        ? deleteField()
        : { name: me.name || 'User', code: me.code || '',
          dp: me.dp || '', at: Date.now() },
    });
  } catch (_) { /* ignore */ }

  if (!currentlyFollowing) {
    // Tell the astrologer, and surface it in their live feed if live.
    try {
      sendPushToUser({
        toUid: astroId,
        title: 'New follower',
        body: `${me.name || 'Someone'} started following you`,
        data: { type: 'follow' },
      });
    } catch (_) { /* ignore */ }
    try {
      const as = await getDoc(doc(db, 'astrologers', astroId));
      if (as.exists() && as.data().isLive) {
        import('./liveService.js').then((m) => m.announceFollow(
          astroId, { name: me.name || 'Someone', uid, code: me.code }))
          .catch(() => {});
      }
    } catch (_) { /* ignore */ }
  }
  return !currentlyFollowing;
}

// Push every follower when the astrologer goes Live / Online.
// kind = 'Live' | 'Online'. Best-effort (never throws).
export async function notifyFollowers(astroId, kind, route) {
  try {
    const s = await getDoc(doc(db, 'astrologers', astroId));
    if (!s.exists()) return;
    const d = s.data();
    const uids = Array.isArray(d.followerUids) ? d.followerUids : [];
    const name = d.name || 'An astrologer';
    uids.slice(0, 500).forEach((toUid) => {
      sendPushToUser({
        toUid,
        title: `${name} is now ${kind}`,
        body: kind === 'Live'
          ? 'Tap to join the live session now.'
          : 'Tap to start a consultation.',
        data: { type: 'follow', route: route || '' },
      });
    });
  } catch (_) { /* ignore */ }
}
