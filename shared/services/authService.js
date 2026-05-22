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
// Server (web) OAuth client id - used as serverClientId for the native
// Google account picker so the returned ID token is accepted by Firebase.
const GOOGLE_WEB_CLIENT_ID =
  '402763204723-1f0mff93i07o9i481eg2u24mk43si5t6.apps.googleusercontent.com';

// Sign a Google ID token into the Firebase JS SDK so the rest of the app
// sees the user identically to the web popup flow.
async function finishGoogle(idToken) {
  if (!idToken) {
    const e = new Error('cancelled'); e.code = 'auth/cancelled'; throw e;
  }
  const cred = await signInWithCredential(
    auth, GoogleAuthProvider.credential(idToken));
  return cred.user;
}

function isCancel(msg) {
  return /cancel|12501|canceled|popup_closed/i.test(String(msg || ''));
}

export async function loginWithGoogle() {
  if (isNativeApp()) {
    const P = (window.Capacitor && window.Capacitor.Plugins) || {};
    // 1) @capacitor-firebase/authentication -> native picker via Android
    //    Credential Manager. Works on modern devices; throws on many
    //    budget / older ROMs ("device doesn't support credential manager").
    const fb = P.FirebaseAuthentication;
    if (fb) {
      try {
        const r = await fb.signInWithGoogle();
        const idToken = r && r.credential && r.credential.idToken;
        if (idToken) return await finishGoogle(idToken);
      } catch (e) {
        const msg = (e && (e.message || e.code)) || '';
        if (isCancel(msg)) throw e; // real user cancel -> stop
        // eslint-disable-next-line no-console
        console.warn('Credential Manager sign-in failed, trying GoogleAuth:',
          msg);
      }
    }
    // 2) @codetrix-studio/capacitor-google-auth -> classic Google Play
    //    Services account picker. No Credential Manager, no WebView, so
    //    it is NOT blocked by Google's "secure browsers" policy (the
    //    disallowed_useragent / 403 we saw with the redirect flow). This
    //    is the reliable path for devices without Credential Manager.
    const ga = P.GoogleAuth;
    if (ga) {
      try {
        if (ga.initialize) {
          await ga.initialize({
            clientId: GOOGLE_WEB_CLIENT_ID,
            scopes: ['profile', 'email'],
            grantOfflineAccess: true,
          });
        }
        const g = await ga.signIn();
        const idToken = (g && ((g.authentication && g.authentication.idToken)
          || g.idToken)) || '';
        return await finishGoogle(idToken);
      } catch (e) {
        const msg = (e && (e.message || e.code)) || '';
        if (isCancel(msg)) throw e;
        // eslint-disable-next-line no-console
        console.warn('GoogleAuth sign-in failed:', msg);
        throw e; // no safe WebView fallback (Google blocks it)
      }
    }
    const e = new Error('Google sign-in is unavailable on this device');
    e.code = 'auth/operation-not-supported-in-this-environment';
    throw e;
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
