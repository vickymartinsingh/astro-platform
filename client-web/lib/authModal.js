import {
  createContext, useContext, useEffect, useRef, useState,
  useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { auth as firebaseAuth, authService } from '@astro/shared';
import { useAuth } from './useAuth';
import { useSettings } from './useSettings';

// LoginCard is the single biggest chrome dep on the boot path (~140 KB
// minified - it pulls Firebase Auth flows, OTP plumbing, Google sign-in
// helpers). It is only visible when the auth modal opens, so we ship
// it in its own chunk that the browser fetches on demand. Until the
// chunk lands the overlay shows a lightweight spinner, then swaps in
// the real card with no layout shift.
const LoginCard = dynamic(() => import('../components/LoginCard'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl bg-white p-10 text-center text-sm
                    text-gray-500">
      Loading sign-in…
    </div>
  ),
});

// Global login popup. openLogin(onSuccess, { onDismiss }).
// Closes ONLY on: successful login, the X / "Maybe later" buttons, or a
// route change (clicking another menu). Clicking the backdrop or the same
// gated button again does NOT close it. Rendered in a body portal.
const Ctx = createContext({ openLogin: () => {}, closeLogin: () => {} });

export function AuthModalProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [shown, setShown] = useState(false); // drives enter/exit animation
  const [mounted, setMounted] = useState(false);
  const cbRef = useRef(null);
  const dismissRef = useRef(null);
  const router = useRouter();
  const { user } = useAuth();
  const { features: settingsFeatures } = useSettings();
  // Latest values for the STABLE callbacks below (so openLogin's identity
  // never changes -> gated pages do not re-fire it in a loop -> the
  // login popup no longer flickers open/closed during sign-in).
  const userRef = useRef(user);
  const openRef = useRef(open);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => { setMounted(true); }, []);

  // The instant auth succeeds (email, Google, redirect, anything) close
  // the popup and run any pending action. This guarantees the login
  // popup never lingers once the user is signed in.
  //
  // EXCEPTION: when the modal is in SIGNUP mode AND the freshly-
  // created Firebase user is not yet email-verified, we keep the
  // modal OPEN so LoginCard's OTP screen has time to render. The
  // user types the OTP, verifyOtp() reloads the user (flipping
  // emailVerified to true), this effect re-fires, and the modal
  // closes normally. For LOGIN mode we never block - the user said
  // OTP must not be re-asked on subsequent logins.
  useEffect(() => {
    if (!open || !user) return;
    // HARD BLOCK on OTP-in-progress. LoginCard sets the
    // window.__pendingSignupOtp flag the instant it starts the
    // signup OTP send and clears it only on successful verify. The
    // flag is the most reliable signal because it bypasses every
    // race with useSettings hydration / Firestore snapshot timing.
    // If the flag is set AND the Firebase user matches it AND that
    // user is not yet verified, we KEEP THE MODAL OPEN.
    try {
      if (typeof window !== 'undefined') {
        const flag = window.__pendingSignupOtp;
        // Accept the flag even when uid is empty (LoginCard sets
        // the flag BEFORE signupUser returns so the auto-close race
        // is lost otherwise) OR when it matches the current user's
        // uid. In either case, if the Firebase user is not verified,
        // keep the modal open until OTP completes.
        if (flag && !user.emailVerified
          && (!flag.uid || flag.uid === user.uid)) {
          return; // wait for OTP verify
        }
      }
    } catch (_) { /* tolerate */ }
    const cb = cbRef.current;
    cbRef.current = null; dismissRef.current = null;
    setShown(false);
    setTimeout(() => setOpen(false), 150);
    if (cb) setTimeout(cb, 380);
    else setTimeout(() => router.replace('/dashboard'), 380);
  }, [open, user, router, mode]);

  // Smoothly animate in after mount.
  useEffect(() => {
    if (open) { const t = setTimeout(() => setShown(true), 10);
      return () => clearTimeout(t); }
    setShown(false);
  }, [open]);

  // Close when navigating to another page (route change).
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on('routeChangeStart', close);
    return () => router.events.off('routeChangeStart', close);
  }, [router.events]);

  const openLogin = useCallback((onSuccess, opts = {}) => {
    // Helper: is this signed-in user blocked by the OTP gate? When the
    // admin requires email verification AND the Firebase user has not
    // verified yet, the customer is treated as NOT signed in for the
    // purpose of running the gated action - we MUST show the modal so
    // they can complete OTP. Otherwise an unverified click would skip
    // straight past verification.
    const otpBlocked = (u) => {
      try {
        const f = JSON.parse(
          (typeof localStorage !== 'undefined'
            && localStorage.getItem('settings_features')) || '{}');
        return !!(f && f.email_verification === true
          && u && !u.emailVerified);
      } catch (_) { return false; }
    };
    // Already signed in (React state) AND verified: run the gated
    // action without showing the popup.
    if (userRef.current && !otpBlocked(userRef.current)) {
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }
    // SECOND defence: even when React state has not hydrated yet,
    // Firebase Auth itself already knows the user is signed in.
    // Still check the OTP gate so we never let an unverified user
    // through.
    try {
      const fbUser = firebaseAuth && firebaseAuth.currentUser;
      if (fbUser && !otpBlocked(fbUser)) {
        if (typeof onSuccess === 'function') onSuccess();
        return;
      }
    } catch (_) { /* defensive */ }
    // Already open: do NOT reopen / reset (kills the flicker loop).
    if (openRef.current) return;
    cbRef.current = typeof onSuccess === 'function' ? onSuccess : null;
    dismissRef.current = typeof opts.onDismiss === 'function'
      ? opts.onDismiss : null;
    setMode(opts.mode === 'signup' ? 'signup' : 'login');
    setOpen(true);
  }, []);
  const closeLogin = useCallback(() => { setOpen(false); }, []);

  function done() {
    const cb = cbRef.current;
    cbRef.current = null; dismissRef.current = null;
    setShown(false);
    setTimeout(() => setOpen(false), 180);
    if (cb) setTimeout(cb, 420);
    else setTimeout(() => router.replace('/dashboard'), 420);
  }
  function dismiss() {
    const d = dismissRef.current;
    cbRef.current = null; dismissRef.current = null;
    // SIGNUP-OTP ROLLBACK: when the customer dismisses the modal in
    // the middle of an OTP-gated signup, delete the freshly-created
    // Firebase user so the signup is truly atomic. Per user rule:
    // "without OTP signup should not be processed."
    try {
      const flag = (typeof window !== 'undefined')
        && window.__pendingSignupOtp;
      const fb = firebaseAuth && firebaseAuth.currentUser;
      if (flag && fb && fb.uid === flag.uid && !fb.emailVerified) {
        // Fire-and-forget. delete() on a freshly-created user
        // succeeds without re-auth because the credential is recent.
        fb.delete().catch(() => {
          // Best-effort: if delete fails (token expired etc.) at
          // least sign them out so the modal does not keep
          // re-opening behind their back.
          try { authService.logoutUser(); } catch (_) {}
        });
        try { delete window.__pendingSignupOtp; } catch (_) {}
      }
    } catch (_) {}
    setShown(false);
    setTimeout(() => setOpen(false), 180);
    if (d) setTimeout(d, 200);
  }

  const overlay = open ? (
    <div
      className={`fixed inset-0 z-[2147483646] flex items-center
        justify-center p-4 transition-opacity duration-200
        ${shown ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(16,11,38,.86)', isolation: 'isolate',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
    >
      <div
        className={`relative w-full max-w-md transition-all duration-300
          ${shown ? 'translate-y-0 scale-100 opacity-100'
            : 'translate-y-4 scale-95 opacity-0'}`}
      >
        <button onClick={dismiss} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center
                     justify-center rounded-full bg-white/25 text-white
                     transition hover:bg-white/40">
          ✕
        </button>
        <LoginCard compact initialMode={mode} onDone={done} />
        <button onClick={dismiss}
          className="mt-3 block w-full text-center text-sm
                     font-medium text-white/90 hover:text-white">
          Maybe later
        </button>
      </div>
    </div>
  ) : null;

  const ctxValue = useMemo(
    () => ({ openLogin, closeLogin }), [openLogin, closeLogin]);

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </Ctx.Provider>
  );
}

export function useAuthModal() { return useContext(Ctx); }
