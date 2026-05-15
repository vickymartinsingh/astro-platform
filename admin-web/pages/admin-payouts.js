import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminPayouts() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);

  async function load() { setRows(await adminService.getAllPayouts()); }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function act(p, approve) {
    const note = approve ? '' : (prompt('Rejection reason:') || '');
    await adminService.processPayout(p.id, approve, note);
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }
  const pending = rows.filter((p) => p.status === 'pending');
  const totalPending = pending.reduce((a, p) => a + Number(p.amount || 0), 0);

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Payout Management</h1>
      <p className="mb-3 text-sub-text">
        Total pending: <b>₹{totalPending}</b>
      </p>
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="card text-sub-text">No payout requests.</div>
        )}
        {rows.map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div>
              <div className="font-semibold">₹{p.amount}</div>
              <div className="text-sm text-sub-text">{p.bankDetails}</div>
              <div className="text-xs capitalize text-sub-text">
                {p.status}{p.adminNote ? ` · ${p.adminNote}` : ''}
              </div>
            </div>
            {p.status === 'pending' && (
              <div className="space-x-3 text-sm">
                <button onClick={() => act(p, true)}
                  className="font-semibold text-success">Approve</button>
                <button onClick={() => act(p, false)}
                  className="text-danger">Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
