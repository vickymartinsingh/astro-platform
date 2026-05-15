import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminTransactions() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (loading) return;
    adminService.getAllTransactions(filter ? { type: filter } : {})
      .then(setRows);
  }, [loading, filter]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  function exportCsv() {
    const head = 'userId,amount,type,reason,createdAt\n';
    const body = rows.map((t) =>
      `${t.userId},${t.amount},${t.type},${t.reason},${
        t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : ''}`)
      .join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'transactions.csv';
    a.click();
  }

  return (
    <Layout>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Transactions</h1>
        <button onClick={exportCsv} className="btn-ghost">Export CSV</button>
      </div>
      <div className="mb-3 flex gap-2">
        {['', 'credit', 'debit'].map((t) => (
          <button key={t || 'all'} onClick={() => setFilter(t)}
            className={`rounded-card px-4 py-2 text-sm ${
              filter === t ? 'bg-primary text-white' : 'bg-white'}`}>
            {t || 'All'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">User</th><th className="p-2">Type</th>
              <th className="p-2">Amount</th><th className="p-2">Reason</th>
              <th className="p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2">{t.userId?.slice(0, 8)}</td>
                <td className="p-2 capitalize">{t.type}</td>
                <td className={`p-2 ${t.amount >= 0
                  ? 'text-success' : 'text-danger'}`}>
                  {t.amount >= 0 ? '+' : ''}₹{Math.abs(t.amount)}
                </td>
                <td className="p-2 capitalize">{t.reason}</td>
                <td className="p-2">
                  {t.createdAt?.toDate
                    ? t.createdAt.toDate().toLocaleString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
