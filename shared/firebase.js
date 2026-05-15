// Shared Firebase client init, used by all three portals.
// Config comes from NEXT_PUBLIC_* env vars (safe for the browser).
//
// Real instances are created at import time. The Firebase modular SDK
// type-checks these objects (e.g. collection(db...) verifies db is a
// real Firestore), so they must NOT be wrapped in a Proxy. Init is guarded
// on the API key so a build with no env (bare CI) doesn't throw, the app
// genuinely can't run without config, which is expected. rtdb is
// additionally gated on the database URL being set.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

const hasConfig = !!firebaseConfig.apiKey;
const app = hasConfig
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const auth = app ? getAuth(app) : undefined;
export const db = app ? getFirestore(app) : undefined;
export const storage = app ? getStorage(app) : undefined;
export const functions = app ? getFunctions(app) : undefined;
export const rtdb = (app && firebaseConfig.databaseURL)
  ? getDatabase(app) : undefined;
export default app;
