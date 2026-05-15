// Notifications, FCM push + in-app notification records (blueprint 8.4).
const functions = require('firebase-functions');
const { admin, db, FieldValue } = require('./lib/admin');
const { requireAdmin } = require('./lib/utils');

async function pushToTokens(tokens, title, message) {
  const valid = tokens.filter(Boolean);
  if (!valid.length) return;
  await admin.messaging().sendEachForMulticast({
    tokens: valid,
    notification: { title, body: message },
  }).catch((e) => console.error('fcm error', e));
}

async function writeInApp(userId, title, message, type) {
  await db.collection('notifications').add({
    userId, title, message, type: type || 'offer',
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
}

// Astrologer goes online -> notify users who favourited them (blueprint 5.5).
exports.onAstrologerGoOnline = functions.firestore
  .document('astrologers/{astroId}')
  .onUpdate(async (change, ctx) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === 'online' || after.status !== 'online') return null;

    const astroId = ctx.params.astroId;
    const favSnap = await db.collection('favorites')
      .where('astrologerIds', 'array-contains', astroId).get();
    const userIds = favSnap.docs.map((d) => d.id);
    if (!userIds.length) return null;

    const name = after.name || 'Your astrologer';
    const tokens = [];
    for (const uid of userIds) {
      const u = await db.collection('users').doc(uid).get();
      if (u.exists && u.data().fcmToken) tokens.push(u.data().fcmToken);
      await writeInApp(uid, `${name} is now available`,
        `${name} just came online. Start a consultation now.`, 'offer');
    }
    await pushToTokens(tokens, `${name} is now available`,
      'Tap to start a consultation');
    return null;
  });

// Admin broadcast / targeted send (blueprint 6.12).
exports.sendNotification = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { target, title, message, userId } = data || {};
  let users = [];
  if (target === 'user' && userId) {
    const u = await db.collection('users').doc(userId).get();
    if (u.exists) users = [{ id: u.id, ...u.data() }];
  } else {
    let q = db.collection('users');
    if (target === 'clients') q = q.where('role', '==', 'client');
    if (target === 'astrologers') q = q.where('role', '==', 'astrologer');
    const snap = await q.get();
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const tokens = users.map((u) => u.fcmToken).filter(Boolean);
  await pushToTokens(tokens, title, message);
  await db.collection('notifications').add({
    userId: target === 'user' ? userId : 'all',
    title, message, type: 'offer', read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { sent: users.length };
});

// Due scheduled notifications (blueprint 8.3 sendScheduledNotification).
exports.sendScheduledNotification = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async () => {
    const now = new Date();
    const snap = await db.collection('scheduler')
      .where('status', '==', 'pending').get();
    for (const doc of snap.docs) {
      const s = doc.data();
      const trigger = s.triggerTime && s.triggerTime.toDate
        ? s.triggerTime.toDate() : null;
      if (!trigger || trigger > now) continue;
      try {
        if (s.type === 'notification' && s.action) {
          await db.collection('notifications').add({
            userId: s.action.userId || 'all',
            title: s.action.title || '',
            message: s.action.message || '',
            type: 'offer', read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        await doc.ref.update({ status: 'executed' });
      } catch (e) {
        await doc.ref.update({ status: 'failed' });
      }
    }
    return null;
  });
