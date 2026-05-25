import { useState } from 'react';
import Link from 'next/link';
import { authService, userService } from '@astro/shared';
import { DateField } from './BirthInputs';
import { useSettings } from '../lib/useSettings';

// Email + Google sign-in card. Reused by the /login page and the login
// popup. Calls onDone(user) after a successful, allowed sign-in.
export default function LoginCard({ onDone, compact, initialMode }) {
  const { features } = useSettings();
  const [mode, setMode] = useState(
    initialMode === 'signup' ? 'signup' : 'login'); // login | signup
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Hard timeout for any auth promise. Firebase Auth occasionally hangs
  // (flaky network, IndexedDB lock, popup race) and never resolves OR
  // rejects, which used to leave the button stuck on "Please wait..."
  // forever. We race the auth call against a timeout so the UI ALWAYS
  // unsticks within `ms` and the user can retry.
  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(`${label} timed out after ${ms / 1000}s`);
          e.code = 'auth/timeout';
          reject(e);
        }, ms);
      }),
    ]);
  }

  async function finish(user) {
    const p = await withTimeout(userService.getUser(user.uid), 15000,
      'Profile lookup');
    if (p && p.isBlocked) {
      await authService.logoutUser();
      setErr('Your account has been suspended. Contact support.');
      return;
    }
    if (p && (p.role === 'astrologer' || p.role === 'admin')) {
      await authService.logoutUser();
      setErr(`Please use the ${p.role} portal to sign in.`);
      return;
    }
    onDone && onDone(user);
  }

  async function submit(e) {
    e.preventDefault();
    // Re-entrancy guard: ignore submits while one is in flight so a
    // double-click doesn't stack runaway auth promises.
    if (busy) return;
    // Validate BEFORE flipping busy, so a bad field never traps the
    // button in the "Please wait..." state.
    if (mode === 'signup') {
      if (!name.trim()) { setErr('Enter your name.'); return; }
      if (phone.replace(/\D/g, '').length < 10) {
        setErr('Enter a valid 10-digit mobile number.'); return;
      }
      if (!/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
        setErr('Please select your date of birth.'); return;
      }
      if (password.length < 6) {
        setErr('Password must be at least 6 characters.'); return;
      }
    }
    setErr(''); setBusy(true);
    try {
      let user;
      if (mode === 'signup') {
        user = await withTimeout(
          authService.signupUser(name.trim(), email.trim(),
            password, { phone: phone.trim(), dob }),
          25000, 'Signup');
      } else {
        user = await withTimeout(
          authService.loginUser(email.trim(), password),
          25000, 'Login');
      }
      await finish(user);
    } catch (e2) {
      const code = e2?.code || '';
      if (code === 'auth/timeout') {
        setErr('Network is slow or unavailable. Please check your '
          + 'connection and try again.');
      } else if (mode === 'signup') {
        setErr(code === 'auth/email-already-in-use'
          ? 'That email is already registered.'
          : 'Could not create account.');
      } else {
        setErr('Invalid email or password.');
      }
    } finally {
      // Belt and braces: always release the button, no matter what.
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const u = await withTimeout(authService.loginWithGoogle(),
        45000, 'Google sign-in');
      // null = a full-page redirect started; the browser navigates
      // away and watchAuth finishes the sign-in on return.
      if (u) await finish(u);
    } catch (e) {
      const c = e?.code || '';
      const msg = String(e?.message || '');
      const native = typeof window !== 'undefined'
        && window.Capacitor
        && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform();
      // Android Google sign-in config not finished (SHA-1 / OAuth
      // client not registered in Firebase): SDK throws code 10 /
      // DEVELOPER_ERROR / ApiException with no auth/* code.
      const isCfg = /DEVELOPER_ERROR|ApiException|: *10\b|status: *10|"?10"?:/i
        .test(`${c} ${msg}`);
      if (c === 'auth/timeout') {
        setErr('Google sign-in took too long. Please try again.');
      } else if (c === 'auth/operation-not-allowed') {
        setErr('Google sign-in is disabled. Enable it in Firebase: '
          + 'Authentication > Sign-in method > Google.');
      } else if (c === 'auth/unauthorized-domain') {
        setErr('This domain is not authorised. Add it in Firebase '
          + 'Auth > Settings > Authorised domains.');
      } else if (c === 'auth/popup-blocked') {
        setErr('Browser blocked the popup. Allow popups and retry.');
      } else if (c === 'auth/popup-closed-by-user'
                 || c === 'auth/cancelled-popup-request'
                 || /cancel/i.test(msg)) {
        setErr('Google sign-in was cancelled. Try again.');
      } else if (native && (isCfg || !c)) {
        setErr('Google sign-in for the app is still being set up on '
          + 'the server (the app fingerprint must be added in '
          + 'Firebase). Please sign in with email and password for '
          + 'now - it works normally.');
      } else if (/unavailable/i.test(msg)) {
        setErr('Google sign-in is not available in this app build. '
          + 'Please use email and password here.');
      } else {
        setErr(`Google sign-in failed (${c || msg || 'unknown'}). `
          + 'Try email/password.');
      }
    } finally { setBusy(false); }
  }

  async function forgot() {
    if (!email.trim()) { setErr('Enter your email first.'); return; }
    try {
      await authService.sendPasswordReset(email.trim());
      setErr('Password reset email sent. Check your inbox.');
    } catch { setErr('Could not send reset email.'); }
  }

  return (
    <div className={compact ? '' : 'w-full max-w-md'}>
      <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="hero-grad p-6 text-white">
          <div className="text-xl font-bold">AstroSeer</div>
          <div className="mt-1 text-2xl font-bold">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </div>
          <p className="mt-1 text-sm opacity-90">
            {mode === 'signup'
              ? 'Sign up to connect with astrologers.'
              : 'Sign in to continue.'}
          </p>
        </div>
        <div className="p-6">
          {err && (
            <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm
                            text-rose-600">{err}</div>
          )}
          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <>
                <input className="input" placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)} required />
                <input className="input" type="tel"
                  placeholder="Mobile number" value={phone}
                  onChange={(e) => setPhone(e.target.value)} required />
                <DateField value={dob} onChange={setDob}
                  label="Date of birth" />
              </>
            )}
            <input className="input" type="email" placeholder="Email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required />
            <input className="input" type="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required />
            <button className="btn-grad w-full justify-center py-3"
              disabled={busy}>
              {busy ? 'Please wait…'
                : mode === 'signup' ? 'Sign up' : 'Login'}
            </button>
            {mode === 'login' && (
              <button type="button" onClick={forgot}
                className="w-full text-sm text-primary">
                Forgot password?
              </button>
            )}
          </form>

          {(() => {
            // Admin-toggled per platform (admin -> Feature Toggles):
            //   google_signin_mobile, google_signin_desktop
            // Default: OFF (hidden) until admin explicitly enables. The
            // admin Feature Toggles page has both checkboxes so the
            // operator can re-enable Google sign-in for either platform
            // at any time without a rebuild.
            const isNative = typeof window !== 'undefined'
              && window.Capacitor && window.Capacitor.isNativePlatform
              && window.Capacitor.isNativePlatform();
            const key = isNative ? 'google_signin_mobile'
              : 'google_signin_desktop';
            const showGoogle = !!(features && features[key] === true);
            if (!showGoogle) return null;
            return (
              <>
                <div className="my-4 flex items-center gap-3 text-sm
                                text-sub-text">
                  <span className="h-px flex-1 bg-gray-200" /> OR
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                <button onClick={google} disabled={busy}
                  className="flex w-full items-center justify-center gap-2
                             rounded-full border border-gray-200 py-3
                             font-semibold hover:bg-bg-light">
                  <span className="text-lg font-bold text-[#4285F4]">
                    G
                  </span>
                  {mode === 'signup' ? 'Sign up with Google'
                    : 'Sign in with Google'}
                </button>
              </>
            );
          })()}

          <button
            onClick={() => { setErr(''); setMode(
              mode === 'signup' ? 'login' : 'signup'); }}
            className="mt-3 w-full text-center text-sm text-primary">
            {mode === 'signup'
              ? 'Already have an account? Login'
              : 'New here? Create an account'}
          </button>
          <p className="mt-3 text-center text-xs text-sub-text">
            By continuing you agree to our{' '}
            <Link href="/terms" className="text-primary">Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-primary">
              Privacy
            </Link>.
          </p>
          {/* Note: "Register as astrologer" is intentionally NOT shown
              here. It lives only as the last item in the side menu and
              only when the admin enables it (features.register_as_astro
              _show). */}
        </div>
      </div>
    </div>
  );
}
