import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminDisputes() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);

  async function load() { setRows(await adminService.getAllDisputes()); }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function resolve(d) {
    const resolution = prompt('Resolution note:') || '';
    const refund = Number(prompt('Refund amount ₹ (0 for none):') || 0);
    await adminService.resolveDispute(d.id, resolution, refund);
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Dispute Management</h1>
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="card text-sub-text">No disputes.</div>
        )}
        {rows.map((d) => (
          <div key={d.id} className="card">
            <div className="flex justify-between">
              <span className="font-semibold capitalize">{d.status}</span>
              <span className="text-xs text-sub-text">
                Session {String(d.sessionId || '').slice(0, 8)}
              </span>
            </div>
            <p className="mt-1 text-sm">{d.issue}</p>
            {d.resolution && (
              <p className="mt-1 text-sm text-success">
                Resolved: {d.resolution} (refund ₹{d.refundAmount || 0})
              </p>
            )}
            {d.status !== 'resolved' && (
              <button onClick={() => resolve(d)}
                className="btn-primary mt-2">Resolve</button>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
