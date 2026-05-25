// Inspect notifications for "all" broadcast scope (shared with every user).
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();

const snap = await db.collection('notifications')
  .where('userId', '==', 'all').get();

console.log(`Found ${snap.size} broadcast notifications:`);
snap.docs.forEach((d) => {
  const v = d.data();
  console.log({
    id: d.id, type: v.type, title: v.title,
    msg: (v.message || '').slice(0, 60),
    at: v.createdAt?.toDate?.()?.toISOString() || '?',
  });
});
process.exit(0);
