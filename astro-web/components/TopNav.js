import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService } from '@astro/shared';
import GoOnlineModal from './GoOnlineModal';
import { useAuth } from '../lib/useAuth';

// TOP NAV ONLY (Hard Rule 1). Go Online/Offline is a prominent nav button.
const LINKS = [
  { href: '/astro-dashboard', label: 'Dashboard' },
  { href: '/astro-sessions', label: 'My Sessions' },
  { href: '/astro-earnings', label: 'Earnings' },
  { href: '/astro-kundli', label: 'Kundli Viewer' },
  { href: '/astro-profile', label: 'Profile' },
  { href: '/astro-reviews', label: 'Reviews' },
];

export default function TopNav({ astro }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const online = astro?.status === 'online';

  async function logout() {
    await authService.logoutUser();
    router.replace('/astro-login');
  }

  return (
    <header className="sticky top-0 z-40 bg-primary text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between
                      px-4 py-3">
        <Link href="/astro-dashboard" className="text-lg font-bold">
          ✨ Astrologer
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-card px-3 py-2 text-sm hover:bg-white/15 ${
                router.pathname === l.href ? 'bg-white/20' : ''}`}>
              {l.label}
            </Link>
          ))}
          <button onClick={() => setModal(true)}
            className={`ml-2 rounded-card px-3 py-2 text-sm font-bold ${
              online ? 'bg-success' : 'bg-white text-primary'}`}>
            {online ? 'Go Offline' : 'Go Online'}
          </button>
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
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className="block rounded-card px-3 py-3">{l.label}</Link>
          ))}
          <button onClick={() => { setModal(true); setOpen(false); }}
            className="mt-2 w-full rounded-card bg-white px-3 py-3
                       text-left font-bold text-primary">
            {online ? 'Go Offline' : 'Go Online'}
          </button>
          <button onClick={logout}
            className="mt-2 w-full rounded-card bg-white/15 px-3 py-3
                       text-left">Logout</button>
        </nav>
      )}

      {modal && (
        <GoOnlineModal astro={astro} uid={user?.uid}
          onClose={() => setModal(false)} />
      )}
    </header>
  );
}
