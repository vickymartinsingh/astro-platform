import { useEffect, useState } from 'react';
import { notificationService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

// Admin announcements + system notices addressed to this astrologer
// (userId in [uid, 'all']). Same data the client portal shows.
export default function AstroNotifications() {
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    return notificationService.listenNotifications(user.uid, (list) =>
      setRows([...list].sort((a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))));
  }, [user]);

  async function open(n) {
    if (!n.read) await notificationService.markNotificationRead(n.id);
  }

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">Announcements</h1>
      {rows.length === 0 ? (
        <div className="surface p-6 text-center text-sub-text">
          No announcements yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <button key={n.id} onClick={() => open(n)}
              className={`surface flex w-full items-start gap-3 p-4
                text-left ${n.read ? '' : 'ring-1 ring-primary/40'}`}>
              <span className="text-xl">🔔</span>
              <div className="flex-1">
                <div className={n.read ? 'font-medium' : 'font-bold'}>
                  {n.title}
                </div>
                <div className="text-sm text-sub-text">{n.message}</div>
                <div className="mt-1 text-xs text-sub-text">
                  {n.createdAt?.toDate
                    ? n.createdAt.toDate().toLocaleString() : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Layout>
  );
}
