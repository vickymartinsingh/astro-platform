import { useEffect, useState } from 'react';
import Link from 'next/link';
import { kundliService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireClient } from '../lib/useAuth';

// Orders = every PDF report (free + paid) the user has bought.
// Re-download is just an <a href> to the long-lived signed Firebase
// Storage URL stored on each order doc; we never re-hit the relay
// for repeats, so this page is essentially free.
//
// Mirrors the data the /kundli "Orders" tab will read once #69 lands.
export default function Orders() {
  const { user, loading } = useRequireClient();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    kundliService.listOrders(user.uid)
      .then(setRows)
      .catch(() => setRows([]));
  }, [user]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  function pretty(kind) {
    if (kind === 'forecast12') return '12-Month Forecast';
    if (kind === 'free') return 'Vedic Kundli (250+ pages)';
    return kind || 'Report';
  }
  function statusLabel(o) {
    switch (o.status) {
      case 'ready': return { text: 'Ready', cls: 'bg-success/10 text-success' };
      case 'paid_generating':
      case 'free_generating':
        return { text: 'Generating…', cls: 'bg-warning/10 text-warning' };
      case 'failed':
      case 'failed_refunded':
        return { text: o.status === 'failed_refunded'
          ? 'Failed (refunded)' : 'Failed',
          cls: 'bg-danger/10 text-danger' };
      default: return { text: o.status || '·',
        cls: 'bg-bg-light text-sub-text' };
    }
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">My Orders</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every PDF report you bought. One click re-downloads the same
        file from the cloud at no charge.
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
        <div className="space-y-2">
          {rows.map((o) => {
            const s = statusLabel(o);
            const at = o.paidAt && o.paidAt.toDate
              ? o.paidAt.toDate() : null;
            // Profile snapshot lets the user tell which chart each
            // PDF belongs to without an extra Firestore read.
            // Falls back to the kundliProfileId tail if a legacy
            // order doc didn't carry the snapshot.
            const who = o.profileName
              || (o.kundliProfileId
                ? `Profile ${String(o.kundliProfileId).slice(0, 6)}`
                : '');
            const birthLine = [o.profileDob, o.profileTob, o.profileAmpm]
              .filter(Boolean).join(' ');
            return (
              <div key={o.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{pretty(o.kind)}</div>
                    {who && (
                      <div className="text-xs font-medium text-dark-text">
                        {who}
                        {o.profilePlace ? `, ${o.profilePlace}` : ''}
                      </div>
                    )}
                    <div className="text-xs text-sub-text">
                      {birthLine ? `${birthLine} · ` : ''}
                      {at ? at.toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      }) : ''}
                      {o.amount > 0 ? ` · ₹${o.amount}` : ' · free'}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5
                      text-[10px] font-bold ${s.cls}`}>
                    {s.text}
                  </span>
                </div>
                {o.status === 'ready' && (() => {
                  // Inline-stored orders carry only a short marker on
                  // pdfUrl ("inline") and the real bytes on
                  // pdfBase64 — we rebuild a data URL on the fly,
                  // then download it via Blob so Chrome's
                  // data-URL-navigation block (since 2021) does
                  // not turn the click into an about:blank tab.
                  const href = o.pdfBase64
                    ? `data:application/pdf;base64,${o.pdfBase64}`
                    : (o.pdfUrl && o.pdfUrl !== 'inline' ? o.pdfUrl : '');
                  if (!href) return null;
                  return (
                    <button type="button"
                      onClick={() => kundliService.downloadPdfFromUrl(
                        href,
                        o.pdfName || 'AstroSeer-Kundli.pdf')}
                      className="mt-2 inline-block rounded-full
                        bg-primary px-3 py-1.5 text-xs font-bold
                        text-white">
                      Download
                    </button>
                  );
                })()}
                {o.validUntil && (
                  <div className="mt-1 text-[11px] text-sub-text">
                    Forecast valid until{' '}
                    {String(o.validUntil).slice(0, 10)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
