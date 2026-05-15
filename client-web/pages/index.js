import { useEffect } from 'react';
import { useRouter } from 'next/router';

// The whole site is browsable without an account. Always land on the
// public dashboard; login is only requested when connecting to an
// astrologer, viewing Kundli or adding money.
export default function Index() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard'); }, [router]);
  return (
    <div className="flex h-screen items-center justify-center
                    text-sub-text">Loading…</div>
  );
}
