import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// Password-reset redirector.
//
// The relay does NOT put the raw Firebase URL
// (https://astrology-2092d.firebaseapp.com/__/auth/action?mode=...)
// inside the reset email. Instead it base64-encodes that URL and
// builds https://astroseer.in/reset?t=<base64>. The customer's email
// client only ever shows the friendly astroseer.in link.
//
// On click this page:
//   1. Decodes the t param.
//   2. Validates that it is a Firebase auth-action URL for THIS
//      project (any other host = silently abort, so this redirector
//      cannot be repurposed as an open-redirect).
//   3. Redirects via window.location.replace() so back-button does
//      not bounce the customer back to /reset.
//
// While the redirect is in flight the page renders a tiny Royal-
// palette "Continuing to your reset page..." card so it does not
// flash an empty screen on slow networks.
const ALLOWED_HOSTS = [
  'astrology-2092d.firebaseapp.com',
  'astrology-2092d.web.app',
];

export default function ResetRedirector() {
  const router = useRouter();
  const [err, setErr] = useState('');
  const [target, setTarget] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const t = String(router.query.t || '');
    if (!t) {
      setErr('Missing reset token. Open the link from the email.');
      return;
    }
    let decoded = '';
    try {
      // atob is fine in browser; defensively handle Buffer when SSR.
      decoded = typeof atob === 'function'
        ? atob(t) : Buffer.from(t, 'base64').toString('utf8');
    } catch (_) {
      setErr('This reset link is malformed.'); return;
    }
    let host = '';
    try { host = new URL(decoded).host; } catch (_) { /* ignore */ }
    if (!ALLOWED_HOSTS.includes(host)) {
      // Defence against open-redirect abuse. The token MUST decode to
      // a Firebase auth URL for our project.
      setErr('This reset link points somewhere we do not trust.');
      return;
    }
    setTarget(decoded);
    // Tiny delay so the customer sees the friendly card briefly even
    // on fast connections - avoids a confusing instant URL change.
    const timer = setTimeout(() => {
      try { window.location.replace(decoded); } catch (_) {}
    }, 600);
    return () => clearTimeout(timer);
  }, [router.isReady, router.query.t]);

  return (
    <>
      <Head>
        <title>Reset your password - AstroSeer</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="viewport"
          content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F5F1EA', padding: 20,
        fontFamily: 'Inter, system-ui, Arial, sans-serif',
      }}>
        <div style={{
          maxWidth: 420, width: '100%',
          background: '#fff', borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,.06)',
        }}>
          <div style={{
            background: 'linear-gradient(135deg,#7F2020,#D4A12A)',
            color: '#fff', padding: '20px 24px',
          }}>
            <div style={{
              fontSize: 12, letterSpacing: 2,
              textTransform: 'uppercase', opacity: 0.85,
            }}>AstroSeer</div>
            <div style={{ fontSize: 20, fontWeight: 800,
              marginTop: 4 }}>
              {err ? 'Reset link problem'
                : 'Opening your reset page…'}
            </div>
          </div>
          <div style={{ padding: 22 }}>
            {err ? (
              <p style={{ fontSize: 14, color: '#7F2020' }}>{err}</p>
            ) : (
              <p style={{ fontSize: 14, color: '#374151',
                lineHeight: 1.55 }}>
                One moment - we are taking you to your secure
                password reset page. If nothing happens,{' '}
                <a href={target}
                  style={{ color: '#7F2020', fontWeight: 700 }}>
                  click here to continue
                </a>.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
