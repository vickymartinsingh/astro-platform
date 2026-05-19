import TopNav from './TopNav';
import PullToRefresh from './PullToRefresh';
import Flash from './Flash';
import { usePortal } from '../lib/portal';

const PORTAL_BANNER = {
  admin: { t: 'Admin Portal', c: 'from-slate-800 to-indigo-900' },
  developer: {
    t: 'Developer Portal · via Admin', c: 'from-[#1f1147] to-[#3b2170]',
  },
  support: {
    t: 'Support Desk · via Admin', c: 'from-amber-700 to-amber-500',
  },
};

export default function Layout({ children, nav = true }) {
  const [portal] = usePortal();
  const b = PORTAL_BANNER[portal] || PORTAL_BANNER.admin;
  return (
    <div className="min-h-full" style={{ background: '#EEF1FB' }}>
      <PullToRefresh />
      <Flash />
      <div className={`bg-gradient-to-r ${b.c}
                      py-1 text-center text-xs font-semibold uppercase
                      tracking-widest text-white`}
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)',
        }}>
        {b.t}
      </div>
      {nav && <TopNav />}
      <main className="mx-auto w-full max-w-6xl px-4 py-4">{children}</main>
    </div>
  );
}
