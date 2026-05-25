// One-shot: create demoastro@demo.com / demoastro@demo.com test
// astrologer with a fully populated public profile so the testing
// pass can exercise every astrologer screen (dashboard, go live,
// sessions, earnings, kundli viewer, remedies, profile, reviews,
// followers, notifications, support) without ratting up the real
// astrologer accounts.
// Idempotent: re-run safely; it updates the existing astrologer
// instead of failing on "email-already-in-use".
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

const KEY = JSON.parse(readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(KEY) });

const EMAIL = 'demoastro@demo.com';
const PASSWORD = 'demoastro@demo.com';
const NAME = 'Demo Astrologer';
const PHONE = '+918888888888';

const auth = admin.auth();
const db = admin.firestore();

async function ensureAuthUser() {
  try {
    const u = await auth.getUserByEmail(EMAIL);
    console.log('auth user exists:', u.uid);
    await auth.updateUser(u.uid, {
      password: PASSWORD, displayName: NAME, phoneNumber: PHONE,
      emailVerified: true,
    });
    return u.uid;
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const u = await auth.createUser({
      email: EMAIL, password: PASSWORD, displayName: NAME,
      phoneNumber: PHONE, emailVerified: true,
    });
    console.log('auth user created:', u.uid);
    return u.uid;
  }
}

async function ensureUserDoc(uid) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  await ref.set({
    name: NAME,
    email: EMAIL,
    phone: PHONE,
    role: 'astrologer',
    isBlocked: false,
    isAstrologer: true,
    profileImage: '',
    createdAt: snap.exists ? (snap.data().createdAt
      || admin.firestore.FieldValue.serverTimestamp())
      : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function ensureAstroDoc(uid) {
  const ref = db.collection('astrologers').doc(uid);
  await ref.set({
    name: NAME,
    email: EMAIL,
    phone: PHONE,
    bio: 'Demo astrologer used for end-to-end test runs of the '
      + 'AstroSeer astrologer app. Not a real practitioner.',
    photo: '',
    languages: ['English', 'Hindi'],
    skills: ['Vedic', 'Tarot', 'Numerology'],
    experience: 10,
    priceChat: 20,
    priceCall: 30,
    priceVideo: 40,
    approved: true,
    isOnline: true,
    status: 'online',          // online / busy / offline
    rating: 4.7,
    reviewsCount: 12,
    followersCount: 0,
    sessionsCount: 0,
    earningsTotal: 0,
    earningsPending: 0,
    pinned: false,
    featured: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`astrologers/${uid} doc set`);
}

const uid = await ensureAuthUser();
await ensureUserDoc(uid);
await ensureAstroDoc(uid);
console.log('\n--- DEMO ASTROLOGER READY ---');
console.log('  email   :', EMAIL);
console.log('  password:', PASSWORD);
console.log('  uid     :', uid);
console.log('  log in at: https://astrologer.astroseer.in/');
process.exit(0);
