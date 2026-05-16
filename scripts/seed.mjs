// Seed dummy astrologers as REAL Firebase Auth accounts so you can log in
// to the Astrologer portal as any of them. Password for all: admin123
//
// Usage (from repo root, after `npm install`):
//   node scripts/seed.mjs
//
// Requires Email/Password sign-in enabled in the Firebase console.
// Each astrologer gets: an auth account, users/{uid} (role=astrologer),
// astrologers/{uid} (approved, varied status), and 5-10 reviews.
// Clients never see they are seeded. Credentials are printed at the end.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile,
} from 'firebase/auth';
import {
  getFirestore, doc, setDoc, getDoc, addDoc, collection,
} from 'firebase/firestore';
import { ASTROLOGERS, REVIEW_TEXTS, REPLIES } from './seedData.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const cfg = {};
  const f = readFileSync(join(__dir, '..', 'client-web', '.env.local'), 'utf8');
  for (const line of f.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}

const e = loadEnv();
const app = initializeApp({
  apiKey: e.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: e.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: e.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: e.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: e.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: e.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);
const PWD = 'admin123';
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const slug = (n) => n.toLowerCase().replace(/[^a-z]+/g, '.')
  .replace(/^\.|\.$/g, '');

async function run() {
  const creds = [];
  for (const a of ASTROLOGERS) {
    const email = `${slug(a.name)}@astro.demo`;
    let uid;
    try {
      const c = await createUserWithEmailAndPassword(auth, email, PWD);
      uid = c.user.uid;
      await updateProfile(c.user, { displayName: a.name });
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        try {
          const c = await signInWithEmailAndPassword(auth, email, PWD);
          uid = c.user.uid;
        } catch {
          console.error(`! ${email} exists with a different password. ` +
            'Delete it in Firebase Console > Authentication > Users, ' +
            'then re-run.');
          continue;
        }
      } else if (err.code === 'auth/operation-not-allowed') {
        console.error('\n========================================\n' +
          'Email/Password sign-in is NOT enabled.\n' +
          'Firebase Console > Authentication > Sign-in method >\n' +
          'Email/Password > Enable. Then run this script again.\n' +
          '========================================');
        process.exit(1);
      } else {
        console.error(a.name, err.code || err.message);
        continue;
      }
    }

    await setDoc(doc(db, 'users', uid), {
      name: a.name, email, phone: '', role: 'astrologer',
      userCode: String(Math.floor(1e8 + Math.random() * 9e8)),
      wallet: 0, isOnline: a.status === 'online', isOnCall: false,
      isBlocked: false, hasSeenTour: true, status: 'active',
      createdAt: new Date(),
    }, { merge: true });

    const reviewCount = 5 + Math.floor(Math.random() * 6);
    await setDoc(doc(db, 'astrologers', uid), {
      name: a.name, userId: uid, bio: a.bio, skills: a.skills,
      languages: a.languages, experience: a.experience,
      priceChat: a.priceChat, priceCall: a.priceCall,
      priceVideo: a.priceVideo, discountPercent: a.discountPercent,
      rating: a.rating, reviewsCount: reviewCount,
      totalSessions: 100 + Math.floor(Math.random() * 900),
      responseRate: 85 + Math.floor(Math.random() * 15),
      approved: true, status: a.status,
      chat_enabled: a.status !== 'offline',
      call_enabled: a.status !== 'offline',
      video_enabled: a.status === 'online',
      earnings: 0,
      profileImage: 'https://api.dicebear.com/7.x/notionists/svg?seed=' +
        encodeURIComponent(a.name) + '&backgroundColor=ede9fe,f3e8ff,fce7f3',
      createdAt: new Date(),
    }, { merge: true });

    const existingRev = await getDoc(doc(db, 'astrologers', uid));
    for (let i = 0; i < reviewCount; i++) {
      await addDoc(collection(db, 'reviews'), {
        userId: uid, astroId: uid, sessionId: 'seed',
        rating: 4 + (Math.random() < 0.65 ? 1 : 0),
        comment: rnd(REVIEW_TEXTS), astrologerReply: rnd(REPLIES),
        createdAt: new Date(Date.now() - i * 864e5),
      });
    }
    await signOut(auth);
    creds.push([a.name, email, a.status]);
    console.log('seeded:', a.name, `(${a.status}, +${reviewCount} reviews)`);
    void existingRev;
  }

  // ---- Admin account (vickymartinsing@gmail.com / admin123) ----
  // Firestore rules allow a user to CREATE its own users doc with any
  // fields (role immutability only applies to updates), so seeding an
  // admin role here is permitted.
  const ADMIN_EMAIL = 'vickymartinsing@gmail.com';
  try {
    let auid;
    try {
      const c = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, PWD);
      auid = c.user.uid;
      await updateProfile(c.user, { displayName: 'Administrator' });
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        const c = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, PWD);
        auid = c.user.uid;
      } else { throw err; }
    }
    await setDoc(doc(db, 'users', auid), {
      name: 'Administrator', email: ADMIN_EMAIL, phone: '',
      role: 'admin',
      userCode: String(Math.floor(1e8 + Math.random() * 9e8)),
      wallet: 0, isOnline: false, isOnCall: false, isBlocked: false,
      hasSeenTour: true, status: 'active', createdAt: new Date(),
    }, { merge: true });
    await signOut(auth);
    console.log('seeded admin: vickymartinsing@gmail.com');
  } catch (e) {
    console.error('admin seed failed:', e.code || e.message);
  }

  console.log('\n==== LOGIN CREDENTIALS (password for all: admin123) ====');
  console.log('ADMIN  (portal :3002)  vickymartinsing@gmail.com');
  console.log('\nASTROLOGERS (portal :3001):');
  creds.forEach(([n, em, st]) =>
    console.log(`  ${n.padEnd(22)} ${em.padEnd(34)} [${st}]`));
  console.log('\nDone.');
  process.exit(0);
}
run().catch((err) => { console.error(err); process.exit(1); });
