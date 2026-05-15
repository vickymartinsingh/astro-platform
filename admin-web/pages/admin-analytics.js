import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminAnalytics() {
  const { loading } = useRequireAdmin();
  const [d, setD] = useState(null);

  useEffect(() => {
    (async () => {
      const [users, txns, sessSnap] = await Promise.all([
        adminService.getAllUsers(),
        adminService.getAllTransactions({ type: 'debit' }),
        getDocs(query(collection(db, 'sessions'), limit(1000))),
      ]);
      const clients = users.filter((u) => u.role === 'client');
      const payers = new Set(txns.map((t) => t.userId));
      const sessions = sessSnap.docs.map((s) => s.data());
      const byType = { chat: 0, call: 0, video: 0 };
      sessions.forEach((s) => { if (byType[s.type] != null) byType[s.type]++; });
      // Revenue per day, last 7 days.
      const days = [...Array(7)].map((_, i) => {
        const dt = new Date(Date.now() - (6 - i) * 864e5);
        return dt.toISOString().slice(0, 10);
      });
      const rev = Object.fromEntries(days.map((k) => [k, 0]));
      txns.forEach((t) => {
        const k = t.createdAt?.toDate
          ? t.createdAt.toDate().toISOString().slice(0, 10) : null;
        if (k && rev[k] != null) rev[k] += Math.abs(t.amount);
      });
      setD({
        users: clients.length,
        payers: payers.size,
        conv: clients.length
          ? Math.round((payers.size / clients.length) * 100) : 0,
        revenue: txns.reduce((a, t) => a + Math.abs(t.amount), 0),
        byType, rev, days,
      });
    })();
  }, []);

  if (loading || !d) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }
  const maxRev = Math.max(1, ...Object.values(d.rev));

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Analytics</h1>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Users', d.users], ['Paying users', d.payers],
          ['Conversion', `${d.conv}%`], ['Revenue', `₹${d.revenue}`]]
          .map(([l, v]) => (
          <div key={l} className="card text-center">
            <div className="text-xs text-sub-text">{l}</div>
            <div className="mt-1 text-xl font-bold text-primary">{v}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <h2 className="mb-2 font-semibold">Revenue, last 7 days</h2>
        <div className="flex h-32 items-end gap-2">
          {d.days.map((k) => (
            <div key={k} className="flex flex-1 flex-col items-center">
              <div className="w-full rounded-t bg-primary"
                style={{ height: `${(d.rev[k] / maxRev) * 100}%` }} />
              <span className="mt-1 text-[10px] text-sub-text">
                {k.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Session type split</h2>
        {Object.entries(d.byType).map(([k, v]) => (
          <div key={k} className="mb-1 flex items-center gap-2">
            <span className="w-14 text-sm capitalize">{k}</span>
            <div className="h-3 flex-1 rounded bg-bg-light">
              <div className="h-3 rounded bg-primary" style={{
                width: `${(v / Math.max(1,
                  d.byType.chat + d.byType.call + d.byType.video)) * 100}%`,
              }} />
            </div>
            <span className="w-8 text-right text-sm">{v}</span>
          </div>
        ))}
      </div>
    </Layout>
  );
}
