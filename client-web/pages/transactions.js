import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  walletService, sessionService, astrologerService, db, kundliService,
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
        // Normalize sign: legacy kundli orders wrote `amount: price`
        // (positive) with `type: 'debit'`. Anything tagged as a debit
        // with a positive amount must be displayed (and downstream-
        // computed) as negative.
        const signed = (t.type === 'debit' && Number(t.amount) > 0)
          ? { ...t, amount: -Math.abs(Number(t.amount)) }
          : t;
        if ((signed.reason === 'session' || signed.reason === 'earning')
            && signed.referenceId) {
          try {
            const s = await sessionService.getSession(signed.referenceId);
            if (s) {
              const a = await astrologerService
                .getAstrologer(s.astroId).catch(() => null);
              return { ...signed, s, astro: a };
            }
          } catch (_) {}
        }
        if (signed.reason === 'recharge' && signed.referenceId) {
          try {
            const p = await getDoc(doc(db, 'payments', signed.referenceId));
            if (p.exists()) return { ...signed, pay: p.data() };
          } catch (_) {}
        }
        // Kundli PDF orders: pull the matching order doc so we can
        // render the profile name + a Download button right here
        // (was previously only available on /orders, which made the
        // user think "reports aren't showing" since the txn line
        // was a dead end).
        const isKundliOrder = signed.referenceId
          && (signed.reason === 'kundli report'
            || signed.reason === '12-month kundli forecast');
        if (isKundliOrder) {
          try {
            const o = await getDoc(doc(db, 'users', user.uid,
              'orders', signed.referenceId));
            if (o.exists()) return { ...signed, order: o.data() };
          } catch (_) {}
        }
        return signed;
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
    if (t.reason === '12-month kundli forecast') {
      return '12-month kundli forecast';
    }
    if (t.reason === 'kundli report') return 'Kundli report';
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
            const clickable = (t.s && t.s.astroId) || t.pay || t.order;
            const goto = () => {
              if (t.pay) router.push(`/invoice/${t.referenceId}`);
              else if (t.s && t.s.astroId) {
                router.push(`/chat/${t.s.astroId}?view=1`);
              } else if (t.order) router.push('/orders');
            };
            return (
              <div key={t.id}
                onClick={clickable ? goto : undefined}
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
                      <div>Session ID: <b className="break-all">
                        {t.referenceId}</b></div>
                      <div>Chat ID: <b className="break-all">
                        {[user.uid, t.s.astroId].sort().join('_')}</b>
                      </div>
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

                  {t.order && (
                    <div className="mt-1 space-y-0.5 text-xs
                                    text-sub-text">
                      {t.order.profileName && (
                        <div>Profile: <b>{t.order.profileName}</b></div>
                      )}
                      {(t.order.profileDob || t.order.profilePlace) && (
                        <div>
                          {[t.order.profileDob, t.order.profileTob,
                            t.order.profileAmpm].filter(Boolean).join(' ')}
                          {t.order.profilePlace
                            ? ` · ${t.order.profilePlace}` : ''}
                        </div>
                      )}
                      <div>Status: <b className="capitalize">
                        {t.order.status === 'ready' ? 'Ready'
                          : t.order.status === 'paid_generating'
                            || t.order.status === 'free_generating'
                            ? 'Generating…'
                            : (t.order.status || '·')}</b></div>
                      {t.order.status === 'ready'
                        && (t.order.pdfBase64
                          || (t.order.pdfUrl
                            && t.order.pdfUrl !== 'inline')) && (
                        <button type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const href = t.order.pdfBase64
                              ? `data:application/pdf;base64,`
                                + `${t.order.pdfBase64}`
                              : t.order.pdfUrl;
                            kundliService.downloadPdfFromUrl(href,
                              t.order.pdfName || 'AstroSeer-Kundli.pdf');
                          }}
                          className="mt-1 inline-block rounded-full
                            bg-primary px-3 py-1 text-[11px]
                            font-bold text-white">
                          Download PDF
                        </button>
                      )}
                      <div className="font-semibold text-primary">
                        Tap to open My Orders
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
