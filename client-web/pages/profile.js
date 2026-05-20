import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { userService, authService, ZODIAC } from '@astro/shared';
import Layout from '../components/Layout';
import Avatar from '../components/Avatar';
import ZodiacGlyph from '../components/ZodiacGlyph';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useI18n, LANGS } from '../lib/i18n';
import { useAppUpdate, startUpdate, APP_VERSION } from '../lib/appUpdate';
import { useSettings } from '../lib/useSettings';

export default function Profile() {
  const router = useRouter();
  const { user, profile, loading } = useRequireClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { t, lang, setLang } = useI18n();
  const [langSel, setLangSel] = useState(lang);
  const [langMsg, setLangMsg] = useState('');
  useEffect(() => { setLangSel(lang); }, [lang]);
  const upd = useAppUpdate();
  const { cfg } = useSettings();
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

  // Stored as a downscaled data URL (no Storage/CORS dependency).
  function fileToDataUrl(file, maxW) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('could not read file'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('invalid image'));
        img.onload = () => {
          const sc = Math.min(1, maxW / (img.width || maxW));
          const w = Math.max(1, Math.round((img.width || maxW) * sc));
          const h = Math.max(1, Math.round((img.height || maxW) * sc));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const url = await fileToDataUrl(file, 256);
      if (url.length > 850000) {
        setMsg('Image too large - pick a smaller photo.');
        return;
      }
      await userService.updateUser(user.uid,
        { profileImage: url, avatarChoice: 'photo' });
      setMsg('Photo updated.');
    } catch (_) {
      setMsg('Could not update photo.');
    } finally { setBusy(false); }
  }

  async function setAvatar(choice) {
    setBusy(true); setMsg('');
    try {
      await userService.updateUser(user.uid, { avatarChoice: choice });
      setMsg('Profile picture updated.');
    } finally { setBusy(false); }
  }

  async function replayTour() {
    await userService.updateUser(user.uid, { hasSeenTour: false });
    router.push('/dashboard');
  }

  async function logout() {
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/login');
  }

  if (loading || !profile) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Profile</h1>
      <div className="card space-y-3">
        <div className="flex items-center gap-4">
          <Avatar profile={profile} size={80} />
          <div className="flex flex-wrap gap-2">
            <label className="btn-ghost cursor-pointer !min-h-0 px-3
              py-2 text-sm">
              {busy ? 'Working...' : 'Upload photo'}
              <input type="file" accept="image/*" hidden
                onChange={uploadPhoto} />
            </label>
            <button onClick={() => setAvatar('auto')}
              className="rounded-card border border-gray-200 px-3 py-2
                text-sm">My zodiac</button>
            <button onClick={() => setAvatar('none')}
              className="rounded-card border border-gray-200 px-3 py-2
                text-sm text-sub-text">Remove</button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-sub-text">
            Or pick a zodiac avatar
          </div>
          <div className="flex flex-wrap gap-2">
            {ZODIAC.map((z) => {
              const on = profile.avatarChoice === `sign:${z}`;
              return (
                <button key={z} onClick={() => setAvatar(`sign:${z}`)}
                  title={z}
                  className={`flex h-11 w-11 items-center justify-center
                    rounded-full border ${on
                      ? 'border-primary bg-bg-light'
                      : 'border-gray-200'}`}>
                  <ZodiacGlyph sign={z}
                    className="h-6 w-6 text-gold" />
                </button>
              );
            })}
          </div>
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
        <select className="input mt-1" value={langSel} data-no-tr
          onChange={(e) => setLangSel(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        {langMsg && (
          <div className="mt-2 text-sm text-success">{langMsg}</div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              setLang(langSel);
              setLangMsg(langSel === 'en'
                ? 'Language set to English.'
                : 'Language saved. Applying…');
            }}
            className="btn-primary flex-1">
            Save Language
          </button>
          <button
            onClick={() => {
              setLangSel('en'); setLang('en');
              setLangMsg('Reset to default (English).');
            }}
            className="flex-1 rounded-card border border-gray-200
              py-3 font-semibold text-sub-text">
            Reset to Default
          </button>
        </div>
      </div>

      {cfg.refer_enabled !== false && (
      <div className="card mt-3">
        <div className="font-semibold">
          {cfg.refer_title || 'Refer & Earn'}
        </div>
        <p className="mt-1 text-sm text-sub-text">
          {cfg.refer_desc
            || 'Share your code, you and your friend both get wallet '
              + 'credit when they join.'}
        </p>
        {(Number(cfg.refer_reward) > 0
          || Number(cfg.refer_friend_reward) > 0) && (
          <p className="mt-1 text-sm font-semibold text-primary">
            You get Rs {Number(cfg.refer_reward) || 0}
            {Number(cfg.refer_friend_reward) > 0
              ? `, your friend gets Rs ${Number(cfg.refer_friend_reward)}`
              : ''}.
          </p>
        )}
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
        {cfg.refer_terms && (
          <p className="mt-2 text-xs text-sub-text whitespace-pre-line">
            {cfg.refer_terms}
          </p>
        )}
      </div>
      )}

      <div className="card mt-3 space-y-2">
        <button onClick={replayTour} className="btn-ghost w-full">
          View App Tour
        </button>
        <div className="flex justify-center gap-4 text-sm text-sub-text">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/page/refund">Refund Policy</a>
        </div>
      </div>

      <div className="card mt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">App version</div>
            <div className="text-xs text-sub-text">
              Installed: v{APP_VERSION}
              {upd.updateAvailable
                ? ` - latest v${upd.latestVersion}` : ''}
            </div>
          </div>
          {upd.updateAvailable ? (
            <button onClick={() => startUpdate(upd.updateUrl)}
              className="btn-primary !min-h-0 px-4 py-2 text-sm">
              Update
            </button>
          ) : (
            <span className="rounded-full bg-success/15 px-3 py-1.5
              text-xs font-semibold text-success">
              App is up to date
            </span>
          )}
        </div>
      </div>

      <button onClick={logout}
        className="mt-3 w-full rounded-card border border-danger
          py-3 font-semibold text-danger">
        Log out
      </button>
    </Layout>
  );
}
