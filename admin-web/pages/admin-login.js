import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  authService, userService, isAdminUser, brandingService,
} from '@astro/shared';

// Branded admin login page. Pulls the live logo from settings/branding so
// it always matches what is configured in the admin App Builder. Bigger
// "Operations Console" title to distinguish from the consumer apps.
export default function AdminLogin() {
  const router = useRouter();
  const denied = router.query.denied === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Visible step indicator so the user (and us) can see exactly
  // which network leg hung on a flaky iOS WKWebView. Goes from
  // 'auth' -> 'profile' -> 'redirect'.
  const [step, setStep] = useState('');
  const [brand, setBrand] = useState({ logo: '', name: 'AstroSeer' });

  useEffect(() => brandingService.watchBranding((b) =>
    setBrand({ logo: b.logo || '', name: b.name || 'AstroSeer' })), []);

  // Tight per-step timeouts. With each step visible to the user
  // (changes 'busy' text), even if the spinner never clears the
  // user can tell US which step was stuck. We log each transition
  // so the iOS Safari Web Inspector / a connected console shows
  // exactly where the flow halts.
  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    setStep('auth');
    const log = (s) => {
      // eslint-disable-next-line no-console
      try { console.log('[admin-login]', s); } catch (_) {}
    };
    try {
      log('auth start');
      const u = await Promise.race([
        authService.loginUser(email.trim(), password),
        new Promise((_, reject) => setTimeout(() =>
          reject(new Error('auth timeout')), 12000)),
      ]);
      log('auth ok ' + u.uid);
      setStep('profile');
      const p = await Promise.race([
        userService.getUser(u.uid),
        new Promise((_, reject) => setTimeout(() =>
          reject(new Error('profile timeout')), 8000)),
      ]);
      log('profile ok role=' + (p && p.role));
      if (!isAdminUser(p, u.email)) {
        await authService.logoutUser();
        setErr('Access denied, admin only.');
        return;
      }
      setStep('redirect');
      log('redirecting');
      router.replace('/admin-dashboard');
    } catch (e2) {
      const msg = String((e2 && e2.message) || '');
      log('FAIL ' + msg);
      if (/auth timeout/.test(msg)) {
        setErr('Authentication took too long. Check your '
          + 'internet and try again.');
      } else if (/profile timeout/.test(msg)) {
        setErr('Connected, but profile read stalled. Tap Sign in '
          + 'again to retry.');
      } else if (/invalid|wrong-password|user-not-found|password/i
        .test(msg)) {
        setErr('Invalid credentials.');
      } else if (/network/i.test(msg)) {
        setErr('Network error. Check your internet.');
      } else {
        setErr(msg || 'Sign-in failed. Try again.');
      }
    } finally { setBusy(false); setStep(''); }
  }

  // Royal palette ONLY (maroon + amber). The previous gradient used
  // purple (#1f1147 / #2d1b66 / #1a0e3a) which violates the no-purple
  // blueprint rule. Now: deep tarot-brown background with maroon +
  // amber glow accents to match the rest of the suite.
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br
      from-[#1A0F0F] via-[#2A1410] to-[#0F0708] px-4 py-12 text-white">
      {/* Soft glow accents - maroon top-left, amber bottom-right */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72
        w-72 rounded-full bg-[#7F2020]/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24
        h-80 w-80 rounded-full bg-[#D4A12A]/25 blur-3xl" />

      <div className="relative mx-auto max-w-sm">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center">
          {brand.logo ? (
            <img src={brand.logo} alt={brand.name}
              className="h-16 w-16 rounded-2xl bg-white object-contain
                p-2 shadow-lg" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center
              rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600
              text-3xl font-bold text-white shadow-lg">
              ⚙
            </div>
          )}
          <div className="mt-3 text-2xl font-bold tracking-tight">
            {brand.name}
          </div>
          <div className="text-[11px] font-semibold uppercase
            tracking-[0.25em] text-amber-300/90">
            Operations Console
          </div>
          <p className="mt-2 max-w-[260px] text-xs text-white/60">
            Restricted access. All actions are logged for compliance.
          </p>
        </div>

        {/* Card */}
        <div className="mt-6 rounded-3xl bg-white p-5 text-dark-text
          shadow-2xl ring-1 ring-white/10">
          {(err || denied) && (
            <div className="mb-3 rounded-card bg-danger/10 px-3 py-2
              text-sm text-danger">
              {err || 'Access denied.'}
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="block text-[11px] font-bold uppercase
                tracking-wider text-sub-text">Admin email</span>
              <input className="input mt-1" type="email"
                placeholder="you@astroseer.in" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold uppercase
                tracking-wider text-sub-text">Password</span>
              <input className="input mt-1" type="password"
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="btn-primary w-full" disabled={busy}>
              {busy
                ? (step === 'auth' ? 'Signing in… (1/3 auth)'
                  : step === 'profile' ? 'Verifying access… (2/3)'
                  : step === 'redirect' ? 'Opening dashboard… (3/3)'
                  : 'Signing in…')
                : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[10px] text-white/40">
          © {new Date().getFullYear()} {brand.name}. Internal use only.
        </p>
      </div>
    </div>
  );
}
