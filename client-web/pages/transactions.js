import { useEffect, useState } from 'react';
import { walletService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

export default function Transactions() {
  const { user, loading } = useRequireClient();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (user) walletService.getTransactions(user.uid).then(setRows);
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">All Transactions</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No transactions yet." />
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <div key={t.id} className="card flex justify-between">
              <div>
                <div className="font-medium capitalize">{t.reason}</div>
                <div className="text-xs text-sub-text">
                  {t.createdAt?.toDate
                    ? t.createdAt.toDate().toLocaleString() : ''}
                </div>
              </div>
              <div className={`font-bold ${t.amount >= 0
                ? 'text-success' : 'text-danger'}`}>
                {t.amount >= 0 ? '+' : ''}₹{Math.abs(t.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
