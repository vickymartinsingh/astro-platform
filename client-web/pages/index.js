import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

// The whole site is browsable without an account. Always land on the
// public dashboard; login is only requested when connecting to an
// astrologer, viewing Kundli or adding money.
//
// We also render a small, crawlable footer with the privacy/terms
// links right in the home page HTML - Google's OAuth domain
// verification crawler requires the home page (astroseer.in) to link
// to the privacy policy, and it doesn't execute the JS redirect.
export default function Index() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace('/dashboard'), 600);
    return () => clearTimeout(t);
  }, [router]);
  return (
    <div className="flex h-screen flex-col items-center justify-center
                    gap-6 text-sub-text">
      <div>Loading AstroSeer…</div>
      <footer className="text-center text-xs">
        <div className="font-semibold text-dark-text">AstroSeer</div>
        <nav className="mt-2 flex flex-wrap justify-center gap-3">
          <a href="/dashboard">Home</a>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <a href="/account-deletion">Delete account</a>
          <a href="mailto:support@astroseer.in">Contact</a>
        </nav>
      </footer>
    </div>
  );
}
