import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminSessions() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);

  async function load() {
    const snap = await getDocs(query(collection(db, 'sessions'),
      orderBy('createdAt', 'desc'), limit(100)));
    setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function forceEnd(id) {
    if (!confirm('Force-end this session?')) return;
    await adminService.forceEndSession(id);
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const live = rows.filter((s) => s.status === 'active');

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Session Monitoring</h1>
      <h2 className="mb-2 font-semibold">Live ({live.length})</h2>
      <div className="mb-4 space-y-2">
        {live.length === 0 && (
          <div className="card text-sub-text">No live sessions.</div>
        )}
        {live.map((s) => (
          <div key={s.id} className="card flex justify-between">
            <span className="capitalize">{s.type} · ₹{s.cost || 0} so far</span>
            <button onClick={() => forceEnd(s.id)}
              className="text-danger">Force End</button>
          </div>
        ))}
      </div>
      <h2 className="mb-2 font-semibold">Recent</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Type</th><th className="p-2">Status</th>
              <th className="p-2">Cost</th><th className="p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2 capitalize">{s.type}</td>
                <td className="p-2 capitalize">{s.status}</td>
                <td className="p-2">₹{s.cost || 0}</td>
                <td className="p-2">
                  {s.createdAt?.toDate
                    ? s.createdAt.toDate().toLocaleString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
