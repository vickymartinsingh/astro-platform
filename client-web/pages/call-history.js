import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { sessionService, astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

function fmt(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    return d ? d.toLocaleString() : '';
  } catch (_) { return ''; }
}
function clock(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function CallHistory() {
  const { user, loading } = useRequireClient();
  const router = useRouter();
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
            <button key={s.id}
              onClick={() => router.push(`/chat/${s.astroId}?view=1`)}
              className="card flex w-full items-center gap-3 text-left
                         hover:shadow-md">
              <img src={s.astro?.profileImage || '/avatar.png'}
                className="h-12 w-12 rounded-full object-cover bg-bg-light"
                alt="" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {s.type === 'video' ? 'Video call' : 'Voice call'}
                  {' with '}{s.astro?.name || 'Astrologer'}
                </div>
                <div className="text-sm text-sub-text">
                  Duration {clock(s.duration)} · ₹{s.cost || 0}
                </div>
                <div className="text-xs text-sub-text">
                  {s.startTime
                    ? <>From {fmt(s.startTime)}{s.endTime
                      ? ` to ${fmt(s.endTime)}` : ''}</>
                    : fmt(s.createdAt)}
                </div>
                <div className="mt-0.5 text-xs font-semibold text-primary">
                  Tap to view conversation
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Layout>
  );
}
