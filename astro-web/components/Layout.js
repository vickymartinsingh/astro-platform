import { useEffect, useState } from 'react';
import { astrologerService } from '@astro/shared';
import TopNav from './TopNav';
import IncomingRequest from './IncomingRequest';
import AnnouncementBanner from './AnnouncementBanner';
import PullToRefresh from './PullToRefresh';
import { useAuth } from '../lib/useAuth';

export default function Layout({ children, nav = true }) {
  const { user, profile } = useAuth();
  const [astro, setAstro] = useState(null);

  useEffect(() => {
    if (!user) return;
    return astrologerService.listenAstrologer(user.uid, setAstro);
  }, [user]);

  // Only suppress the popup while the astrologer is genuinely IN a live
  // session (users.isOnCall, set when a session is accepted/active).
  // Do NOT suppress on a seeded/idle "busy" status, that hid real
  // incoming requests.
  const inSession = !!profile?.isOnCall;

  return (
    <div className="min-h-full" style={{ background: '#F1FAF6' }}>
      <PullToRefresh />
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600
                      py-1 text-center text-xs font-semibold uppercase
                      tracking-widest text-white">
        Astrologer Portal
      </div>
      <AnnouncementBanner />
      {nav && <TopNav astro={astro} />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
      {user && <IncomingRequest uid={user.uid} isOnCall={inSession} />}
    </div>
  );
}
