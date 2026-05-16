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
  signInWithCredential,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../firebase.js';

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
export async function signupUser(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
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
  return onAuthStateChanged(auth, callback);
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
    // (Importing '@capacitor-firebase/authentication' would drag its web
    // build into webpack and break the static export.)
    const plugin = window.Capacitor
      && window.Capacitor.Plugins
      && window.Capacitor.Plugins.FirebaseAuthentication;
    if (!plugin) throw new Error('Google sign-in is unavailable');
    const result = await plugin.signInWithGoogle();
    const idToken = result && result.credential && result.credential.idToken;
    if (!idToken) throw new Error('Google sign-in was cancelled');
    const gCred = GoogleAuthProvider.credential(idToken);
    const cred = await signInWithCredential(auth, gCred);
    return cred.user;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
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
