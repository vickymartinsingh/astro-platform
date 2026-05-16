// Create (or repair) the admin account only.
//   cd D:\Projects\Astro
//   node scripts/seed-admin.mjs
//
// Requires Email/Password sign-in enabled in the Firebase console
// (Authentication > Sign-in method > Email/Password).
// Result: admin@astro.demo / admin123  with users/{uid}.role = "admin".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(
  join(__dir, '..', 'client-web', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const app = initializeApp({
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

const EMAIL = 'admin@astro.demo';
const PWD = 'admin123';

async function run() {
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error('Missing client-web/.env.local Firebase config.');
    process.exit(1);
  }
  let uid;
  try {
    const c = await createUserWithEmailAndPassword(auth, EMAIL, PWD);
    uid = c.user.uid;
    await updateProfile(c.user, { displayName: 'Administrator' });
    console.log('Created auth account:', EMAIL);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      try {
        const c = await signInWithEmailAndPassword(auth, EMAIL, PWD);
        uid = c.user.uid;
        console.log('Account already exists, signed in OK.');
      } catch (e2) {
        console.error('\nThe email exists but the password is NOT ' +
          'admin123.\nDelete the user "admin@astro.demo" in Firebase ' +
          'Console > Authentication > Users, then run this again.');
        process.exit(1);
      }
    } else if (err.code === 'auth/operation-not-allowed') {
      console.error('\nEnable Email/Password sign-in first:\n' +
        'Firebase Console > Authentication > Sign-in method > ' +
        'Email/Password > Enable.');
      process.exit(1);
    } else {
      console.error('Failed:', err.code || err.message);
      process.exit(1);
    }
  }

  await setDoc(doc(db, 'users', uid), {
    name: 'Administrator', email: EMAIL, phone: '', role: 'admin',
    userCode: String(Math.floor(1e8 + Math.random() * 9e8)),
    wallet: 0, isOnline: false, isOnCall: false, isBlocked: false,
    hasSeenTour: true, status: 'active', createdAt: new Date(),
  }, { merge: true });

  const check = await getDoc(doc(db, 'users', uid));
  console.log('\nDone. users/%s role = %s', uid,
    check.exists() ? check.data().role : '(missing)');
  console.log('\nLogin at  http://localhost:3002/admin-login');
  console.log('  Email:    admin@astro.demo');
  console.log('  Password: admin123');
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
