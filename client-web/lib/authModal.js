import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import LoginCard from '../components/LoginCard';
import { useAuth } from './useAuth';

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
      if (cb) setTimeout(cb, 380);
    }
  }, [open, user]);

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

  function openLogin(onSuccess, opts = {}) {
    // Already signed in: never show the popup, just run the action.
    if (user) { if (typeof onSuccess === 'function') onSuccess(); return; }
    cbRef.current = typeof onSuccess === 'function' ? onSuccess : null;
    dismissRef.current = typeof opts.onDismiss === 'function'
      ? opts.onDismiss : null;
    setMode(opts.mode === 'signup' ? 'signup' : 'login');
    setOpen(true);
  }
  function closeLogin() { setOpen(false); }

  function done() {
    const cb = cbRef.current;
    cbRef.current = null; dismissRef.current = null;
    setShown(false);
    setTimeout(() => setOpen(false), 180);
    if (cb) setTimeout(cb, 420);
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

  return (
    <Ctx.Provider value={{ openLogin, closeLogin }}>
      {children}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </Ctx.Provider>
  );
}

export function useAuthModal() { return useContext(Ctx); }
