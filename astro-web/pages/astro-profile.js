import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  astrologerService, payoutService, authService, db, storage,
  appVersionName,
} from '@astro/shared';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const BLANK = {
  name: '', gender: 'male', bio: '', skills: '', languages: '',
  experience: 0,
  priceChat: 20, priceCall: 30, priceVideo: 40, discountPercent: 0,
};

export default function AstroProfile() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  async function logout() {
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/astro-login');
  }
  const [f, setF] = useState(BLANK);
  const [exists, setExists] = useState(false);
  const [msg, setMsg] = useState('');
  const [payout, setPayout] = useState({ amount: '', bankDetails: '' });
  const [payouts, setPayouts] = useState([]);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      if (a) {
        setExists(true);
        setF({
          name: a.name || profile?.name || '',
          gender: a.gender || 'male',
          bio: a.bio || '',
          skills: (a.skills || []).join(', '),
          languages: (a.languages || []).join(', '),
          experience: a.experience || 0,
          priceChat: a.priceChat || 20,
          priceCall: a.priceCall || 30,
          priceVideo: a.priceVideo || 40,
          discountPercent: a.discountPercent || 0,
        });
      } else {
        setF((p) => ({ ...p, name: profile?.name || '' }));
      }
    }).catch(() => setExists(false));
    payoutService.getPayouts(user.uid).then(setPayouts)
      .catch(() => setPayouts([]));
  }, [user, profile]);

  async function save() {
    setMsg('');
    const data = {
      userId: user.uid,
      name: f.name,
      gender: f.gender || 'other',
      bio: f.bio,
      skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
      languages: f.languages.split(',').map((s) => s.trim()).filter(Boolean),
      experience: Number(f.experience),
      priceChat: Number(f.priceChat),
      priceCall: Number(f.priceCall),
      priceVideo: Number(f.priceVideo),
      discountPercent: Number(f.discountPercent),
    };
    if (exists) {
      await astrologerService.updateAstrologer(user.uid, data);
    } else {
      await setDoc(doc(db, 'astrologers', user.uid), {
        ...data, approved: false, status: 'offline',
        rating: 0, reviewsCount: 0, totalSessions: 0,
        responseRate: 100, earnings: 0,
        chat_enabled: false, call_enabled: false, video_enabled: false,
        createdAt: new Date(),
      });
      setExists(true);
    }
    setMsg('Profile saved. Pricing/discount are live; approval pending if new.');
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = ref(storage, `profileImages/${user.uid}/pending`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await astrologerService.updateAstrologer(user.uid, {
      pendingProfileImage: url, imageStatus: 'pending',
    });
    setMsg('Photo uploaded, under review (24h).');
  }

  async function requestPayout() {
    await payoutService.requestPayout(user.uid, Number(payout.amount),
      payout.bankDetails);
    setPayout({ amount: '', bankDetails: '' });
    setPayouts(await payoutService.getPayouts(user.uid));
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Profile</h1>
      {msg && (
        <div className="card mb-3 bg-success/10 text-success">{msg}</div>
      )}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,160px]">
          <Field label="Name">
            <input className="input" value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Gender">
            <select className="input" value={f.gender || 'male'}
              onChange={(e) => setF({ ...f, gender: e.target.value })}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Bio">
          <textarea className="input" rows={3} value={f.bio}
            onChange={(e) => setF({ ...f, bio: e.target.value })} />
        </Field>
        <Field label="Skills (comma separated)">
          <input className="input" value={f.skills}
            onChange={(e) => setF({ ...f, skills: e.target.value })} />
        </Field>
        <Field label="Languages (comma separated)">
          <input className="input" value={f.languages}
            onChange={(e) => setF({ ...f, languages: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Experience (yrs)">
            <input className="input" type="number" value={f.experience}
              onChange={(e) => setF({ ...f, experience: e.target.value })} />
          </Field>
          <Field label="Chat ₹/min">
            <input className="input" type="number" value={f.priceChat}
              onChange={(e) => setF({ ...f, priceChat: e.target.value })} />
          </Field>
          <Field label="Call ₹/min">
            <input className="input" type="number" value={f.priceCall}
              onChange={(e) => setF({ ...f, priceCall: e.target.value })} />
          </Field>
          <Field label="Video ₹/min">
            <input className="input" type="number" value={f.priceVideo}
              onChange={(e) => setF({ ...f, priceVideo: e.target.value })} />
          </Field>
        </div>
        <Field label="Discount %">
          <select className="input" value={f.discountPercent}
            onChange={(e) =>
              setF({ ...f, discountPercent: e.target.value })}>
            <option value={0}>No Discount</option>
            <option value={25}>25%</option>
            <option value={50}>50%</option>
            <option value={70}>70%</option>
          </select>
        </Field>
        <label className="btn-ghost inline-block cursor-pointer">
          Upload profile photo
          <input type="file" accept="image/*" hidden onChange={uploadPhoto} />
        </label>
        <button onClick={save} className="btn-primary w-full">
          Save Profile
        </button>
      </div>

      <KycAndBank user={user} />

      <p className="mt-4 text-center text-[11px] text-sub-text">
        Withdrawals moved to{' '}
        <a href="/astro-earnings" className="font-bold text-primary
          underline">Earnings & payouts</a> - request a payout there.
      </p>

      <button onClick={logout}
        className="mt-4 w-full rounded-card border border-danger py-3
          font-semibold text-danger">
        Log out
      </button>
      <div className="mt-3 text-center text-xs text-sub-text">
        App version {appVersionName('astro-web')}
      </div>
    </Layout>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-sm text-sub-text">{label}</label>
      {children}
    </div>
  );
}

// KYC + Bank panel - lives on astro-profile.js so the astrologer
// can self-serve the data the admin needs to release payouts.
// Bank fields are editable until KYC is approved; afterwards a
// support ticket is required to change them (admin gates the edit).
function KycAndBank({ user }) {
  const [astro, setAstro] = useState(null);
  const [bank, setBank] = useState({ accountHolder: '', bankName: '',
    accountNumber: '', ifsc: '', branch: '', upi: '' });
  const [kyc, setKyc] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      setAstro(a);
      setBank({ accountHolder: '', bankName: '', accountNumber: '',
        ifsc: '', branch: '', upi: '', ...(a?.bank || {}) });
      setKyc(a?.kyc || {});
    });
  }, [user]);

  const kycStatus = kyc.status || 'incomplete';
  const locked = kycStatus === 'approved';

  async function saveBank() {
    setBusy(true); setMsg('');
    try {
      await payoutService.updateBank(user.uid, bank, user.uid,
        'astrologer self-edit');
      setMsg('Bank details saved.');
    } catch (e) {
      setMsg(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  async function uploadDoc(field, file) {
    setMsg('');
    try {
      const r = ref(storage, `kyc/${user.uid}/${field}-${Date.now()}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      const next = { ...kyc, [field]: url,
        status: kyc.status === 'approved' ? 'approved' : 'pending' };
      await payoutService.setKyc(user.uid, next, user.uid);
      setKyc(next);
      setMsg(`${field} uploaded.`);
    } catch (e) {
      setMsg(String((e && e.message) || e));
    }
  }

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold">KYC verification</h2>
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold
            uppercase ${kycStatus === 'approved'
              ? 'bg-emerald-100 text-emerald-700'
              : kycStatus === 'pending'
                ? 'bg-amber-100 text-amber-800'
                : kycStatus === 'rejected'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-700'}`}>
            {kycStatus}
          </span>
          <span className="text-[11px] text-sub-text">
            {kycStatus === 'approved'
              ? 'You can request payouts.'
              : 'Upload documents below; admin reviews within 24h.'}
          </span>
        </div>
        {kyc.rejectionReason && (
          <div className="rounded-card bg-rose-50 p-2 text-xs
            text-rose-700">
            <b>Rejected:</b> {kyc.rejectionReason}
          </div>
        )}
        <KycDoc label="Aadhaar card" field="aadhaarUrl" k={kyc}
          onUpload={(f) => uploadDoc('aadhaarUrl', f)} />
        <KycDoc label="PAN card" field="panUrl" k={kyc}
          onUpload={(f) => uploadDoc('panUrl', f)} />
        <KycDoc label="Bank passbook / cancelled cheque" field="passbookUrl"
          k={kyc} onUpload={(f) => uploadDoc('passbookUrl', f)} />
        <KycDoc label="Selfie holding ID" field="selfieUrl" k={kyc}
          onUpload={(f) => uploadDoc('selfieUrl', f)} />
      </div>

      <h2 className="mb-2 mt-6 font-bold">
        Bank details
        {locked && (
          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5
            text-[10px] font-bold uppercase text-slate-700">
            Locked
          </span>
        )}
      </h2>
      <div className="card space-y-2">
        {locked && (
          <p className="rounded-card bg-bg-light/60 p-2 text-[11px]
            text-sub-text">
            Bank details are locked after KYC approval. Raise a
            support ticket to change them - the admin will verify and
            update.
          </p>
        )}
        {['accountHolder','bankName','accountNumber','ifsc','branch',
          'upi'].map((k) => (
          <Field key={k} label={({
            accountHolder: 'Account holder name',
            bankName: 'Bank name',
            accountNumber: 'Account number',
            ifsc: 'IFSC code',
            branch: 'Branch',
            upi: 'UPI (optional)',
          })[k]}>
            <input className="input" disabled={locked}
              value={bank[k] || ''}
              onChange={(e) => setBank({ ...bank, [k]: e.target.value })} />
          </Field>
        ))}
        {!locked && (
          <button onClick={saveBank} disabled={busy}
            className="btn-primary w-full">
            {busy ? 'Saving…' : 'Save bank details'}
          </button>
        )}
      </div>
      {msg && (
        <p className="mt-2 text-center text-[11px] text-sub-text">{msg}</p>
      )}
    </>
  );
}

function KycDoc({ label, field, k, onUpload }) {
  const url = k && k[field];
  return (
    <div className="flex items-center justify-between gap-2
      rounded-card bg-bg-light/40 p-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate text-[10px] text-sub-text">
          {url ? 'Uploaded - tap to replace' : 'Not uploaded yet'}
        </div>
      </div>
      <label className="cursor-pointer rounded-full bg-primary px-3
        py-1 text-[11px] font-bold text-white">
        {url ? 'Replace' : 'Upload'}
        <input type="file" accept="image/*,application/pdf" hidden
          onChange={(e) => e.target.files && e.target.files[0]
            && onUpload(e.target.files[0])} />
      </label>
    </div>
  );
}
