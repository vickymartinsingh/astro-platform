// RTDB onDisconnect handler, blueprint 7.7 / Hard Rule 7.
// When /status/{uid} flips to offline (browser closed, network lost, app
// minimized), mirror it to Firestore and END any active session involving
// that user so billingEngine stops on its next tick. No overcharge ever.
const functions = require('firebase-functions');
const { db } = require('./lib/admin');
const { endSessionInternal } = require('./billing');

exports.onUserStatusChanged = functions.database
  .ref('/status/{uid}')
  .onWrite(async (change, ctx) => {
    const uid = ctx.params.uid;
    const after = change.after.val();
    const state = after && after.state;
    if (state === 'online') return null;

    // Mirror presence to Firestore.
    await db.collection('users').doc(uid)
      .set({ isOnline: false }, { merge: true }).catch(() => {});

    // End any active session this user is part of (client OR astrologer).
    const [asUser, asAstro] = await Promise.all([
      db.collection('sessions')
        .where('status', '==', 'active').where('userId', '==', uid).get(),
      db.collection('sessions')
        .where('status', '==', 'active').where('astroId', '==', uid).get(),
    ]);
    const ids = new Set();
    asUser.forEach((d) => ids.add(d.id));
    asAstro.forEach((d) => ids.add(d.id));
    for (const id of ids) {
      await endSessionInternal(id, 'disconnect').catch((e) =>
        console.error('disconnect end failed', id, e));
    }

    // If they are an astrologer, drop them out of the live listing.
    await db.collection('astrologers').doc(uid)
      .set({ status: 'offline' }, { merge: true }).catch(() => {});
    return null;
  });
