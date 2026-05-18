import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, adminService } from '@astro/shared';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const TEST_EMAIL = 'vickymartinsing@gmail.com';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function AdminDashboard() {
  const { loading } = useRequireAdmin();
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadData() {
    const [users, astros, txns, astroSnap, cfgSnap] = await Promise.all([
      adminService.getAllUsers(),
      adminService.getAllUsers({ role: 'astrologer' }),
      adminService.getAllTransactions({ type: 'debit' }),
      getDocs(collection(db, 'astrologers')),
      getDoc(doc(db, 'settings', 'config')),
    ]);
    const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
    const resetAt = Number(cfg.revenueResetAt || 0); // ms cutoff
    // Test account uids are excluded from real revenue.
    const testUids = new Set(users
      .filter((u) => u.email === TEST_EMAIL || u.isTest)
      .map((u) => u.uid));
    const ms = (t) => (t.createdAt?.toDate
      ? t.createdAt.toDate().getTime() : 0);
    const today = Date.now() - 864e5;

    const real = txns.filter((t) => !testUids.has(t.userId)
      && ms(t) >= resetAt);
    const revToday = r2(real
      .filter((t) => ms(t) >= today)
      .reduce((a, t) => a + Math.abs(t.amount), 0));
    const revAll = r2(real.reduce((a, t) => a + Math.abs(t.amount), 0));

    const aList = astroSnap.docs.map((d) => d.data());
    setM({
      users: users.filter((u) => u.role === 'client').length,
      astros: astros.length,
      onlineAstros: aList.filter((a) => a.status === 'online').length,
      pendingApproval: aList.filter((a) => !a.approved).length,
      pendingPhotos: aList.filter((a) => a.pendingProfileImage).length,
      revToday, revAll, resetAt,
    });
  }

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, []);

  async function resetRevenue() {
    if (!window.confirm(
      'Reset the revenue counter to start fresh from NOW?\n\n'
      + 'Total Revenue will only count earnings after this moment. '
      + 'Past transactions are kept but excluded from the total.')) return;
    setBusy(true);
    try {
      await adminService.updateSettings('config',
        { revenueResetAt: Date.now() });
      await loadData();
    } finally { setBusy(false); }
  }

  if (loading || !m) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const cards = [
    ['Total Users', m.users],
    ['Total Astrologers', m.astros],
    ['Active Astrologers', m.onlineAstros],
    ['Revenue Today', `₹${m.revToday.toFixed(2)}`],
    ['Total Revenue', `₹${m.revAll.toFixed(2)}`],
  ];

  return (
    <Layout>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row
        sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin-test"
            className="flex-1 rounded-full border border-gray-300 px-4
                       py-2 text-center text-sm font-semibold sm:flex-none">
            Test View
          </Link>
          <button onClick={resetRevenue} disabled={busy}
            className="flex-1 rounded-full bg-warning px-4 py-2 text-sm
                       font-semibold text-white sm:flex-none">
            {busy ? 'Resetting…' : 'Reset revenue'}
          </button>
        </div>
      </div>
      {m.resetAt > 0 && (
        <div className="mb-3 text-xs text-sub-text">
          Revenue counted since {new Date(m.resetAt).toLocaleString()} ·
          test account ({TEST_EMAIL}) excluded
        </div>
      )}

      {(m.pendingApproval > 0 || m.pendingPhotos > 0) && (
        <Link href="/admin-astrologers"
          className="surface mb-4 flex items-center justify-between p-4
                     ring-1 ring-warning/40 hover:shadow-md">
          <div>
            <div className="font-semibold text-warning">Action needed</div>
            <div className="text-sm text-sub-text">
              {m.pendingApproval} astrologer(s) awaiting approval ·{' '}
              {m.pendingPhotos} photo(s) pending review
            </div>
          </div>
          <span className="badge bg-warning text-white">
            {m.pendingApproval + m.pendingPhotos}
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([l, v]) => (
          <div key={l} className="surface p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-sub-text">
              {l}
            </div>
            <div className="mt-1 text-2xl font-bold text-primary">{v}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
