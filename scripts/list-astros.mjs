// Read-only: list astrologer accounts so we can identify duplicates.
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync(join(ROOT, 'firebase-key.json'), 'utf8'))) });
const db = admin.firestore();

const snap = await db.collection('astrologers').get();
console.log(`=== astrologers (${snap.size}) ===`);
for (const d of snap.docs) {
  const a = d.data();
  let email = '?';
  try {
    const u = await db.collection('users').doc(d.id).get();
    email = (u.data() || {}).email || '(no users doc)';
  } catch (_) {}
  console.log(
    `uid=${d.id} | name=${a.name} | email=${email} | approved=${a.approved}`
    + ` | status=${a.status} | rating=${a.rating} reviews=${a.reviewsCount}`
    + ` | exp=${a.experience} | skills=${JSON.stringify(a.skills || [])}`
    + ` | prices chat/call/video=${a.priceChat}/${a.priceCall}/${a.priceVideo}`);
}
process.exit(0);
