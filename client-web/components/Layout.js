import TopNav from './TopNav';
import AnnouncementBanner from './AnnouncementBanner';

// Single global layout, TOP NAV ONLY, content below, auto-responsive
// (single column on mobile, wider on desktop). No sidebars anywhere.
export default function Layout({ children, nav = true }) {
  return (
    <div className="min-h-full">
      {nav && <TopNav />}
      {nav && <AnnouncementBanner />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
    </div>
  );
}
