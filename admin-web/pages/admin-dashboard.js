import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, adminService } from '@astro/shared';
import { collection, getDocs } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminDashboard() {
  const { loading } = useRequireAdmin();
  const [m, setM] = useState(null);

  useEffect(() => {
    (async () => {
      const [users, astros, txns, astroSnap] = await Promise.all([
        adminService.getAllUsers(),
        adminService.getAllUsers({ role: 'astrologer' }),
        adminService.getAllTransactions({ type: 'debit' }),
        getDocs(collection(db, 'astrologers')),
      ]);
      const today = Date.now() - 864e5;
      const revToday = txns.filter((t) =>
        t.createdAt?.toDate && t.createdAt.toDate().getTime() >= today)
        .reduce((a, t) => a + Math.abs(t.amount), 0);
      const revAll = txns.reduce((a, t) => a + Math.abs(t.amount), 0);
      const aList = astroSnap.docs.map((d) => d.data());
      setM({
        users: users.filter((u) => u.role === 'client').length,
        astros: astros.length,
        onlineAstros: aList.filter((a) => a.status === 'online').length,
        pendingApproval: aList.filter((a) => !a.approved).length,
        pendingPhotos: aList.filter((a) => a.pendingProfileImage).length,
        revToday, revAll,
      });
    })();
  }, []);

  if (loading || !m) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
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
      <h1 className="mb-3 text-2xl font-bold">Dashboard</h1>

      {(m.pendingApproval > 0 || m.pendingPhotos > 0) && (
        <Link href="/admin-astrologers"
          className="surface mb-4 flex items-center justify-between p-4
                     ring-1 ring-warning/40 hover:shadow-md">
          <div>
            <div className="font-semibold text-warning">
              Action needed
            </div>
            <div className="text-sm text-sub-text">
              {m.pendingApproval} astrologer(s) awaiting approval ·{' '}
              {m.pendingPhotos} photo(s) pending review
            </div>
          </div>
          <span className="badge bg-warning text-white">
            {m.pendingApproval + m.pendingPhotos}
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([l, v]) => (
          <div key={l} className="surface p-4 text-center">
            <div className="text-xs uppercase tracking-wide text-sub-text">
              {l}
            </div>
            <div className="mt-1 text-2xl font-bold text-primary">{v}</div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
