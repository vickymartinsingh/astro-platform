import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  astrologerService, payoutService, authService, db, storage,
} from '@astro/shared';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const BLANK = {
  name: '', bio: '', skills: '', languages: '', experience: 0,
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
    });
    payoutService.getPayouts(user.uid).then(setPayouts);
  }, [user, profile]);

  async function save() {
    setMsg('');
    const data = {
      userId: user.uid,
      name: f.name,
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
        <Field label="Name">
          <input className="input" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
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

      <h2 className="mb-2 mt-6 font-bold">Request Withdrawal</h2>
      <div className="card space-y-3">
        <input className="input" placeholder="Amount ₹"
          type="number" value={payout.amount}
          onChange={(e) => setPayout({ ...payout, amount: e.target.value })} />
        <input className="input" placeholder="UPI ID / Bank details"
          value={payout.bankDetails}
          onChange={(e) =>
            setPayout({ ...payout, bankDetails: e.target.value })} />
        <button onClick={requestPayout} className="btn-primary w-full">
          Request Payout
        </button>
        {payouts.map((p) => (
          <div key={p.id} className="flex justify-between text-sm">
            <span>₹{p.amount}</span>
            <span className="capitalize text-sub-text">{p.status}</span>
          </div>
        ))}
      </div>

      <button onClick={logout}
        className="mt-4 w-full rounded-card border border-danger py-3
          font-semibold text-danger">
        Log out
      </button>
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
