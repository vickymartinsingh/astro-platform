// Flip settings/features.email_verification = true so the customer
// signup flow demands a 6-digit OTP from support@astroseer.in.
// Re-run with false to disable, or just toggle in /admin-features.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const on = process.argv[2] !== 'off';
await admin.firestore().doc('settings/features').set({
  email_verification: on,
}, { merge: true });
console.log('email_verification =', on);
process.exit(0);
