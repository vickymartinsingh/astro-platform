import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  kundliService, db, reportType,
} from '@astro/shared';
import {
  collection, query, orderBy, onSnapshot,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import PdfPreviewModal from '../components/PdfPreviewModal';
import SendPdfByEmailModal from '../components/SendPdfByEmailModal';
import SupportTicketModal from '../components/SupportTicketModal';
import { useRequireClient } from '../lib/useAuth';

// Orders = every PDF report (free + paid) the user has bought.
// Re-download opens the PDF in an in-app preview (PdfPreviewModal)
// with a corner download icon, so the customer stays inside the app
// instead of being kicked to a Chrome tab. Send-to-email opens
// SendPdfByEmailModal which ships the PDF as an attachment via the
// SMTP relay and reports "Email sent successfully" on completion.
//
// LIVE UPDATES: the page subscribes to users/{uid}/orders with
// Firestore onSnapshot, so the moment the relay's sweep writes
// status:'ready' to an order doc the customer's UI flips from
// "Generating..." to "Ready" + the Download button appears - no
// refresh, no polling. The relay sweep is itself fired by:
//   - useOrderSyncer (mounted in _app.js) on every page load + 60s
//   - The customer's own /orders polling effect below
//   - The admin Report Activity page on mount + every 30s
//   - Any external cron service pointed at action:'sweepPending'
// So at least one trigger is ALWAYS active for any signed-in user.
export default function Orders() {
  const { user, profile, loading } = useRequireClient();
  const [rows, setRows] = useState(null);
  const [preview, setPreview] = useState(null);   // { url, name } | null
  const [emailing, setEmailing] = useState(null); // order | null
  // 2026-06-07: per-order Help / Support ticket popup.
  const [supportFor, setSupportFor] = useState(null); // order | null

  useEffect(() => {
    if (!user) return undefined;
    const q = query(
      collection(db, 'users', user.uid, 'orders'),
      orderBy('paidAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => setRows([]));
    return () => unsub();
  }, [user]);

  // BACKGROUND POLLING: any order in *_generating gets its
  // reportStatus polled every 60s while the customer is on /orders.
  useEffect(() => {
    if (!user || !Array.isArray(rows)) return undefined;
    const pending = rows.filter((o) => o.status === 'paid_generating'
      || o.status === 'free_generating');
    if (pending.length === 0) return undefined;
    const tick = async () => {
      let didChange = false;
      await Promise.all(pending.map(async (o) => {
        try {
          const s = await kundliService.getReportStatus({
            uid: user.uid, orderId: o.id,
          });
          if (s && (s.status === 'ready'
            || s.status === 'failed'
            || s.status === 'failed_refunded')) {
            didChange = true;
          }
        } catch (_) { /* swallow */ }
      }));
      if (didChange) {
        try {
          const fresh = await kundliService.listOrders(user.uid);
          if (fresh) setRows(fresh);
        } catch (_) { /* */ }
      }
    };
    const t1 = setTimeout(tick, 8000);
    const t2 = setInterval(tick, 60000);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [user, rows]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  // Friendly report name. Pulls the catalogue shortName when known
  // (REPORT_TYPES is the single source of truth) and falls back to
  // the raw kind tag for orders predating a catalogue entry.
  function pretty(kind) {
    const t = reportType(kind);
    if (t && t.shortName) return t.shortName;
    if (kind === 'free') return 'Vedic Kundli (250+ pages)';
    if (kind === 'forecast12') return '12-Month Forecast';
    if (kind === 'careerFinance') return 'Career & Finance Report';
    if (kind === 'lifetime') return 'Lifetime Report';
    return kind || 'Report';
  }
  // Status badge with the legacy + edge labels collapsed into the
  // four states a customer actually cares about: Ready, Generating,
  // Queued, Failed.
  function statusLabel(o) {
    const ok = (s) => ({ text: s,
      cls: 'bg-emerald-100 text-emerald-700' });
    const warn = (s) => ({ text: s,
      cls: 'bg-amber-100 text-amber-700' });
    const bad = (s) => ({ text: s,
      cls: 'bg-red-100 text-red-700' });
    const neutral = (s) => ({ text: s,
      cls: 'bg-bg-light text-sub-text' });
    switch (o.status) {
      case 'ready':
      case 'ready_rescued':
      case 'paid_ready':
        return ok('Ready');
      case 'paid_generating':
      case 'free_generating':
      case 'prepaid':
        return o.kickoffPending ? warn('Queued')
          : warn('Generating…');
      case 'failed': return bad('Failed');
      case 'failed_refunded': return bad('Failed · refunded');
      default: return neutral(o.status || '·');
    }
  }
  function queueNote(o) {
    if (!o || !o.kickoffPending) return '';
    const paidMs = (o.paidAt && o.paidAt.toMillis
      && o.paidAt.toMillis()) || 0;
    if (!paidMs) return '';
    const ageS = (Date.now() - paidMs) / 1000;
    if (ageS < 30) return '';
    if (ageS < 120) {
      return 'Waiting for the report service to confirm your '
        + 'order. This is normal when the service is busy with '
        + 'other reports; usually clears within a minute.';
    }
    return 'Report service is taking longer than usual to start '
      + 'this order. We will keep retrying for up to 5 minutes; '
      + 'if it still does not start, your wallet is refunded '
      + 'automatically.';
  }

  // Same fmt + ref helpers we used before, with date+time on the
  // primary "ordered on" line.
  function fmtDateTime(ts) {
    const d = ts && ts.toDate ? ts.toDate()
      : (typeof ts === 'number' ? new Date(ts) : null);
    if (!d) return '';
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  function orderRef(o) {
    if (!o || !o.id) return '';
    if (/^\d{6,12}$/.test(o.id)) return o.id;
    return o.id.slice(0, 10);
  }
  function amountLabel(o) {
    if (o.amount > 0) return `₹${o.amount}`;
    if (o.complimentary) return 'Complimentary';
    return 'Free';
  }
  function pdfHref(o) {
    if (o.pdfBase64) return `data:application/pdf;base64,${o.pdfBase64}`;
    if (o.pdfUrl && o.pdfUrl !== 'inline') return o.pdfUrl;
    return '';
  }

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">My Orders</h1>
      <p className="mb-4 text-sm text-sub-text">
        Every PDF report you bought. Preview right here, email it to
        yourself or anyone else, or download to your device.
      </p>
      {rows.length === 0 ? (
        <div className="card text-center text-sub-text">
          <div className="text-sm">No orders yet.</div>
          <Link href="/kundli"
            className="mt-2 inline-block rounded-full bg-primary
              px-4 py-1.5 text-xs font-bold text-white">
            Generate your kundli
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((o) => {
            const s = statusLabel(o);
            const who = o.profileName
              || (o.kundliProfileId
                ? `Profile ${String(o.kundliProfileId).slice(0, 6)}`
                : '');
            const birthLine = [o.profileDob, o.profileTob, o.profileAmpm]
              .filter(Boolean).join(' ');
            const href = pdfHref(o);
            const ready = !!href;
            return (
              <div key={o.id}
                className="overflow-hidden rounded-2xl bg-white
                  shadow-sm ring-1 ring-gray-200/70">
                {/* HEADER: report name + status pill */}
                <div className="flex items-start justify-between
                  gap-3 px-4 pt-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-base font-bold
                        text-dark-text">
                        {pretty(o.kind)}
                      </div>
                      {/* Complimentary chip - admin-issued gift. Order
                          doc carries complimentary:true (set by the
                          relay's complimentary branch) so the customer
                          sees "Gift from AstroSeer" instead of a paid
                          purchase. */}
                      {o.complimentary && (
                        <span className="rounded-full bg-amber-50
                          px-2 py-0.5 text-[10px] font-bold
                          text-amber-700">
                          Gift from AstroSeer
                        </span>
                      )}
                    </div>
                    {who && (
                      <div className="mt-0.5 truncate text-xs
                        text-sub-text">
                        For <span className="font-semibold
                          text-dark-text">{who}</span>
                        {o.profilePlace ? `, ${o.profilePlace}` : ''}
                      </div>
                    )}
                    {birthLine && (
                      <div className="mt-0.5 text-[11px] text-sub-text">
                        Born {birthLine}
                      </div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5
                    py-1 text-[11px] font-bold ${s.cls}`}>
                    {s.text}
                  </span>
                </div>

                {/* META BAR: order #, ordered on, amount - all in
                    one tidy strip below the header. */}
                <div className="mt-3 flex flex-wrap items-center
                  gap-x-3 gap-y-1 border-t border-gray-200/70
                  bg-bg-light/40 px-4 py-2 text-[11px]">
                  <span className="font-mono text-sub-text">
                    Order&nbsp;<span className="font-bold
                      text-dark-text">#{orderRef(o)}</span>
                  </span>
                  <span className="text-sub-text">·</span>
                  <span className="text-sub-text">
                    Ordered <span className="font-semibold
                      text-dark-text">
                      {fmtDateTime(o.paidAt) || '–'}
                    </span>
                  </span>
                  <span className="text-sub-text">·</span>
                  <span className="text-sub-text">
                    Amount <span className="font-semibold
                      text-dark-text">{amountLabel(o)}</span>
                  </span>
                </div>

                {/* QUEUE NOTE */}
                {queueNote(o) && (
                  <div className="mx-4 mt-3 rounded-card
                    bg-amber-50 px-3 py-2 text-[11px] leading-snug
                    text-amber-800">
                    {queueNote(o)}
                  </div>
                )}

                {/* ACTIONS */}
                {ready && (
                  <div className="flex flex-wrap items-center gap-2
                    px-4 py-3">
                    <button type="button"
                      onClick={() => setPreview({ url: href,
                        name: o.pdfName || `AstroSeer-${
                          pretty(o.kind).replace(/\s+/g, '-')}.pdf` })}
                      className="inline-flex items-center gap-1.5
                        rounded-full bg-primary px-4 py-2 text-xs
                        font-bold text-white hover:bg-primary/90">
                      <svg width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round"
                        strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0
                          1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </button>
                    <button type="button"
                      onClick={() => setEmailing(o)}
                      className="inline-flex items-center gap-1.5
                        rounded-full border border-primary/40
                        bg-white px-4 py-2 text-xs font-bold
                        text-primary hover:bg-primary/5">
                      <svg width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round"
                        strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0
                          1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1
                          .9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                      Send to email
                    </button>
                  </div>
                )}

                {o.validUntil && (
                  <div className="border-t border-gray-200/70 px-4
                    py-2 text-[11px] text-sub-text">
                    Forecast valid until <b className="text-dark-text">
                      {String(o.validUntil).slice(0, 10)}
                    </b>
                  </div>
                )}
                {/* Help / Support row - always visible so a customer
                    can raise a ticket against this specific order
                    (PDF not received, wrong content, refund, etc.). */}
                <div className="flex items-center justify-between
                  border-t border-gray-200/70 px-4 py-2 text-[11px]
                  text-sub-text">
                  <span>Need help with this order?</span>
                  <button type="button"
                    onClick={() => setSupportFor(o)}
                    className="inline-flex items-center gap-1
                      rounded-full border border-primary/40 bg-white
                      px-3 py-1 text-[11px] font-bold text-primary
                      hover:bg-primary/5">
                    <svg width="12" height="12" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor"
                      strokeWidth="2.4" strokeLinecap="round"
                      strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Get help
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <PdfPreviewModal url={preview.url} name={preview.name}
          onClose={() => setPreview(null)} />
      )}
      {emailing && (
        <SendPdfByEmailModal order={emailing}
          defaultEmail={profile?.email || user?.email || ''}
          onClose={() => setEmailing(null)} />
      )}
      {/* Help / Support modal for the picked order. The button next
          to each row sets supportFor; closing clears it. */}
      <SupportTicketModal
        open={!!supportFor}
        kind="order"
        refId={supportFor ? orderRef(supportFor) : ''}
        refLabel={supportFor
          ? `${pretty(supportFor.kind)} - Order #${orderRef(supportFor)}`
          : ''}
        user={{ uid: user?.uid, profile }}
        onClose={() => setSupportFor(null)} />
    </Layout>
  );
}
