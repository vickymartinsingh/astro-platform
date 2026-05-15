import { useEffect, useState } from 'react';
import { notificationService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

const ICON = {
  incoming_call: '📞', new_message: '💬', low_balance: '⚠️',
  payment_success: '✅', offer: '🎉',
};

export default function Notifications() {
  const { user, loading } = useRequireClient();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    return notificationService.listenNotifications(user.uid, setRows);
  }, [user]);

  async function open(n) {
    if (!n.read) await notificationService.markNotificationRead(n.id);
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Notifications</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No notifications yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((n) => (
            <button key={n.id} onClick={() => open(n)}
              className={`card flex w-full items-start gap-3 text-left ${
                n.read ? '' : 'border-l-4 border-primary'}`}>
              <span className="text-xl">{ICON[n.type] || '🔔'}</span>
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
