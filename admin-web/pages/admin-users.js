import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminUsers() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    setRows(await adminService.getAllUsers(
      { role: 'client', search: search || undefined }));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function block(u) {
    await adminService.blockUser(u.uid, !u.isBlocked);
    load();
  }
  async function adjust(u) {
    const amt = Number(prompt(`Adjust wallet for ${u.name} (₹, +/-):`));
    if (!amt) return;
    await adminService.adjustWallet(u.uid, amt, 'admin_adjust');
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">User Management</h1>
      <div className="card mb-3 flex gap-2">
        <input className="input flex-1" placeholder="Search name / email / code"
          value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button onClick={load} className="btn-primary">Search</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Name</th><th className="p-2">Email</th>
              <th className="p-2">Wallet</th><th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.uid} className="border-t">
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">₹{u.wallet || 0}</td>
                <td className="p-2">
                  {u.isBlocked ? 'Suspended' : 'Active'}
                </td>
                <td className="p-2 space-x-2">
                  <button onClick={() => block(u)}
                    className="text-danger">
                    {u.isBlocked ? 'Unblock' : 'Block'}
                  </button>
                  <button onClick={() => adjust(u)}
                    className="text-primary">Wallet±</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
