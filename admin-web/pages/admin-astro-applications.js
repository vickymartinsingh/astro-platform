import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { applicationService, adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin recruitment + HRMS inbox.
//
// Shows submissions from /register-as-astrologer and walks each
// application through the full pipeline:
//   submitted -> reviewing -> interview -> kyc -> bank
//             -> declaration -> approved / rejected
//
// Each application is editable: admin can advance/return stages, view
// the applicant-uploaded KYC + bank + signed declaration, and finally
// approve - which creates the real astrologer account via
// adminService.createAstrologer and emails the applicant their login.
// A query string `?stage=kyc` deep-links HR dashboard chips to the
// matching filter, so HR can open "KYC pending" from anywhere.
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : (Number(ts) || 0);
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
  ['interview', 'Interview'],
  ['kyc', 'KYC'],
  ['bank', 'Bank'],
  ['declaration', 'Declaration'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['', 'All'],
];

const STAGE_COLOR = {
  submitted: 'bg-blue-100 text-blue-700',
  reviewing: 'bg-amber-100 text-amber-700',
  interview: 'bg-amber-100 text-amber-800',
  kyc: 'bg-sky-100 text-sky-700',
  bank: 'bg-cyan-100 text-cyan-700',
  declaration: 'bg-rose-100 text-rose-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function AdminAstroApplications() {
  const { loading } = useRequireAdmin();
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('submitted');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Deep-link: ?stage=kyc -> auto-set tab.
  useEffect(() => {
    const s = router.query && router.query.stage;
    if (typeof s === 'string'
      && TABS.some(([k]) => k === s)) setTab(s);
  }, [router.query]);

  async function load() {
    setRows(await applicationService.listApplications(
      { status: tab || null }) || []);
  }
  useEffect(() => { if (!loading) load(); }, [loading, tab]);

  async function setStatus(a, status, note = '') {
    setBusy(true);
    try {
      await applicationService.updateApplicationStatus(a.id, status,
        note);
      flash(`Marked ${status}. Applicant notified by email.`);
      load();
    } catch (e) { flash(`Failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }

  async function advance(a) {
    const nxt = applicationService.nextStage(a.status);
    if (!nxt) {
      flash('Already at the final stage. Use "Approve & create".',
        'error');
      return;
    }
    const note = window.prompt(
      `Advance ${a.fullName} to "${nxt}". Optional note for the `
      + 'applicant (will be emailed):', '') || '';
    await setStatus(a, nxt, note);
  }

  async function reject(a) {
    const note = window.prompt(
      `Reject ${a.fullName}. Optional reason (will be emailed):`, '');
    if (note === null) return;
    setBusy(true);
    try {
      await applicationService.updateApplicationStatus(a.id,
        'rejected', note);
      await applicationService.notifyRejected(a.id, note);
      flash('Rejected and applicant notified.');
      load();
    } catch (e) { flash(`Failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }

  async function approveAndCreate(a) {
    // Block approval until KYC + bank + declaration are on file.
    const missing = [];
    if (!a.kyc || !a.kyc.panNumber) missing.push('KYC');
    if (!a.bank || !a.bank.accountNo) missing.push('bank details');
    if (!a.declaration || !a.declaration.signedAt) {
      missing.push('signed declaration');
    }
    if (missing.length
      && !window.confirm(
        `Missing: ${missing.join(', ')}. Approve anyway?`)) return;
    const pwd = window.prompt(
      `Create login for ${a.fullName} (${a.email}). Set a temporary `
      + 'password (the astrologer will reset it on first sign-in):',
      'astro@123');
    if (!pwd) return;
    setBusy(true);
    try {
      // Resolve "Referred by" userCode -> the referrer's uid so the
      // session-end hook can pay out the bonus later.
      const referrer = await applicationService
        .resolveReferrer(a.id);
      // Languages / skills may already be arrays (new form) or comma
      // strings (legacy applications). Normalize.
      const langs = Array.isArray(a.languages) ? a.languages
        : String(a.languages || '').split(',').map((s) => s.trim())
          .filter(Boolean);
      const skills = Array.isArray(a.skills) ? a.skills
        : String(a.skills || '').split(',').map((s) => s.trim())
          .filter(Boolean);
      await adminService.createAstrologer({
        name: a.fullName, email: a.email, password: pwd,
        gender: a.gender || 'other',
        experience: a.experienceYears || 0,
        skills, languages,
        priceChat: Number(a.expectedRate) || 20,
        priceCall: Number(a.expectedRate) || 20,
        priceVideo: Number(a.expectedRate) * 2 || 40,
        bio: a.bio || '',
        referredByCode: referrer ? referrer.referrerCode : '',
        referredByUserId: referrer ? referrer.referrerUid : '',
      });
      await applicationService.updateApplicationStatus(a.id, 'approved',
        `Account created. Login: ${a.email} / ${pwd}`);
      await applicationService.notifyApproved(a.id, pwd);
      flash(`Approved & created. Login emailed to ${a.email}.`);
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
        Inbox + onboarding pipeline for everyone who applied via the
        public
        <a href="/register-as-astrologer" target="_blank" rel="noreferrer"
          className="ml-1 font-semibold text-primary underline">
          Join as astrologer
        </a>
        {' '}form. Move applicants through screening, KYC, bank,
        declaration and finally approve to create their login.
      </p>

      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-full bg-bg-light
          p-1 text-xs font-bold">
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
                        STAGE_COLOR[a.status]
                        || 'bg-bg-light text-sub-text'}`}>
                      {applicationService.STAGE_LABEL[a.status]
                        || a.status}
                    </span>
                    {a.kyc && a.kyc.panNumber && (
                      <span className="rounded-full bg-sky-50 px-2
                        py-0.5 text-[10px] font-bold text-sky-700">
                        KYC ✓
                      </span>
                    )}
                    {a.bank && a.bank.accountNo && (
                      <span className="rounded-full bg-cyan-50 px-2
                        py-0.5 text-[10px] font-bold text-cyan-700">
                        Bank ✓
                      </span>
                    )}
                    {a.declaration && a.declaration.signedAt && (
                      <span className="rounded-full bg-rose-50 px-2
                        py-0.5 text-[10px] font-bold text-rose-700">
                        Signed ✓
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-sub-text">
                    {a.email} · {a.phone}
                    {a.city ? ` · ${a.city}` : ''}
                    {' · '}{fmt(a.createdAt)}
                    {' · '}token{' '}
                    <span className="font-mono">{a.token}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setOpenId(
                    openId === a.id ? null : a.id)}
                    className="rounded-full bg-bg-light px-3 py-1.5
                      text-xs font-bold text-primary">
                    {openId === a.id ? 'Hide' : 'View'}
                  </button>
                  {a.status !== 'approved' && a.status !== 'rejected' && (
                    <button onClick={() => advance(a)} disabled={busy}
                      className="rounded-full bg-primary px-3 py-1.5
                        text-xs font-bold text-white disabled:opacity-60">
                      Advance →{' '}
                      {applicationService.STAGE_LABEL[
                        applicationService.nextStage(a.status)] || '-'}
                    </button>
                  )}
                  {a.status !== 'approved' && (
                    <button onClick={() => approveAndCreate(a)}
                      disabled={busy}
                      className="rounded-full bg-emerald-600 px-3 py-1.5
                        text-xs font-bold text-white disabled:opacity-60">
                      Approve &amp; create
                    </button>
                  )}
                  {a.status !== 'rejected' && (
                    <button onClick={() => reject(a)} disabled={busy}
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

                  {a.kyc && (
                    <div className="sm:col-span-2 rounded-card
                      bg-sky-50/60 p-3">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-sky-700">KYC</div>
                      <div className="mt-1 grid grid-cols-1 gap-1
                        text-[13px] sm:grid-cols-2">
                        <div>PAN: <span className="font-mono">
                          {a.kyc.panNumber || '-'}</span></div>
                        <div>Aadhaar:{' '}
                          <span className="font-mono">
                            {a.kyc.aadhaarNumber || '-'}</span></div>
                        {a.kyc.panUrl && (
                          <a href={a.kyc.panUrl} target="_blank"
                            rel="noreferrer"
                            className="text-primary underline">
                            View PAN file
                          </a>
                        )}
                        {a.kyc.aadhaarUrl && (
                          <a href={a.kyc.aadhaarUrl} target="_blank"
                            rel="noreferrer"
                            className="text-primary underline">
                            View Aadhaar file
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {a.bank && (
                    <div className="sm:col-span-2 rounded-card
                      bg-cyan-50/60 p-3">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-cyan-700">
                        Bank details
                      </div>
                      <div className="mt-1 grid grid-cols-1 gap-1
                        text-[13px] sm:grid-cols-2">
                        <div>Holder: {a.bank.holder || '-'}</div>
                        <div>Account:{' '}
                          <span className="font-mono">
                            {a.bank.accountNo || '-'}
                          </span></div>
                        <div>IFSC:{' '}
                          <span className="font-mono">
                            {a.bank.ifsc || '-'}
                          </span></div>
                        <div>{a.bank.bankName || '-'}
                          {a.bank.branch
                            ? ` · ${a.bank.branch}` : ''}</div>
                      </div>
                    </div>
                  )}

                  {a.declaration && a.declaration.signedAt && (
                    <div className="sm:col-span-2 rounded-card
                      bg-rose-50/60 p-3">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-rose-700">
                        Code-of-conduct declaration
                      </div>
                      <div className="mt-1 text-[13px]">
                        Signed by{' '}
                        <strong>{a.declaration.signature}</strong>
                        {' '}on {fmt(a.declaration.signedAt)}
                        {a.declaration.ip
                          ? ` from IP ${a.declaration.ip}` : ''}.
                      </div>
                    </div>
                  )}

                  {Array.isArray(a.history) && a.history.length > 0 && (
                    <div className="sm:col-span-2">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-sub-text">History</div>
                      <ul className="mt-1 space-y-0.5 text-[12px]">
                        {a.history.slice().reverse().map((h, i) => (
                          <li key={i} className="text-sub-text">
                            <span className="font-mono">{fmt(h.at)}</span>
                            {' · '}
                            <span className="font-semibold">{h.stage}</span>
                            {' · by '}{h.by || 'admin'}
                            {h.note ? ` - ${h.note}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {a.note && (
                    <div className="sm:col-span-2">
                      <div className="text-[11px] font-bold uppercase
                        tracking-wider text-sub-text">
                        Latest admin note
                      </div>
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
