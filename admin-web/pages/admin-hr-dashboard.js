import { useEffect, useState } from 'react';
import Link from 'next/link';
import { applicationService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Landing page for the HR / Recruitment portal. Shows live counts per
// pipeline stage, deep-links into the applications screen with the
// matching filter pre-applied (?stage=...), and surfaces the latest
// new submissions so HR can act on them in one click. Designed to be
// the home view whenever the admin switches to the "HR" portal via the
// PortalSwitcher floating control.
const TILES = [
  ['submitted', 'New', 'bg-blue-100 text-blue-700',
    'Fresh applications awaiting first review.'],
  ['reviewing', 'Reviewing', 'bg-amber-100 text-amber-700',
    'Currently being screened by the team.'],
  ['interview', 'Interview', 'bg-amber-100 text-amber-800',
    'Screening call scheduled or completed.'],
  ['kyc', 'KYC pending', 'bg-sky-100 text-sky-700',
    'Waiting on PAN + Aadhaar from the applicant.'],
  ['bank', 'Bank pending', 'bg-cyan-100 text-cyan-700',
    'Waiting on payout bank details from the applicant.'],
  ['declaration', 'Declaration pending', 'bg-rose-100 text-rose-700',
    'Waiting on the signed code-of-conduct.'],
  ['approved', 'Approved', 'bg-emerald-100 text-emerald-700',
    'Live astrologer accounts created via recruitment.'],
  ['rejected', 'Rejected', 'bg-red-100 text-red-700',
    'Not taken forward.'],
];

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}

export default function AdminHrDashboard() {
  const { loading } = useRequireAdmin();
  const [counts, setCounts] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        setCounts(await applicationService.pipelineCounts());
        setRecent(await applicationService.listApplications({}) || []);
      } catch (_) { /* ignore */ }
    })();
  }, [loading]);

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">HR / Recruitment dashboard</h1>
      <p className="mb-3 text-sm text-sub-text">
        Live overview of the astrologer recruitment pipeline. Click any
        tile to jump straight to the matching stage.
      </p>

      <div className="card mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map(([key, label, cls, hint]) => (
          <Link key={key} href={`/admin-astro-applications?stage=${key}`}
            className={`rounded-card p-3 text-left hover:opacity-90
              ${cls}`}>
            <div className="text-[11px] font-bold uppercase
              tracking-wider opacity-80">{label}</div>
            <div className="mt-1 text-2xl font-bold">
              {counts ? (counts[key] || 0) : '-'}
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] opacity-70">
              {hint}
            </div>
          </Link>
        ))}
      </div>

      <div className="card mb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Recent applications</h2>
          <Link href="/admin-astro-applications"
            className="text-[12px] font-bold text-primary">
            Open inbox →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="mt-2 text-sm text-sub-text">No applications
            yet.</div>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {recent.slice(0, 10).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center
                justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold">
                    {a.fullName || '(no name)'}
                    <span className="ml-2 rounded-full bg-bg-light px-2
                      py-0.5 text-[10px] font-bold text-primary">
                      {applicationService.STAGE_LABEL[a.status]
                        || a.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-sub-text">
                    {a.email}{a.phone ? ` · ${a.phone}` : ''}
                    {' · '}{fmt(a.createdAt)}
                    {' · token '}
                    <span className="font-mono">{a.token}</span>
                  </div>
                </div>
                <Link
                  href={`/admin-astro-applications?stage=${a.status
                    || 'submitted'}`}
                  className="rounded-full bg-primary px-3 py-1.5 text-xs
                    font-bold text-white">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="text-base font-bold">Public links</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            Application form:
            {' '}
            <a className="font-mono text-primary underline"
              href="/register-as-astrologer" target="_blank"
              rel="noreferrer">
              /register-as-astrologer
            </a>
          </li>
          <li>
            Token-resume onboarding:
            {' '}
            <span className="font-mono">/astro-onboarding/&lt;token&gt;</span>
            {' '}
            (link emailed automatically to each applicant on submission)
          </li>
        </ul>
      </div>
    </Layout>
  );
}
