// One-shot: dump settings/features so we can confirm the
// email_verification toggle is enabled on production.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const f = await admin.firestore().doc('settings/features').get();
console.log(JSON.stringify(f.data() || {}, null, 2));
process.exit(0);
