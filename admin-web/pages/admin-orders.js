import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { kundliService, userService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin-side view of every kundli PDF order across every customer.
// Filterable by status + report kind + search-by-name/email. Each row
// drills down to the customer profile and shows the PDF status,
// download link, and amount paid.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : Number(ts) || 0;
    if (!ms) return '·';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '·'; }
}

const STATUS_CHIP = {
  ready: 'bg-success/10 text-success',
  paid_generating: 'bg-warning/10 text-warning',
  free_generating: 'bg-warning/10 text-warning',
  failed: 'bg-danger/10 text-danger',
  failed_refunded: 'bg-danger/10 text-danger',
};
const STATUS_LABEL = {
  ready: 'Ready',
  paid_generating: 'Generating…',
  free_generating: 'Generating…',
  failed: 'Failed',
  failed_refunded: 'Failed (refunded)',
};

const KIND_LABEL = {
  free: 'Free Vedic Kundli',
  forecast12: '12-Month Forecast',
  careerFinance: 'Career & Finance',
  lifetime: 'Lifetime Report',
};

export default function AdminOrders() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [usersById, setUsersById] = useState({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  useEffect(() => {
    (async () => {
      const list = await kundliService.listAllOrdersAdmin();
      setRows(list);
      // Fetch each unique customer once for the display row + drilldown.
      const uniq = [...new Set(list.map((o) => o.userId).filter(Boolean))];
      const fetched = {};
      await Promise.all(uniq.map(async (uid) => {
        try {
          const s = await getDoc(doc(db, 'users', uid));
          if (s.exists()) fetched[uid] = { id: s.id, ...s.data() };
        } catch (_) {}
      }));
      setUsersById(fetched);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = search.trim().toLowerCase();
    return rows.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (kindFilter && o.kind !== kindFilter) return false;
      if (!term) return true;
      const u = usersById[o.userId] || {};
      return (
        (u.name || '').toLowerCase().includes(term)
        || (u.email || '').toLowerCase().includes(term)
        || (o.profileName || '').toLowerCase().includes(term)
        || String(o.id || '').toLowerCase().includes(term)
        || String(o.userId || '').toLowerCase().includes(term)
      );
    });
  }, [rows, search, statusFilter, kindFilter, usersById]);

  if (loading || !rows) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const totalRevenue = rows
    .filter((o) => o.status === 'ready' && o.amount > 0)
    .reduce((s, o) => s + Number(o.amount || 0), 0);
  const totalFree = rows.filter((o) => o.amount === 0
    && (o.status === 'ready' || o.kind === 'free')).length;
  const totalFailed = rows.filter((o) =>
    o.status === 'failed' || o.status === 'failed_refunded').length;

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">Order Management</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every kundli PDF order across the customer base. Click any row
        to drill into the customer profile, regenerate or refund.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total orders" value={rows.length} />
        <Stat label="Revenue (₹)" value={totalRevenue.toFixed(0)}
          highlight />
        <Stat label="Free reports" value={totalFree} />
        <Stat label="Failed" value={totalFailed}
          danger={totalFailed > 0} />
      </div>

      <div className="surface mb-3 grid gap-2 p-3 sm:grid-cols-3">
        <input className="input" placeholder="Search by customer
          name, email, profile, order id…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="paid_generating">Generating (paid)</option>
          <option value="free_generating">Generating (free)</option>
          <option value="failed">Failed</option>
          <option value="failed_refunded">Failed (refunded)</option>
        </select>
        <select className="input" value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">All report types</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="surface p-4 text-center text-sub-text">
          No orders match your filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const u = usersById[o.userId] || {};
            const at = o.paidAt && o.paidAt.toDate
              ? o.paidAt.toDate() : null;
            const href = o.pdfBase64
              ? `data:application/pdf;base64,${o.pdfBase64}`
              : (o.pdfUrl && o.pdfUrl !== 'inline' ? o.pdfUrl : '');
            return (
              <div key={o.id} className="surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {KIND_LABEL[o.kind] || o.kind || 'Report'}
                    </div>
                    <div className="text-xs text-sub-text">
                      Order <span className="font-mono">{o.id}</span>
                      {at ? ` · ${fmt(o.paidAt)}` : ''}
                    </div>
                    {/* Customer block */}
                    <div className="mt-2 rounded-card bg-bg-light p-2
                      text-xs">
                      <div className="font-bold">
                        {u.name || '(unknown customer)'}
                        {u.email && (
                          <span className="ml-1 text-sub-text">
                            ({u.email})
                          </span>
                        )}
                      </div>
                      <div className="text-sub-text">
                        UID <span className="font-mono">{o.userId}</span>
                        {u.phone ? ` · ${u.phone}` : ''}
                        {u.wallet != null ? ` · ₹${u.wallet} wallet`
                          : ''}
                      </div>
                      {(u.lastIp || u.lastUserAgent) && (
                        <div className="mt-0.5 text-sub-text">
                          Last seen: {u.lastIp || '·'}
                          {u.lastUserAgent
                            ? ` · ${(u.lastUserAgent).slice(0, 60)}…`
                            : ''}
                        </div>
                      )}
                      <Link
                        href={`/admin-user-profile/${o.userId}`}
                        className="mt-1 inline-block font-bold
                          text-primary underline">
                        Open full customer profile →
                      </Link>
                    </div>
                    {/* Profile / chart used to generate the report */}
                    {(o.profileName || o.profileDob) && (
                      <div className="mt-2 text-xs text-sub-text">
                        <b>Chart used:</b> {o.profileName}
                        {o.profileDob ? ` · DOB ${o.profileDob}` : ''}
                        {o.profileTob ? ` · ${o.profileTob}` : ''}
                        {o.profileAmpm ? ` ${o.profileAmpm}` : ''}
                        {o.profilePlace ? ` · ${o.profilePlace}` : ''}
                      </div>
                    )}
                    {o.failureReason && (
                      <div className="mt-2 rounded-card bg-danger/10
                        p-2 text-xs text-danger">
                        Failure: {o.failureReason}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-block rounded-full px-2
                      py-0.5 text-[10px] font-bold ${
                        STATUS_CHIP[o.status] || 'bg-bg-light '
                        + 'text-sub-text'}`}>
                      {STATUS_LABEL[o.status] || o.status || '·'}
                    </span>
                    <div className="mt-1 text-sm font-bold">
                      {o.amount > 0 ? `₹${o.amount}` : 'Free'}
                    </div>
                    {o.status === 'ready' && href && (
                      <button type="button"
                        onClick={() =>
                          kundliService.downloadPdfFromUrl(href,
                            o.pdfName || 'AstroSeer-Kundli.pdf')}
                        className="mt-2 rounded-full bg-primary px-3
                          py-1 text-[11px] font-bold text-white">
                        Download PDF
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

function Stat({ label, value, highlight, danger }) {
  return (
    <div className={`surface p-3 ${danger ? 'border border-danger/30'
      : highlight ? 'border border-primary/30' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide
        text-sub-text">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${danger
        ? 'text-danger' : highlight ? 'text-primary' : ''}`}>
        {value}
      </div>
    </div>
  );
}
