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
  getAdditionalUserInfo,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { ensureUserDoc, updateUser } from './userService.js';
import { logEvent as logAudit } from './auditService.js';

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
  if (extra && extra.gender) patch.gender = String(extra.gender).trim();
  if (Object.keys(patch).length) {
    try { await updateUser(cred.user.uid, patch); } catch (_) {}
  }
  // Compliance: log the signup with IP + device (admin-only).
  try { logAudit('signup', { method: 'email', email }); } catch (_) {}
  // Fire-and-forget the welcome email through the relay. The relay
  // is idempotent (writes welcomeEmailSentAt on users/{uid}) and
  // honours the admin toggle, so safe to call from every signup
  // path without coordination.
  sendWelcomeEmail({
    uid: cred.user.uid, email, name: full,
  }).catch(() => {});
  return cred.user;
}

// Fires the welcome email via the relay. Idempotent + honors the
// admin toggle on settings/email server-side, so the client is just
// the trigger. Used both for email/password signup and for first-
// time Google sign-in (when the user doc was just created).
export async function sendWelcomeEmail({ uid, email, name }) {
  try {
    const r = await fetch(otpEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'welcome', uid, email, name,
      }),
    });
    return r.json().catch(() => ({}));
  } catch (_) { return { ok: false }; }
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try { logAudit('login', { method: 'email', email }); } catch (_) {}
  return cred.user;
}

// ---- Email OTP signup verification ----------------------------------
// Talks to the relay's /api/emailOtp endpoint. Two actions:
//   requestEmailOtp(email, name)  -> sends a 6-digit code from
//                                    support@astroseer.in (SMTP via
//                                    admin's settings/email config).
//   verifyEmailOtp(email, code)   -> checks the code and flips the
//                                    Auth user's emailVerified flag.
// Throws Error with the human-readable relay message on failure.
function otpEndpoint() {
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/emailOtp')
    : 'https://astro-platform-push-relay.vercel.app/api/emailOtp';
}

export async function requestEmailOtp(email, name) {
  const r = await fetch(otpEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'request', email, name }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error
    || `OTP request failed (HTTP ${r.status}).`);
  return j;
}

export async function verifyEmailOtp(email, code) {
  const r = await fetch(otpEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', email, code }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error
    || `OTP verify failed (HTTP ${r.status}).`);
  return j;
}

// ---- Forgot-password (combined link + OTP) -------------------------
// Talks to the relay's /api/emailOtp endpoint with new actions:
//   requestPasswordReset(email) -> { ok, exists, sent }
//   verifyPasswordResetOtp(email, code, newPassword) -> { ok, updated }
// Returns the server response shape so the UI can branch on
// exists:false (no account) vs sent:true (email exists, code sent).
export async function requestPasswordReset(email) {
  // Primary path: relay's combined link + OTP email (knows whether
  // the account exists, sends both options in one email).
  try {
    const r = await fetch(otpEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resetRequest', email }),
    });
    const j = await r.json().catch(() => ({}));
    // Only treat as success if the relay actually accepted the
    // action. The OLD relay returns 400 with this exact string when
    // it does not recognise resetRequest yet (Vercel deploy lagging).
    const unknownAction = j && j.error
      && /action must be/i.test(String(j.error));
    if (!r.ok || unknownAction) {
      throw new Error(unknownAction
        ? 'relay-not-deployed'
        : (j.error || `HTTP ${r.status}`));
    }
    return j;
  } catch (e1) {
    // Fallback: Firebase's built-in password reset. Loses the OTP
    // option (link only) and cannot tell us if the account exists
    // (Firebase always returns 200). But it always WORKS, even when
    // our relay is down or mid-deploy. Better than a dead button.
    try {
      await sendPasswordResetEmail(auth, String(email).trim());
      return {
        ok: true,
        exists: true, // Firebase doesn't tell us; assume yes.
        sent: true,
        fallback: true,
      };
    } catch (e2) {
      // Map Firebase codes back to readable errors.
      if (e2 && e2.code === 'auth/user-not-found') {
        return { ok: true, exists: false };
      }
      throw new Error(e1.message === 'relay-not-deployed'
        ? 'Password reset is temporarily unavailable. Please try '
          + 'again in a minute.'
        : (e2 && e2.message) || 'Could not send reset email.');
    }
  }
}

export async function verifyPasswordResetOtp(email, code, newPassword) {
  const r = await fetch(otpEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'resetVerify', email, code, newPassword,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error
    || `Reset verify failed (HTTP ${r.status}).`);
  return j;
}

// Verify the OTP only - do NOT consume it. Lets the UI show "OTP
// matched, now pick a new password" before the password is even
// chosen. Returns { ok: true, valid: true } on success or throws
// with the relay's user-readable error.
export async function checkPasswordResetOtp(email, code) {
  const r = await fetch(otpEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'resetCheckOtp', email, code,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error
    || `Code check failed (HTTP ${r.status}).`);
  return j;
}

export async function logoutUser() {
  // Log BEFORE signing out so the audit POST still has a fresh ID token.
  try { await logAudit('logout', {}); } catch (_) {}
  // Trace EVERY logout call with a stack so we can find the culprit
  // when the user reports "I keep getting logged out". Production
  // builds can be patched to comment this out if it gets noisy.
  try {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[authService.logoutUser] called from:',
        new Error('stack').stack);
    }
  } catch (_) {}
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
  try { logAudit('login', { method: 'google',
    email: cred.user && cred.user.email }); } catch (_) {}
  // First-time Google user: send the welcome touch through the relay
  // (server-side idempotency makes a repeat call safe).
  try {
    const info = getAdditionalUserInfo(cred);
    if (info && info.isNewUser && cred.user && cred.user.email) {
      sendWelcomeEmail({
        uid: cred.user.uid,
        email: cred.user.email,
        name: cred.user.displayName || '',
      }).catch(() => {});
    }
  } catch (_) { /* tolerate */ }
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
    try { logAudit('login', { method: 'google-popup',
      email: cred.user && cred.user.email }); } catch (_) {}
    try {
      const info = getAdditionalUserInfo(cred);
      if (info && info.isNewUser && cred.user && cred.user.email) {
        sendWelcomeEmail({
          uid: cred.user.uid,
          email: cred.user.email,
          name: cred.user.displayName || '',
        }).catch(() => {});
      }
    } catch (_) { /* tolerate */ }
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
  try {
    const r = await getRedirectResult(auth);
    if (r && r.user) {
      try { logAudit('login', { method: 'google-redirect',
        email: r.user.email }); } catch (_) {}
    }
  } catch (_) { /* ignore */ }
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
