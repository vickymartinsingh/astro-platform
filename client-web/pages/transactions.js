import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  walletService, sessionService, astrologerService,
} from '@astro/shared';
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

export default function Transactions() {
  const { user, loading } = useRequireClient();
  const router = useRouter();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const txns = await walletService.getTransactions(user.uid);
      const out = await Promise.all(txns.map(async (t) => {
        // Enrich consultation rows with astrologer + service + duration.
        if ((t.reason === 'session' || t.reason === 'earning')
            && t.referenceId) {
          try {
            const s = await sessionService.getSession(t.referenceId);
            if (s) {
              const a = await astrologerService
                .getAstrologer(s.astroId).catch(() => null);
              return { ...t, s, astro: a };
            }
          } catch (_) {}
        }
        return t;
      }));
      setRows(out);
    })();
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  const label = (t) => {
    if (t.s) {
      const svc = t.s.type === 'video' ? 'Video call'
        : t.s.type === 'call' ? 'Voice call' : 'Chat';
      return `${svc} with ${t.astro?.name || 'Astrologer'}`;
    }
    if (t.reason === 'recharge') return 'Wallet recharge';
    return String(t.reason || 'Transaction')
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Order History</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No orders yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((t) => {
            const clickable = t.s && t.s.astroId;
            const Comp = clickable ? 'button' : 'div';
            return (
              <Comp key={t.id}
                onClick={clickable
                  ? () => router.push(
                    `/chat/${t.s.astroId}?view=1`)
                  : undefined}
                className={`card flex w-full items-center justify-between
                  gap-3 text-left ${clickable ? 'hover:shadow-md' : ''}`}>
                <div className="min-w-0">
                  <div className="font-medium">{label(t)}</div>
                  <div className="text-xs text-sub-text">
                    {fmt(t.createdAt)}
                  </div>
                  {t.s && (
                    <div className="mt-0.5 text-xs text-sub-text">
                      Duration {clock(t.s.duration)}
                      {t.s.startTime && (
                        <> · {fmt(t.s.startTime)}</>
                      )}
                      {t.s.endTime && (
                        <> to {fmt(t.s.endTime)}</>
                      )}
                    </div>
                  )}
                  {clickable && (
                    <div className="mt-0.5 text-xs font-semibold
                                    text-primary">
                      Tap to view conversation
                    </div>
                  )}
                </div>
                <div className={`shrink-0 font-bold ${t.amount >= 0
                  ? 'text-success' : 'text-danger'}`}>
                  {t.amount >= 0 ? '+' : ''}₹{Math.abs(t.amount)}
                </div>
              </Comp>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
