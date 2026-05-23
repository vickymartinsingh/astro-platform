import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { userService, authService, ZODIAC } from '@astro/shared';
import Layout from '../components/Layout';
import Avatar from '../components/Avatar';
import ZodiacGlyph from '../components/ZodiacGlyph';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useI18n, LANGS } from '../lib/i18n';
import { useAppUpdate, startUpdate, APP_VERSION } from '../lib/appUpdate';
import { useSettings } from '../lib/useSettings';
import { confirmModal } from '../components/ConfirmModal';

// Profile page. Organised as a sequence of clearly-titled cards with
// matching subtitles and consistent spacing, instead of one giant block.
export default function Profile() {
  const router = useRouter();
  const { user, profile, loading } = useRequireClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
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
      setMsg('Saved.');
    } finally { setBusy(false); }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      await userService.uploadProfileImage(user.uid, file);
      setMsg('Photo updated.');
    } catch (err) {
      setMsg(err.message || 'Upload failed');
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
    const ok = await confirmModal({
      title: 'Log out?',
      message: 'You will need to sign in again to continue.',
      yes: 'Log out',
      no: 'Stay',
      danger: true,
    });
    if (!ok) return;
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/login');
  }

  async function deleteAccount() {
    const sure = await confirmModal({
      title: 'Delete your account?',
      message: 'Your account is deactivated immediately and all personal '
        + 'data is purged within 30 days. Transaction records required '
        + 'by law are kept for the legal period. This cannot be undone '
        + 'after 30 days.',
      yes: 'Delete account',
      no: 'Cancel',
      danger: true,
    });
    if (!sure) return;
    let reason = '';
    try {
      // eslint-disable-next-line no-alert
      reason = window.prompt(
        'Optional: tell us why (helps us improve, leave blank to skip):',
      ) || '';
    } catch (_) { /* ignore */ }
    try {
      await userService.requestAccountDeletion(user.uid, reason);
      try { await authService.logoutUser(); } catch (_) {}
      await confirmModal({
        title: 'Account deletion requested',
        message: 'Your account has been deactivated. We will purge your '
          + 'data within 30 days. A confirmation email follows.',
        yes: 'OK', no: 'Close',
      });
      router.replace('/account-deletion');
    } catch (e) {
      await confirmModal({
        title: 'Could not submit',
        message: 'Please email support@astroseer.in to delete your '
          + 'account.',
        yes: 'OK', no: 'Close',
      });
    }
  }

  if (loading || !profile) return <Layout><SkeletonList /></Layout>;

  const email = profile.email || '';
  const code = profile.userCode || '';

  return (
    <Layout>
      {/* HERO CARD: avatar + name + key identity facts */}
      <div className="card">
        <div className="flex flex-col items-center gap-3 text-center
          sm:flex-row sm:items-start sm:gap-5 sm:text-left">
          <div className="relative shrink-0">
            <Avatar profile={profile} size={84} />
            <label className="absolute -bottom-1 -right-1 cursor-pointer
              rounded-full border-2 border-white bg-primary p-2
              text-white shadow"
              title="Upload photo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0
                  0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <input type="file" accept="image/*" hidden
                onChange={uploadPhoto} />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-dark-text
              sm:text-2xl">
              {name || profile.name || 'My profile'}
            </h1>
            {email && (
              <div className="mt-0.5 truncate text-sm text-sub-text">
                {email}
              </div>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-1.5
              sm:justify-start">
              {code && (
                <span className="rounded-full bg-bg-light px-2.5 py-1
                  text-[11px] font-bold text-primary">
                  Code {code}
                </span>
              )}
              {profile.dob && (
                <span className="rounded-full bg-bg-light px-2.5 py-1
                  text-[11px] text-sub-text">
                  DOB {profile.dob}
                </span>
              )}
              {profile.zodiac && (
                <span className="rounded-full bg-bg-light px-2.5 py-1
                  text-[11px] text-sub-text">
                  {profile.zodiac}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setAvOpen((v) => !v)}
              className="mt-3 text-xs font-semibold text-primary">
              {avOpen ? 'Hide picture options' : 'Change picture'}
            </button>
          </div>
        </div>

        {/* Collapsible avatar picker keeps the hero clean */}
        {avOpen && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-full border
                border-gray-200 bg-white px-3 py-1.5 text-xs font-bold
                text-dark-text hover:bg-bg-light">
                {busy ? 'Working...' : 'Upload photo'}
                <input type="file" accept="image/*" hidden
                  onChange={uploadPhoto} />
              </label>
              <button onClick={() => setAvatar('auto')}
                className="rounded-full border border-gray-200 px-3 py-1.5
                  text-xs font-bold text-dark-text hover:bg-bg-light">
                My zodiac
              </button>
              <button onClick={() => setAvatar('none')}
                className="rounded-full border border-gray-200 px-3 py-1.5
                  text-xs text-sub-text hover:bg-bg-light">
                Remove
              </button>
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wider
              text-sub-text">Pick a zodiac avatar</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ZODIAC.map((z) => {
                const on = profile.avatarChoice === `sign:${z}`;
                return (
                  <button key={z} onClick={() => setAvatar(`sign:${z}`)}
                    title={z}
                    className={`flex h-10 w-10 items-center justify-center
                      rounded-full border ${on
                        ? 'border-primary bg-bg-light'
                        : 'border-gray-200'}`}>
                    <ZodiacGlyph sign={z}
                      className="h-5 w-5 text-gold" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* PERSONAL INFO */}
      <SectionCard title="Personal info"
        subtitle="Name and contact details used across the app.">
        <Field label="Name">
          <input className="input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Mobile number">
          <input className="input" value={phone} type="tel"
            placeholder="Add / change mobile number"
            onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input className="input bg-bg-gray" value={email} readOnly />
          </Field>
          <Field label="User code">
            <input className="input bg-bg-gray" value={code} readOnly />
          </Field>
        </div>
        {msg && (
          <div className="rounded-card bg-success/10 px-3 py-2 text-sm
            text-success">{msg}</div>
        )}
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? 'Saving…' : 'Save personal info'}
        </button>
      </SectionCard>

      {/* SECURITY */}
      <SectionCard title="Security"
        subtitle="Change your password. Google sign-in accounts manage
          their password with Google.">
        {pwMsg && (
          <div className={`rounded-card px-3 py-2 text-sm ${
            pwMsg === 'Password changed.'
              ? 'bg-success/10 text-success'
              : 'bg-danger/10 text-danger'}`}>
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
      </SectionCard>

      {/* PREFERENCES */}
      <SectionCard title="Preferences"
        subtitle="Language and display settings.">
        <Field label={t('profile.language')}>
          <select className="input" value={langSel} data-no-tr
            onChange={(e) => setLangSel(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </Field>
        {langMsg && (
          <div className="text-sm text-success">{langMsg}</div>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLang(langSel);
              setLangMsg(langSel === 'en'
                ? 'Language set to English.'
                : 'Language saved. Applying…');
            }}
            className="btn-primary flex-1">
            Save language
          </button>
          <button
            onClick={() => {
              setLangSel('en'); setLang('en');
              setLangMsg('Reset to default (English).');
            }}
            className="flex-1 rounded-card border border-gray-200
              py-3 font-semibold text-sub-text">
            Reset
          </button>
        </div>
      </SectionCard>

      {/* REFER & EARN */}
      {cfg.refer_enabled !== false && (
        <SectionCard title={cfg.refer_title || 'Refer & Earn'}
          subtitle={cfg.refer_desc
            || 'Share your code, you and your friend both get wallet '
              + 'credit when they join.'}>
          {(Number(cfg.refer_reward) > 0
            || Number(cfg.refer_friend_reward) > 0) && (
            <div className="rounded-card bg-primary/10 px-3 py-2 text-sm
              font-semibold text-primary">
              You get Rs {Number(cfg.refer_reward) || 0}
              {Number(cfg.refer_friend_reward) > 0
                ? `, your friend gets Rs ${Number(cfg.refer_friend_reward)}`
                : ''}.
            </div>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-card bg-bg-light px-3 py-2
              text-center font-bold tracking-wider">
              {code}
            </code>
            <button
              onClick={() => {
                const link = `${window.location.origin}/signup?ref=${code}`;
                navigator.clipboard?.writeText(link);
                setMsg('Referral link copied.');
              }}
              className="btn-ghost !min-h-0 px-4 py-2">
              Copy link
            </button>
          </div>
          {cfg.refer_terms && (
            <p className="whitespace-pre-line text-[11px] text-sub-text">
              {cfg.refer_terms}
            </p>
          )}
        </SectionCard>
      )}

      {/* APP */}
      <SectionCard title="App"
        subtitle="Version, app tour, and legal documents.">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">App version</div>
            <div className="text-xs text-sub-text">
              Installed: v{APP_VERSION}
              {upd.updateAvailable
                ? ` · latest v${upd.latestVersion}` : ''}
            </div>
          </div>
          {upd.updateAvailable ? (
            <button onClick={() => startUpdate(upd.updateUrl)}
              className="btn-primary !min-h-0 px-4 py-2 text-sm">
              Update
            </button>
          ) : (
            <span className="rounded-full bg-success/15 px-3 py-1.5
              text-[11px] font-bold text-success">
              Up to date
            </span>
          )}
        </div>
        <button onClick={replayTour} className="btn-ghost w-full">
          View app tour
        </button>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1
          text-sm text-sub-text">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/page/refund">Refund policy</Link>
          <Link href="/support">Help &amp; support</Link>
        </div>
      </SectionCard>

      {/* DANGER ZONE */}
      <div className="surface mt-3 border border-red-200 p-4">
        <div className="text-xs font-bold uppercase tracking-wider
          text-red-700">Danger zone</div>
        <p className="mt-1 text-[12px] text-sub-text">
          Log out of this device, or permanently delete your account.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button onClick={logout}
            className="flex-1 rounded-full border border-danger py-2.5
              text-sm font-bold text-danger hover:bg-danger/5">
            Log out
          </button>
          <button onClick={deleteAccount}
            className="flex-1 rounded-full bg-danger py-2.5 text-sm
              font-bold text-white hover:opacity-90">
            Delete my account
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-sub-text">
          <Link href="/account-deletion" className="underline">
            Read the account deletion policy
          </Link>
        </p>
      </div>
    </Layout>
  );
}

// Re-usable section card. Title + subtitle header followed by a vertical
// stack of fields / inputs. Keeps every section visually consistent.
function SectionCard({ title, subtitle, children }) {
  return (
    <div className="card mt-3 space-y-3">
      <div>
        <div className="text-sm font-bold text-dark-text">{title}</div>
        {subtitle && (
          <div className="mt-0.5 text-[12px] text-sub-text">{subtitle}</div>
        )}
      </div>
      <div className="space-y-3 border-t border-gray-100 pt-3">
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase
        tracking-wider text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
