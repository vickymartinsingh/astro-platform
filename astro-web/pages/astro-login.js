import { useState } from 'react';
import { useRouter } from 'next/router';
import { authService, userService } from '@astro/shared';

export default function AstroLogin() {
  const router = useRouter();
  const denied = router.query.denied === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await authService.loginUser(email.trim(), password);
      const p = await userService.getUser(u.uid);
      if (!p || (p.role !== 'astrologer' && p.isAstrologer !== true)) {
        await authService.logoutUser();
        setErr('Access denied. This is the Astrologer portal.');
        return;
      }
      if (p.isBlocked) {
        await authService.logoutUser();
        setErr('Your account has been suspended.');
        return;
      }
      router.replace('/astro-dashboard');
    } catch {
      setErr('Invalid email or password.');
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
    <div className="flex min-h-screen items-center justify-center
                    bg-gradient-to-br from-[#EDE9FE] to-[#FCE7F3] px-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white
                      shadow-xl">
        <div className="hero-grad p-6 text-white">
          <div className="text-xl font-bold">AstroConnect</div>
          <div className="mt-1 text-2xl font-bold">Astrologer Portal</div>
          <p className="mt-1 text-sm opacity-90">
            Sign in to go online and take consultations.
          </p>
        </div>
        <div className="p-6">
          {(err || denied) && (
            <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm
                            text-rose-600">
              {err || 'Access denied, wrong portal.'}
            </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <input className="input" type="email" placeholder="Email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required />
            <input className="input" type="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required />
            <button className="btn-grad w-full justify-center py-3"
              disabled={busy}>
              {busy ? 'Signing in…' : 'Login'}
            </button>
            <button type="button" onClick={forgot}
              className="w-full text-sm text-primary">
              Forgot password?
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-sub-text">
            Astrologer accounts are created/approved by the admin team.
          </p>
        </div>
      </div>
    </div>
  );
}
