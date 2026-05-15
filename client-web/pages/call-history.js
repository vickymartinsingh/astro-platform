import { useEffect, useState } from 'react';
import { sessionService, astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

export default function CallHistory() {
  const { user, loading } = useRequireClient();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all = await sessionService.getUserSessions(user.uid);
      const calls = all.filter((s) =>
        ['call', 'video'].includes(s.type) && s.status === 'ended');
      const enriched = await Promise.all(calls.map(async (s) => ({
        ...s,
        astro: await astrologerService.getAstrologer(s.astroId),
      })));
      setRows(enriched);
    })();
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Call History</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No calls yet. Start your first consultation 🔮" />
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="card flex items-center gap-3">
              <img src={s.astro?.profileImage || '/avatar.png'}
                className="h-12 w-12 rounded-full object-cover bg-bg-light"
                alt="" />
              <div className="flex-1">
                <div className="font-semibold">{s.astro?.name}</div>
                <div className="text-sm text-sub-text capitalize">
                  {s.type} · {Math.round((s.duration || 0) / 60)} min · ₹{s.cost}
                </div>
              </div>
              <div className="text-xs text-sub-text">
                {s.createdAt?.toDate
                  ? s.createdAt.toDate().toLocaleDateString() : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
