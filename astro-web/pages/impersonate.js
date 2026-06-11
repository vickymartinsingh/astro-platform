import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@astro/shared';

// Admin impersonation landing page. The admin panel opens this URL in a
// new tab with ?token=<Firebase custom token>. We exchange it for a real
// auth session then redirect to the astrologer dashboard. A yellow banner
// persists for the life of the tab so the admin is always aware they are
// viewing another account.

const MAROON = '#7F2020';
const AMBER = '#D4A12A';
const CREAM = '#FFF8E7';

export default function Impersonate() {
  const router = useRouter();
  const [status, setStatus] = useState('loading'); // loading | error | done
  const [errMsg, setErrMsg] = useState('');
  const [userName, setUserName] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const token = router.query.token;
    if (!token) {
      setStatus('error');
      setErrMsg('No impersonation token in URL.');
      return;
    }
    signInWithCustomToken(auth, token)
      .then((cred) => {
        const name = cred.user?.displayName || cred.user?.email || cred.user?.uid;
        setUserName(name);
        // Store a flag so the banner re-appears on reload for this tab.
        try {
          sessionStorage.setItem('__adminImpersonate', name || '1');
        } catch (_) {}
        setStatus('done');
        setTimeout(() => router.replace('/astro-dashboard'), 1200);
      })
      .catch((e) => {
        setStatus('error');
        setErrMsg(String((e && e.message) || e));
      });
  }, [router.isReady, router.query.token]);

  return (
    <div style={{ minHeight: '100vh', background: CREAM, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, Inter, Arial, sans-serif', padding: 24 }}>

      {/* Admin banner */}
      {status === 'done' && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: AMBER, color: MAROON,
          padding: '10px 16px', textAlign: 'center',
          fontWeight: 700, fontSize: 13,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}>
          ADMIN VIEW: Viewing as {userName || 'astrologer'}. This is not your account.
        </div>
      )}

      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        {status === 'loading' && (
          <>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', margin: '0 auto 20px',
              border: `4px solid ${AMBER}`,
              borderTopColor: MAROON,
              animation: 'spin 0.9s linear infinite',
            }} />
            <p style={{ color: MAROON, fontWeight: 600, fontSize: 16 }}>
              Logging in as user...
            </p>
            <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>
              Exchanging admin token with Firebase.
            </p>
          </>
        )}

        {status === 'done' && (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#10003;</div>
            <p style={{ color: '#15803d', fontWeight: 700, fontSize: 16 }}>
              Signed in. Redirecting...
            </p>
            <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>
              You are now viewing as {userName || 'this astrologer'}.
            </p>
          </>
        )}

        {status === 'error' && (
          <div style={{
            background: '#fce8e8', border: `1.5px solid ${MAROON}`,
            borderRadius: 12, padding: '20px 24px', color: MAROON,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
              Impersonation failed
            </div>
            <div style={{ fontSize: 13 }}>{errMsg}</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
              The token may have expired. Return to the admin panel and
              click View as Astrologer again to generate a fresh link.
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
