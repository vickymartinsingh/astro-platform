import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { db, rupees } from '@astro/shared';
import {
  collection, query, where, getDocs, orderBy,
} from 'firebase/firestore';

// Bank-statement-style ledger for a customer. Pulls EVERY row from
// /transactions where userId == uid (the single source of truth for
// the wallet balance), runs them through a chronological scan to
// compute a per-row running balance (just like a bank passbook), and
// surfaces filter chips by category + a reconciliation chip that
// flags when the computed balance disagrees with the live
// users/{uid}.wallet field.
//
// PDF and CSV downloads use the same in-memory rows so what the
// customer sees on a downloaded statement is exactly what the admin
// sees on screen.
//
// Each row is clickable to the source: sessionId -> session monitor,
// orderId -> orders page, giftcard code -> gift card details. Rows
// without a source just expand to show the raw metadata.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : typeof ts === 'number' ? ts
      : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}
function csvCell(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return `"${s}"`;
}

// Categorise a transaction row from its type + reason + referenceId
// shape. We map a wider universe of strings down to a small set of
// chips ("recharge", "session", "report", "gift card", "refund",
// "bonus", "adjustment", "reconciliation"). Anything we cannot
// classify falls into "other".
function categoriseOne(t) {
  const reason = String(t.reason || '').toLowerCase();
  const ref = String(t.referenceId || '').toLowerCase();
  // Admin Refund modal writes kind='refund' explicitly - check that
  // first so refunds never get mis-tagged when the narration text
  // happens to mention a session id.
  if (t.kind === 'refund') return 'refund';
  if (/recharge|topup|top-up|add money/.test(reason)) return 'recharge';
  if (/gift card|giftcard/.test(reason)) return 'gift_card';
  if (/refund|no activity/.test(reason)) return 'refund';
  if (/welcome|bonus/.test(reason)) return 'bonus';
  if (/voucher/.test(reason)) return 'voucher';
  if (/kundli report|report/.test(reason)
    || /^report|^order|^o[0-9]/.test(ref)) return 'report';
  if (/session|chat|call|video/.test(reason)
    || /^[TCVL]\d/.test(t.referenceId || '')) return 'session';
  if (/reconciliation|wallet_recovery/.test(reason)) return 'reconciliation';
  if (/admin/.test(reason) || /admin/.test(t.source || '')) return 'adjustment';
  return 'other';
}
const CAT_META = {
  all: { label: 'All', tone: 'bg-bg-light text-sub-text' },
  credit: { label: 'Credits', tone: 'bg-emerald-100 text-emerald-700' },
  debit: { label: 'Debits', tone: 'bg-rose-100 text-rose-700' },
  recharge: { label: 'Recharge', tone: 'bg-amber-100 text-amber-700' },
  gift_card: { label: 'Gift cards', tone: 'bg-amber-100 text-amber-800' },
  refund: { label: 'Refunds', tone: 'bg-sky-100 text-sky-700' },
  bonus: { label: 'Bonus', tone: 'bg-emerald-100 text-emerald-700' },
  voucher: { label: 'Vouchers', tone: 'bg-amber-100 text-amber-700' },
  report: { label: 'Reports', tone: 'bg-primary/15 text-primary' },
  session: { label: 'Sessions', tone: 'bg-violet-100 text-violet-700' },
  adjustment: { label: 'Admin adjust',
    tone: 'bg-slate-100 text-slate-700' },
  reconciliation: { label: 'Reconciliation',
    tone: 'bg-slate-100 text-slate-700' },
  other: { label: 'Other', tone: 'bg-bg-light text-sub-text' },
};

export default function UserTransactionsTab({ uid, user }) {
  const [rows, setRows] = useState(null);
  const [cat, setCat] = useState('all');

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'transactions'),
          where('userId', '==', uid),
          orderBy('createdAt', 'desc'),
        ));
        setRows(snap.docs.map((d) => {
          const t = d.data() || {};
          return { id: d.id, ...t, category: categoriseOne(t) };
        }));
      } catch (e) {
        // Index missing or rules - fall back to no-orderBy query
        // and sort in memory.
        try {
          const snap = await getDocs(query(
            collection(db, 'transactions'),
            where('userId', '==', uid),
          ));
          const list = snap.docs.map((d) => {
            const t = d.data() || {};
            return { id: d.id, ...t, category: categoriseOne(t) };
          });
          list.sort((a, b) => {
            const am = a.createdAt && a.createdAt.toMillis
              ? a.createdAt.toMillis() : 0;
            const bm = b.createdAt && b.createdAt.toMillis
              ? b.createdAt.toMillis() : 0;
            return bm - am;
          });
          setRows(list);
        } catch (_) { setRows([]); }
      }
    })();
  }, [uid]);

  // Per-row running balance: scan oldest->newest, accumulate, then
  // tag each row with `balanceAfter`. We render newest-first but the
  // balance column reads "balance immediately after this row".
  const enriched = useMemo(() => {
    if (!Array.isArray(rows)) return null;
    const oldest = [...rows].sort((a, b) => {
      const am = a.createdAt && a.createdAt.toMillis
        ? a.createdAt.toMillis() : 0;
      const bm = b.createdAt && b.createdAt.toMillis
        ? b.createdAt.toMillis() : 0;
      return am - bm;
    });
    let bal = 0;
    const out = [];
    for (const t of oldest) {
      const amt = Number(t.amount || 0);
      // Bank convention: amount field already signed in newer rows
      // (debits = negative). Older rows used type='debit' with a
      // positive amount; we treat that as a debit.
      // RECONCILIATION rows are ignored in the running balance.
      // They're just audit markers - the real ledger is the recharge
      // / debit rows. Including them would double-count (the same
      // bug that inflated wallets in recover-wallet.mjs prior to
      // 2026-06-06).
      const isRec = t.category === 'reconciliation';
      const delta = isRec
        ? 0
        : ((t.type === 'debit' && amt > 0) ? -amt : amt);
      bal += delta;
      out.push({ ...t, delta, balanceAfter: bal });
    }
    // Reverse to newest-first for the display.
    return out.reverse();
  }, [rows]);

  // Totals - drive the breakdown bar at the top. Reconciliation
  // rows are excluded from credits/debits totals for the same
  // reason as above; they still count toward the per-category tile.
  const totals = useMemo(() => {
    const t = {
      credits: 0, debits: 0, count: 0,
      byCat: {},
    };
    (rows || []).forEach((r) => {
      const amt = Number(r.amount || 0);
      const isRec = r.category === 'reconciliation';
      if (!isRec) {
        const delta = (r.type === 'debit' && amt > 0) ? -amt : amt;
        if (delta >= 0) t.credits += delta; else t.debits += -delta;
      }
      t.count += 1;
      t.byCat[r.category] = (t.byCat[r.category] || 0) + 1;
    });
    return t;
  }, [rows]);

  // Reconcile: sum (excluding reconciliation rows) should equal the
  // current wallet field on users/{uid}.
  const sumBalance = (rows || []).reduce((s, r) => {
    if (r.category === 'reconciliation') return s;
    const amt = Number(r.amount || 0);
    const delta = (r.type === 'debit' && amt > 0) ? -amt : amt;
    return s + delta;
  }, 0);
  const walletNow = Number(user?.wallet || 0);
  const reconcileDiff = walletNow - sumBalance;

  const filtered = useMemo(() => {
    if (!enriched) return [];
    if (cat === 'all') return enriched;
    if (cat === 'credit') return enriched.filter((r) => r.delta > 0);
    if (cat === 'debit') return enriched.filter((r) => r.delta < 0);
    return enriched.filter((r) => r.category === cat);
  }, [enriched, cat]);

  function downloadCsv() {
    if (!enriched) return;
    const header = ['When', 'Type', 'Category', 'Amount',
      'Balance after', 'Reason', 'Reference'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of enriched) {
      lines.push([
        fmt(r.createdAt),
        r.delta >= 0 ? 'Credit' : 'Debit',
        (CAT_META[r.category] || {}).label || r.category,
        r.delta,
        r.balanceAfter,
        r.reason || '',
        r.referenceId || r.id,
      ].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')],
      { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(user?.name || 'customer')
      .replace(/[^\w]+/g, '_')}-statement.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function downloadPdf() {
    if (!enriched) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const ROWS = enriched.map((r) => `
      <tr>
        <td>${fmt(r.createdAt)}</td>
        <td>${r.delta >= 0 ? 'Credit' : 'Debit'}</td>
        <td>${(CAT_META[r.category] || {}).label || r.category}</td>
        <td style="text-align:right;color:${
          r.delta >= 0 ? '#1f6f3a' : '#a31a1a'}">${
          r.delta >= 0 ? '+' : ''}${r.delta}</td>
        <td style="text-align:right">${r.balanceAfter}</td>
        <td>${String(r.reason || '').replace(/</g, '&lt;')}</td>
        <td>${String(r.referenceId || r.id || '').slice(0, 20)}</td>
      </tr>
    `).join('');
    const html = `<!doctype html><html><head>
      <meta charset="utf-8">
      <title>${user?.name || 'Customer'} - Wallet statement</title>
      <style>
        @page { size: A4 portrait; margin: 14mm 10mm; }
        body { font-family: Inter, Arial, sans-serif; color: #1A1A2E;
          margin: 0; }
        .head { display: flex; justify-content: space-between;
          align-items: flex-end; border-bottom: 2px solid #7F2020;
          padding-bottom: 8px; margin-bottom: 14px; }
        h1 { margin: 0; color: #7F2020; font-size: 22px; }
        .meta { font-size: 11px; color: #6B7280; text-align: right; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        th, td { padding: 5px 7px; border-bottom: 1px solid #E6DEC9;
          text-align: left; vertical-align: top; }
        th { background: #FBF7EE; color: #7F2020;
          font-size: 9.5px; text-transform: uppercase;
          letter-spacing: 0.4px; font-weight: 700; }
      </style>
    </head><body>
      <div class="head">
        <div>
          <h1>Wallet statement</h1>
          <div style="font-size:12px;margin-top:2px">
            ${user?.name || ''} &middot;
            ${user?.email || ''}
          </div>
        </div>
        <div class="meta">
          Generated <b>${fmt(Date.now())}</b><br/>
          Current balance <b>${rupees(walletNow)}</b><br/>
          ${enriched.length} transactions
        </div>
      </div>
      <table>
        <thead><tr>
          <th>When</th><th>Type</th><th>Category</th>
          <th style="text-align:right">Amount</th>
          <th style="text-align:right">Balance</th>
          <th>Reason</th><th>Reference</th>
        </tr></thead>
        <tbody>${ROWS}</tbody>
      </table>
    </body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} },
      400);
  }

  if (!enriched) {
    return <div className="surface mt-4 p-4 text-sm text-sub-text">
      Loading transactions...
    </div>;
  }

  return (
    <div className="surface mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide
            text-sub-text">Wallet statement</h2>
          <p className="mt-0.5 text-[11px] text-sub-text">
            Every credit + debit ever made to this wallet.
            Reconciles to the current wallet balance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadCsv}
            className="rounded-full bg-bg-light px-3 py-1.5 text-xs
              font-bold text-sub-text hover:bg-gray-200">
            Download CSV
          </button>
          <button onClick={downloadPdf}
            className="rounded-full bg-primary px-3 py-1.5 text-xs
              font-bold text-white">
            Download PDF
          </button>
        </div>
      </div>

      {/* Balance + reconciliation strip */}
      <div className="grid gap-2 sm:grid-cols-4">
        <Card label="Available balance"
          value={rupees(walletNow)} tone="emerald" />
        <Card label="Total credits"
          value={rupees(totals.credits)} tone="emerald" />
        <Card label="Total debits"
          value={rupees(totals.debits)} tone="rose" />
        <Card label={reconcileDiff === 0
          ? 'Reconciled' : 'Mismatch'}
          value={reconcileDiff === 0
            ? '✓ ledger = wallet'
            : `${reconcileDiff > 0 ? '+' : ''}${rupees(reconcileDiff)}`}
          tone={reconcileDiff === 0 ? 'emerald' : 'rose'}
          hint={reconcileDiff !== 0
            ? 'Run scripts/recover-wallet.mjs to reconcile'
            : null} />
      </div>

      {/* Category chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.keys(CAT_META).map((k) => {
          const meta = CAT_META[k];
          const n = k === 'all' ? totals.count
            : k === 'credit'
              ? enriched.filter((r) => r.delta > 0).length
              : k === 'debit'
                ? enriched.filter((r) => r.delta < 0).length
                : (totals.byCat[k] || 0);
          if (!n && k !== 'all') return null;
          return (
            <button key={k} onClick={() => setCat(k)}
              className={`rounded-full px-2.5 py-1 text-[11px]
                font-bold transition ${cat === k
                  ? meta.tone + ' ring-1 ring-current'
                  : 'bg-bg-light text-sub-text hover:bg-gray-200'}`}>
              {meta.label} {n}
            </button>
          );
        })}
      </div>

      {/* Ledger table */}
      <div className="mt-3 overflow-x-auto rounded-card border
        border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-bg-light text-left text-[10px]
            font-bold uppercase tracking-wider text-sub-text">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center
                text-sub-text">No transactions.</td></tr>
            ) : filtered.map((r) => {
              const isCredit = r.delta >= 0;
              return (
                <tr key={r.id} className="border-t border-gray-100
                  align-top hover:bg-bg-light/40">
                  <td className="px-3 py-2 whitespace-nowrap text-sub-text">
                    {fmt(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5
                      text-[9px] font-bold uppercase tracking-wider
                      ${(CAT_META[r.category] || CAT_META.other).tone}`}>
                      {(CAT_META[r.category] || CAT_META.other).label}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono
                    font-bold ${isCredit
                      ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isCredit ? '+' : ''}{rupees(r.delta)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono
                    text-dark-text">
                    {rupees(r.balanceAfter)}
                  </td>
                  <td className="px-3 py-2 text-dark-text">
                    {r.reason || '-'}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    <SourceLink t={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Render the right deep-link for a transaction's source. We
// recognise session ids (start with T/C/V/L), order ids (numeric
// 8-digit) and gift card codes (8 uppercase alphanumeric). Anything
// else is just printed as a mono ref.
function SourceLink({ t }) {
  const ref = String(t.referenceId || '').trim();
  if (!ref) return <span className="text-sub-text">-</span>;
  if (/^[TCVL]\d{6,12}$/.test(ref) || t.sessionId) {
    const sid = t.sessionId || ref;
    return (
      <Link href={`/admin-sessions?focus=${sid}`}
        className="font-mono text-primary hover:underline">
        {sid}
      </Link>
    );
  }
  if (/^\d{8}$/.test(ref) || /report/i.test(t.reason || '')) {
    return (
      <Link href={`/admin-orders?focus=${ref}`}
        className="font-mono text-primary hover:underline">
        {ref}
      </Link>
    );
  }
  if (/^[A-Z0-9]{8}$/.test(ref)) {
    return (
      <Link href="/admin-gifts"
        className="font-mono text-amber-700 hover:underline">
        {ref}
      </Link>
    );
  }
  return <span className="font-mono text-sub-text">{ref}</span>;
}

function Card({ label, value, tone, hint }) {
  const cls = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-800'
    : tone === 'rose'
      ? 'bg-rose-50 text-rose-800'
      : 'bg-bg-light text-dark-text';
  return (
    <div className={`rounded-card p-3 ${cls}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider
        opacity-75">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] opacity-75">{hint}</div>
      )}
    </div>
  );
}
