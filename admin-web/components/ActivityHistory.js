// Admin "Activity History" panel.
//
// Aggregates every event we have on a user (logins / device sessions,
// audit events from the relay, wallet transactions, consultation
// sessions, kundli orders) into a single timeline. Date-range filter
// with the presets the user asked for (Today / Yesterday / This Week
// / This Month / This Quarter / H1 / This Year / Last Year / Custom).
// "Download PDF" prints a clean A4-friendly report via the browser's
// Save-as-PDF dialog so no server-side renderer is required.
import { useEffect, useMemo, useState } from 'react';
import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db, auditService, kundliService } from '@astro/shared';

const PRESETS = [
  ['today',       'Today'],
  ['yesterday',   'Yesterday'],
  ['week',        'This week'],
  ['month',       'This month'],
  ['quarter',     'This quarter'],
  ['half',        'Last 6 months'],
  ['year',        'This year'],
  ['prevyear',    'Last year'],
  ['all',         'All time'],
  ['custom',      'Custom range'],
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  // Monday-start week (ISO-ish). Sunday -> previous Monday.
  const day = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (day - 1));
  return x;
}
function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfQuarter(d) {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

function presetRange(key, customFrom, customTo) {
  const now = new Date();
  if (key === 'today') {
    return [+startOfDay(now), +endOfDay(now)];
  }
  if (key === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return [+startOfDay(y), +endOfDay(y)];
  }
  if (key === 'week') return [+startOfWeek(now), +endOfDay(now)];
  if (key === 'month') return [+startOfMonth(now), +endOfDay(now)];
  if (key === 'quarter') return [+startOfQuarter(now), +endOfDay(now)];
  if (key === 'half') {
    const six = new Date(now); six.setMonth(six.getMonth() - 6);
    return [+startOfDay(six), +endOfDay(now)];
  }
  if (key === 'year') {
    return [+new Date(now.getFullYear(), 0, 1), +endOfDay(now)];
  }
  if (key === 'prevyear') {
    return [+new Date(now.getFullYear() - 1, 0, 1),
      +new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999)];
  }
  if (key === 'custom') {
    return [
      customFrom ? +startOfDay(new Date(customFrom)) : 0,
      customTo ? +endOfDay(new Date(customTo)) : Date.now(),
    ];
  }
  // 'all'
  return [0, Date.now()];
}

const TYPE_LABEL = {
  login_session: 'Login / device',
  audit: 'App event',
  transaction: 'Wallet',
  session: 'Consultation',
  order: 'Kundli order',
};

function fmt(ms) {
  if (!ms) return '·';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtAmount(n) {
  if (n == null) return '';
  return `${Number(n) >= 0 ? '+' : ''}₹${Math.abs(Number(n))}`;
}

export default function ActivityHistory({ uid, user }) {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [fromMs, toMs] = useMemo(
    () => presetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true); setError('');
    (async () => {
      try {
        // Fan out: pull everything in parallel.
        const [audit, sessions, txns, orders, loginHist] =
          await Promise.all([
            auditService.getAuditByUserBetween(uid, fromMs, toMs, 1000)
              .catch(() => []),
            getDocs(query(collection(db, 'sessions'),
              where('userId', '==', uid),
              orderBy('createdAt', 'desc'), limit(500)))
              .then((s) => s.docs.map((d) =>
                ({ id: d.id, ...d.data() })))
              .catch(() => []),
            getDocs(query(collection(db, 'transactions'),
              where('userId', '==', uid),
              orderBy('createdAt', 'desc'), limit(500)))
              .then((s) => s.docs.map((d) =>
                ({ id: d.id, ...d.data() })))
              .catch(() => []),
            kundliService.listOrders(uid).catch(() => []),
            getDocs(query(collection(db, 'users', uid, 'sessions'),
              orderBy('at', 'desc'), limit(500)))
              .then((s) => s.docs.map((d) =>
                ({ id: d.id, ...d.data() })))
              .catch(() => []),
          ]);
        const ms = (x) => {
          const t = x && (x.toMillis ? x.toMillis()
            : x.seconds ? x.seconds * 1000 : 0);
          return t || 0;
        };
        // Map every source onto a unified shape.
        const merged = [
          ...audit.map((a) => ({
            kind: 'audit', at: ms(a.createdAt) || a.ts || 0,
            label: a.type || 'event', detail: a.meta || {},
            ip: (a.meta && a.meta.ip) || a.ip || '',
            ua: (a.meta && a.meta.ua) || a.ua || '',
            id: a.id,
          })),
          ...loginHist.map((l) => ({
            kind: 'login_session', at: ms(l.at),
            label: 'Connected', detail: l,
            ip: l.ip || '', ua: l.ua || '',
            id: l.id,
          })),
          ...txns.map((t) => ({
            kind: 'transaction', at: ms(t.createdAt),
            label: t.reason || t.type || 'transaction',
            amount: t.amount,
            detail: t, id: t.id,
          })),
          ...sessions.map((s) => ({
            kind: 'session', at: ms(s.createdAt),
            label: `${s.type || 'chat'} consultation`,
            astroId: s.astroId,
            durationSec: Number(s.duration || 0),
            cost: s.cost, detail: s, id: s.id,
          })),
          ...orders.map((o) => {
            // Determine whether the wallet was actually debited.
            // prepaid_* orders are pre-generated in the background
            // when the user saves their profile; the wallet debit
            // only happens later when they explicitly click "Buy"
            // (the claim path). complimentary orders are admin gifts.
            // Showing ₹299 as a debit for a prepaid order is
            // misleading because no money left the user's wallet.
            const st = o.status || '';
            const walletDebited = Number(o.amount) > 0
              && (st === 'paid_generating' || st === 'ready')
              && !o.complimentary;
            const isPrepaid = st.startsWith('prepaid') || !!o.prepaid;
            const kindLabel = o.kind === 'forecast12'
              ? '12-Month Forecast PDF'
              : (o.kind === 'free' ? 'Free Vedic Kundli PDF'
                : 'Kundli report');
            let suffix = '';
            if (o.complimentary) {
              suffix = ' (complimentary, no charge)';
            } else if (isPrepaid) {
              suffix = ` (pre-generated, not yet purchased`
                + ` : price ₹${Number(o.amount || 0)})`;
            }
            return {
              kind: 'order', at: ms(o.paidAt),
              label: kindLabel + suffix,
              // Only show as a debit if wallet was actually debited.
              amount: walletDebited
                ? -Math.abs(Number(o.amount)) : null,
              detail: o, id: o.id,
            };
          }),
        ];
        const filtered = merged
          .filter((r) => r.at >= fromMs && r.at <= toMs)
          .sort((a, b) => b.at - a.at);
        setRows(filtered);
      } catch (e) {
        setError(e.message || 'Failed to load activity.');
        setRows([]);
      } finally { setLoading(false); }
    })();
  }, [uid, fromMs, toMs]);

  function downloadPdf() {
    if (typeof window === 'undefined' || !rows) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const name = (user && user.name) || uid || 'user';
    const email = (user && user.email) || '';
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Activity History - ${escapeHtml(name)}</title>
<style>
  body { font: 12px -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    color: #1A1A2E; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px 0; color: #7F2020; }
  .sub { color: #555; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #eee; padding: 6px 4px;
    text-align: left; vertical-align: top; }
  th { background: #FFF7E0; }
  .kind { font-weight: 700; }
  .meta { color: #666; font-size: 10px; word-break: break-all; }
  .amt-pos { color: #178A3F; font-weight: 700; }
  .amt-neg { color: #B83227; font-weight: 700; }
  @media print { @page { margin: 12mm; } }
</style></head><body>
<h1>Activity History - ${escapeHtml(name)}</h1>
<div class="sub">
  ${escapeHtml(email)} · UID ${escapeHtml(uid)}<br/>
  Range: ${fmt(fromMs)} to ${fmt(toMs)}<br/>
  ${rows.length} events · Generated ${fmt(Date.now())}
</div>
<table>
<thead><tr><th>When</th><th>Type</th><th>Detail</th>
<th style="text-align:right">Amount</th></tr></thead>
<tbody>
${rows.map((r) => `
<tr>
  <td>${escapeHtml(fmt(r.at))}</td>
  <td><span class="kind">${escapeHtml(TYPE_LABEL[r.kind] || r.kind)}</span>
    <div class="meta">${escapeHtml(r.label || '')}</div></td>
  <td><div>${escapeHtml(detailText(r))}</div>
    <div class="meta">${escapeHtml(metaText(r))}</div></td>
  <td style="text-align:right" class="${
  r.amount > 0 ? 'amt-pos'
    : r.amount < 0 ? 'amt-neg' : ''}">${
  r.amount != null ? escapeHtml(fmtAmount(r.amount)) : ''}</td>
</tr>`).join('')}
</tbody></table>
</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => { try { w.focus(); w.print(); } catch (_) {} };
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 600);
  }

  return (
    <div className="surface mt-4 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between
        gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide
          text-sub-text">Activity History</h2>
        <button onClick={downloadPdf}
          disabled={!rows || rows.length === 0}
          className="rounded-full bg-primary px-3 py-1 text-[11px]
            font-bold text-white disabled:opacity-40">
          ⬇ PDF
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {PRESETS.map(([k, label]) => (
          <button key={k} type="button"
            onClick={() => setPreset(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${preset === k ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text'}`}>
            {label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="mb-2 flex flex-wrap gap-2">
          <label className="text-[11px] text-sub-text">From
            <input type="date" className="input ml-1 !min-h-0 py-1
              text-xs" value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label className="text-[11px] text-sub-text">To
            <input type="date" className="input ml-1 !min-h-0 py-1
              text-xs" value={customTo}
              onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      <div className="mb-2 text-[10px] text-sub-text">
        Range: {fmt(fromMs)} to {fmt(toMs)}
        {rows ? ` · ${rows.length} events` : ''}
      </div>
      {loading && (
        <div className="text-sm text-sub-text">Loading…</div>
      )}
      {error && (
        <div className="rounded-card bg-danger/10 p-2 text-xs
          text-danger">{error}</div>
      )}
      {rows && rows.length === 0 && !loading && (
        <div className="text-sm text-sub-text">
          No activity in this range.
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Type</th>
                <th className="py-1 pr-3">Detail</th>
                <th className="py-1 pr-3">IP</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}
                  className="border-t border-gray-100 align-top">
                  <td className="py-1 pr-3 font-mono whitespace-nowrap">
                    {fmt(r.at)}
                  </td>
                  <td className="py-1 pr-3">
                    <div className="font-bold">
                      {TYPE_LABEL[r.kind] || r.kind}
                    </div>
                    <div className="text-[10px] text-sub-text">
                      {r.label || ''}
                    </div>
                  </td>
                  <td className="py-1 pr-3">
                    <div>{detailText(r)}</div>
                    <div className="text-[10px] text-sub-text">
                      {metaText(r)}
                    </div>
                  </td>
                  <td className="py-1 pr-3 font-mono">{r.ip || '·'}</td>
                  <td className={`py-1 text-right font-bold ${
                    r.amount > 0 ? 'text-success'
                      : r.amount < 0 ? 'text-danger' : ''}`}>
                    {r.amount != null ? fmtAmount(r.amount) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function detailText(r) {
  if (r.kind === 'login_session') return 'Opened the app / website';
  if (r.kind === 'session') {
    const mins = Math.round((r.durationSec || 0) / 60);
    return `${mins}m with ${r.astroId || 'astrologer'}`;
  }
  if (r.kind === 'order') {
    const st = r.detail && r.detail.status
      ? ` [${r.detail.status}]` : '';
    return (r.detail && r.detail.profileName)
      ? `Chart: ${r.detail.profileName}${st}`
      : `Kundli PDF order${st}`;
  }
  if (r.kind === 'transaction') {
    return r.detail && r.detail.type
      ? `${r.detail.type} · ${r.detail.reason || ''}`
      : (r.detail && r.detail.reason) || '';
  }
  if (r.kind === 'audit') {
    const m = r.detail || {};
    if (m.path) return `route: ${m.path}`;
    return Object.keys(m).filter((k) =>
      !['ua', 'platform', 'language', 'online', 'screen', 'timezone']
        .includes(k))
      .map((k) => `${k}=${String(m[k]).slice(0, 60)}`)
      .join(' · ').slice(0, 200);
  }
  return '';
}
function metaText(r) {
  const d = r.detail || {};
  const ua = d.ua || r.ua || '';
  const platform = d.platform || '';
  const out = [platform, ua].filter(Boolean).join(' · ');
  return out.slice(0, 140);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
