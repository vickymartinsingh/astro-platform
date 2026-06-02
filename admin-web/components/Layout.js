import AdminShell from './AdminShell';
import TopNav from './TopNav';
import PullToRefresh from './PullToRefresh';
import Flash from './Flash';

// Layout switches between the new shell (sidebar + sticky top bar +
// command palette) when nav is on, and a minimal nav-less surface
// (login, splash) when off. The old TopNav is still imported so a
// page can fall back to the classic horizontal nav by passing
// nav="legacy".
export default function Layout({ children, nav = true }) {
  if (nav === 'legacy') {
    return (
      <div className="min-h-full" style={{ background: '#EEF1FB' }}>
        <PullToRefresh />
        <Flash />
        <TopNav />
        <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
      </div>
    );
  }
  if (!nav) {
    return (
      <div className="min-h-full" style={{ background: '#EEF1FB' }}>
        <PullToRefresh />
        <Flash />
        <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
      </div>
    );
  }
  return <AdminShell>{children}</AdminShell>;
}
