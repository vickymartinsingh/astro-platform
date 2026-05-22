// authService, blueprint 8.2. Email + Google only (no phone/SMS OTP).
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { ensureUserDoc, updateUser } from './userService.js';

// True only inside the packaged Android/iOS app (Capacitor injects this
// global). On the web it stays false, so the browser keeps using the
// normal popup flow. No @capacitor/* import here, so the web bundles
// (astro-web / admin-web) are completely unaffected.
function isNativeApp() {
  return typeof window !== 'undefined'
    && !!window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();
}

// The Firestore user record is created by the createUser Cloud Function
// (auth.onCreate trigger). The browser never writes wallet/role.
export async function signupUser(name, email, password, extra = {}) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const full = String(name || '').trim();
  if (full) await updateProfile(cred.user, { displayName: full });
  // Persist name + mandatory mobile number + DOB into the Firestore
  // user doc immediately (DOB also powers the zodiac avatar / personal
  // stars), before the auth-state race can run ensureUserDoc.
  try { await ensureUserDoc(cred.user); } catch (_) {}
  const patch = {};
  if (full) patch.name = full;
  if (extra && extra.phone) patch.phone = String(extra.phone).trim();
  if (extra && extra.dob) patch.dob = extra.dob;
  if (Object.keys(patch).length) {
    try { await updateUser(cred.user.uid, patch); } catch (_) {}
  }
  return cred.user;
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export function watchAuth(callback) {
  // Hard safety: if Firebase failed to initialise (no config in some
  // build) NEVER throw - that white-screens the whole app. Report
  // "signed out" and no-op instead.
  if (!auth) {
    try { callback(null); } catch (_) { /* ignore */ }
    return () => {};
  }
  // Complete any pending Google redirect before/while we start listening,
  // so a redirect sign-in lands the user automatically.
  try { getRedirectResult(auth).catch(() => {}); } catch (_) {}
  try {
    return onAuthStateChanged(auth, callback);
  } catch (_) {
    try { callback(null); } catch (e) { /* ignore */ }
    return () => {};
  }
}

// ---- Google sign-in (free, no SMS) ----
// Web: Firebase popup. Native app: Google blocks OAuth inside Android
// WebViews, so we use the native @capacitor-firebase/authentication
// plugin to get a Google ID token, then sign that token into the same
// Firebase JS SDK so the rest of the app sees the user identically.
export async function loginWithGoogle() {
  if (isNativeApp()) {
    // Capacitor auto-registers the native plugin as a runtime global, so
    // we reach it via window.Capacitor.Plugins WITHOUT a bundler import.
    const plugin = window.Capacitor
      && window.Capacitor.Plugins
      && window.Capacitor.Plugins.FirebaseAuthentication;
    if (plugin) {
      try {
        const result = await plugin.signInWithGoogle();
        const idToken = result && result.credential
          && result.credential.idToken;
        if (idToken) {
          const gCred = GoogleAuthProvider.credential(idToken);
          const cred = await signInWithCredential(auth, gCred);
          return cred.user;
        }
        // No token + no throw -> treat as cancel.
        const e = new Error('cancelled');
        e.code = 'auth/cancelled'; throw e;
      } catch (e) {
        const msg = String((e && (e.message || e.code)) || '');
        // User actually cancelled the picker -> don't fall back.
        if (/cancel|12501|canceled/i.test(msg)) {
          throw e;
        }
        // The plugin uses Android Credential Manager (v8). MANY devices
        // - budget phones, several Chinese ROMs, anything without an
        // up-to-date Credential Manager backend - throw "device doesn't
        // support credential manager" (or other ApiException). In that
        // case fall through to the browser redirect flow below, which
        // works on every device. (allowNavigation in capacitor.config
        // keeps the redirect inside the WebView so it returns cleanly.)
        // eslint-disable-next-line no-console
        console.warn('Native Google sign-in failed, using redirect:', msg);
      }
    }
    // ---- Native fallback: browser redirect inside the WebView ----
    const np = new GoogleAuthProvider();
    np.setCustomParameters({ prompt: 'select_account' });
    await signInWithRedirect(auth, np);
    return null; // resolved by watchAuth/getRedirectResult on return
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Desktop browsers: try the popup (instant, no navigation). Anything
  // else (mobile browsers, PWAs, in-app browsers) -> full-page redirect,
  // which is far more reliable; the result is finalised by watchAuth /
  // resolveGoogleRedirect on the next load.
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent)
    || '';
  const isMobileWeb = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (isMobileWeb) {
    await signInWithRedirect(auth, provider);
    return null;
  }
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (e) {
    const code = e && e.code;
    if ([
      'auth/popup-blocked', 'auth/popup-closed-by-user',
      'auth/cancelled-popup-request', 'auth/web-storage-unsupported',
      'auth/operation-not-supported-in-this-environment',
    ].includes(code)) {
      await signInWithRedirect(auth, provider);
      return null; // browser navigates away; handled on return
    }
    throw e;
  }
}

// Finalise a Google redirect sign-in (no-op for popup/native flows).
// Safe to call on every app load.
export async function resolveGoogleRedirect() {
  try { await getRedirectResult(auth); } catch (_) { /* ignore */ }
}

// ---- Change password (email/password accounts) ----
// Reauthenticates with the current password, then sets the new one.
export async function changePassword(currentPassword, newPassword) {
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error('No email account signed in');
  const cred = EmailAuthProvider.credential(u.email, currentPassword);
  await reauthenticateWithCredential(u, cred);
  await updatePassword(u, newPassword);
}
