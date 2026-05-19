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
import {
  getAuth, initializeAuth, indexedDBLocalPersistence,
  browserLocalPersistence, inMemoryPersistence,
  browserPopupRedirectResolver,
} from 'firebase/auth';
import {
  getFirestore, initializeFirestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getDatabase } from 'firebase/database';

// The Firebase WEB config is NOT secret (it ships in every client and
// the Android APK already). Baking it as a default - with env override
// still winning - means env-less builds (the iOS CI workflow, bare CI)
// initialise Firebase too, instead of crashing with `auth` undefined.
const E = (typeof process !== 'undefined' && process.env) || {};
const firebaseConfig = {
  apiKey: E.NEXT_PUBLIC_FIREBASE_API_KEY
    || 'AIzaSyB8uaBVHBjCsZj571O-urWntwJBMoUv5dQ',
  authDomain: E.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    || 'astrology-2092d.firebaseapp.com',
  projectId: E.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'astrology-2092d',
  storageBucket: E.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || 'astrology-2092d.firebasestorage.app',
  messagingSenderId: E.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
    || '402763204723',
  appId: E.NEXT_PUBLIC_FIREBASE_APP_ID
    || '1:402763204723:web:b041d334be1eae5d498206',
  databaseURL: E.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '',
};

const hasConfig = !!firebaseConfig.apiKey;
let app = null;
try {
  if (hasConfig) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
} catch (_) { app = null; }

// iOS WKWebView under the capacitor:// custom scheme is the classic
// "works on web/Android, breaks on iOS" environment for Firebase:
//  - Firestore's default fetch-stream / WebChannel transport can hang
//    -> use experimentalAutoDetectLongPolling so it falls back itself.
//  - IndexedDB / localStorage can be unavailable -> Auth persistence
//    falls back indexedDB -> localStorage -> in-memory instead of
//    throwing auth/web-storage-unsupported at init.
// Every init is wrapped so one failure can NEVER white-screen the app.
function initAuth() {
  if (!app) return undefined;
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        inMemoryPersistence,
      ],
      // REQUIRED for signInWithPopup / signInWithRedirect. Unlike
      // getAuth(), initializeAuth() does NOT bundle the resolver, so
      // Google sign-in throws auth/argument-error without this.
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (_) {
    try { return getAuth(app); } catch (e) { return undefined; }
  }
}
function initDb() {
  if (!app) return undefined;
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch (_) {
    try { return getFirestore(app); } catch (e) { return undefined; }
  }
}
function safe(fn) { try { return fn(); } catch (_) { return undefined; } }

export const auth = initAuth();
export const db = initDb();
export const storage = safe(() => (app ? getStorage(app) : undefined));
export const functions = safe(
  () => (app ? getFunctions(app) : undefined));
export const rtdb = safe(() => ((app && firebaseConfig.databaseURL)
  ? getDatabase(app) : undefined));
export default app;
