import { useState, useEffect } from 'react';
import Link from 'next/link';
import { adminService, db } from '@astro/shared';
import {
  collection, query, where, getDocs, deleteDoc, doc, writeBatch,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Reset Transactions
//
// Two distinct scopes the operator can pick:
//
//   USER RESET - target one customer's transaction history.
//     Optionally also "remove from admin": subtract those same rows
//     from the global revenue counter (settings/config.revenueResetAt
//     is shifted forward to exclude them, OR we hard-delete from the
//     transactions/ collection so admin dashboard never sees them).
//
//   ADMIN RESET - global revenue counter reset. Same as the old
//     "Reset revenue counter" button on /admin-dashboard, exposed
//     here so it lives alongside the user-scoped reset and audit
//     trail captures it.
//
// Both go through soft-archive (RESET_PARTS=['transaction']) so the
// rows are recoverable from /admin-archive, then optionally hard-
// deleted on a second pass when the "also remove from admin" flag
// is on.
export default function AdminResetTransactions() {
  const { loading } = useRequireAdmin();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [pickedUid, setPickedUid] = useState('');
  const [removeFromAdmin, setRemoveFromAdmin] = useState(false);
  const [confirmUser, setConfirmUser] = useState('');
  const [confirmAdmin, setConfirmAdmin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) =>
      setUsers((list || []).filter((u) => (u.role || 'client') === 'client')))
      .catch(() => setUsers([]));
  }, [loading]);

  const filtered = (users || []).filter((u) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.name || '').toLowerCase().includes(s)
      || (u.email || '').toLowerCase().includes(s)
      || String(u.phone || '').includes(s)
      || String(u.userCode || '').toLowerCase().includes(s);
  }).slice(0, 50);
  const picked = users.find((u) => (u.uid || u.id) === pickedUid);

  async function runUserReset() {
    if (!picked) { flash('Pick a customer.', 'error'); return; }
    if (confirmUser.trim() !== 'RESET') {
      flash('Type RESET to confirm.', 'error'); return;
    }
    setBusy(true);
    try {
      // 1. Soft archive + delete the user's transactions (recoverable
      //    via /admin-archive). adminService.resetUserData with the
      //    'transaction' part handles this.
      await adminService.resetAccountData(picked.uid || picked.id,
        { role: 'client', parts: ['transaction'] });
      // 2. If "also remove from admin" - hard-delete from the
      //    transactions/ root collection too, so the admin dashboard
      //    revenue counter no longer counts them.
      if (removeFromAdmin) {
        const snap = await getDocs(query(collection(db, 'transactions'),
          where('userId', '==', picked.uid || picked.id)));
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        flash(`Reset ${docs.length} transaction(s) for `
          + `${picked.name || picked.email} and removed them from `
          + 'the admin revenue counter.', 'success');
      } else {
        flash(`Reset transactions for ${picked.name || picked.email}. `
          + 'They are archived for recovery; admin dashboard still '
          + 'counts them.', 'success');
      }
      setConfirmUser(''); setRemoveFromAdmin(false);
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }

  async function runAdminReset() {
    if (confirmAdmin.trim() !== 'RESET REVENUE') {
      flash('Type RESET REVENUE to confirm.', 'error'); return;
    }
    setBusy(true);
    try {
      await adminService.updateSettings('config',
        { revenueResetAt: Date.now() });
      flash('Admin revenue counter reset. Past transactions are '
        + 'kept but excluded from the dashboard total.', 'success');
      setConfirmAdmin('');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">Reset transactions</h1>
      <p className="mb-5 text-sm text-sub-text">
        Two scopes: <b>User reset</b> wipes one customer&apos;s
        transaction history (recoverable from{' '}
        <Link href="/admin-archive" className="text-primary
          hover:underline">Archive</Link>),
        with an option to also drop those rows from the admin revenue
        counter. <b>Admin reset</b> moves the global revenue cutoff
        forward so the dashboard total starts fresh from now.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* USER RESET */}
        <section className="surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center
              rounded-full bg-amber-100 text-amber-700">⟳</span>
            <h2 className="text-base font-bold">User reset</h2>
          </div>
          <input className="input w-full" placeholder="Search by name,
            email, phone or user code" value={q}
            onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto rounded-card
            border border-gray-200">
            {filtered.length === 0 ? (
              <div className="p-3 text-sm text-sub-text">No matches.</div>
            ) : (
              filtered.map((u) => {
                const uid = u.uid || u.id;
                const active = pickedUid === uid;
                return (
                  <button key={uid} onClick={() => setPickedUid(uid)}
                    className={`flex w-full items-center justify-between
                      gap-2 border-b border-gray-100 px-3 py-2
                      text-left text-sm last:border-b-0 ${active
                        ? 'bg-primary/5' : 'hover:bg-bg-light'}`}>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {u.name || u.email || '(no name)'}
                      </div>
                      <div className="truncate text-[11px]
                        text-sub-text">
                        {u.email} {u.phone ? `· ${u.phone}` : ''}
                      </div>
                    </div>
                    {active && (
                      <span className="rounded-full bg-primary
                        px-2 py-0.5 text-[10px] font-bold text-white">
                        Selected
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {picked && (
            <>
              <label className="flex items-start gap-2 rounded-card
                bg-bg-light p-3 text-[12px] text-dark-text">
                <input type="checkbox" checked={removeFromAdmin}
                  onChange={(e) => setRemoveFromAdmin(e.target.checked)}
                  className="mt-0.5" />
                <span>
                  <b>Also remove from the admin revenue counter.</b>
                  {' '}When on, these rows are hard-deleted from{' '}
                  <code>transactions/</code> so the dashboard total
                  drops. When off, the rows stay (archived only) and
                  admin revenue is unchanged.
                </span>
              </label>
              <div>
                <label className="block text-[11px] font-semibold
                  text-sub-text">Type RESET to confirm</label>
                <input className="input mt-1" value={confirmUser}
                  onChange={(e) => setConfirmUser(e.target.value)}
                  placeholder="RESET" />
              </div>
              <button onClick={runUserReset} disabled={busy
                || confirmUser.trim() !== 'RESET'}
                className="w-full rounded-full bg-danger px-4 py-2
                  text-sm font-bold text-white disabled:opacity-50">
                {busy ? 'Resetting...'
                  : `Reset transactions for ${
                    picked.name || picked.email}`}
              </button>
            </>
          )}
        </section>

        {/* ADMIN RESET */}
        <section className="surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center
              rounded-full bg-red-100 text-red-700">⟲</span>
            <h2 className="text-base font-bold">Admin reset
              (global revenue)</h2>
          </div>
          <p className="text-[12px] text-sub-text">
            Moves the global revenue cutoff forward. The dashboard
            <b> Total Revenue</b> and <b>Revenue Today</b> tiles will
            start counting from this moment. Past transactions stay
            in <code>transactions/</code>, just excluded from the
            counter. Reversible by setting{' '}
            <code>settings/config.revenueResetAt</code> back to 0.
          </p>
          <label className="block">
            <span className="text-[11px] font-semibold text-sub-text">
              Type RESET REVENUE to confirm
            </span>
            <input className="input mt-1" value={confirmAdmin}
              onChange={(e) => setConfirmAdmin(e.target.value)}
              placeholder="RESET REVENUE" />
          </label>
          <button onClick={runAdminReset} disabled={busy
            || confirmAdmin.trim() !== 'RESET REVENUE'}
            className="w-full rounded-full bg-danger px-4 py-2
              text-sm font-bold text-white disabled:opacity-50">
            {busy ? 'Resetting...' : 'Reset the global revenue counter'}
          </button>
        </section>
      </div>
    </Layout>
  );
}
