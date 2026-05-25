// One-shot: create demo@demo.com / demo@demo.com test customer with a
// fully populated profile + Rs 500 wallet credit so the testing pass
// can exercise paid features (chat / call) without going through
// payment. Idempotent: re-run safely; it updates the existing user
// instead of failing on "email-already-in-use".
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

const KEY = JSON.parse(readFileSync('./firebase-key.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(KEY) });

const EMAIL = 'demo@demo.com';
const PASSWORD = 'demo@demo.com';
const NAME = 'Demo User';
const PHONE = '+919999999999';
const WALLET = 500;

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

async function ensureProfile(uid) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const base = {
    name: NAME,
    email: EMAIL,
    phone: PHONE,
    role: 'client',
    isBlocked: false,
    wallet: WALLET,
    gender: 'male',
    dob: '01-01-2000',
    city: 'Hyderabad',
    state: 'Telangana',
    country: 'India',
    language: 'English',
    profileImage: '',
    userCode: 'DEMO' + uid.slice(0, 6).toUpperCase(),
    createdAt: snap.exists ? (snap.data().createdAt
      || admin.firestore.FieldValue.serverTimestamp())
      : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(base, { merge: true });
  console.log(`users/${uid} profile set (wallet = Rs ${WALLET})`);
}

async function logSeed(uid) {
  await db.collection('transactions').add({
    userId: uid, amount: WALLET, type: 'credit',
    reason: 'demo seed', referenceId: 'demo-seed-' + Date.now(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('transaction row written');
}

const uid = await ensureAuthUser();
await ensureProfile(uid);
await logSeed(uid);
console.log('\n--- DEMO USER READY ---');
console.log('  email   :', EMAIL);
console.log('  password:', PASSWORD);
console.log('  uid     :', uid);
console.log('  wallet  : Rs', WALLET);
process.exit(0);
