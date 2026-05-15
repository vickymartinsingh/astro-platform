import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/useAuth';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/admin-dashboard' : '/admin-login');
  }, [user, loading, router]);
  return <div className="flex h-screen items-center justify-center
    text-sub-text">Loading…</div>;
}
