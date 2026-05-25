// Read the current theme settings doc so we can bake it into
// _document.js as the inline boot palette (kills the purple flash
// on first paint).
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const t = await admin.firestore().doc('settings/theme').get();
console.log('exists:', t.exists);
console.log(JSON.stringify(t.data() || {}, null, 2));
process.exit(0);
