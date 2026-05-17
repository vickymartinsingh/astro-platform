import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';

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
  ]],
  ['Sessions', [
    ['/admin-sessions', 'Sessions'],
    ['/admin-live', 'Monitor Live'],
  ]],
  ['Finance', [
    ['/admin-transactions', 'Transactions'],
    ['/admin-payouts', 'Payouts'],
    ['/admin-payments', 'Payment Gateways'],
    ['/admin-coupons', 'Coupons'],
    ['/admin-gifts', 'Gift Cards'],
    ['/admin-disputes', 'Disputes'],
  ]],
  ['Content', [
    ['/admin-cms', 'CMS Builder'],
    ['/admin-announcement', 'Announcement'],
    ['/admin-notifications', 'Notifications'],
  ]],
  ['Astrology', [
    ['/admin-kundli-api', 'Kundli API'],
    ['/admin-remedies', 'Remedies'],
  ]],
  ['Config', [
    ['/admin-developer', 'Developer Mode'],
    ['/admin-builder', 'App Builder'],
    ['/admin-settings', 'Settings'],
    ['/admin-features', 'Feature Toggles'],
    ['/admin-theme', 'App Theme'],
  ]],
];
const ALL = GROUPS.flatMap(([, items]) => items);

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);  // open group name
  const [q, setQ] = useState('');
  const [logo, setLogo] = useState('');
  const router = useRouter();
  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setLogo((s.exists() && s.data().logo) || '')).catch(() => {});
  }, []);

  async function logout() {
    await authService.logoutUser();
    router.replace('/admin-login');
  }
  const go = (href) => { setQ(''); setMenu(null); setOpen(false);
    router.push(href); };

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ALL.filter(([, l]) => l.toLowerCase().includes(s)).slice(0, 8);
  }, [q]);

  return (
    <header className="sticky top-0 z-40 bg-dark-text text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4
                      py-3">
        <Link href="/admin-dashboard"
          className="flex shrink-0 items-center text-lg font-bold">
          {logo ? (
            <img src={logo} alt="logo"
              className="h-8 max-w-[140px] object-contain" />
          ) : '⚙️ Admin'}
        </Link>

        {/* Search */}
        <div className="relative hidden flex-1 max-w-xs md:block">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search admin..."
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
          {GROUPS.map(([name, items]) => (
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
          <button onClick={logout}
            className="ml-2 rounded-card bg-white/15 px-3 py-2 text-sm">
            Logout
          </button>
        </nav>

        <button className="ml-auto rounded-card bg-white/15 px-3 py-2
          md:hidden" onClick={() => setOpen((v) => !v)}>
          {open ? '✕' : '☰'}
        </button>
      </div>

      {open && (
        <nav className="max-h-[80vh] overflow-y-auto border-t
          border-white/20 px-4 pb-4 pt-2 md:hidden">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search admin..."
            className="mb-2 w-full rounded-card bg-white/10 px-3 py-2
              text-sm placeholder-white/50 outline-none" />
          {q.trim() ? (
            results.map(([href, label]) => (
              <button key={href} onClick={() => go(href)}
                className="block w-full rounded-card px-3 py-3 text-left">
                {label}
              </button>
            ))
          ) : GROUPS.map(([name, items]) => (
            <div key={name} className="mb-2">
              <div className="px-3 pb-1 pt-2 text-xs font-semibold
                uppercase tracking-wide text-white/50">{name}</div>
              {items.map(([href, label]) => (
                <button key={href} onClick={() => go(href)}
                  className="block w-full rounded-card px-3 py-3
                    text-left text-sm">{label}</button>
              ))}
            </div>
          ))}
          <button onClick={logout}
            className="mt-2 w-full rounded-card bg-white/15 px-3 py-3
              text-left">Logout</button>
        </nav>
      )}
    </header>
  );
}
