import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { brandingService, menuService } from '@astro/shared';

// TOP NAV. Go Online/Offline is NOT here anymore - availability is set
// from the Dashboard (per-service switches). Beside the menu button:
// monochrome Notifications + Earnings shortcuts. Logout lives in
// Profile. Menu is admin-editable via menuService.
function Bell() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
function Life() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M4.7 4.7l4.6 4.6M14.7 14.7l4.6 4.6M19.3 4.7l-4.6 4.6
        M9.3 14.7l-4.6 4.6" />
    </svg>
  );
}

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [brand, setBrand] = useState({ logo: '', name: 'AstroSeer' });
  useEffect(() => brandingService.watchBranding((b) =>
    setBrand({ logo: b.logo || '',
      name: b.name || 'AstroSeer' })), []);
  const [links, setLinks] = useState(menuService.DEFAULT_ASTRO_MENU);
  useEffect(() => menuService.watchMenus(
    (m) => setLinks(m.astro)), []);
  const [iosNative, setIosNative] = useState(false);
  useEffect(() => {
    try {
      const C = typeof window !== 'undefined' ? window.Capacitor : null;
      const ios = C && C.getPlatform && C.getPlatform() === 'ios';
      setIosNative(!!(ios && C.isNativePlatform
        && C.isNativePlatform()));
    } catch (_) { /* ignore */ }
  }, []);
  const showBack = iosNative
    && router.pathname !== '/astro-dashboard';
  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else { router.replace('/astro-dashboard'); }
  }

  const IconBtn = ({ href, label, children }) => (
    <Link href={href} aria-label={label}
      className="rounded-xl border border-gray-200 px-3 py-2
        text-dark-text">
      {children}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100
      bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl items-center
        justify-between px-4 py-3">
        {showBack && (
          <button onClick={goBack} aria-label="Back"
            className="mr-1 rounded-xl border border-gray-200 px-2.5
              py-2 text-dark-text">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <Link href="/astro-dashboard" className="flex items-center gap-2">
          {brand.logo ? (
            <img src={brand.logo} alt={brand.name}
              className="h-9 max-w-[150px] object-contain" />
          ) : (
            <>
              <span className="flex h-9 w-9 items-center justify-center
                rounded-xl bg-gradient-to-br from-primary to-[#8B5CF6]
                font-bold text-white">A</span>
              <span className="leading-tight">
                <span className="block font-bold">{brand.name}</span>
                <span className="block text-[10px] uppercase
                  tracking-wide text-sub-text">Astrologer Portal</span>
              </span>
            </>
          )}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-full px-3 py-2 text-sm font-medium
                transition ${router.pathname === l.href
                  ? 'pill-active' : 'text-dark-text hover:bg-bg-light'}`}>
              {l.label}
            </Link>
          ))}
          <span className="ml-2 flex items-center gap-2">
            <IconBtn href="/astro-notifications" label="Notifications">
              <Bell />
            </IconBtn>
            <IconBtn href="/astro-support" label="Support">
              <Life />
            </IconBtn>
          </span>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <IconBtn href="/astro-notifications" label="Notifications">
            <Bell />
          </IconBtn>
          <IconBtn href="/astro-support" label="Support">
            <Life />
          </IconBtn>
          <button aria-label="Menu"
            className="rounded-xl border border-gray-200 px-3 py-2"
            onClick={() => setOpen((v) => !v)}>{open ? '✕' : '☰'}</button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)} />
          <nav className="absolute right-0 top-0 h-full w-[78%] max-w-xs
            overflow-y-auto bg-white px-4 pb-6 pt-4 shadow-2xl
            animate-[slideIn_.2s_ease-out]">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold">Menu</span>
              <button aria-label="Close" onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-200 px-2.5
                  py-1 text-sm">✕</button>
            </div>
            {links.map((l) => (
              <Link key={l.href} href={l.href}
                onClick={() => setOpen(false)}
                className={`block rounded-xl px-3 py-3 text-base ${
                  router.pathname === l.href
                    ? 'bg-bg-light font-semibold text-primary' : ''}`}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
      <style jsx global>{`
        @keyframes slideIn {
          from { opacity: .4; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </header>
  );
}
