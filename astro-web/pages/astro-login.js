import { useState } from 'react';
import { useRouter } from 'next/router';
import { authService, userService, ticketService } from '@astro/shared';

export default function AstroLogin() {
  const router = useRouter();
  const denied = router.query.denied === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login'); // login | help
  const [hSubject, setHSubject] = useState('');
  const [hMsg, setHMsg] = useState('');
  const [hOk, setHOk] = useState('');

  async function raiseTicket() {
    setErr(''); setHOk('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErr('Enter your registered email.'); return;
    }
    if (!hMsg.trim()) { setErr('Describe the issue briefly.'); return; }
    setBusy(true);
    try {
      const r = await ticketService.createEmailTicket(email.trim(), {
        category: 'login', role: 'astrologer',
        subject: hSubject.trim() || 'Unable to access account',
        message: hMsg.trim(), name: email.trim(),
      });
      // Also send a password reset as a quick self-serve option.
      try { await authService.sendPasswordReset(email.trim()); } catch (_) {}
      setHOk(`Ticket ${r.ticketNo} raised. Our team will contact you `
        + 'by email. We also sent a password reset link to your inbox.');
      setHSubject(''); setHMsg('');
    } catch (e) {
      setErr(e?.message || 'Could not raise the ticket. Try again.');
    } finally { setBusy(false); }
  }

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
          {hOk && (
            <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm
                            text-emerald-700">{hOk}</div>
          )}

          {mode === 'login' ? (
            <>
              <form onSubmit={submit} className="space-y-3">
                <input className="input" type="email" placeholder="Email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required />
                <input className="input" type="password"
                  placeholder="Password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
              <button type="button"
                onClick={() => { setMode('help'); setErr(''); }}
                className="mt-3 w-full rounded-xl border border-gray-200
                  py-2.5 text-sm font-semibold text-dark-text">
                Unable to access your account? Raise a ticket
              </button>
              <p className="mt-4 text-center text-xs text-sub-text">
                Astrologer accounts are created/approved by the admin
                team.
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-sub-text">
                Locked out? Tell us the issue using your registered
                email. Our team will reach you by email.
              </p>
              <input className="input" type="email"
                placeholder="Your registered email" value={email}
                onChange={(e) => setEmail(e.target.value)} />
              <input className="input" placeholder="Subject"
                value={hSubject}
                onChange={(e) => setHSubject(e.target.value)} />
              <textarea className="input" rows={4}
                placeholder="Describe the issue (login, password, blocked, etc.)"
                value={hMsg}
                onChange={(e) => setHMsg(e.target.value)} />
              <button type="button" onClick={raiseTicket} disabled={busy}
                className="btn-grad w-full justify-center py-3">
                {busy ? 'Submitting…' : 'Raise ticket'}
              </button>
              <button type="button"
                onClick={() => { setMode('login'); setErr(''); }}
                className="w-full text-sm text-primary">
                Back to login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
