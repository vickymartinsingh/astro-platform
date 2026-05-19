import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

// Global on-screen BACK for the native apps (Android APK + iOS), shown
// top-left on every screen that needs it. Pages that render <TopNav/>
// already have an in-header back button (tagged [data-topnav]); on
// those this defers so there is never a double button. Full-screen
// pages (tarot, call, session, login...) get this floating one.
//
// Web is untouched (browsers have their own back).
const ROOTS = ['/', '/dashboard'];
const HOME = '/dashboard';

export default function NativeBack() {
  const router = useRouter();
  const [native, setNative] = useState(false);
  const [hasTopNav, setHasTopNav] = useState(true);

  useEffect(() => {
    try {
      const C = typeof window !== 'undefined' ? window.Capacitor : null;
      setNative(!!(C && C.isNativePlatform && C.isNativePlatform()));
    } catch (_) { /* ignore */ }
  }, []);

  // Re-check for a TopNav after every navigation (it mounts post-paint).
  useEffect(() => {
    let raf1;
    let raf2;
    const check = () => {
      try {
        setHasTopNav(!!document.querySelector('[data-topnav]'));
      } catch (_) { setHasTopNav(false); }
    };
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(check); });
    const t = setTimeout(check, 250);
    return () => {
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, [router.asPath]);

  if (!native) return null;
  if (ROOTS.includes(router.pathname)) return null;
  if (hasTopNav) return null;

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else { router.replace(HOME); }
  };

  return (
    <button
      onClick={goBack}
      aria-label="Back"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        left: 'calc(env(safe-area-inset-left, 0px) + 10px)',
      }}
      className="fixed z-[2147483600] flex h-10 w-10 items-center
        justify-center rounded-full border border-white/25
        bg-black/45 text-white shadow-lg backdrop-blur-md
        active:scale-95 transition">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
