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

// Confirm modal used before destructive or important saves
function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px',
    }}>
      <div style={{
        background: '#FFF8E7',
        borderRadius: 16,
        border: '1.5px solid #D4A12A',
        padding: '24px 20px',
        maxWidth: 380,
        width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#7F2020', marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: '#3d1a00', lineHeight: 1.6, marginBottom: 20 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: '1.5px solid #D4A12A', background: 'transparent',
              color: '#7F2020', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 8,
              border: 'none',
              background: danger ? '#7F2020' : '#D4A12A',
              color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            {confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Initials avatar used in multiple places
function InitialsAvatar({ name, photoUrl, size = 48 }) {
  const initials = (name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      border: '2px solid #D4A12A',
      background: '#7F2020',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt="profile"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span style={{
          color: '#FFF8E7', fontWeight: 700,
          fontSize: size > 64 ? Math.round(size * 0.35) : Math.round(size * 0.38),
          lineHeight: 1,
          textTransform: 'uppercase',
        }}>
          {initials}
        </span>
      )}
    </div>
  );
}

// Profile completion progress bar
function ProfileCompletion({ f, hasPhoto }) {
  const fields = [
    { label: 'Name', done: !!(f.name && f.name.trim()) },
    { label: 'Bio', done: !!(f.bio && f.bio.trim()) },
    { label: 'Skills', done: !!(f.skills && f.skills.trim()) },
    { label: 'Languages', done: !!(f.languages && f.languages.trim()) },
    { label: 'Experience', done: Number(f.experience) > 0 },
    { label: 'Photo', done: !!hasPhoto },
  ];
  const done = fields.filter((x) => x.done).length;
  const pct = Math.round((done / fields.length) * 100);
  const color = pct === 100 ? '#16a34a' : pct >= 60 ? '#D4A12A' : '#7F2020';

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: '#7F2020', fontWeight: 600, marginBottom: 4,
      }}>
        <span>Profile completion</span>
        <span>{pct}%</span>
      </div>
      <div style={{
        height: 6, background: '#e5d9c0', borderRadius: 99, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: color,
          borderRadius: 99, transition: 'width 0.4s',
        }} />
      </div>
      {pct < 100 && (
        <div style={{ fontSize: 10, color: '#b45309', marginTop: 3 }}>
          Missing: {fields.filter((x) => !x.done).map((x) => x.label).join(', ')}
        </div>
      )}
    </div>
  );
}

export default function AstroProfile() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  const photoInputRef = useRef(null);

  async function logout() {
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/astro-login');
  }

  const [f, setF] = useState(BLANK);
  const [astroDoc, setAstroDoc] = useState(null);
  const [exists, setExists] = useState(false);
  const [toast, setToast] = useState(null);
  const [payout, setPayout] = useState({ amount: '', bankDetails: '' });
  const [payouts, setPayouts] = useState([]);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      if (a) {
        setExists(true);
        setAstroDoc(a);
        setCurrentUsername(a.username || null);
        setProfilePhotoUrl(a.profileImage || a.pendingProfileImage || null);
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

  // Derived lock states
  const kycStatus = astroDoc?.kyc?.status || astroDoc?.kycStatus || 'incomplete';
  const profileKycLocked = kycStatus === 'approved' || kycStatus === 'verified';
  const nameGenderLocked = astroDoc?.status === 'approved' || profileKycLocked;

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

  async function uploadPhoto(file) {
    if (!file) return;
    setPhotoUploading(true);
    try {
      const r = ref(storage, `profileImages/${user.uid}/pending`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await astrologerService.updateAstrologer(user.uid, {
        pendingProfileImage: url, imageStatus: 'pending',
      });
      setProfilePhotoUrl(url);
      setToast({ msg: 'Photo uploaded, under review (24h)', kind: 'ok' });
    } catch (e) {
      setToast({ msg: String((e && e.message) || 'Upload failed'), kind: 'err' });
    } finally {
      setPhotoUploading(false);
    }
  }

  async function removePhoto() {
    try {
      await astrologerService.updateAstrologer(user.uid, {
        pendingProfileImage: null, profileImage: null, imageStatus: null,
      });
      setProfilePhotoUrl(null);
      setToast({ msg: 'Photo removed', kind: 'ok' });
    } catch (e) {
      setToast({ msg: String((e && e.message) || 'Remove failed'), kind: 'err' });
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
      {/* Page header with small avatar identifier */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
      }}>
        <InitialsAvatar name={f.name} photoUrl={profilePhotoUrl} size={48} />
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#7F2020' }}>
            {f.name || 'My Profile'}
          </h1>
          {profileKycLocked && (
            <span style={{
              fontSize: 10, fontWeight: 700, background: '#FFF8E7',
              color: '#7F2020', border: '1px solid #D4A12A',
              borderRadius: 99, padding: '1px 8px', textTransform: 'uppercase',
            }}>
              KYC Approved
            </span>
          )}
        </div>
      </div>

      {/* Profile photo card */}
      <div className="card" style={{ marginBottom: 12 }}>
        <ProfileCompletion f={f} hasPhoto={!!profilePhotoUrl} />
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 10, paddingTop: 12,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#7F2020' }}>
            {f.name || 'Your Name'}
          </div>
          <InitialsAvatar name={f.name} photoUrl={profilePhotoUrl} size={100} />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadPhoto(file);
            }}
          />
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={photoUploading}
            style={{
              background: '#D4A12A', color: '#fff', fontWeight: 700,
              fontSize: 13, border: 'none', borderRadius: 8,
              padding: '8px 20px', cursor: 'pointer',
              opacity: photoUploading ? 0.6 : 1,
            }}
          >
            {photoUploading ? 'Uploading...' : 'Change Photo'}
          </button>
          {profilePhotoUrl && (
            <button
              onClick={removePhoto}
              style={{
                background: 'none', border: 'none', color: '#7F2020',
                fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                padding: 0,
              }}
            >
              Remove Photo
            </button>
          )}
          <div style={{ fontSize: 10, color: '#b45309', textAlign: 'center' }}>
            Photo uploaded as pending - reviewed within 24h.
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        {profileKycLocked && (
          <div style={{
            background: '#FFF8E7', border: '1px solid #D4A12A',
            borderRadius: 8, padding: '8px 12px',
            fontSize: 12, color: '#7F2020', fontWeight: 600,
          }}>
            Your profile is locked after KYC approval. Raise a support ticket to request changes.
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,160px]">
          <Field label="Name">
            {nameGenderLocked ? (
              <>
                <input
                  className="input"
                  value={f.name}
                  readOnly
                  disabled
                  autoCapitalize="words"
                  style={{ textTransform: 'capitalize', cursor: 'not-allowed', opacity: 0.7 }}
                />
                <div style={{ fontSize: 10, color: '#b45309', marginTop: 2 }}>
                  Name and gender can only be changed via a support ticket.
                </div>
              </>
            ) : (
              <input
                className="input"
                value={f.name}
                autoCapitalize="words"
                style={{ textTransform: 'capitalize' }}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Gender">
            <select
              className="input"
              value={f.gender || 'male'}
              disabled={nameGenderLocked}
              style={nameGenderLocked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
              onChange={(e) => setF({ ...f, gender: e.target.value })}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <Field label="Bio">
          <textarea
            className="input"
            rows={3}
            value={f.bio}
            disabled={profileKycLocked}
            autoCapitalize="sentences"
            style={profileKycLocked
              ? { textTransform: 'capitalize', cursor: 'not-allowed', opacity: 0.7 }
              : { textTransform: 'capitalize' }
            }
            onChange={(e) => setF({ ...f, bio: e.target.value })}
          />
        </Field>

        <Field label="Skills (comma separated)">
          <input
            className="input"
            value={f.skills}
            disabled={profileKycLocked}
            autoCapitalize="words"
            style={profileKycLocked
              ? { textTransform: 'capitalize', cursor: 'not-allowed', opacity: 0.7 }
              : { textTransform: 'capitalize' }
            }
            onChange={(e) => setF({ ...f, skills: e.target.value })}
          />
        </Field>

        <Field label="Languages (comma separated)">
          <input
            className="input"
            value={f.languages}
            disabled={profileKycLocked}
            autoCapitalize="words"
            style={profileKycLocked
              ? { textTransform: 'capitalize', cursor: 'not-allowed', opacity: 0.7 }
              : { textTransform: 'capitalize' }
            }
            onChange={(e) => setF({ ...f, languages: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Field label="Experience (yrs)">
            <input
              className="input"
              type="number"
              value={f.experience}
              disabled={profileKycLocked}
              style={profileKycLocked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
              onChange={(e) => setF({ ...f, experience: e.target.value })}
            />
          </Field>
          <Field label="Chat Rs/min">
            <input
              className="input"
              type="number"
              value={f.priceChat}
              disabled={profileKycLocked}
              style={profileKycLocked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
              onChange={(e) => setF({ ...f, priceChat: e.target.value })}
            />
          </Field>
          <Field label="Call Rs/min">
            <input
              className="input"
              type="number"
              value={f.priceCall}
              disabled={profileKycLocked}
              style={profileKycLocked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
              onChange={(e) => setF({ ...f, priceCall: e.target.value })}
            />
          </Field>
          <Field label="Video Rs/min">
            <input
              className="input"
              type="number"
              value={f.priceVideo}
              disabled={profileKycLocked}
              style={profileKycLocked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
              onChange={(e) => setF({ ...f, priceVideo: e.target.value })}
            />
          </Field>
        </div>

        {/* Discount is always editable, even when KYC locked */}
        <Field label="Discount %">
          <select
            className="input"
            value={f.discountPercent}
            onChange={(e) => setF({ ...f, discountPercent: e.target.value })}
          >
            <option value={0}>No Discount</option>
            <option value={25}>25%</option>
            <option value={50}>50%</option>
            <option value={70}>70%</option>
          </select>
        </Field>

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
  const [toast, setToast] = useState(null);
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

// KYC + Bank panel
function KycAndBank({ user }) {
  const [astro, setAstro] = useState(null);
  const [bank, setBank] = useState({
    accountHolder: '', bankName: '', accountNumber: '', ifsc: '', branch: '',
  });
  const [bankNameOther, setBankNameOther] = useState('');
  const [kyc, setKyc] = useState({});
  const [errMsg, setErrMsg] = useState('');
  const [bankToast, setBankToast] = useState(null);
  const [kycToast, setKycToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kycDetailsBusy, setKycDetailsBusy] = useState(false);
  const [ifscLoading, setIfscLoading] = useState(false);
  const [bankConfirm, setBankConfirm] = useState(false);

  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      setAstro(a);
      const savedBank = a?.bank || {};
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
  // Also check top-level kycStatus on astro doc
  const effectiveKycStatus = astro?.kycStatus || kycStatus;
  const locked = effectiveKycStatus === 'approved' || effectiveKycStatus === 'verified'
    || kycStatus === 'approved' || kycStatus === 'verified';
  const photosLocked = locked;

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

  // Show confirm modal before actually saving bank
  function handleSaveBankClick() {
    setBankConfirm(true);
  }

  async function doSaveBank() {
    setBankConfirm(false);
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

  // Build confirm modal message
  const acctLast4 = (bank.accountNumber || '').replace(/\s/g, '').slice(-4);
  const confirmBankMsg = `Please verify: Account Holder: ${bank.accountHolder || '-'}, Bank: ${resolvedBankName() || '-'}, Account: ...${acctLast4 || '????'}. Incorrect details will cause payout failures.`;

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold">KYC verification</h2>
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold
            uppercase ${kycStatus === 'approved' || kycStatus === 'verified'
              ? 'bg-emerald-100 text-emerald-700'
              : kycStatus === 'pending'
                ? 'bg-amber-100 text-amber-800'
                : kycStatus === 'rejected'
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-slate-100 text-slate-700'}`}>
            {kycStatus}
          </span>
          <span className="text-[11px] text-sub-text">
            {kycStatus === 'approved' || kycStatus === 'verified'
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

        <Field label="Name as per document">
          <input
            className="input"
            placeholder="Full name exactly as on your document"
            value={kyc.docName || ''}
            autoCapitalize="words"
            style={{ textTransform: 'capitalize' }}
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
            style={{ textTransform: 'uppercase' }}
            onChange={(e) => setKyc({ ...kyc, docNumber: e.target.value })}
          />
          {docNumberPlaceholder && (
            <span className="mt-0.5 block text-[10px] text-sub-text">
              Format: {docNumberPlaceholder}
            </span>
          )}
        </Field>

        <button
          onClick={saveKycDetails}
          disabled={kycDetailsBusy}
          className="btn-primary w-full"
        >
          {kycDetailsBusy ? 'Saving...' : 'Save document details'}
        </button>

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

        {/* Field order: Account Holder, IFSC (triggers autofill), Bank Name, Account Number */}
        <Field label="Account holder name">
          <input
            className="input"
            disabled={locked}
            value={bank.accountHolder || ''}
            autoCapitalize="words"
            style={locked
              ? { textTransform: 'capitalize', cursor: 'not-allowed', opacity: 0.7 }
              : { textTransform: 'capitalize' }
            }
            onChange={(e) =>
              setBank({ ...bank, accountHolder: e.target.value })}
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
              style={locked
                ? { textTransform: 'uppercase', cursor: 'not-allowed', opacity: 0.7 }
                : { textTransform: 'uppercase' }
              }
            />
            {ifscLoading && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2
                text-[10px] text-sub-text">
                ...
              </span>
            )}
          </div>
        </Field>

        <Field label="Bank name">
          <select
            className="input"
            disabled={locked}
            value={bank.bankName || ''}
            style={locked ? { cursor: 'not-allowed', opacity: 0.7 } : {}}
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
              autoCapitalize="words"
              style={{ textTransform: 'capitalize' }}
              onChange={(e) => setBankNameOther(e.target.value)}
            />
          )}
          {bank.bankName === 'Other' && locked && bankNameOther && (
            <input
              className="input mt-1"
              disabled
              value={bankNameOther}
              style={{ textTransform: 'capitalize', opacity: 0.7 }}
            />
          )}
        </Field>

        <Field label="Account number">
          <input
            className="input"
            disabled={locked}
            value={bank.accountNumber || ''}
            style={locked
              ? { textTransform: 'uppercase', cursor: 'not-allowed', opacity: 0.7 }
              : { textTransform: 'uppercase' }
            }
            onChange={(e) =>
              setBank({ ...bank, accountNumber: e.target.value })}
          />
        </Field>

        {!locked && (
          <button
            onClick={handleSaveBankClick}
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

      {bankConfirm && (
        <ConfirmModal
          title="Confirm Bank Account Details"
          message={confirmBankMsg}
          confirmLabel="Yes, Save"
          danger={false}
          onConfirm={doSaveBank}
          onCancel={() => setBankConfirm(false)}
        />
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

  const useCameraCapture = selfieFails < 2;

  function handleChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      setSelfieFails((n) => n + 1);
      return;
    }
    onUpload(file);
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
