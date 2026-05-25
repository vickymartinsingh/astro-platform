// Simulate an idle-timeout-ended session so we can preview the
// inactivity end-reason banner without actually waiting 2 minutes.
// Picks the most recent ended/active session for the demo user and
// stamps it with endReason: 'idle-timeout' + inactivityRefund.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();
const uid = 'UvO1au1PaFfgLWnw6n38PpgXHGB2';

const snap = await db.collection('sessions')
  .where('userId', '==', uid).get();

const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.startTime?.toMillis?.() || 0)
    - (a.startTime?.toMillis?.() || 0));

if (!list.length) { console.error('no sessions for demo user'); process.exit(1); }
const s = list[0];
console.log('Stamping session', s.id, 'as idle-timeout ended');
await db.collection('sessions').doc(s.id).update({
  status: 'ended',
  endTime: admin.firestore.FieldValue.serverTimestamp(),
  endedByAi: true,
  endReason: 'idle-timeout',
  inactivityRefund: 12,           // example: Rs 12 for 2 min at Rs 6/min
  inactivityRefundSeconds: 120,
});
console.log('done. Open the chat:', `/chat/${s.astroId}?view=1`);
process.exit(0);
