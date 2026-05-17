import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Test View: everything for the test account (vickymartinsing@gmail.com)
// kept SEPARATE from real revenue so launch-day testing is isolated.
const TEST_EMAIL = 'vickymartinsing@gmail.com';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function AdminTest() {
  const { loading } = useRequireAdmin();
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const [users, txns] = await Promise.all([
        adminService.getAllUsers(),
        adminService.getAllTransactions({ type: 'debit' }),
      ]);
      const testUsers = users.filter(
        (u) => u.email === TEST_EMAIL || u.isTest);
      const testUids = new Set(testUsers.map((u) => u.uid));
      const list = txns
        .filter((t) => testUids.has(t.userId))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0)
          - (a.createdAt?.toMillis?.() || 0));
      setD({
        wallet: r2(testUsers.reduce((a, u) => a + Number(u.wallet || 0), 0)),
        total: r2(list.reduce((a, t) => a + Math.abs(t.amount), 0)),
        count: list.length,
        accounts: testUsers,
        txns: list,
      });
    })();
  }, []);

  if (loading || !d) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">Test View</h1>
      <p className="mb-4 text-sm text-sub-text">
        Isolated data for the test account <b>{TEST_EMAIL}</b>. These
        amounts are <b>excluded</b> from the real Dashboard revenue.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          ['Test wallet balance', `₹${d.wallet.toFixed(2)}`],
          ['Test spend (revenue)', `₹${d.total.toFixed(2)}`],
          ['Test transactions', d.count],
        ].map(([l, v]) => (
          <div key={l} className="surface p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-sub-text">
              {l}
            </div>
            <div className="mt-1 text-2xl font-bold text-primary">{v}</div>
          </div>
        ))}
      </div>

      <div className="surface overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">When</th><th className="p-2">Reason</th>
              <th className="p-2">Amount</th><th className="p-2">Ref</th>
            </tr>
          </thead>
          <tbody>
            {d.txns.length === 0 ? (
              <tr><td className="p-3 text-sub-text" colSpan={4}>
                No test transactions yet.</td></tr>
            ) : d.txns.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2">
                  {t.createdAt?.toDate
                    ? t.createdAt.toDate().toLocaleString() : '-'}
                </td>
                <td className="p-2">{t.reason || '-'}</td>
                <td className="p-2 font-semibold">
                  ₹{Math.abs(Number(t.amount || 0))}
                </td>
                <td className="p-2 text-xs text-sub-text">
                  {t.referenceId || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
