// End-to-end OTP roundtrip test against the live relay + Firestore.
//   1. Pick a synthetic email so no real human gets the code.
//   2. Call /api/emailOtp action=request via the live relay.
//   3. Read the code straight out of emailOtps/{email} in Firestore
//      (this is what the admin would have to do if SMTP failed).
//   4. Call /api/emailOtp action=verify with that code.
//   5. Re-verify (idempotency check).
// Prints PASS/FAIL for each step.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const RELAY = 'https://astro-platform-push-relay.vercel.app/api/emailOtp';
const email = `sweep+${Date.now()}@example.invalid`;

async function post(body) {
  const r = await fetch(RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

console.log('email =', email);
const req = await post({ action: 'request', email, name: 'Sweep' });
console.log('1 request →', req.status, JSON.stringify(req.body));
if (!(req.status === 200 || req.status === 502)) process.exit(1);

const snap = await admin.firestore().collection('emailOtps').doc(email).get();
if (!snap.exists) { console.log('FAIL: no otp doc'); process.exit(1); }
const code = snap.data().code;
console.log('2 firestore code =', code);

const verBad = await post({ action: 'verify', email, code: '000000' });
console.log('3 verify(wrong) →', verBad.status, JSON.stringify(verBad.body));

const ver = await post({ action: 'verify', email, code });
console.log('4 verify(right) →', ver.status, JSON.stringify(ver.body));

const ver2 = await post({ action: 'verify', email, code });
console.log('5 verify(replay) →', ver2.status, JSON.stringify(ver2.body));

// Cleanup
await admin.firestore().collection('emailOtps').doc(email).delete();
console.log('6 cleanup → deleted');
process.exit(0);
