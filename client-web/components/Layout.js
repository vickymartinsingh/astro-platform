import TopNav from './TopNav';
import BottomNav from './BottomNav';
import AnnouncementBanner from './AnnouncementBanner';
import PullToRefresh from './PullToRefresh';

// Global layout. Desktop: top nav. Mobile: top nav + Astrotalk-style
// fixed bottom tab bar. Content gets bottom padding on mobile so it is
// never hidden behind the tab bar.
export default function Layout({ children, nav = true }) {
  return (
    <div className="min-h-full">
      <PullToRefresh />
      {nav && <TopNav />}
      {nav && <AnnouncementBanner />}
      <main className={`mx-auto w-full max-w-6xl px-4 py-4 ${
        nav ? 'pb-safe-nav md:pb-4' : ''}`}>{children}</main>
      {nav && <BottomNav />}
    </div>
  );
}
