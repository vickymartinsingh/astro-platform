import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService } from '@astro/shared';

// TOP NAV ONLY (Hard Rule 1), admin panel has no sidebar either.
// Extra modules live under a "More" dropdown that opens from the top
// (still top-nav, never a side drawer).
// Matches blueprint 6.1 admin top-nav exactly.
const LINKS = [
  { href: '/admin-dashboard', label: 'Dashboard' },
  { href: '/admin-users', label: 'Users' },
  { href: '/admin-astrologers', label: 'Astrologers' },
  { href: '/admin-sessions', label: 'Sessions' },
  { href: '/admin-transactions', label: 'Transactions' },
  { href: '/admin-reports', label: 'Reports' },
  { href: '/admin-cms', label: 'CMS Builder' },
  { href: '/admin-settings', label: 'Settings' },
];
const MORE = [
  { href: '/admin-payouts', label: 'Payouts' },
  { href: '/admin-disputes', label: 'Disputes' },
  { href: '/admin-coupons', label: 'Coupons' },
  { href: '/admin-gifts', label: 'Gift Cards' },
  { href: '/admin-notifications', label: 'Notifications' },
  { href: '/admin-features', label: 'Feature Toggles' },
  { href: '/admin-announcement', label: 'Announcement' },
  { href: '/admin-analytics', label: 'Analytics' },
  { href: '/admin-audit', label: 'Audit Log' },
  { href: '/admin-health', label: 'System Health' },
];

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const router = useRouter();

  async function logout() {
    await authService.logoutUser();
    router.replace('/admin-login');
  }

  return (
    <header className="sticky top-0 z-40 bg-dark-text text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between
                      px-4 py-3">
        <Link href="/admin-dashboard" className="text-lg font-bold">
          ⚙️ Admin
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-card px-3 py-2 text-sm hover:bg-white/10 ${
                router.pathname === l.href ? 'bg-white/20' : ''}`}>
              {l.label}
            </Link>
          ))}
          <div className="relative">
            <button onClick={() => setMore((v) => !v)}
              className="rounded-card px-3 py-2 text-sm hover:bg-white/10">
              More ▾
            </button>
            {more && (
              <div className="absolute right-0 mt-1 w-48 rounded-card
                              bg-white p-1 text-dark-text shadow-lg">
                {MORE.map((l) => (
                  <Link key={l.href} href={l.href}
                    onClick={() => setMore(false)}
                    className="block rounded-card px-3 py-2 text-sm
                               hover:bg-bg-light">
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <button onClick={logout}
            className="ml-2 rounded-card bg-white/15 px-3 py-2 text-sm">
            Logout
          </button>
        </nav>
        <button className="md:hidden rounded-card bg-white/15 px-3 py-2"
          onClick={() => setOpen((v) => !v)}>{open ? '✕' : '☰'}</button>
      </div>
      {open && (
        <nav className="md:hidden border-t border-white/20 px-4 pb-4 pt-2">
          {[...LINKS, ...MORE].map((l) => (
            <Link key={l.href} href={l.href}
              className="block rounded-card px-3 py-3">{l.label}</Link>
          ))}
          <button onClick={logout}
            className="mt-2 w-full rounded-card bg-white/15 px-3 py-3
                       text-left">Logout</button>
        </nav>
      )}
    </header>
  );
}
