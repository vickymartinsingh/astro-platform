import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService, brandingService } from '@astro/shared';

// Professional grouped admin nav: a search box that jumps to any page,
// plus category dropdowns. Every admin page is included (nothing
// removed) - just organised so it is easy to find.
const GROUPS = [
  ['Overview', [
    ['/admin-dashboard', 'Dashboard'],
    ['/admin-analytics', 'Analytics'],
    ['/admin-reports', 'Reports'],
    ['/admin-audit', 'Audit Log'],
    ['/admin-health', 'System Health'],
  ]],
  ['People', [
    ['/admin-users', 'Users'],
    ['/admin-astrologers', 'Astrologers'],
    ['/admin-reviews', 'Customer Reviews'],
    ['/admin-tickets', 'Support Tickets'],
    ['/admin-tarot', 'Tarot Questions'],
    ['/admin-support', 'Support Inbox'],
  ]],
  ['Sessions', [
    ['/admin-sessions', 'Sessions'],
    ['/admin-live', 'Monitor Live'],
    ['/admin-recordings', 'Recordings & Live'],
    ['/admin-hours', 'Astrologer Hours'],
  ]],
  ['Finance', [
    ['/admin-transactions', 'Transactions'],
    ['/admin-payouts', 'Payouts'],
    ['/admin-payments', 'Payment Gateways'],
    ['/admin-coupons', 'Coupons'],
    ['/admin-gifts', 'Gift Cards'],
    ['/admin-refer', 'Refer & Earn'],
    ['/admin-disputes', 'Disputes'],
  ]],
  ['Content', [
    ['/admin-cms', 'CMS Builder'],
    ['/admin-icons', 'Icons'],
    ['/admin-announcement', 'Announcement'],
    ['/admin-notifications', 'Notifications'],
  ]],
  ['Astrology', [
    ['/admin-kundli-api', 'Kundli API'],
    ['/admin-horoscope', 'Horoscope CSV'],
    ['/admin-remedies', 'Remedies'],
  ]],
  ['Config', [
    ['/admin-dev2', 'Developer 2.0'],
    ['/admin-developer', 'Developer Mode'],
    ['/admin-builder', 'App Builder'],
    ['/admin-settings', 'Settings'],
    ['/admin-features', 'Feature Toggles'],
    ['/admin-free', 'Free Sessions'],
    ['/admin-appupdate', 'App Update & Splash'],
    ['/admin-sounds', 'Notification & Ringtone'],
    ['/admin-theme', 'App Theme'],
    ['/admin-email', 'Email & Alerts'],
  ]],
];
// Developer Portal: a parallel nav (same look, different contents) that
// replaces the admin nav the moment Developer Mode is on. Everything
// that controls how the apps look/behave lives here. Switch back to the
// normal admin panel with one click.
const DEV_GROUPS = [
  ['Build', [
    ['/admin-builder', 'App Builder (menus/nav)'],
    ['/admin-theme', 'Theme & Colors'],
    ['/admin-features', 'Feature Toggles'],
    ['/admin-free', 'Free Sessions'],
    ['/admin-appupdate', 'App Update & Splash'],
    ['/admin-sounds', 'Notification & Ringtone'],
    ['/admin-refer', 'Refer & Earn'],
  ]],
  ['Content', [
    ['/admin-cms', 'CMS / Text & Pages'],
    ['/admin-icons', 'Icons'],
    ['/admin-horoscope', 'Horoscope CSV'],
    ['/admin-reviews', 'Customer Reviews'],
    ['/admin-tickets', 'Support Tickets'],
    ['/admin-tarot', 'Tarot Questions'],
    ['/admin-announcement', 'Announcement Banner'],
    ['/admin-notifications', 'Push Notifications'],
  ]],
  ['Integrations', [
    ['/admin-kundli-api', 'Kundli API'],
    ['/admin-payments', 'Payment Gateways'],
    ['/admin-settings', 'Core Settings'],
  ]],
  ['Advanced', [
    ['/admin-dev2', 'Developer 2.0 (Builder)'],
    ['/admin-developer', 'Raw Config Editor'],
    ['/admin-email', 'Email & Alerts'],
    ['/admin-audit', 'Audit Log'],
    ['/admin-health', 'System Health'],
  ]],
];
const ALL = GROUPS.flatMap(([, items]) => items);
const DEV_ALL = DEV_GROUPS.flatMap(([, items]) => items);

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);  // open group name
  const [q, setQ] = useState('');
  const [logo, setLogo] = useState('');
  const [dev, setDev] = useState(false);
  const router = useRouter();
  useEffect(() => brandingService.watchBranding((b) =>
    setLogo(b.logo || '')), []);
  useEffect(() => {
    try { setDev(window.localStorage.getItem('devMode') === '1'); }
    catch (_) {}
  }, []);
  function toggleDev() {
    const next = !dev;
    setDev(next);
    try {
      window.localStorage.setItem('devMode', next ? '1' : '0');
    } catch (_) {}
    setMenu(null); setOpen(false);
    router.push(next ? '/admin-builder' : '/admin-dashboard');
  }

  async function logout() {
    await authService.logoutUser();
    router.replace('/admin-login');
  }
  const go = (href) => { setQ(''); setMenu(null); setOpen(false);
    router.push(href); };
  const [native, setNative] = useState(false);
  useEffect(() => {
    try {
      const C = typeof window !== 'undefined' ? window.Capacitor : null;
      setNative(!!(C && C.isNativePlatform && C.isNativePlatform()));
    } catch (_) {}
  }, []);
  const showBack = native
    && router.pathname !== '/admin-dashboard'
    && router.pathname !== '/admin-builder';
  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else { router.replace('/admin-dashboard'); }
  }

  const GR = dev ? DEV_GROUPS : GROUPS;
  const POOL = dev ? DEV_ALL : ALL;
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return POOL.filter(([, l]) => l.toLowerCase().includes(s)).slice(0, 8);
  }, [q, POOL]);

  return (
    <header data-topnav
      className={`sticky top-0 z-40 text-white ${dev
      ? 'bg-[#1f1147]' : 'bg-dark-text'}`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4
                      py-2 md:py-3">
        {showBack && (
          <button onClick={goBack} aria-label="Back"
            className="shrink-0 rounded-card bg-white/15 px-2.5 py-1.5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        <Link href={dev ? '/admin-builder' : '/admin-dashboard'}
          className="flex shrink-0 items-center gap-2 text-base
            font-bold md:text-lg">
          {logo ? (
            <img src={logo} alt="logo"
              className="h-7 max-w-[120px] object-contain md:h-8" />
          ) : (dev ? '🛠️' : '⚙️ Admin')}
          {dev && (
            <span className="rounded-full bg-amber-400 px-2 py-0.5
              text-[10px] font-bold text-dark-text">DEV</span>
          )}
        </Link>

        {/* Search */}
        <div className="relative hidden flex-1 max-w-xs md:block">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={dev ? 'Search developer portal...'
              : 'Search admin...'}
            className="w-full rounded-card bg-white/10 px-3 py-2 text-sm
              placeholder-white/50 outline-none focus:bg-white/20" />
          {results.length > 0 && (
            <div className="absolute z-50 mt-1 w-full overflow-hidden
              rounded-card bg-white text-dark-text shadow-lg">
              {results.map(([href, label]) => (
                <button key={href} onClick={() => go(href)}
                  className="block w-full px-3 py-2 text-left text-sm
                    hover:bg-bg-light">{label}</button>
              ))}
            </div>
          )}
        </div>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {GR.map(([name, items]) => (
            <div key={name} className="relative">
              <button
                onClick={() => setMenu(menu === name ? null : name)}
                className={`rounded-card px-3 py-2 text-sm
                  hover:bg-white/10 ${items.some(
                    ([h]) => h === router.pathname)
                  ? 'bg-white/20' : ''}`}>
                {name} ▾
              </button>
              {menu === name && (
                <div className="absolute right-0 z-50 mt-1 w-52
                  rounded-card bg-white p-1 text-dark-text shadow-lg">
                  {items.map(([href, label]) => (
                    <button key={href} onClick={() => go(href)}
                      className={`block w-full rounded-card px-3 py-2
                        text-left text-sm hover:bg-bg-light ${
                          router.pathname === href
                            ? 'bg-bg-light font-semibold' : ''}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button onClick={toggleDev}
            className={`ml-2 rounded-card px-3 py-2 text-sm font-semibold
              ${dev ? 'bg-amber-400 text-dark-text'
                : 'bg-white/15 text-white'}`}>
            {dev ? 'Switch to Admin' : 'Developer Mode'}
          </button>
          <button onClick={logout}
            className="ml-1 rounded-card bg-white/15 px-3 py-2 text-sm">
            Logout
          </button>
        </nav>

        <button className="ml-auto rounded-card bg-white/15 px-3 py-1.5
          text-sm md:hidden" onClick={() => setOpen((v) => !v)}>
          {open ? '✕ Close' : '☰ Menu'}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <div className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)} />
          <nav className={`absolute right-0 top-0 flex h-full w-[80%]
            max-w-xs flex-col overflow-y-auto px-3 pb-6 pt-3 shadow-2xl
            ${dev ? 'bg-[#1f1147]' : 'bg-dark-text'}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">
              {dev ? 'Developer' : 'Admin'} menu
            </span>
            <button onClick={() => setOpen(false)}
              className="rounded-card bg-white/15 px-2.5 py-1
                text-sm">✕</button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={dev ? 'Search developer portal...'
              : 'Search admin...'}
            className="mb-2 w-full rounded-card bg-white/10 px-3 py-2
              text-sm placeholder-white/50 outline-none" />
          {q.trim() ? (
            results.map(([href, label]) => (
              <button key={href} onClick={() => go(href)}
                className="block w-full rounded-card px-3 py-2 text-left
                  text-sm">
                {label}
              </button>
            ))
          ) : GR.map(([name, items]) => (
            <div key={name} className="mb-1.5">
              <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold
                uppercase tracking-wide text-white/45">{name}</div>
              <div className="grid grid-cols-2 gap-1">
                {items.map(([href, label]) => (
                  <button key={href} onClick={() => go(href)}
                    className={`truncate rounded-card px-2.5 py-2
                      text-left text-[13px] ${router.pathname === href
                        ? 'bg-white/20 font-semibold'
                        : 'bg-white/5'}`}>{label}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <button onClick={toggleDev}
              className={`flex-1 rounded-card px-3 py-2 text-sm
                font-semibold ${dev ? 'bg-amber-400 text-dark-text'
                : 'bg-white/15'}`}>
              {dev ? 'Admin' : 'Developer'}
            </button>
            <button onClick={logout}
              className="flex-1 rounded-card bg-white/15 px-3 py-2
                text-sm">Logout</button>
          </div>
          </nav>
        </div>
      )}
      {dev && (
        <div className="flex items-center justify-center gap-2
          bg-amber-400 px-3 py-1 text-[11px] font-semibold
          text-dark-text">
          <span className="hidden sm:inline">DEVELOPER PORTAL - changes
            go live across all apps on Save.</span>
          <span className="sm:hidden">DEVELOPER PORTAL</span>
          <button onClick={toggleDev}
            className="rounded-full bg-dark-text px-2.5 py-0.5
              text-white">
            Admin
          </button>
        </div>
      )}
    </header>
  );
}
