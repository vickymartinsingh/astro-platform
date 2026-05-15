import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Clients sign in via the in-page popup, not a standalone screen.
// Any hit on /login just goes home (the popup is available there).
export default function Login() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard'); }, [router]);
  return (
    <div className="flex h-screen items-center justify-center
                    text-sub-text">Loading…</div>
  );
}
