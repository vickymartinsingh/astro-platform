import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { collection, getDocs } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminAstrologers() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('pending');

  async function load() {
    const snap = await getDocs(collection(db, 'astrologers'));
    setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function approve(a, val) {
    await adminService.approveAstrologer(a.id, val);
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const shown = tab === 'pending'
    ? rows.filter((a) => !a.approved)
    : rows;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Astrologer Management</h1>
      <div className="mb-3 flex gap-2">
        {['pending', 'all'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-card px-4 py-2 text-sm font-semibold ${
              tab === t ? 'bg-primary text-white' : 'bg-white'}`}>
            {t === 'pending' ? 'Pending Approval' : 'All'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="card text-sub-text">Nothing here.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <div key={a.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold">{a.name}</div>
                  <div className="text-sm text-sub-text">
                    {(a.skills || []).join(', ')} · {a.experience || 0} yrs ·
                    ⭐ {a.rating || 0}
                  </div>
                  <div className="text-sm text-sub-text">{a.bio}</div>
                </div>
                <div className="space-x-2 text-sm">
                  {a.approved ? (
                    <button onClick={() => approve(a, false)}
                      className="text-danger">Revoke</button>
                  ) : (
                    <>
                      <button onClick={() => approve(a, true)}
                        className="text-success font-semibold">Approve</button>
                      <button onClick={() => approve(a, false)}
                        className="text-danger">Reject</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
