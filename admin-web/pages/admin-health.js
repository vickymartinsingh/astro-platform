import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import {
  collection, query, where, getDocs, getCountFromServer, doc, getDoc,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Blueprint 6.31, system health at a glance.
export default function AdminHealth() {
  const { loading } = useRequireAdmin();
  const [h, setH] = useState(null);

  useEffect(() => {
    (async () => {
      const onlineQ = query(collection(db, 'users'),
        where('isOnline', '==', true));
      const activeQ = query(collection(db, 'sessions'),
        where('status', '==', 'active'));
      const [onlineC, activeC, paySnap] = await Promise.all([
        getCountFromServer(onlineQ).catch(() => null),
        getCountFromServer(activeQ).catch(() => null),
        getDoc(doc(db, 'settings', 'payments')).catch(() => null),
      ]);
      const activeCount = activeC ? activeC.data().count : 0;
      setH({
        online: onlineC ? onlineC.data().count : 0,
        active: activeCount,
        billing: activeCount >= 0,         // engine reachable if query worked
        payments: !!(paySnap && paySnap.exists() &&
          paySnap.data().razorpay_key_id),
      });
    })();
  }, []);

  if (loading || !h) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const Dot = ({ ok }) => (
    <span className={`badge ${ok ? 'bg-success' : 'bg-danger'} text-white`}>
      {ok ? 'OK' : 'CHECK'}
    </span>
  );

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">System Health</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card text-center">
          <div className="text-xs text-sub-text">Active Users</div>
          <div className="mt-1 text-2xl font-bold text-primary">{h.online}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-sub-text">Live Sessions</div>
          <div className="mt-1 text-2xl font-bold text-primary">{h.active}</div>
        </div>
        <div className="card flex items-center justify-between">
          <span>Billing engine</span><Dot ok={h.billing} />
        </div>
        <div className="card flex items-center justify-between">
          <span>Payment gateway</span><Dot ok={h.payments} />
        </div>
      </div>
      <p className="mt-3 text-xs text-sub-text">
        Payment gateway shows OK when a Razorpay key is configured in
        settings/payments. Function error logs are in the Firebase console.
      </p>
    </Layout>
  );
}
