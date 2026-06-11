import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  astrologerService, payoutService, authService, db, storage,
  appVersionName,
} from '@astro/shared';
import {
  doc, setDoc, collection, query, where, getDocs,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const BLANK = {
  name: '', gender: 'male', bio: '', skills: '', languages: '',
  experience: 0,
  priceChat: 20, priceCall: 30, priceVideo: 40, discountPercent: 0,
};

const INDIAN_BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Canara Bank',
  'Union Bank of India',
  'IndusInd Bank',
  'Yes Bank',
  'IDFC FIRST Bank',
  'Federal Bank',
  'South Indian Bank',
  'Other',
];

const DOC_TYPES = [
  { value: '', label: '-- Select document type --' },
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'pan', label: 'PAN Card' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_licence', label: 'Driving Licence' },
];

function docNumberHint(docType) {
  switch (docType) {
    case 'aadhaar': return 'XXXX XXXX XXXX (12 digits)';
    case 'pan': return 'ABCDE1234F (10 chars)';
    case 'passport': return 'A1234567 (8 chars)';
    case 'voter_id': return 'ABC1234567 (10 chars)';
    case 'driving_licence': return 'As per state format';
    default: return '';
  }
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

async function isUsernameTaken(username, myUid) {
  const q = await getDocs(
    query(
      collection(db, 'astrologers'),
      where('username', '==', username.toLowerCase()),
    ),
  );
  return q.docs.some((d) => d.id !== myUid);
}

// Shared toast component - slides up from bottom, auto-dismisses after 3s
function SaveToast({ msg, kind, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      background: kind === 'ok' ? '#F0FDF4' : '#FFF8E7',
      border: `1.5px solid ${kind === 'ok' ? '#16a34a' : '#7F2020'}`,
      borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 13,
      color: kind === 'ok' ? '#15803d' : '#7F2020',
      boxShadow: '0 4px 20px rgba(0,0,0,.12)',
      whiteSpace: 'nowrap',
    }}>
      {kind === 'ok' ? '✓ ' : '! '}{msg}
    </div>
  );
}

export default function AstroProfile() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  async function logout() {
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/astro-login');
  }
  const [f, setF] = useState(BLANK);
  const [exists, setExists] = useState(false);
  const [toast, setToast] = useState(null); // { msg, kind }
  const [payout, setPayout] = useState({ amount: '', bankDetails: '' });
  const [payouts, setPayouts] = useState([]);
  const [currentUsername, setCurrentUsername] = useState(null);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      if (a) {
        setExists(true);
        setCurrentUsername(a.username || null);
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
    setToast(null);
    try {
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
      setToast({ msg: 'Profile saved successfully', kind: 'ok' });
    } catch (e) {
      setToast({ msg: String((e && e.message) || 'Save failed'), kind: 'err' });
    }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = ref(storage, `profileImages/${user.uid}/pending`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await astrologerService.updateAstrologer(user.uid, {
        pendingProfileImage: url, imageStatus: 'pending',
      });
      setToast({ msg: 'Photo uploaded, under review (24h)', kind: 'ok' });
    } catch (e) {
      setToast({ msg: String((e && e.message) || 'Upload failed'), kind: 'err' });
    }
  }

  async function requestPayout() {
    await payoutService.requestPayout(user.uid, Number(payout.amount),
      payout.bankDetails);
    setPayout({ amount: '', bankDetails: '' });
    setPayouts(await payoutService.getPayouts(user.uid));
  }

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Profile</h1>
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
          <Field label="Chat Rs/min">
            <input className="input" type="number" value={f.priceChat}
              onChange={(e) => setF({ ...f, priceChat: e.target.value })} />
          </Field>
          <Field label="Call Rs/min">
            <input className="input" type="number" value={f.priceCall}
              onChange={(e) => setF({ ...f, priceCall: e.target.value })} />
          </Field>
          <Field label="Video Rs/min">
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

      <UsernamePanel
        user={user}
        currentUsername={currentUsername}
        onSaved={(uname) => setCurrentUsername(uname)}
      />

      <KycAndBank user={user} />

      <p className="mt-4 text-center text-[11px] text-sub-text">
        Withdrawals moved to{' '}
        <a href="/astro-earnings" className="font-bold text-primary
          underline">Earnings &amp; payouts</a> - request a payout there.
      </p>

      <button onClick={logout}
        className="mt-4 w-full rounded-card border border-danger py-3
          font-semibold text-danger">
        Log out
      </button>
      <div className="mt-3 text-center text-xs text-sub-text">
        App version {appVersionName('astro-web')}
      </div>

      {toast && (
        <SaveToast
          msg={toast.msg}
          kind={toast.kind}
          onDone={() => setToast(null)}
        />
      )}
    </Layout>
  );
}

function UsernamePanel({ user, currentUsername, onSaved }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | checking | available | taken | invalid
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { msg, kind }
  const debounceRef = useRef(null);

  function handleChange(e) {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setInput(val);
    setToast(null);

    if (!val) { setStatus('idle'); return; }
    if (!USERNAME_RE.test(val)) { setStatus('invalid'); return; }

    setStatus('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const taken = await isUsernameTaken(val, user.uid);
        setStatus(taken ? 'taken' : 'available');
      } catch (_) {
        setStatus('idle');
      }
    }, 450);
  }

  async function saveUsername() {
    if (status !== 'available') return;
    setSaving(true);
    setToast(null);
    try {
      // Double-check uniqueness before writing
      const taken = await isUsernameTaken(input, user.uid);
      if (taken) { setStatus('taken'); setSaving(false); return; }
      await setDoc(
        doc(db, 'astrologers', user.uid),
        { username: input.toLowerCase() },
        { merge: true },
      );
      onSaved(input.toLowerCase());
      setToast({ msg: 'Username saved', kind: 'ok' });
      setInput('');
      setStatus('idle');
    } catch (e) {
      setToast({ msg: 'Error saving username. Please try again.', kind: 'err' });
    } finally {
      setSaving(false);
    }
  }

  const statusColor = {
    available: '#16a34a',
    taken: '#dc2626',
    invalid: '#b45309',
    checking: '#6b7280',
    idle: '#6b7280',
  }[status];

  const statusText = {
    available: 'Available',
    taken: 'Taken',
    invalid: 'Lowercase letters, numbers, underscores only (3-20 chars)',
    checking: 'Checking...',
    idle: '',
  }[status];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold">Username</h2>
      <div className="card space-y-3">
        {currentUsername ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-sub-text">Current username:</span>
              <span
                className="rounded-full px-3 py-0.5 text-sm font-bold"
                style={{
                  backgroundColor: '#FFF8E7',
                  color: '#7F2020',
                  border: '1px solid #D4A12A',
                }}
              >
                @{currentUsername}
              </span>
            </div>
            <div
              className="rounded-card p-2 text-[11px]"
              style={{
                backgroundColor: '#FFF8E7',
                borderColor: '#D4A12A',
                color: '#7F2020',
                border: '1px solid #D4A12A',
              }}
            >
              Username can only be changed via a support ticket.
            </div>
            <div className="text-[11px] text-sub-text">
              Public profile:{' '}
              <span className="font-mono font-semibold" style={{ color: '#7F2020' }}>
                astroseer.in/@{currentUsername}
              </span>
            </div>
          </>
        ) : (
          <>
            <div
              className="rounded-card p-2 text-[11px]"
              style={{
                backgroundColor: '#FFF8E7',
                border: '1px solid #D4A12A',
                color: '#7F2020',
              }}
            >
              Choose a unique username for your public profile. Once set, it can
              only be changed via a support ticket.
            </div>
            <Field label="Choose username">
              <div className="relative">
                <span
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm
                    font-semibold select-none"
                  style={{ color: '#D4A12A' }}
                >
                  @
                </span>
                <input
                  className="input pl-7"
                  placeholder="your_username"
                  value={input}
                  maxLength={20}
                  onChange={handleChange}
                />
              </div>
            </Field>
            {statusText && (
              <div className="text-xs font-semibold" style={{ color: statusColor }}>
                {statusText}
              </div>
            )}
            {status === 'available' && (
              <div className="text-[11px] text-sub-text">
                Public profile will be:{' '}
                <span className="font-mono font-semibold" style={{ color: '#7F2020' }}>
                  astroseer.in/@{input}
                </span>
              </div>
            )}
            {status === 'available' && (
              <button
                onClick={saveUsername}
                disabled={saving}
                className="btn-primary w-full"
                style={{ background: '#7F2020' }}
              >
                {saving ? 'Saving...' : 'Save username'}
              </button>
            )}
          </>
        )}
      </div>
      {toast && (
        <SaveToast
          msg={toast.msg}
          kind={toast.kind}
          onDone={() => setToast(null)}
        />
      )}
    </>
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
// KYC document detail fields (docName, docType, docNumber) remain
// editable even after approval so admin can correct them if needed.
// Only document photo uploads are locked after approval.
function KycAndBank({ user }) {
  const [astro, setAstro] = useState(null);
  const [bank, setBank] = useState({
    accountHolder: '', bankName: '', accountNumber: '', ifsc: '', branch: '',
  });
  const [bankNameOther, setBankNameOther] = useState('');
  const [kyc, setKyc] = useState({});
  const [errMsg, setErrMsg] = useState('');
  const [bankToast, setBankToast] = useState(null);   // { msg, kind }
  const [kycToast, setKycToast] = useState(null);     // { msg, kind }
  const [busy, setBusy] = useState(false);
  const [kycDetailsBusy, setKycDetailsBusy] = useState(false);
  const [ifscLoading, setIfscLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      setAstro(a);
      const savedBank = a?.bank || {};
      // Strip upi if it was previously stored - we no longer use it
      const { upi: _upi, ...bankWithoutUpi } = savedBank;
      const loaded = {
        accountHolder: '',
        bankName: '',
        accountNumber: '',
        ifsc: '',
        branch: '',
        ...bankWithoutUpi,
      };
      setBank(loaded);
      // If stored bankName is not in the dropdown list (and not empty), treat as Other
      if (
        loaded.bankName &&
        !INDIAN_BANKS.slice(0, -1).includes(loaded.bankName)
      ) {
        setBankNameOther(loaded.bankName);
        setBank((prev) => ({ ...prev, bankName: 'Other' }));
      }
      setKyc(a?.kyc || {});
    });
  }, [user]);

  const kycStatus = kyc.status || 'incomplete';
  const locked = kycStatus === 'approved';
  // Document photos are locked after approval; detail text fields remain editable
  const photosLocked = locked;

  // Resolve the final bankName to save: if user picked "Other", use the typed value
  function resolvedBankName() {
    if (bank.bankName === 'Other') return bankNameOther.trim();
    return bank.bankName;
  }

  async function lookupIfsc(code) {
    if (!code || code.length < 6) return;
    setIfscLoading(true);
    try {
      const res = await fetch(
        `https://ifsc.razorpay.com/${code.toUpperCase()}`
      );
      if (res.ok) {
        const data = await res.json();
        const fetchedBank = data.BANK || '';
        const fetchedBranch = data.BRANCH || '';
        // Try to match against known banks
        const matched = INDIAN_BANKS.slice(0, -1).find(
          (b) => b.toLowerCase() === fetchedBank.toLowerCase()
        );
        if (matched) {
          setBank((prev) => ({
            ...prev,
            bankName: matched,
            branch: fetchedBranch,
          }));
          setBankNameOther('');
        } else if (fetchedBank) {
          setBank((prev) => ({
            ...prev,
            bankName: 'Other',
            branch: fetchedBranch,
          }));
          setBankNameOther(fetchedBank);
        } else {
          setBank((prev) => ({ ...prev, branch: fetchedBranch }));
        }
      }
    } catch (_) {
      // Silently ignore lookup errors
    } finally {
      setIfscLoading(false);
    }
  }

  function handleIfscChange(e) {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setBank((prev) => ({ ...prev, ifsc: val }));
    if (val.length >= 6) {
      lookupIfsc(val);
    }
  }

  async function saveBank() {
    setBusy(true); setErrMsg('');
    try {
      const toSave = { ...bank, bankName: resolvedBankName() };
      await payoutService.updateBank(user.uid, toSave, user.uid,
        'astrologer self-edit');
      setBankToast({ msg: 'Bank details saved', kind: 'ok' });
    } catch (e) {
      setErrMsg(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  async function saveKycDetails() {
    setKycDetailsBusy(true); setErrMsg('');
    try {
      const patch = {
        docName: (kyc.docName || '').trim(),
        docType: kyc.docType || '',
        docNumber: (kyc.docNumber || '').trim(),
      };
      const next = { ...kyc, ...patch };
      await payoutService.setKyc(user.uid, next, user.uid);
      setKyc(next);
      setKycToast({ msg: 'Document details saved', kind: 'ok' });
    } catch (e) {
      setErrMsg(String((e && e.message) || e));
    } finally { setKycDetailsBusy(false); }
  }

  async function uploadDoc(field, file) {
    setErrMsg('');
    try {
      const r = ref(storage, `kyc/${user.uid}/${field}-${Date.now()}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      const next = { ...kyc, [field]: url,
        status: kyc.status === 'approved' ? 'approved' : 'pending' };
      await payoutService.setKyc(user.uid, next, user.uid);
      setKyc(next);
      setKycToast({ msg: `${field} uploaded`, kind: 'ok' });
    } catch (e) {
      setErrMsg(String((e && e.message) || e));
    }
  }

  const docNumberPlaceholder = docNumberHint(kyc.docType || '');

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

        {/* Informational note about document requirements */}
        <div
          className="rounded-card border p-2 text-[11px]"
          style={{
            backgroundColor: '#FFF8E7',
            borderColor: '#D4A12A',
            color: '#7F2020',
          }}
        >
          Your documents must clearly show your name, date of birth, and
          document number. All details must match your bank account records.
        </div>

        {/* Document detail fields - always editable (admin may correct after approval) */}
        <Field label="Name as per document">
          <input
            className="input"
            placeholder="Full name exactly as on your document"
            value={kyc.docName || ''}
            onChange={(e) => setKyc({ ...kyc, docName: e.target.value })}
          />
        </Field>

        <Field label="Document type">
          <select
            className="input"
            value={kyc.docType || ''}
            onChange={(e) =>
              setKyc({ ...kyc, docType: e.target.value, docNumber: '' })}
          >
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Document number">
          <input
            className="input"
            placeholder={docNumberPlaceholder || 'Enter document number'}
            value={kyc.docNumber || ''}
            onChange={(e) => setKyc({ ...kyc, docNumber: e.target.value })}
          />
          {docNumberPlaceholder && (
            <span className="mt-0.5 block text-[10px] text-sub-text">
              Format: {docNumberPlaceholder}
            </span>
          )}
        </Field>

        {/* Save KYC details button */}
        <button
          onClick={saveKycDetails}
          disabled={kycDetailsBusy}
          className="btn-primary w-full"
        >
          {kycDetailsBusy ? 'Saving...' : 'Save document details'}
        </button>

        {/* Document photo uploads - locked after approval */}
        <div className="border-t pt-3" style={{ borderColor: '#D4A12A33' }}>
          <p className="mb-2 text-[11px] text-sub-text">
            Document photos
            {photosLocked && (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-[10px]
                  font-bold uppercase"
                style={{ backgroundColor: '#FFF8E7', color: '#7F2020' }}
              >
                Locked after approval
              </span>
            )}
          </p>
          <div className="space-y-2">
            <KycDoc label="Aadhaar card" field="aadhaarUrl" k={kyc}
              locked={photosLocked}
              onUpload={(f) => uploadDoc('aadhaarUrl', f)} />
            <KycDoc label="PAN card" field="panUrl" k={kyc}
              locked={photosLocked}
              onUpload={(f) => uploadDoc('panUrl', f)} />
            <KycDoc label="Bank passbook / cancelled cheque" field="passbookUrl"
              k={kyc} locked={photosLocked}
              onUpload={(f) => uploadDoc('passbookUrl', f)} />
            <SelfieCaptureDoc label="Selfie holding ID" field="selfieUrl" k={kyc}
              locked={photosLocked}
              onUpload={(f) => uploadDoc('selfieUrl', f)} />
          </div>
        </div>
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

        {/* Informational note */}
        <div
          className="rounded-card border p-2 text-[11px]"
          style={{
            backgroundColor: '#FFF8E7',
            borderColor: '#D4A12A',
            color: '#7F2020',
          }}
        >
          Bank details must match your passbook or cancelled cheque.
          IFSC code can be found on your cheque leaf.
        </div>

        <Field label="Account holder name">
          <input
            className="input"
            disabled={locked}
            value={bank.accountHolder || ''}
            onChange={(e) =>
              setBank({ ...bank, accountHolder: e.target.value })}
          />
        </Field>

        <Field label="Bank name">
          <select
            className="input"
            disabled={locked}
            value={bank.bankName || ''}
            onChange={(e) => {
              setBank({ ...bank, bankName: e.target.value });
              if (e.target.value !== 'Other') setBankNameOther('');
            }}
          >
            <option value="">-- Select bank --</option>
            {INDIAN_BANKS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          {bank.bankName === 'Other' && !locked && (
            <input
              className="input mt-1"
              placeholder="Enter bank name"
              value={bankNameOther}
              onChange={(e) => setBankNameOther(e.target.value)}
            />
          )}
          {bank.bankName === 'Other' && locked && bankNameOther && (
            <input
              className="input mt-1"
              disabled
              value={bankNameOther}
            />
          )}
        </Field>

        <Field label="Account number">
          <input
            className="input"
            disabled={locked}
            value={bank.accountNumber || ''}
            onChange={(e) =>
              setBank({ ...bank, accountNumber: e.target.value })}
          />
        </Field>

        <Field label="IFSC code">
          <div className="relative">
            <input
              className="input pr-8"
              disabled={locked}
              value={bank.ifsc || ''}
              onChange={handleIfscChange}
              maxLength={11}
              placeholder="e.g. SBIN0001234"
            />
            {ifscLoading && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2
                text-[10px] text-sub-text">
                ...
              </span>
            )}
          </div>
        </Field>

        <Field label="Branch">
          <input
            className="input"
            disabled={locked}
            value={bank.branch || ''}
            onChange={(e) => setBank({ ...bank, branch: e.target.value })}
          />
        </Field>

        {!locked && (
          <button
            onClick={saveBank}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? 'Saving...' : 'Save bank details'}
          </button>
        )}
      </div>
      {errMsg && (
        <p className="mt-2 text-center text-[11px] text-sub-text">{errMsg}</p>
      )}

      {kycToast && (
        <SaveToast
          msg={kycToast.msg}
          kind={kycToast.kind}
          onDone={() => setKycToast(null)}
        />
      )}
      {bankToast && (
        <SaveToast
          msg={bankToast.msg}
          kind={bankToast.kind}
          onDone={() => setBankToast(null)}
        />
      )}
    </>
  );
}

function KycDoc({ label, field, k, locked, onUpload }) {
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
      {locked ? (
        <span
          className="rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ backgroundColor: '#FFF8E7', color: '#7F2020' }}
        >
          {url ? 'Uploaded' : 'Not uploaded'}
        </span>
      ) : (
        <label className="cursor-pointer rounded-full bg-primary px-3
          py-1 text-[11px] font-bold text-white">
          {url ? 'Replace' : 'Upload'}
          <input type="file" accept="image/*,application/pdf" hidden
            onChange={(e) => e.target.files && e.target.files[0]
              && onUpload(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

// Selfie upload with camera-first, silent file-picker fallback after 2 fails.
function SelfieCaptureDoc({ label, field, k, locked, onUpload }) {
  const url = k && k[field];
  const [selfieFails, setSelfieFails] = useState(0);
  const inputRef = useRef(null);

  // Use camera capture for first 2 attempts, then fall back to plain picker.
  const useCameraCapture = selfieFails < 2;

  function handleChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      // The picker opened but user cancelled or no file came through -
      // count as a fail to eventually switch to plain file picker.
      setSelfieFails((n) => n + 1);
      return;
    }
    onUpload(file);
    // Reset input so selecting the same file again triggers onChange next time.
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="flex items-center justify-between gap-2
      rounded-card bg-bg-light/40 p-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate text-[10px] text-sub-text">
          {url ? 'Uploaded - tap to replace' : 'Not uploaded yet'}
        </div>
      </div>
      {locked ? (
        <span
          className="rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ backgroundColor: '#FFF8E7', color: '#7F2020' }}
        >
          {url ? 'Uploaded' : 'Not uploaded'}
        </span>
      ) : (
        <label className="cursor-pointer rounded-full bg-primary px-3
          py-1 text-[11px] font-bold text-white">
          {url ? 'Replace' : 'Upload'}
          {useCameraCapture ? (
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="user"
              hidden
              onChange={handleChange}
            />
          ) : (
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleChange}
            />
          )}
        </label>
      )}
    </div>
  );
}
