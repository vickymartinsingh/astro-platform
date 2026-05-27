import { useState } from 'react';
import Link from 'next/link';
import { applicationService } from '@astro/shared';
import Layout from '../components/Layout';

// Public application tracker. Applicants enter the email they
// registered with plus the 6-digit token they got in the confirmation
// email. We look up the matching row in astroApplications and render
// the stage pipeline so they always know where they stand.
const STAGE_LABELS = [
  ['submitted', 'Application received'],
  ['reviewing', 'Under review'],
  ['interview', 'Screening interview'],
  ['kyc', 'KYC documents'],
  ['bank', 'Bank verification'],
  ['declaration', 'Code-of-conduct sign-off'],
  ['approved', 'Approved'],
];

export default function TrackApplication() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hit, setHit] = useState(null);
  const [missed, setMissed] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setErr(''); setMissed(false); setHit(null);
    if (!email.trim() || !/^\d{6}$/.test(token.trim())) {
      setErr('Enter your registered email and the 6-digit token.');
      return;
    }
    setBusy(true);
    try {
      const r = await applicationService.trackApplication(email, token);
      if (!r) setMissed(true);
      else setHit(r);
    } catch (e2) {
      setErr(`Lookup failed. ${e2.message || ''}`);
    } finally { setBusy(false); }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-xl">
        <div className="mb-3 flex flex-wrap items-center
          justify-between gap-2">
          <h1 className="text-2xl font-bold">Track your application</h1>
          <Link href="/register-as-astrologer"
            className="text-xs font-bold text-primary underline">
            New application →
          </Link>
        </div>
        <p className="mb-4 text-sm text-sub-text">
          Enter the email you registered with and the 6-digit token
          we emailed you. We will show your current stage in the
          recruitment pipeline.
        </p>
        <form onSubmit={lookup} className="card space-y-3">
          <label className="block">
            <span className="block text-[11px] font-bold uppercase
              tracking-wider text-sub-text">Registered email</span>
            <input className="input mt-1" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold uppercase
              tracking-wider text-sub-text">6-digit token</span>
            <input className="input mt-1 tracking-[0.4em] text-center"
              inputMode="numeric" maxLength={6} value={token}
              onChange={(e) => setToken(
                e.target.value.replace(/\D/g, '').slice(0, 6))}
              required />
          </label>
          {err && (
            <div className="rounded-2xl bg-danger/10 p-3 text-sm
              text-danger">{err}</div>
          )}
          <button disabled={busy} className="btn-primary w-full">
            {busy ? 'Looking up…' : 'Check status'}
          </button>
        </form>

        {missed && !hit && (
          <div className="card mt-4 bg-warning/10 text-sm text-dark-text">
            We couldn&apos;t find an application matching that email +
            token combination. Double-check the token in your email
            (subject line includes it), or {' '}
            <Link href="/register-as-astrologer"
              className="font-bold text-primary underline">
              start a new application
            </Link>.
          </div>
        )}

        {hit && (
          <div className="card mt-4">
            <div className="flex flex-wrap items-center
              justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wider
                  text-sub-text">Application</div>
                <div className="text-lg font-bold">{hit.fullName}</div>
                <div className="text-xs text-sub-text">{hit.email}</div>
              </div>
              <div className="rounded-full bg-primary/10 px-3 py-1
                text-xs font-bold text-primary">
                Token {hit.token}
              </div>
            </div>

            <ol className="mt-4 space-y-2">
              {STAGE_LABELS.map(([key, label], i) => {
                const idx = STAGE_LABELS.findIndex(
                  ([k]) => k === hit.status);
                const state = hit.status === 'rejected' ? 'rejected'
                  : i < idx ? 'done'
                    : i === idx ? 'current' : 'todo';
                return (
                  <li key={key} className={`flex items-center gap-3
                    rounded-card px-3 py-2 text-sm ${
                    state === 'done' ? 'bg-success/10 text-success'
                      : state === 'current'
                        ? 'bg-primary/10 font-bold text-primary'
                        : state === 'rejected' && i === 0
                          ? 'bg-danger/10 text-danger'
                          : 'bg-gray-50 text-sub-text'}`}>
                    <span className={`inline-flex h-6 w-6
                      items-center justify-center rounded-full
                      text-[10px] font-bold ${
                      state === 'done' ? 'bg-success text-white'
                        : state === 'current'
                          ? 'bg-primary text-white'
                          : 'bg-gray-200 text-sub-text'}`}>
                      {i + 1}
                    </span>
                    <span>{label}</span>
                    {state === 'current' && (
                      <span className="ml-auto rounded-full
                        bg-primary px-2 py-0.5 text-[9px]
                        text-white">current</span>
                    )}
                  </li>
                );
              })}
            </ol>

            {hit.status === 'rejected' && (
              <div className="mt-3 rounded-card bg-danger/10 p-3
                text-sm text-danger">
                Unfortunately your application was not selected this
                time. {hit.note ? `Note: ${hit.note}` : ''} You can
                re-apply with the same email - applications are
                capped at 6 attempts.
              </div>
            )}
            {hit.status === 'approved' && (
              <div className="mt-3 rounded-card bg-success/10 p-3
                text-sm text-success">
                Congratulations - you&apos;re approved. Check your
                inbox for the login email.
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
