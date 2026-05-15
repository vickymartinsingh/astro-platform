import { useState } from 'react';
import Link from 'next/link';
import { authService, userService } from '@astro/shared';

// Email + Google sign-in card. Reused by the /login page and the login
// popup. Calls onDone(user) after a successful, allowed sign-in.
export default function LoginCard({ onDone, compact, initialMode }) {
  const [mode, setMode] = useState(
    initialMode === 'signup' ? 'signup' : 'login'); // login | signup
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish(user) {
    const p = await userService.getUser(user.uid);
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
    setErr(''); setBusy(true);
    try {
      let user;
      if (mode === 'signup') {
        if (!name.trim()) { setErr('Enter your name.'); return; }
        if (password.length < 6) {
          setErr('Password must be at least 6 characters.'); return;
        }
        user = await authService.signupUser(name.trim(), email.trim(),
          password);
      } else {
        user = await authService.loginUser(email.trim(), password);
      }
      await finish(user);
    } catch (e2) {
      setErr(mode === 'signup'
        ? (e2?.code === 'auth/email-already-in-use'
          ? 'That email is already registered.'
          : 'Could not create account.')
        : 'Invalid email or password.');
    } finally { setBusy(false); }
  }

  async function google() {
    setErr(''); setBusy(true);
    try { await finish(await authService.loginWithGoogle()); }
    catch (e) {
      const c = e?.code || '';
      if (c === 'auth/operation-not-allowed') {
        setErr('Enable Google in Firebase: Authentication > ' +
          'Sign-in method > Google.');
      } else if (c === 'auth/unauthorized-domain') {
        setErr('Add this domain in Firebase Auth > Settings > ' +
          'Authorised domains.');
      } else if (c === 'auth/popup-blocked') {
        setErr('Browser blocked the popup. Allow popups and retry.');
      } else if (c === 'auth/popup-closed-by-user' ||
                 c === 'auth/cancelled-popup-request') {
        setErr('Google popup was closed. Try again.');
      } else {
        setErr(`Google sign-in failed (${c || 'unknown error'}).`);
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
          <div className="text-xl font-bold">AstroConnect</div>
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
              <input className="input" placeholder="Full name" value={name}
                onChange={(e) => setName(e.target.value)} required />
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

          <div className="my-4 flex items-center gap-3 text-sm
                          text-sub-text">
            <span className="h-px flex-1 bg-gray-200" /> OR
            <span className="h-px flex-1 bg-gray-200" />
          </div>
          <button onClick={google} disabled={busy}
            className="flex w-full items-center justify-center gap-2
                       rounded-full border border-gray-200 py-3
                       font-semibold hover:bg-bg-light">
            <span className="text-lg font-bold text-[#4285F4]">G</span>
            {mode === 'signup' ? 'Sign up with Google'
              : 'Sign in with Google'}
          </button>

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
            <Link href="/page/terms" className="text-primary">Terms</Link>
            {' '}and{' '}
            <Link href="/page/privacy" className="text-primary">
              Privacy
            </Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
