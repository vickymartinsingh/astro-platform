import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { applicationService, storage } from '@astro/shared';
import Layout from '../../components/Layout';

// Public token-gated astrologer onboarding flow. The applicant gets a
// link like /astro-onboarding/ABCD1234 in their confirmation email and
// can resume any time without logging in. The form auto-shows the
// section that recruitment has currently asked them to complete:
//
//   stage = kyc          -> KYC step (PAN + Aadhaar)
//   stage = bank         -> Bank step
//   stage = declaration  -> Sign declaration
//   anything else        -> Read-only status / what's next.
//
// Each completed section saves to the application doc via the shared
// applicationService (no admin auth needed because the writes go via
// the same Firestore rules that already allow self-submission from the
// public form; the token doubles as the secret).
const TITLE = 'Astrologer onboarding';

function StatusBadge({ status }) {
  const cls = {
    submitted: 'bg-blue-100 text-blue-700',
    reviewing: 'bg-amber-100 text-amber-700',
    interview: 'bg-violet-100 text-violet-700',
    kyc: 'bg-indigo-100 text-indigo-700',
    bank: 'bg-cyan-100 text-cyan-700',
    declaration: 'bg-fuchsia-100 text-fuchsia-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
  }[status] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold
      ${cls}`}>
      {applicationService.STAGE_LABEL[status] || status}
    </span>
  );
}

export default function AstroOnboardingByToken() {
  const router = useRouter();
  const tokenRaw = router.query && router.query.token;
  const token = typeof tokenRaw === 'string'
    ? tokenRaw.toUpperCase() : '';
  const [app, setApp] = useState(null);   // application doc
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (!token) return;
    setErr('');
    try {
      const a = await applicationService.getApplicationByToken(token);
      if (!a) setErr('No application found for this token. Please '
        + 'double-check the link from your email.');
      setApp(a);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setLoaded(true); }
  }
  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ },
    [token]);

  if (!token || !loaded) {
    return (
      <Layout>
        <div className="card mx-auto max-w-lg">Loading…</div>
      </Layout>
    );
  }
  if (err || !app) {
    return (
      <Layout>
        <div className="card mx-auto max-w-lg">
          <h1 className="text-xl font-bold">{TITLE}</h1>
          <p className="mt-2 text-sm text-danger">
            {err || 'Application not found.'}
          </p>
          <p className="mt-3 text-sm text-sub-text">
            If you have not yet applied, you can do so
            {' '}
            <a className="font-bold text-primary underline"
              href="/register-as-astrologer">here</a>.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <div className="card mb-3 flex items-center justify-between
          gap-2">
          <div>
            <h1 className="text-xl font-bold">{TITLE}</h1>
            <div className="mt-0.5 text-[12px] text-sub-text">
              Token <span className="font-mono">{app.token}</span>
              {' · '}{app.fullName}
            </div>
          </div>
          <StatusBadge status={app.status} />
        </div>

        <Pipeline app={app} />

        {(app.status === 'kyc' || (!app.kyc && app.status !== 'approved'
          && app.status !== 'rejected')) && (
          <KycStep app={app} onSaved={load} />
        )}
        {(app.status === 'bank' || (!app.bank && app.status !== 'approved'
          && app.status !== 'rejected' && app.kyc)) && (
          <BankStep app={app} onSaved={load} />
        )}
        {(app.status === 'declaration'
          || (app.bank && !app.declaration
            && app.status !== 'approved' && app.status !== 'rejected'
          )) && (
          <DeclarationStep app={app} onSaved={load} />
        )}

        {app.status === 'approved' && (
          <div className="card text-sm">
            <strong>You are approved.</strong> Check your inbox for your
            login credentials and download the AstroSeer Astrologer app
            to start consulting.
          </div>
        )}
        {app.status === 'rejected' && (
          <div className="card text-sm">
            Unfortunately your application is not being taken forward at
            this time. You are welcome to re-apply in the future.
          </div>
        )}
      </div>
    </Layout>
  );
}

function Pipeline({ app }) {
  const stages = applicationService.STAGES;
  const idx = Math.max(0, stages.indexOf(app.status));
  return (
    <div className="card mb-3 overflow-x-auto">
      <div className="text-[11px] font-bold uppercase tracking-wider
        text-sub-text">Your progress</div>
      <ol className="mt-2 flex items-center gap-1 text-[11px]">
        {stages.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 font-bold
              ${i < idx ? 'bg-emerald-100 text-emerald-700'
              : i === idx ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text'}`}>
              {applicationService.STAGE_LABEL[s] || s}
            </span>
            {i < stages.length - 1 && (
              <span className="text-sub-text">›</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function KycStep({ app, onSaved }) {
  const [pan, setPan] = useState((app.kyc && app.kyc.panNumber) || '');
  const [aad, setAad] = useState((app.kyc && app.kyc.aadhaarNumber) || '');
  const [panUrl, setPanUrl] = useState((app.kyc && app.kyc.panUrl) || '');
  const [aadUrl, setAadUrl] = useState(
    (app.kyc && app.kyc.aadhaarUrl) || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function upload(file, kind, setUrl) {
    if (!file || !storage) return;
    setBusy(true); setErr('');
    try {
      const r = ref(storage,
        `astro-onboarding/${app.token}/${kind}-${Date.now()}-`
        + `${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setUrl(url);
    } catch (e) { setErr(`Upload failed: ${e.message || e}`); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!pan.trim() || !aad.trim()) {
      setErr('PAN and Aadhaar numbers are required.'); return;
    }
    setBusy(true); setErr('');
    try {
      await applicationService.saveKyc(app.id, {
        panNumber: pan, panUrl, aadhaarNumber: aad, aadhaarUrl: aadUrl,
      });
      onSaved && onSaved();
    } catch (e) { setErr(`Save failed: ${e.message || e}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="card mb-3 space-y-3">
      <h2 className="text-base font-bold">Step: KYC documents</h2>
      <p className="text-[12px] text-sub-text">
        Required for compliance. We never share these documents - they
        are used only to verify your identity for payouts.
      </p>
      <Field label="PAN number">
        <input className="input uppercase" value={pan}
          onChange={(e) => setPan(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Upload PAN (image or PDF)">
        <input type="file" accept="image/*,.pdf"
          onChange={(e) => upload(e.target.files[0], 'pan', setPanUrl)} />
        {panUrl && <a href={panUrl} target="_blank" rel="noreferrer"
          className="ml-2 text-[12px] text-primary underline">
            Uploaded</a>}
      </Field>
      <Field label="Aadhaar number">
        <input className="input" value={aad}
          onChange={(e) => setAad(e.target.value)} />
      </Field>
      <Field label="Upload Aadhaar (image or PDF)">
        <input type="file" accept="image/*,.pdf"
          onChange={(e) => upload(e.target.files[0], 'aadhaar', setAadUrl)} />
        {aadUrl && <a href={aadUrl} target="_blank" rel="noreferrer"
          className="ml-2 text-[12px] text-primary underline">
            Uploaded</a>}
      </Field>
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? 'Saving…' : 'Save KYC'}
      </button>
    </div>
  );
}

function BankStep({ app, onSaved }) {
  const [b, setB] = useState({
    holder: (app.bank && app.bank.holder) || app.fullName || '',
    accountNo: (app.bank && app.bank.accountNo) || '',
    ifsc: (app.bank && app.bank.ifsc) || '',
    bankName: (app.bank && app.bank.bankName) || '',
    branch: (app.bank && app.bank.branch) || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setB((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!b.holder.trim() || !b.accountNo.trim() || !b.ifsc.trim()) {
      setErr('Account holder, number and IFSC are required.'); return;
    }
    setBusy(true); setErr('');
    try {
      await applicationService.saveBank(app.id, b);
      onSaved && onSaved();
    } catch (e) { setErr(`Save failed: ${e.message || e}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="card mb-3 space-y-3">
      <h2 className="text-base font-bold">Step: Bank details</h2>
      <p className="text-[12px] text-sub-text">
        We pay your earnings directly to this account.
      </p>
      <Field label="Account holder name">
        <input className="input" value={b.holder}
          onChange={(e) => set('holder', e.target.value)} />
      </Field>
      <Field label="Account number">
        <input className="input" value={b.accountNo}
          onChange={(e) => set('accountNo', e.target.value)} />
      </Field>
      <Field label="IFSC">
        <input className="input uppercase" value={b.ifsc}
          onChange={(e) => set('ifsc',
            e.target.value.toUpperCase())} />
      </Field>
      <Field label="Bank name">
        <input className="input" value={b.bankName}
          onChange={(e) => set('bankName', e.target.value)} />
      </Field>
      <Field label="Branch">
        <input className="input" value={b.branch}
          onChange={(e) => set('branch', e.target.value)} />
      </Field>
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <button onClick={save} disabled={busy} className="btn-primary">
        {busy ? 'Saving…' : 'Save bank details'}
      </button>
    </div>
  );
}

function DeclarationStep({ app, onSaved }) {
  const [sig, setSig] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function sign() {
    if (!agree) { setErr('Please tick the checkbox to agree.'); return; }
    if (!sig.trim() || sig.trim().length < 3) {
      setErr('Type your full name as signature.'); return;
    }
    setBusy(true); setErr('');
    try {
      await applicationService.saveDeclaration(app.id, {
        signature: sig,
      });
      onSaved && onSaved();
    } catch (e) { setErr(`Save failed: ${e.message || e}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="card mb-3 space-y-3">
      <h2 className="text-base font-bold">Step: Code-of-conduct
        declaration</h2>
      <div className="max-h-64 overflow-y-auto rounded-card bg-bg-light
        p-3 text-[12px] text-sub-text">
        <p>I, the undersigned applicant, hereby declare that:</p>
        <ol className="ml-4 mt-1 list-decimal space-y-1">
          <li>All information provided in my application, KYC and bank
            details is true and accurate.</li>
          <li>I will conduct consultations on AstroSeer ethically, will
            not give medical, legal or financial advice, and will not
            ask clients to contact me off-platform.</li>
          <li>I will not share any personal information of clients with
            third parties.</li>
          <li>I will follow AstroSeer's pricing, refund and grievance
            policies as updated from time to time.</li>
          <li>I understand that violation of these terms may lead to
            suspension or permanent removal of my account and forfeiture
            of pending payouts.</li>
        </ol>
      </div>
      <label className="flex items-start gap-2 text-[12px]">
        <input type="checkbox" checked={agree}
          onChange={(e) => setAgree(e.target.checked)} />
        <span>I have read and agree to the AstroSeer Astrologer
          Code-of-Conduct.</span>
      </label>
      <Field label="Type your full name as signature">
        <input className="input" value={sig}
          onChange={(e) => setSig(e.target.value)} />
      </Field>
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <button onClick={sign} disabled={busy} className="btn-primary">
        {busy ? 'Signing…' : 'Sign and submit'}
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase
        tracking-wider text-sub-text">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
