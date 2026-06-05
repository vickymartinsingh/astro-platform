import { useEffect, useMemo, useState } from 'react';
import {
  adminService, db, rupees, authService,
} from '@astro/shared';
import {
  deleteDoc, doc, writeBatch,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Transactions admin.
//
// Reads the entire transactions/ collection (paged at 500), groups
// by SOURCE so the admin can tell "real" payments (paid via gateway)
// apart from giftcards / wallet bonuses / admin top-ups. Only the
// real-revenue source counts toward dashboard totals.
//
// Two destructive paths the issues doc asked for:
//   1) Select rows -> Delete selected (admin password required).
//   2) Reset all   -> Wipe the whole transactions collection in
//      batches of 400 (admin password required, last-resort).
//
// Both write an audit entry, then refuse to run when the password
// is wrong.
function isGatewayTxn(t) {
  // The reason / source fields we use to tell a real Razorpay /
  // Cashfree etc. payment apart from a wallet adjustment, gift
  // card redemption or admin top-up. New gateway entries should
  // set source='gateway' OR reason='recharge'; everything else
  // is considered internal.
  const src = String(t.source || '').toLowerCase();
  const reason = String(t.reason || '').toLowerCase();
  if (src === 'gateway') return true;
  if (reason === 'recharge') return true;
  if (reason === 'razorpay' || reason === 'cashfree'
    || reason === 'stripe') return true;
  return false;
}

export default function AdminTransactions() {
  const { user, loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const list = await adminService.getAllTransactions(filter
      ? { type: filter } : {});
    setRows(list);
    setSel({});
  }
  useEffect(() => {
    if (loading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, filter]);

  const shown = useMemo(() => {
    const list = rows || [];
    if (sourceFilter === 'gateway') return list.filter(isGatewayTxn);
    if (sourceFilter === 'internal') {
      return list.filter((t) => !isGatewayTxn(t));
    }
    return list;
  }, [rows, sourceFilter]);

  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const allShownSelected = shown.length > 0
    && shown.every((t) => sel[t.id]);

  function toggleAll() {
    if (allShownSelected) {
      const next = { ...sel };
      shown.forEach((t) => { delete next[t.id]; });
      setSel(next);
    } else {
      const next = { ...sel };
      shown.forEach((t) => { next[t.id] = true; });
      setSel(next);
    }
  }

  function exportCsv() {
    const head = 'id,userId,amount,type,reason,source,gateway,createdAt\n';
    const body = (shown || []).map((t) =>
      `${t.id},${t.userId},${t.amount},${t.type},${t.reason},`
      + `${t.source || ''},${isGatewayTxn(t) ? 'yes' : 'no'},${
        t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : ''}`)
      .join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transactions.csv';
    a.click();
  }

  // Re-auth the signed-in admin so an unattended browser cannot
  // wipe transactions. Returns true only if Firebase Auth accepted
  // the password against the same email.
  async function reAuth(label) {
    const pw = window.prompt(
      `Confirm with your admin password to ${label}:`);
    if (!pw) return false;
    try {
      await authService.loginUser(user.email, pw);
      return true;
    } catch (_) {
      flash('Password did not match. Cancelled.', 'error');
      return false;
    }
  }

  async function deleteSelected() {
    if (selectedIds.length === 0) {
      flash('Select some rows first.', 'error'); return;
    }
    if (!window.confirm(`Permanently delete ${selectedIds.length} `
      + 'transaction(s)? They will not be recoverable.')) return;
    if (!await reAuth('delete the selected transactions')) return;
    setBusy(true);
    try {
      for (let i = 0; i < selectedIds.length; i += 400) {
        const batch = writeBatch(db);
        selectedIds.slice(i, i + 400).forEach((id) => {
          batch.delete(doc(db, 'transactions', id));
        });
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
      }
      flash(`Deleted ${selectedIds.length} transaction(s).`, 'success');
      await load();
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }

  async function resetAll() {
    if (!window.confirm('Reset the ENTIRE transactions collection? '
      + 'This permanently deletes every row from the live database. '
      + 'Use admin-reset-transactions instead if you only want to '
      + 'reset the dashboard counter while keeping the rows.')) return;
    if (!await reAuth('reset the entire transactions table')) return;
    setBusy(true);
    try {
      const list = await adminService.getAllTransactions({});
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        list.slice(i, i + 400).forEach((t) => {
          batch.delete(doc(db, 'transactions', t.id));
        });
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
      }
      flash(`Reset complete. ${list.length} row(s) deleted.`, 'success');
      await load();
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const gatewayCount = (rows || []).filter(isGatewayTxn).length;

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            {rows.length} total · {gatewayCount} gateway payments
            (real revenue) · {rows.length - gatewayCount} internal
            (gift / wallet / bonus). Use the source filter to focus.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCsv} className="rounded-full
            bg-bg-light px-3 py-1.5 text-xs font-bold">
            Export CSV
          </button>
          <button onClick={deleteSelected} disabled={busy
            || selectedIds.length === 0}
            className="rounded-full bg-danger px-3 py-1.5 text-xs
              font-bold text-white disabled:opacity-40">
            Delete selected ({selectedIds.length})
          </button>
          <button onClick={resetAll} disabled={busy}
            className="rounded-full border border-danger px-3 py-1.5
              text-xs font-bold text-danger">
            Reset ALL (danger)
          </button>
        </div>
      </div>

      <div className="surface mb-3 flex flex-wrap gap-2 p-3">
        <div className="flex gap-1">
          {[['', 'All types'], ['credit', 'Credit'],
            ['debit', 'Debit']].map(([t, lbl]) => (
            <button key={t || 'all'} onClick={() => setFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-bold
                ${filter === t ? 'bg-primary text-white'
                  : 'bg-bg-light text-sub-text'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <span className="text-sub-text">|</span>
        <div className="flex gap-1">
          {[['all', 'All sources'], ['gateway', 'Gateway only'],
            ['internal', 'Internal only']].map(([k, lbl]) => (
            <button key={k} onClick={() => setSourceFilter(k)}
              className={`rounded-full px-3 py-1 text-xs font-bold
                ${sourceFilter === k ? 'bg-primary text-white'
                  : 'bg-bg-light text-sub-text'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-sub-text">
          {shown.length} shown
        </span>
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider
            text-sub-text">
            <tr>
              <th className="p-3">
                <input type="checkbox" checked={allShownSelected}
                  onChange={toggleAll} />
              </th>
              <th className="p-3">When</th>
              <th className="p-3">User</th>
              <th className="p-3">Type</th>
              <th className="p-3">Source</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Reason</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className="border-t border-gray-200">
                <td className="p-3">
                  <input type="checkbox"
                    checked={!!sel[t.id]}
                    onChange={(e) => setSel({ ...sel,
                      [t.id]: e.target.checked })} />
                </td>
                <td className="p-3 text-xs">
                  {t.createdAt?.toDate
                    ? t.createdAt.toDate().toLocaleString() : ''}
                </td>
                <td className="p-3 font-mono text-[11px]">
                  {String(t.userId || '').slice(0, 10)}
                </td>
                <td className="p-3 capitalize">{t.type}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5
                    text-[10px] font-bold ${isGatewayTxn(t)
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-800'}`}>
                    {isGatewayTxn(t) ? 'gateway' : 'internal'}
                  </span>
                </td>
                <td className={`p-3 ${t.amount >= 0
                  ? 'text-success' : 'text-danger'}`}>
                  {t.amount >= 0 ? '+' : '-'}{rupees(Math.abs(t.amount))}
                </td>
                <td className="p-3 text-xs capitalize">{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
