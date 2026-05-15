import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { userService, storage, authService } from '@astro/shared';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useI18n, LANGS } from '../lib/i18n';

export default function Profile() {
  const router = useRouter();
  const { user, profile, loading } = useRequireClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { t, lang, setLang } = useI18n();
  const [pw, setPw] = useState({ cur: '', next: '', conf: '' });
  const [pwMsg, setPwMsg] = useState('');

  async function changePw() {
    setPwMsg('');
    if (pw.next.length < 6) {
      setPwMsg('New password must be at least 6 characters.'); return;
    }
    if (pw.next !== pw.conf) { setPwMsg('Passwords do not match.'); return; }
    try {
      await authService.changePassword(pw.cur, pw.next);
      setPw({ cur: '', next: '', conf: '' });
      setPwMsg('Password changed.');
    } catch (e) {
      setPwMsg(e?.code === 'auth/wrong-password'
        ? 'Current password is incorrect.'
        : e?.code === 'auth/requires-recent-login'
          ? 'Please log out and log in again, then retry.'
          : 'Could not change password (Google accounts have no password).');
    }
  }

  useEffect(() => {
    if (profile) { setName(profile.name || ''); setPhone(profile.phone || ''); }
  }, [profile]);

  async function save() {
    setBusy(true); setMsg('');
    try {
      await userService.updateUser(user.uid, { name, phone });
      setMsg('Profile saved.');
    } finally { setBusy(false); }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const r = ref(storage, `profileImages/${user.uid}/avatar`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await userService.updateUser(user.uid, { profileImage: url });
      setMsg('Photo updated.');
    } finally { setBusy(false); }
  }

  async function replayTour() {
    await userService.updateUser(user.uid, { hasSeenTour: false });
    router.push('/dashboard');
  }

  if (loading || !profile) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Profile</h1>
      <div className="card space-y-3">
        <div className="flex items-center gap-4">
          <img src={profile.profileImage || '/avatar.png'}
            className="h-20 w-20 rounded-full object-cover bg-bg-light"
            alt="" />
          <label className="btn-ghost cursor-pointer">
            Upload photo
            <input type="file" accept="image/*" hidden
              onChange={uploadPhoto} />
          </label>
        </div>
        <div>
          <label className="text-sm text-sub-text">Name</label>
          <input className="input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-sub-text">Mobile number</label>
          <input className="input" value={phone} type="tel"
            placeholder="Add / change mobile number"
            onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="text-sm text-sub-text">Email</label>
          <input className="input bg-bg-gray"
            value={profile.email || ', '} readOnly />
        </div>
        <div>
          <label className="text-sm text-sub-text">User Code</label>
          <input className="input bg-bg-gray" value={profile.userCode || ''}
            readOnly />
        </div>
        {msg && <div className="text-success">{msg}</div>}
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <div className="card mt-3 space-y-2">
        <div className="font-semibold">Change password</div>
        {pwMsg && (
          <div className={`rounded-card p-2 text-sm ${
            pwMsg === 'Password changed.'
              ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
            {pwMsg}
          </div>
        )}
        <input className="input" type="password"
          placeholder="Current password" value={pw.cur}
          onChange={(e) => setPw({ ...pw, cur: e.target.value })} />
        <input className="input" type="password"
          placeholder="New password (min 6)" value={pw.next}
          onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <input className="input" type="password"
          placeholder="Confirm new password" value={pw.conf}
          onChange={(e) => setPw({ ...pw, conf: e.target.value })} />
        <button onClick={changePw} className="btn-ghost w-full">
          Update password
        </button>
      </div>

      <div className="card mt-3">
        <label className="text-sm text-sub-text">{t('profile.language')}</label>
        <select className="input mt-1" value={lang}
          onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>

      <div className="card mt-3">
        <div className="font-semibold">Refer &amp; Earn</div>
        <p className="mt-1 text-sm text-sub-text">
          Share your code, you and your friend both get wallet credit when
          they join.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded-card bg-bg-light px-3 py-2 font-bold">
            {profile.userCode}
          </code>
          <button
            onClick={() => {
              const link = `${window.location.origin}/signup?ref=${profile.userCode}`;
              navigator.clipboard?.writeText(link);
              setMsg('Referral link copied!');
            }}
            className="btn-ghost">
            Copy link
          </button>
        </div>
      </div>

      <div className="card mt-3 space-y-2">
        <button onClick={replayTour} className="btn-ghost w-full">
          View App Tour
        </button>
        <div className="flex justify-center gap-4 text-sm text-sub-text">
          <a href="/page/terms">Terms</a>
          <a href="/page/privacy">Privacy</a>
          <a href="/page/refund">Refund Policy</a>
        </div>
      </div>
    </Layout>
  );
}
