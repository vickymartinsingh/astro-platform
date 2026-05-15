import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminAudit() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (loading) return;
    adminService.getAuditLogs().then(setRows).catch(() => setRows([]));
  }, [loading]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Audit Log</h1>
      {rows.length === 0 ? (
        <div className="card text-sub-text">No audit entries yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">Admin</th><th className="p-2">Action</th>
                <th className="p-2">Target</th><th className="p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2">{String(l.adminId || '').slice(0, 8)}</td>
                  <td className="p-2">{l.action}</td>
                  <td className="p-2">{String(l.target || '').slice(0, 12)}</td>
                  <td className="p-2">
                    {l.timestamp?.toDate
                      ? l.timestamp.toDate().toLocaleString() : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
