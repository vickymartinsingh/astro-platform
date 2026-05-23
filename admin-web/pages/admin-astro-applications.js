import { useEffect, useState } from 'react';
import { applicationService, adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin recruitment inbox. Shows submissions from
// /register-as-astrologer with full applicant info. Admin can move them
// through Reviewing -> Approved (creates the astrologer account) or
// Rejected with a note.
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}

const TABS = [
  ['submitted', 'New'],
  ['reviewing', 'Reviewing'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['', 'All'],
];

export default function AdminAstroApplications() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('submitted');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setRows(await applicationService.listApplications(
      { status: tab || null }) || []);
  }
  useEffect(() => { if (!loading) load(); }, [loading, tab]);

  async function setStatus(a, status) {
    setBusy(true);
    try {
      await applicationService.updateApplicationStatus(a.id, status);
      flash(`Marked ${status}.`);
      load();
    } catch (e) { flash(`Failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }

  async function approveAndCreate(a) {
    const pwd = window.prompt(
      `Create login for ${a.fullName} (${a.email}). Set a temporary `
      + 'password (the astrologer will reset it on first sign-in):',
      'astro@123');
    if (!pwd) return;
    setBusy(true);
    try {
      await adminService.createAstrologer({
        name: a.fullName, email: a.email, password: pwd,
        gender: a.gender || 'other',
        experience: Number(a.experienceYears || 0),
        skills: String(a.skills || '').split(',').map((s) => s.trim())
          .filter(Boolean),
        languages: String(a.languages || '').split(',').map((s) => s.trim())
          .filter(Boolean),
        priceChat: Number(a.expectedRate) || 20,
        priceCall: Number(a.expectedRate) || 20,
        priceVideo: Number(a.expectedRate) * 2 || 40,
        bio: a.bio || '',
      });
      await applicationService.updateApplicationStatus(a.id, 'approved',
        `Account created. Login: ${a.email} / ${pwd}`);
      flash(`Approved & created. Login: ${a.email} / ${pwd}`);
      load();
    } catch (e) {
      flash(`Approval failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  const filtered = (rows || []).filter((a) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (a.fullName || '').toLowerCase().includes(s)
      || (a.email || '').toLowerCase().includes(s)
      || (a.phone || '').includes(s)
      || (a.token || '').toLowerCase().includes(s)
      || (a.city || '').toLowerCase().includes(s);
  });

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Astrologer applications</h1>
      <p className="mb-3 text-sm text-sub-text">
        Inbox for everyone who applied via the public
        <a href="/register-as-astrologer" target="_blank" rel="noreferrer"
          className="ml-1 font-semibold text-primary underline">
          Join as astrologer
        </a>
        {' '}form. Approve to create their login automatically.
      </p>

      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-bg-light p-1
          text-xs font-bold">
          {TABS.map(([k, lbl]) => (
            <button key={k || 'all'} onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1.5 ${tab === k
                ? 'bg-white text-primary shadow-sm' : 'text-sub-text'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <input className="input flex-1" value={q}
          placeholder="Search by name / email / phone / token / city"
          onChange={(e) => setQ(e.target.value)} />
        <button onClick={load}
          className="rounded-full bg-primary px-3 py-1.5 text-xs
            font-bold text-white">Refresh</button>
      </div>

      {!rows ? (
        <div className="card">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-sm text-sub-text">
          No applications {tab ? `in "${tab}"` : 'yet'}.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-center justify-between
                gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-dark-text">
                      {a.fullName || '(no name)'}
                    </span>
                    <span className="rounded-full bg-bg-light px-2
                      py-0.5 text-[10px] font-bold text-primary">
                      {a.gender || 'other'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5
                      text-[10px] font-bold ${
                        a.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-700'
                        : a.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                        : a.status === 'reviewing'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'}`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-sub-text">
                    {a.email} · {a.phone}
                    {a.city ? ` · ${a.city}` : ''}
                    {' · '}{fmt(a.createdAt)}
                    {' · '}token <span className="font-mono">{a.token}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setOpenId(
                    openId === a.id ? null : a.id)}
                    className="rounded-full bg-bg-light px-3 py-1.5
                      text-xs font-bold text-primary">
                    {openId === a.id ? 'Hide' : 'View'}
                  </button>
                  {a.status !== 'approved' && (
                    <button onClick={() => approveAndCreate(a)}
                      disabled={busy}
                      className="rounded-full bg-emerald-600 px-3 py-1.5
                        text-xs font-bold text-white disabled:opacity-60">
                      Approve &amp; create
                    </button>
                  )}
                  {a.status === 'submitted' && (
                    <button onClick={() => setStatus(a, 'reviewing')}
                      disabled={busy}
                      className="rounded-full border border-amber-500
                        px-3 py-1.5 text-xs font-bold text-amber-700
                        disabled:opacity-60">
                      Reviewing
                    </button>
                  )}
                  {a.status !== 'rejected' && (
                    <button onClick={() => setStatus(a, 'rejected')}
                      disabled={busy}
                      className="rounded-full border border-danger px-3
                        py-1.5 text-xs font-bold text-danger
                        disabled:opacity-60">
                      Reject
                    </button>
                  )}
                </div>
              </div>

              {openId === a.id && (
                <div className="mt-3 grid grid-cols-1 gap-3
                  rounded-card border border-gray-200 p-3 text-sm
                  sm:grid-cols-2">
                  <Row k="DOB" v={a.dob || '-'} />
                  <Row k="Experience"
                    v={`${a.experienceYears || 0} years`} />
                  <Row k="Expected rate"
                    v={a.expectedRate ? `₹${a.expectedRate}/min` : '-'} />
                  <Row k="Referred by" v={a.referredBy || '-'} />
                  <Row k="Languages" v={a.languages || '-'} />
                  <Row k="Skills" v={a.skills || '-'} />
                  <div className="sm:col-span-2">
                    <div className="text-[11px] font-bold uppercase
                      tracking-wider text-sub-text">Bio</div>
                    <p className="mt-1 whitespace-pre-line">
                      {a.bio || '(none)'}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-[11px] font-bold uppercase
                      tracking-wider text-sub-text">
                      Why they want to join
                    </div>
                    <p className="mt-1 whitespace-pre-line">
                      {a.why || '(none)'}
                    </p>
                  </div>
                  {a.note && (
                    <div className="sm:col-span-2">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-sub-text">Admin note</div>
                      <p className="mt-1 whitespace-pre-line">
                        {a.note}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
const Row = ({ k, v }) => (
  <div>
    <div className="text-[11px] font-bold uppercase tracking-wider
      text-sub-text">{k}</div>
    <div className="font-semibold">{v}</div>
  </div>
);
