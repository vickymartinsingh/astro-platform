import TopNav from './TopNav';
import PullToRefresh from './PullToRefresh';
import Flash from './Flash';

export default function Layout({ children, nav = true }) {
  return (
    <div className="min-h-full" style={{ background: '#EEF1FB' }}>
      <PullToRefresh />
      <Flash />
      <div className="bg-gradient-to-r from-slate-800 to-indigo-900
                      py-1 text-center text-xs font-semibold uppercase
                      tracking-widest text-white">
        Admin Portal
      </div>
      {nav && <TopNav />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
    </div>
  );
}
