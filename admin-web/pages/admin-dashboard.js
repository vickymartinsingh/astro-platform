import { useEffect, useState } from 'react';
import { adminService, sessionService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminDashboard() {
  const { loading } = useRequireAdmin();
  const [m, setM] = useState(null);

  useEffect(() => {
    (async () => {
      const [users, astros, txns] = await Promise.all([
        adminService.getAllUsers(),
        adminService.getAllUsers({ role: 'astrologer' }),
        adminService.getAllTransactions({ type: 'debit' }),
      ]);
      const today = Date.now() - 864e5;
      const revToday = txns.filter((t) =>
        t.createdAt?.toDate && t.createdAt.toDate().getTime() >= today)
        .reduce((a, t) => a + Math.abs(t.amount), 0);
      const revAll = txns.reduce((a, t) => a + Math.abs(t.amount), 0);
      setM({
        users: users.filter((u) => u.role === 'client').length,
        astros: astros.length,
        onlineAstros: astros.filter((a) => a.isOnline).length,
        revToday, revAll,
      });
    })();
  }, []);

  if (loading || !m) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const cards = [
    ['Total Users', m.users],
    ['Total Astrologers', m.astros],
    ['Active Astrologers', m.onlineAstros],
    ['Revenue Today', `₹${m.revToday}`],
    ['Total Revenue', `₹${m.revAll}`],
  ];

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([l, v]) => (
          <div key={l} className="card text-center">
            <div className="text-xs text-sub-text">{l}</div>
            <div className="mt-1 text-2xl font-bold text-primary">{v}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
