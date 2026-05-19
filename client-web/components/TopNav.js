import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  authService, notificationService, brandingService, menuService,
} from '@astro/shared';
import { useAuth } from '../lib/useAuth';
import { useAuthModal } from '../lib/authModal';
import { useI18n } from '../lib/i18n';
import { useSettings } from '../lib/useSettings';

// Hard Rule 1: TOP NAV ONLY. White premium header; on mobile it collapses
// to a hamburger that drops DOWN (never a side drawer). Account-related
// links live under a "Profile" sub menu (dropdown).
// Menus are admin-editable; defaults + live overrides via menuService.

// Group a menu list into ordered segments for a clean breakup.
const SEG_ORDER = ['Activity', 'Account', 'Help'];
function grouped(items) {
  const g = {};
  items.forEach((m) => {
    const s = m.seg || 'Account';
    if (!g[s]) g[s] = [];
    g[s].push(m);
  });
  const order = [
    ...SEG_ORDER.filter((s) => g[s]),
    ...Object.keys(g).filter((s) => !SEG_ORDER.includes(s)),
  ];
  return order.map((s) => [s, g[s]]);
}

// Monochrome (no colour) outline bell for the notifications shortcut.
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
// Monochrome wallet icon for the quick wallet shortcut.
function Wallet() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H3z" />
      <path d="M3 9v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H6" />
      <circle cx="17" cy="14" r="1.4" />
    </svg>
  );
}

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [prof, setProf] = useState(false);
  const [unread, setUnread] = useState(0);
  const [brand, setBrand] = useState({ logo: '', name: 'AstroConnect' });
  const [menu, setMenu] = useState(menuService.DEFAULT_CLIENT_MENU);
  const [menuMobile, setMenuMobile] = useState(
    menuService.DEFAULT_CLIENT_MENU);
  const [profileMenu, setProfileMenu] = useState(
    menuService.DEFAULT_CLIENT_PROFILE);
  const router = useRouter();
  useEffect(() => menuService.watchMenus((m) => {
    setMenu(m.menu);
    setMenuMobile(m.menuMobile || m.menu);
    setProfileMenu(m.profile);
  }), []);
  const { user, profile } = useAuth();
  const { openLogin } = useAuthModal();
  const { t } = useI18n();
  const { features } = useSettings();
  // iOS has no hardware back button - show an on-screen one.
  const [iosNative, setIosNative] = useState(false);
  useEffect(() => {
    try {
      const C = typeof window !== 'undefined' ? window.Capacitor : null;
      const ios = C && C.getPlatform && C.getPlatform() === 'ios';
      setIosNative(!!(ios && C.isNativePlatform
        && C.isNativePlatform()));
    } catch (_) { /* ignore */ }
  }, []);
  const ROOTS = ['/', '/dashboard'];
  const showBack = iosNative && !ROOTS.includes(router.pathname);
  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else { router.replace('/dashboard'); }
  }
  // Admin choice for what shows beside the Profile dropdown when signed
  // in: 'logout' (default), 'name' (user's full name), 'hidden'.
  const sideMode = (features && features.desktop_profile_side)
    || 'logout';

  useEffect(() => {
    if (!user) return;
    return notificationService.listenNotifications(user.uid, (list) =>
      setUnread(list.filter((n) => !n.read).length));
  }, [user]);

  useEffect(() => brandingService.watchBranding((b) =>
    setBrand({ logo: b.logo || '',
      name: b.name || 'AstroConnect' })), []);

  useEffect(() => { setOpen(false); setProf(false); }, [router.asPath]);

  async function logout() {
    await authService.logoutUser();
    router.replace('/dashboard');
  }

  const profActive = profileMenu.some((m) => m.href === router.pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between
                      px-4 py-3">
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
        <Link href="/dashboard" className="flex items-center gap-2">
          {brand.logo ? (
            <img src={brand.logo} alt={brand.name}
              className="h-9 max-w-[150px] object-contain" />
          ) : (
            <>
              <span className="flex h-9 w-9 items-center justify-center
                               rounded-xl bg-gradient-to-br from-primary
                               to-[#8B5CF6] font-bold text-white">A</span>
              <span className="leading-tight">
                <span className="block font-bold">{brand.name}</span>
                <span className="block text-[10px] uppercase
                  tracking-wide text-sub-text">Trusted Astrologers</span>
              </span>
            </>
          )}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {menu.map((l) => {
            const active = router.pathname === l.href;
            return (
              <Link key={l.href} href={l.href}
                className={`rounded-full px-3 py-2 text-sm font-medium
                  transition ${active
                    ? 'pill-active' : 'text-dark-text hover:bg-bg-light'}`}>
                {l.label}
              </Link>
            );
          })}

          {/* Profile sub menu */}
          <div className="relative">
            <button onClick={() => setProf((v) => !v)}
              className={`relative rounded-full px-3 py-2 text-sm
                font-medium transition ${profActive
                  ? 'pill-active' : 'text-dark-text hover:bg-bg-light'}`}>
              {t('nav.profile')} ▾
              {unread > 0 && (
                <span className="badge absolute -right-1 -top-1
                  bg-rose-500 text-white">{unread}</span>
              )}
            </button>
            {prof && (
              <div className="absolute right-0 z-50 mt-1 w-56 rounded-2xl
                              border border-gray-100 bg-white p-1 shadow-lg">
                {grouped(profileMenu).map(([seg, items]) => (
                  <div key={seg} className="border-b border-gray-100
                    pb-1 last:border-0">
                    <div className="px-3 pb-0.5 pt-2 text-[10px]
                      font-semibold uppercase tracking-wide text-sub-text">
                      {seg}
                    </div>
                    {items.map((m) => (
                      <Link key={m.href} href={m.href}
                        onClick={() => setProf(false)}
                        className="flex items-center justify-between
                          rounded-xl px-3 py-2.5 text-sm hover:bg-bg-light">
                        {m.label}
                        {m.notif && unread > 0 && (
                          <span className="badge bg-rose-500 text-white">
                            {unread}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                ))}
                {user && (
                  <button onClick={logout}
                    className="mt-1 w-full rounded-xl px-3 py-2.5 text-left
                               text-sm text-danger hover:bg-bg-light">
                    Logout
                  </button>
                )}
              </div>
            )}
          </div>

          {user ? (
            sideMode === 'hidden' ? null
              : sideMode === 'name' ? (
                <Link href="/profile"
                  className="ml-2 max-w-[160px] truncate rounded-full
                    border border-gray-200 px-4 py-2 text-sm
                    font-semibold hover:bg-bg-light"
                  title={profile?.name || 'My account'}>
                  {profile?.name || 'My account'}
                </Link>
              ) : (
                <button onClick={logout}
                  className="ml-2 rounded-full border border-gray-200
                    px-4 py-2 text-sm font-semibold hover:bg-bg-light">
                  {t('nav.logout')}
                </button>
              )
          ) : (
            <>
              <button onClick={() => openLogin()}
                className="ml-2 rounded-full border border-gray-200 px-4
                           py-2 text-sm font-semibold hover:bg-bg-light">
                {t('auth.login')}
              </button>
              <button onClick={() => openLogin(undefined, { mode: 'signup' })}
                className="btn-grad ml-1">
                {t('auth.signup')}
              </button>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <Link href="/wallet" aria-label="Wallet" data-tour="top-wallet"
            className="rounded-xl border border-gray-200 px-3 py-2
                       text-dark-text">
            <Wallet />
          </Link>
          <Link href="/notifications" aria-label="Notifications"
            data-tour="top-bell"
            className="relative rounded-xl border border-gray-200 px-3
                       py-2 text-dark-text">
            <Bell />
            {unread > 0 && (
              <span className="badge absolute -right-1 -top-1
                bg-rose-500 text-white">{unread}</span>
            )}
          </Link>
          <button aria-label="Menu" data-tour="top-menu"
            className="rounded-xl border border-gray-200 px-3 py-2"
            onClick={() => setOpen((v) => !v)}>
            {open ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)} />
          <nav className="absolute right-0 top-0 flex h-full w-[78%]
                          max-w-xs flex-col bg-white shadow-2xl
                          animate-[slideIn_.2s_ease-out]">
          {/* Fixed top: close + auth always visible (never scrolls away) */}
          <div className="border-b border-gray-100 px-4 pb-3 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold">Menu</span>
              <button aria-label="Close" onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-200 px-2.5 py-1
                           text-sm">✕</button>
            </div>
            {/* Logout lives in Profile now, so it is not repeated here.
                Guests still get login / signup. */}
            {!user && (
              <div className="flex gap-2">
                <button onClick={() => openLogin()}
                  className="flex-1 rounded-xl border border-gray-200 px-3
                             py-3 text-center text-base font-semibold">
                  {t('auth.login')}
                </button>
                <button
                  onClick={() => openLogin(undefined, { mode: 'signup' })}
                  className="btn-grad flex-1 justify-center py-3 text-base">
                  {t('auth.signup')}
                </button>
              </div>
            )}
          </div>
          {/* Scrollable links - clean segments. Extra bottom padding
              so the last items (Help) are never hidden behind the
              bottom tab bar. */}
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-safe-nav">
            <div className="px-3 pb-1 text-xs font-semibold uppercase
              tracking-wide text-sub-text">Explore</div>
            {menuMobile.map((l) => (
              <Link key={l.href} href={l.href}
                className={`block rounded-xl px-3 py-3 text-base ${
                  router.pathname === l.href
                    ? 'bg-bg-light font-semibold text-primary' : ''}`}>
                {l.label}
              </Link>
            ))}
            {grouped(profileMenu).map(([seg, items]) => (
              <div key={seg} className="mt-2 border-t border-gray-100
                pt-2">
                <div className="px-3 pb-1 text-xs font-semibold uppercase
                                tracking-wide text-sub-text">
                  {seg}
                </div>
                {items.map((m) => (
                  <Link key={m.href} href={m.href}
                    className={`flex items-center justify-between rounded-xl
                      px-3 py-3 text-base ${router.pathname === m.href
                        ? 'bg-bg-light font-semibold text-primary' : ''}`}>
                    {m.label}
                    {m.notif && unread > 0 && (
                      <span className="badge bg-rose-500 text-white">
                        {unread}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          </nav>
        </div>
      )}
      <style jsx global>{`
        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideIn {
          from { opacity: .4; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </header>
  );
}
