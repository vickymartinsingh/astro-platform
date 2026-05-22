import TopNav from './TopNav';
import BottomNav from './BottomNav';
import AnnouncementBanner from './AnnouncementBanner';
import UpdateBanner from './UpdateBanner';
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
      {nav && <UpdateBanner />}
      <main className={`mx-auto w-full max-w-6xl px-4 py-4 ${
        nav ? 'pb-safe-nav md:pb-4' : ''}`}>{children}</main>
      {/* Crawlable legal footer - also satisfies Google's OAuth domain
          verification (home page must link to the privacy policy). */}
      <footer className="mx-auto max-w-6xl px-4 pb-24 pt-2 text-center
        text-xs text-sub-text md:pb-6">
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/account-deletion">Account Deletion</a>
          <a href="mailto:support@astroseer.in">Contact</a>
        </nav>
        <div className="mt-1">© {new Date().getFullYear()} AstroSeer</div>
      </footer>
      {nav && <BottomNav />}
    </div>
  );
}
