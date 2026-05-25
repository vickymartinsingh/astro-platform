// Shared Firebase client init, used by all three portals.
// Config comes from NEXT_PUBLIC_* env vars (safe for the browser).
//
// Real instances are created at import time for the modules every
// page hits (auth + firestore). The OPTIONAL modules
// (storage / functions / realtime-database) are dynamic-imported on
// first use via getStorageLazy / getFunctionsLazy / getRtdbLazy.
// That keeps roughly 80 KB of brotli-compressed Firebase SDK out of
// the boot _app.js bundle on pages that never need them - which is
// almost every page (home, dashboard, kundli, profile, etc).
//
// The Firebase modular SDK type-checks the singletons (e.g.
// collection(db, ...) verifies db is a real Firestore), so the
// returned objects are NOT wrapped in a Proxy. Init is guarded on the
// API key so a build with no env (bare CI) doesn't throw - the app
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

export const auth = initAuth();
export const db = initDb();

// ---- Lazy modules ---------------------------------------------------
// Each helper:
//   1. Returns the cached instance on second-and-later calls (cheap).
//   2. Dynamically imports the Firebase module on the FIRST call so
//      the boot bundle never pulls it.
//   3. Returns undefined if the global app failed to init (bare-CI
//      build with no config) so callers can early-return without
//      crashing the whole tree.
let _storage; let _storagePromise;
export function getStorageLazy() {
  if (_storage) return Promise.resolve(_storage);
  if (!app) return Promise.resolve(undefined);
  if (_storagePromise) return _storagePromise;
  _storagePromise = import('firebase/storage').then((m) => {
    _storage = m.getStorage(app);
    return _storage;
  }).catch(() => undefined);
  return _storagePromise;
}

let _functions; let _functionsPromise;
export function getFunctionsLazy() {
  if (_functions) return Promise.resolve(_functions);
  if (!app) return Promise.resolve(undefined);
  if (_functionsPromise) return _functionsPromise;
  _functionsPromise = import('firebase/functions').then((m) => {
    _functions = m.getFunctions(app);
    return _functions;
  }).catch(() => undefined);
  return _functionsPromise;
}

let _rtdb; let _rtdbPromise;
export function getRtdbLazy() {
  if (_rtdb) return Promise.resolve(_rtdb);
  if (!app || !firebaseConfig.databaseURL) {
    return Promise.resolve(undefined);
  }
  if (_rtdbPromise) return _rtdbPromise;
  _rtdbPromise = import('firebase/database').then((m) => {
    _rtdb = m.getDatabase(app);
    return _rtdb;
  }).catch(() => undefined);
  return _rtdbPromise;
}

// Back-compat: the old sync exports stay declared so old imports
// resolve, but they're undefined until the matching getXxxLazy() is
// awaited. Callers that used to read `storage` / `functions` / `rtdb`
// at the top level must now `await getStorageLazy()` etc inside the
// async function that needs the instance. The handful of services
// that still use them have all been migrated to the lazy form (see
// chatService, recordService, presenceService, walletService etc).
export const storage = undefined;
export const functions = undefined;
export const rtdb = undefined;

export default app;
