import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Courtesy redirect for anyone typing "/admin" directly. The canonical
// dashboard route is /admin-dashboard; without this file Next returns
// the 500 _error page (observed in the 2026-06-07 QA pass).
export default function AdminAlias() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin-dashboard'); }, [router]);
  return (
    <div className="flex h-screen items-center justify-center
      text-sub-text">
      Loading…
    </div>
  );
}
