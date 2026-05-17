// One-off: make vickymartinsing@gmail.com a single account that can sign
// into ALL three portals (admin + astrologer + client).
//
// Firebase has ONE auth user per email, so we don't delete anything -
// we just (create or) elevate that account and set its Firestore role.
// Uses the local service-account key (gitignored). Run:
//   node scripts/make-superadmin.mjs
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = 'vickymartinsing@gmail.com';
const PASSWORD = 'admin123';
const NAME = 'Vicky Martin Singh';

const svc = JSON.parse(readFileSync(join(ROOT, 'firebase-key.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(svc) });

const auth = admin.auth();
const db = admin.firestore();

let user;
try {
  user = await auth.getUserByEmail(EMAIL);
  console.log('found existing auth user:', user.uid);
} catch (_) {
  user = await auth.createUser({ email: EMAIL, password: PASSWORD,
    displayName: NAME, emailVerified: true });
  console.log('created auth user:', user.uid);
}

// Reset password + make sure it can sign in.
await auth.updateUser(user.uid, {
  password: PASSWORD, emailVerified: true, disabled: false,
  displayName: NAME });

// users/{uid}: role=admin (admin portal) + isAstrologer=true (astro
// portal). Client portal only needs a signed-in user. merge keeps wallet.
await db.collection('users').doc(user.uid).set({
  name: NAME, email: EMAIL, role: 'admin', isAstrologer: true,
  isBlocked: false,
}, { merge: true });

// Minimal astrologer profile so the astrologer portal is usable.
const aRef = db.collection('astrologers').doc(user.uid);
if (!(await aRef.get()).exists) {
  await aRef.set({
    name: NAME, approved: true, status: 'offline',
    priceChat: 20, priceCall: 30, priceVideo: 40,
    chat_enabled: false, call_enabled: false, video_enabled: false,
    rating: 5, reviewsCount: 0, experience: 1, skills: ['Vedic'],
    commissionPercent: 30, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('created astrologer profile');
} else {
  await aRef.set({ approved: true }, { merge: true });
  console.log('astrologer profile already existed (kept)');
}

console.log('\nDONE. Single login for all 3 portals:');
console.log('  email   :', EMAIL);
console.log('  password:', PASSWORD);
process.exit(0);
