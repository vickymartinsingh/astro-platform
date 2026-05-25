// Flip settings/kundliApi.provider to "astroseer" so the next kundli
// call routes through our Render-hosted API. Leaves any existing
// provider creds untouched so re-runs are safe + reversible.
//
// If admin already pasted the API key into the AstroSeer admin row
// it lands here as kundliApi.astroseer.key. Env vars on the relay
// (ASTROSEER_API_URL / ASTROSEER_API_KEY) take precedence; this
// script does NOT touch them.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();
const ref = db.doc('settings/kundliApi');
const cur = (await ref.get()).data() || {};
console.log('before:', JSON.stringify({
  provider: cur.provider,
  astroseerKeySaved: !!(cur.astroseer && cur.astroseer.key),
}, null, 2));

await ref.set({ provider: 'astroseer' }, { merge: true });

const next = (await ref.get()).data() || {};
console.log('after:', JSON.stringify({
  provider: next.provider,
  astroseerKeySaved: !!(next.astroseer && next.astroseer.key),
}, null, 2));
process.exit(0);
