import { useEffect, useState } from 'react';
import { sessionService, astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;

export default function AstroEarnings() {
  const { user, loading } = useRequireAstrologer();
  const [ended, setEnded] = useState([]);
  const [astro, setAstro] = useState(null);

  useEffect(() => {
    if (!user) return;
    sessionService.collectAstrologerEarnings(user.uid)
      .catch(() => {})
      .finally(() => {
        // Both reads are best-effort: a network blip shouldn't blow
        // up the dashboard with an unhandled rejection.
        sessionService.getAstrologerSessions(user.uid).then((l) =>
          setEnded(l.filter((s) => s.status === 'ended')))
          .catch(() => setEnded([]));
        astrologerService.getAstrologer(user.uid).then(setAstro)
          .catch(() => {});
      });
  }, [user]);

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  const now = Date.now();
  const within = (ms) => ended.filter((s) =>
    s.createdAt?.toDate && now - s.createdAt.toDate().getTime() <= ms);
  const sum = (a) => a.reduce((x, s) =>
    x + Number(s.astrologerEarning || 0), 0).toFixed(0);

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Earnings</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Today', within(DAY)], ['This Week', within(7 * DAY)],
          ['This Month', within(30 * DAY)], ['All Time', ended]]
          .map(([label, arr]) => (
          <div key={label} className="card text-center">
            <div className="text-xs text-sub-text">{label}</div>
            <div className="mt-1 text-lg font-bold">₹{sum(arr)}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 font-bold">Session Breakdown</h2>
      <div className="space-y-2">
        {ended.map((s) => (
          <div key={s.id} className="card text-sm">
            <div className="flex justify-between">
              <span className="capitalize">{s.type}</span>
              <span>{s.createdAt?.toDate
                ? s.createdAt.toDate().toLocaleDateString() : ''}</span>
            </div>
            <div className="mt-1 text-sub-text">
              Gross ₹{s.cost || 0} · Commission {s.commissionPercent || 0}% ·
              Earned ₹{s.astrologerEarning || 0}
            </div>
          </div>
        ))}
        {ended.length === 0 && (
          <div className="card text-sub-text">No earnings yet.</div>
        )}
      </div>
    </Layout>
  );
}
