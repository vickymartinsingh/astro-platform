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
      if (!p || p.role !== 'astrologer') {
        await authService.logoutUser();
        setErr('Access denied, this is the Astrologer portal.');
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

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-1 text-2xl font-bold text-primary">
        ✨ Astrologer Portal
      </h1>
      <p className="mb-6 text-sub-text">Sign in to go online.</p>
      {(err || denied) && (
        <div className="mb-3 rounded-card bg-danger/10 p-3 text-danger">
          {err || 'Access denied, wrong portal.'}
        </div>
      )}
      <form onSubmit={submit} className="card space-y-3">
        <input className="input" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          required />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
