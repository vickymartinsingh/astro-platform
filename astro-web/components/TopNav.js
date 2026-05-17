import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService, astrologerService } from '@astro/shared';
import GoOnlineModal from './GoOnlineModal';
import { useAuth } from '../lib/useAuth';

// TOP NAV ONLY (Hard Rule 1). Premium white header to match the client
// portal. Go Online/Offline is a prominent nav button.
const LINKS = [
  { href: '/astro-dashboard', label: 'Dashboard' },
  { href: '/astro-sessions', label: 'My Sessions' },
  { href: '/astro-earnings', label: 'Earnings' },
  { href: '/astro-kundli', label: 'Kundli Viewer' },
  { href: '/astro-remedies', label: 'My Remedies' },
  { href: '/astro-profile', label: 'Profile' },
  { href: '/astro-reviews', label: 'Reviews' },
  { href: '/astro-notifications', label: 'Announcements' },
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

  // Quick toggle: flip availability without the service dialog. Going
  // online with no service enables Chat by default.
  async function quickToggle() {
    if (!astro || !user) { setModal(true); return; }
    if (online) {
      await astrologerService.updateAvailability(user.uid, {
        status: 'offline', chat_enabled: false,
        call_enabled: false, video_enabled: false });
    } else {
      const anySvc = astro.chat_enabled || astro.call_enabled
        || astro.video_enabled;
      await astrologerService.updateAvailability(user.uid, {
        status: 'online',
        chat_enabled: anySvc ? !!astro.chat_enabled : true,
        call_enabled: !!astro.call_enabled,
        video_enabled: !!astro.video_enabled });
    }
  }

  const Toggle = ({ extra }) => (
    <button onClick={quickToggle} title="Quick online/offline"
      className={`flex items-center gap-2 rounded-full border px-3 py-2
        text-sm font-semibold ${extra} ${online
          ? 'border-emerald-300 text-emerald-700'
          : 'border-gray-200 text-sub-text'}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${
        online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {online ? 'Online' : 'Offline'}
    </button>
  );

  const StatusBtn = ({ extra }) => (
    <button onClick={() => setModal(true)}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${extra} ${
        online ? 'bg-success text-white'
          : 'bg-gradient-to-br from-primary to-[#8B5CF6] text-white'}`}>
      {online ? 'Go Offline' : 'Go Online'}
    </button>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between
                      px-4 py-3">
        <Link href="/astro-dashboard" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center
                           rounded-xl bg-gradient-to-br from-primary
                           to-[#8B5CF6] font-bold text-white">A</span>
          <span className="leading-tight">
            <span className="block font-bold">AstroConnect</span>
            <span className="block text-[10px] uppercase tracking-wide
                             text-sub-text">Astrologer Portal</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-full px-3 py-2 text-sm font-medium
                transition ${router.pathname === l.href
                  ? 'pill-active' : 'text-dark-text hover:bg-bg-light'}`}>
              {l.label}
            </Link>
          ))}
          <Toggle extra="ml-2" />
          <StatusBtn extra="ml-1" />
          <button onClick={logout}
            className="ml-1 rounded-full border border-gray-200 px-4 py-2
                       text-sm font-semibold hover:bg-bg-light">
            Logout
          </button>
        </nav>

        <button aria-label="Menu"
          className="rounded-xl border border-gray-200 px-3 py-2 md:hidden"
          onClick={() => setOpen((v) => !v)}>{open ? '✕' : '☰'}</button>
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
              className="rounded-lg border border-gray-200 px-2.5 py-1
                         text-sm">✕</button>
          </div>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`block rounded-xl px-3 py-3 text-base ${
                router.pathname === l.href
                  ? 'bg-bg-light font-semibold text-primary' : ''}`}>
              {l.label}
            </Link>
          ))}
          <div className="mt-2 space-y-2">
            <Toggle extra="w-full justify-center" />
            <StatusBtn extra="w-full" />
          </div>
          <button onClick={logout}
            className="mt-2 w-full rounded-xl border border-gray-200 px-3
                       py-3 text-left text-base">Logout</button>
          </nav>
        </div>
      )}
      <style jsx global>{`
        @keyframes slideIn {
          from { opacity: .4; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {modal && (
        <GoOnlineModal astro={astro} uid={user?.uid}
          onClose={() => setModal(false)} />
      )}
    </header>
  );
}
