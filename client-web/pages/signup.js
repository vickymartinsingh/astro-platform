import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Clients sign up via the in-page popup, not a standalone screen.
// Preserve any ?ref= referral code for later, then go home.
export default function Signup() {
  const router = useRouter();
  useEffect(() => {
    const ref = router.query.ref;
    if (ref && typeof window !== 'undefined') {
      try { localStorage.setItem('referralCode', String(ref)); } catch (e) {}
    }
    router.replace('/dashboard');
  }, [router]);
  return (
    <div className="flex h-screen items-center justify-center
                    text-sub-text">Loading…</div>
  );
}
