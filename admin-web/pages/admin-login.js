import { useState } from 'react';
import { useRouter } from 'next/router';
import { authService, userService, isAdminUser } from '@astro/shared';

export default function AdminLogin() {
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
      if (!isAdminUser(p, u.email)) {
        await authService.logoutUser();
        setErr('Access denied, admin only.');
        return;
      }
      router.replace('/admin-dashboard');
    } catch {
      setErr('Invalid credentials.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-1 text-2xl font-bold">⚙️ Admin Panel</h1>
      <p className="mb-6 text-sub-text">Restricted access.</p>
      {(err || denied) && (
        <div className="mb-3 rounded-card bg-danger/10 p-3 text-danger">
          {err || 'Access denied.'}
        </div>
      )}
      <form onSubmit={submit} className="card space-y-3">
        <input className="input" type="email" placeholder="Admin email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          required />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Login'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-sub-text">
        First admin: create a user, then set role=admin in Firestore.
      </p>
    </div>
  );
}
