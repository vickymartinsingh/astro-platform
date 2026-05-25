// One-shot cleanup: delete duplicate broadcast notifications. Keeps
// the NEWEST entry for each (type, title, message) tuple, deletes the
// rest. Specifically catches the "48 Welcome notifications" mess but
// works for any broadcast that was clicked Send multiple times.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();

const snap = await db.collection('notifications')
  .where('userId', '==', 'all').get();

console.log(`Scanning ${snap.size} broadcast notifications...`);

const groups = new Map();
snap.docs.forEach((d) => {
  const v = d.data();
  const ms = (v.createdAt && v.createdAt.toMillis
    && v.createdAt.toMillis()) || 0;
  const key = `${v.type || ''}|${(v.title || '').trim()}|${(v.message || '').trim()}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ id: d.id, ms });
});

let keep = 0; let drop = 0;
const batch = db.batch();
for (const [key, list] of groups) {
  list.sort((a, b) => b.ms - a.ms);
  const [keepRow, ...dropRows] = list;
  console.log(`[${list.length}] "${key.slice(0, 60)}" -> keep ${keepRow.id}, drop ${dropRows.length}`);
  keep += 1; drop += dropRows.length;
  dropRows.forEach((r) => batch.delete(db.collection('notifications').doc(r.id)));
}
await batch.commit();
console.log(`\nKept ${keep}, deleted ${drop}.`);
process.exit(0);
