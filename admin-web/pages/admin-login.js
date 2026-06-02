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
  const [brand, setBrand] = useState({ logo: '', name: 'AstroSeer' });

  useEffect(() => brandingService.watchBranding((b) =>
    setBrand({ logo: b.logo || '', name: b.name || 'AstroSeer' })), []);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await authService.loginUser(email.trim(), password);
      // 10-second guard around the Firestore profile lookup. On iOS
      // WKWebView this read used to hang forever when Firestore had
      // picked the wrong transport - now even if that race still
      // happens for any reason, the spinner clears and the user can
      // retry instead of staring at "Signing in..." forever.
      const p = await Promise.race([
        userService.getUser(u.uid),
        new Promise((_, reject) => setTimeout(() =>
          reject(new Error('profile timeout')), 10000)),
      ]);
      if (!isAdminUser(p, u.email)) {
        await authService.logoutUser();
        setErr('Access denied, admin only.');
        return;
      }
      router.replace('/admin-dashboard');
    } catch (e2) {
      const msg = String((e2 && e2.message) || '');
      if (msg.includes('timeout')) {
        setErr('Connection slow. Try once more.');
      } else if (/invalid|wrong-password|user-not-found/i.test(msg)) {
        setErr('Invalid credentials.');
      } else {
        setErr(msg || 'Sign-in failed. Try again.');
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br
      from-[#1f1147] via-[#2d1b66] to-[#1a0e3a] px-4 py-12 text-white">
      {/* Soft glow accents */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72
        w-72 rounded-full bg-primary/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24
        h-80 w-80 rounded-full bg-amber-500/20 blur-3xl" />

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
              {busy ? 'Signing in…' : 'Sign in'}
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
