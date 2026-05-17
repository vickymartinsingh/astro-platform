import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  walletService, sessionService, astrologerService, db,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
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
const SVC = { video: 'Video call', call: 'Voice call', chat: 'Chat' };

export default function Transactions() {
  const { user, loading } = useRequireClient();
  const router = useRouter();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const txns = await walletService.getTransactions(user.uid);
      const out = await Promise.all(txns.map(async (t) => {
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
        if (t.reason === 'recharge' && t.referenceId) {
          try {
            const p = await getDoc(doc(db, 'payments', t.referenceId));
            if (p.exists()) return { ...t, pay: p.data() };
          } catch (_) {}
        }
        return t;
      }));
      setRows(out);
    })();
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  const title = (t) => {
    if (t.s) return `${SVC[t.s.type] || 'Chat'} with `
      + `${t.astro?.name || 'Astrologer'}`;
    if (t.reason === 'recharge') return 'Wallet recharge';
    if (t.reason === 'gift card') return 'Gift card redeemed';
    return String(t.reason || 'Transaction')
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Order &amp; Transaction
        History</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No orders yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((t) => {
            const clickable = (t.s && t.s.astroId) || t.pay;
            return (
              <div key={t.id}
                onClick={clickable ? () => router.push(t.pay
                  ? `/invoice/${t.referenceId}`
                  : `/chat/${t.s.astroId}?view=1`) : undefined}
                className={`card flex w-full items-start justify-between
                  gap-3 text-left ${clickable ? 'cursor-pointer '
                  + 'hover:shadow-md' : ''}`}>
                <div className="min-w-0">
                  <div className="font-semibold">{title(t)}</div>
                  <div className="text-xs text-sub-text">
                    {fmt(t.createdAt)}
                  </div>

                  {t.s && (
                    <div className="mt-1 space-y-0.5 text-xs
                                    text-sub-text">
                      <div>Astrologer: <b>{t.astro?.name
                        || 'Astrologer'}</b></div>
                      <div>Mode: <b className="capitalize">
                        {SVC[t.s.type] || t.s.type}</b></div>
                      <div>Duration: <b>{clock(t.s.duration)}</b></div>
                      {t.s.startTime && (
                        <div>From {fmt(t.s.startTime)}
                          {t.s.endTime ? ` to ${fmt(t.s.endTime)}` : ''}
                        </div>
                      )}
                      <div className="font-semibold text-primary">
                        Tap to view the conversation
                      </div>
                    </div>
                  )}

                  {t.pay && (
                    <div className="mt-1 space-y-0.5 text-xs
                                    text-sub-text">
                      <div>Mode: Online payment</div>
                      <div>Gateway: <b className="capitalize">
                        {t.pay.gateway || '-'}</b></div>
                      {t.pay.paymentId && (
                        <div>Payment ID: {t.pay.paymentId}</div>
                      )}
                      {t.pay.orderId && (
                        <div>Order ID: {t.pay.orderId}</div>
                      )}
                      {t.pay.invoiceNo && (
                        <div>Invoice: {t.pay.invoiceNo}</div>
                      )}
                      <div className="font-semibold text-primary">
                        Tap for the tax invoice
                      </div>
                    </div>
                  )}
                </div>
                <div className={`shrink-0 font-bold ${t.amount >= 0
                  ? 'text-success' : 'text-danger'}`}>
                  {t.amount >= 0 ? '+' : ''}₹{Math.abs(t.amount)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
