import { useEffect, useState } from 'react';
import { astrologerService } from '@astro/shared';
import TopNav from './TopNav';
import IncomingRequest from './IncomingRequest';
import AnnouncementBanner from './AnnouncementBanner';
import { useAuth } from '../lib/useAuth';

// Global layout: TOP NAV ONLY + always-listening incoming-request popup.
export default function Layout({ children, nav = true }) {
  const { user, profile } = useAuth();
  const [astro, setAstro] = useState(null);

  useEffect(() => {
    if (!user) return;
    return astrologerService.listenAstrologer(user.uid, setAstro);
  }, [user]);

  return (
    <div className="min-h-full">
      {nav && <TopNav astro={astro} />}
      {nav && <AnnouncementBanner />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
      {user && (
        <IncomingRequest uid={user.uid}
          isOnCall={profile?.isOnCall || astro?.status === 'busy'} />
      )}
    </div>
  );
}
