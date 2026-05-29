import {
  createContext, useContext, useEffect, useRef, useState,
  useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { auth as firebaseAuth } from '@astro/shared';
import { useAuth } from './useAuth';

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
  useEffect(() => {
    if (open && user) {
      const cb = cbRef.current;
      cbRef.current = null; dismissRef.current = null;
      setShown(false);
      setTimeout(() => setOpen(false), 150);
      // Always land on Home after a fresh sign-in / sign-up, unless a
      // specific gated action is pending (then run that instead).
      if (cb) setTimeout(cb, 380);
      else setTimeout(() => router.replace('/dashboard'), 380);
    }
  }, [open, user, router]);

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
    // Already signed in (React state): never show the popup, just run
    // the gated action.
    if (userRef.current) {
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }
    // SECOND defence against the post-signup race: even when React
    // state hasn't hydrated yet, Firebase Auth itself already knows
    // the user is signed in. Check `auth.currentUser` directly so a
    // page that mounts in the brief gap between Firebase sign-in and
    // our useAuth listener firing does NOT pop the login modal again.
    try {
      if (firebaseAuth && firebaseAuth.currentUser) {
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
