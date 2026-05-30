import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { userService, authService, ZODIAC,
  kundliService } from '@astro/shared';
import Layout from '../components/Layout';
import Avatar from '../components/Avatar';
import ZodiacGlyph from '../components/ZodiacGlyph';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useI18n, LANGS } from '../lib/i18n';
import { useAppUpdate, startUpdate, APP_VERSION } from '../lib/appUpdate';
import { useSettings } from '../lib/useSettings';
import { confirmModal } from '../components/ConfirmModal';

// Customer profile - dashboard-style, like Instagram / Facebook. The
// hero shows who you are. Below it are CLICKABLE rows ("Account info",
// "Change password", "Language", "Refer & Earn", "App tour", "Legal",
// "App version") that each open the matching editor inline. The danger
// zone is at the bottom with smaller, de-emphasised Delete-account link.
const VIEWS = {
  HOME: '', INFO: 'info', PASSWORD: 'password', LANG: 'language',
  REFER: 'refer', LEGAL: 'legal', VERSION: 'version',
  ORDERS: 'orders',
};

export default function Profile() {
  const router = useRouter();
  const { user, profile, loading } = useRequireClient();
  // Account info row is OPEN by default - so users see their name /
  // gender / mobile / email immediately instead of having to click.
  const [view, setView] = useState(VIEWS.INFO);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
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

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setPhone(profile.phone || '');
      setGender(profile.gender || '');
    }
  }, [profile]);

  // Order history (kundli reports + paid reports). Lazy-fetched the
  // first time the row is opened, then cached on state.
  const [orders, setOrders] = useState(null);
  const [ordersBusy, setOrdersBusy] = useState(false);
  useEffect(() => {
    if (view !== VIEWS.ORDERS || !user || orders != null) return;
    setOrdersBusy(true);
    kundliService.listOrders(user.uid)
      .then((rows) => setOrders(Array.isArray(rows) ? rows : []))
      .catch(() => setOrders([]))
      .finally(() => setOrdersBusy(false));
  }, [view, user, orders]);

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

  async function saveInfo() {
    setBusy(true); setMsg('');
    try {
      await userService.updateUser(user.uid, { name, phone, gender });
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
      title: 'Log out?', message: 'You will need to sign in again.',
      yes: 'Log out', no: 'Stay', danger: true,
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
        + 'by law are kept for the legal period. This cannot be undone.',
      yes: 'Delete account', no: 'Cancel', danger: true,
    });
    if (!sure) return;
    try {
      await userService.requestAccountDeletion(user.uid, '');
      try { await authService.logoutUser(); } catch (_) {}
      router.replace('/account-deletion');
    } catch (_) {
      await confirmModal({ title: 'Could not submit',
        message: 'Please email support@astroseer.in to delete your account.',
        yes: 'OK', no: 'Close' });
    }
  }

  if (loading || !profile) return <Layout><SkeletonList /></Layout>;

  const email = profile.email || '';
  const code = profile.userCode || '';

  return (
    <Layout>
      {/* HERO */}
      <div className="card">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <Avatar profile={profile} size={64} />
            <label className="absolute -bottom-1 -right-1 cursor-pointer
              rounded-full border-2 border-white bg-primary p-1.5
              text-white shadow" title="Upload photo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
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
            <div className="truncate text-lg font-bold text-dark-text">
              {name || profile.name || 'My profile'}
            </div>
            {email && (
              <div className="truncate text-[12px] text-sub-text">
                {email}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {code && (
                <span className="rounded-full bg-bg-light px-2 py-0.5
                  text-[10px] font-bold text-primary">Code {code}</span>
              )}
              {profile.zodiac && (
                <span className="rounded-full bg-bg-light px-2 py-0.5
                  text-[10px] text-sub-text">{profile.zodiac}</span>
              )}
              {gender && (
                <span className="rounded-full bg-bg-light px-2 py-0.5
                  text-[10px] capitalize text-sub-text">{gender}</span>
              )}
            </div>
          </div>
          <button onClick={() => setAvOpen((v) => !v)}
            className="rounded-full bg-bg-light px-3 py-1.5 text-xs
              font-bold text-primary">
            {avOpen ? 'Done' : 'Edit'}
          </button>
        </div>
        {avOpen && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <div className="text-[11px] font-bold uppercase tracking-wider
              text-sub-text">Pick a zodiac avatar</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ZODIAC.map((z) => {
                const on = profile.avatarChoice === `sign:${z}`;
                return (
                  <button key={z} onClick={() => setAvatar(`sign:${z}`)}
                    title={z}
                    className={`flex h-9 w-9 items-center justify-center
                      rounded-full border ${on
                        ? 'border-primary bg-bg-light'
                        : 'border-gray-200'}`}>
                    <ZodiacGlyph sign={z} className="h-5 w-5 text-gold" />
                  </button>
                );
              })}
              <button onClick={() => setAvatar('auto')}
                className="rounded-full border border-gray-200 px-3
                  text-xs font-bold">Use zodiac</button>
              <button onClick={() => setAvatar('none')}
                className="rounded-full border border-gray-200 px-3
                  text-xs text-sub-text">Remove</button>
            </div>
          </div>
        )}
      </div>

      {/* DASHBOARD: clickable rows that expand inline */}
      <div className="card mt-3 divide-y divide-gray-100 p-0">
        {/* Orders row - kundli + paid reports the customer has bought.
            Inline list with direct Download links, plus a deep link to
            the full /orders page. Added per user request: "order
            information should show in the profile as well of the
            customer". */}
        <Row open={view === VIEWS.ORDERS}
          onClick={() => setView(view === VIEWS.ORDERS
            ? VIEWS.HOME : VIEWS.ORDERS)}
          icon="📦" label="My orders"
          sub={orders == null
            ? 'Kundli PDFs and premium reports you have purchased'
            : `${orders.length} order${orders.length === 1 ? '' : 's'}`}>
          <div className="space-y-2">
            {ordersBusy && (
              <div className="text-xs text-sub-text">
                Loading orders...
              </div>
            )}
            {!ordersBusy && orders && orders.length === 0 && (
              <div className="rounded-card bg-bg-light px-3 py-3
                text-xs text-sub-text">
                You have not placed any kundli or premium report
                orders yet. Generate a free kundli or browse premium
                reports from{' '}
                <Link href="/kundli"
                  className="font-bold text-primary underline">
                  the Kundli page
                </Link>.
              </div>
            )}
            {!ordersBusy && orders && orders.length > 0 && (
              <>
                {orders.slice(0, 10).map((o) => {
                  const isFree = !o.amount || o.amount === 0;
                  const ready = o.status === 'ready' && (o.pdfUrl
                    || o.pdfBase64);
                  const realUrl = o.pdfBase64
                    ? `data:application/pdf;base64,${o.pdfBase64}`
                    : o.pdfUrl;
                  const when = o.deliveredAt && o.deliveredAt.toDate
                    ? o.deliveredAt.toDate()
                    : (o.paidAt && o.paidAt.toDate
                      ? o.paidAt.toDate() : null);
                  return (
                    <div key={o.id} className="rounded-card border
                      border-gray-100 bg-white px-3 py-2">
                      <div className="flex items-start justify-between
                        gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]
                            font-semibold text-dark-text">
                            {o.kind === 'forecast12'
                              ? '12-Month Vedic Forecast'
                              : o.kind === 'careerFinance'
                                ? 'Career and Finance Deep Dive'
                                : o.kind === 'lifetime'
                                  ? 'Lifetime Vedic Report'
                                  : 'Free Vedic Kundli PDF'}
                          </div>
                          <div className="mt-0.5 text-[11px]
                            text-sub-text">
                            {o.profileName ? `${o.profileName} · ` : ''}
                            {when ? when.toLocaleDateString() : ''}
                            {!isFree && ` · ₹${o.amount}`}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2
                          py-0.5 text-[10px] font-bold ${ready
                            ? 'bg-success/15 text-success'
                            : 'bg-warning/15 text-warning'}`}>
                          {ready ? 'Ready'
                            : (o.status || 'processing')}
                        </span>
                      </div>
                      {ready && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button"
                            onClick={() => kundliService
                              .downloadPdfFromUrl(realUrl,
                                o.pdfName || 'AstroSeer-Kundli.pdf')}
                            className="rounded-full bg-primary px-3
                              py-1 text-[11px] font-bold text-white">
                            Download PDF
                          </button>
                          <Link href="/orders"
                            className="rounded-full border
                              border-primary px-3 py-1 text-[11px]
                              font-bold text-primary">
                            View in Orders
                          </Link>
                        </div>
                      )}
                    </div>
                  );
                })}
                {orders.length > 10 && (
                  <Link href="/orders"
                    className="block rounded-card bg-bg-light px-3
                      py-2 text-center text-xs font-semibold
                      text-primary">
                    View all {orders.length} orders
                  </Link>
                )}
              </>
            )}
          </div>
        </Row>

        <Row open={view === VIEWS.INFO}
          onClick={() => setView(view === VIEWS.INFO
            ? VIEWS.HOME : VIEWS.INFO)}
          icon="👤" label="Account info"
          sub="Name, gender, mobile, email">
          <div className="space-y-3">
            <Field label="Name">
              <input className="input" value={name}
                onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Gender">
              <select className="input" value={gender}
                onChange={(e) => setGender(e.target.value)}>
                <option value="">Choose…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Mobile number">
              <input className="input" value={phone} type="tel"
                placeholder="Add / change mobile"
                onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Email">
                <input className="input bg-bg-gray" value={email}
                  readOnly />
              </Field>
              <Field label="User code">
                <input className="input bg-bg-gray" value={code}
                  readOnly />
              </Field>
            </div>
            {msg && (
              <div className="rounded-card bg-success/10 px-3 py-2
                text-sm text-success">{msg}</div>
            )}
            <button onClick={saveInfo} disabled={busy}
              className="btn-primary w-full">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </Row>

        <Row open={view === VIEWS.PASSWORD}
          onClick={() => setView(view === VIEWS.PASSWORD
            ? VIEWS.HOME : VIEWS.PASSWORD)}
          icon="🔒" label="Change password"
          sub="Email/password accounts only">
          <div className="space-y-3">
            {pwMsg && (
              <div className={`rounded-card px-3 py-2 text-sm ${
                pwMsg === 'Password changed.'
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'}`}>{pwMsg}</div>
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
        </Row>

        <Row open={view === VIEWS.LANG}
          onClick={() => setView(view === VIEWS.LANG
            ? VIEWS.HOME : VIEWS.LANG)}
          icon="🌐" label="Language" sub={LANGS.find(
            (l) => l.code === lang)?.label || lang}>
          <div className="space-y-3">
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
            <button
              onClick={() => {
                setLang(langSel);
                setLangMsg(langSel === 'en'
                  ? 'Language set to English.'
                  : 'Language saved. Applying…');
              }}
              className="btn-primary w-full">
              Save language
            </button>
          </div>
        </Row>

        {cfg.refer_enabled !== false && (
          <Row open={view === VIEWS.REFER}
            onClick={() => setView(view === VIEWS.REFER
              ? VIEWS.HOME : VIEWS.REFER)}
            icon="🎁" label={cfg.refer_title || 'Refer & Earn'}
            sub={`Code ${code}`}>
            <div className="space-y-3">
              <p className="text-sm text-sub-text">
                {cfg.refer_desc || 'Share your code, you and your friend '
                  + 'both get wallet credit when they join.'}
              </p>
              {(Number(cfg.refer_reward) > 0
                || Number(cfg.refer_friend_reward) > 0) && (
                <div className="rounded-card bg-primary/10 px-3 py-2
                  text-sm font-semibold text-primary">
                  You get ₹{Number(cfg.refer_reward) || 0}
                  {Number(cfg.refer_friend_reward) > 0
                    ? `, your friend gets ₹${
                      Number(cfg.refer_friend_reward)}` : ''}.
                </div>
              )}
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-card bg-bg-light px-3
                  py-2 text-center font-bold tracking-wider">{code}</code>
                <button onClick={() => {
                  const link = `${window.location.origin}/signup?ref=`
                    + `${code}`;
                  navigator.clipboard?.writeText(link);
                  setMsg('Referral link copied.');
                }} className="btn-ghost !min-h-0 px-4 py-2">
                  Copy
                </button>
              </div>
            </div>
          </Row>
        )}

        <Row open={view === VIEWS.LEGAL}
          onClick={() => setView(view === VIEWS.LEGAL
            ? VIEWS.HOME : VIEWS.LEGAL)}
          icon="📄" label="Legal &amp; help"
          sub="Terms, Privacy, Support">
          {/* Top 4 stay as a 2-col grid. Below them, the deletion
              policy + delete-account tiles render FULL-WIDTH stacked,
              matching the bottom-of-page "Log out" button style. */}
          <div className="grid grid-cols-2 gap-2">
            <Link href="/terms"
              className="flex h-12 items-center justify-center
                rounded-card bg-bg-light px-3 text-center
                text-sm font-semibold">
              Terms
            </Link>
            <Link href="/privacy"
              className="flex h-12 items-center justify-center
                rounded-card bg-bg-light px-3 text-center
                text-sm font-semibold">
              Privacy
            </Link>
            <Link href="/page/refund"
              className="flex h-12 items-center justify-center
                rounded-card bg-bg-light px-3 text-center
                text-sm font-semibold">
              Refund policy
            </Link>
            <Link href="/support"
              className="flex h-12 items-center justify-center
                rounded-card bg-bg-light px-3 text-center
                text-sm font-semibold">
              Help &amp; support
            </Link>
          </div>
          <Link href="/account-deletion"
            className="mt-2 flex h-12 w-full items-center
              justify-center rounded-card bg-bg-light px-3
              text-center text-sm font-semibold">
            Account deletion policy
          </Link>
          <button type="button" onClick={deleteAccount}
            className="mt-2 flex h-12 w-full items-center
              justify-center rounded-card border border-danger
              bg-white px-3 text-center text-sm font-bold
              text-danger hover:bg-danger/5">
            Delete my account permanently
          </button>
        </Row>

        <Row open={view === VIEWS.VERSION}
          onClick={() => setView(view === VIEWS.VERSION
            ? VIEWS.HOME : VIEWS.VERSION)}
          icon="📱" label="App"
          sub={`v${APP_VERSION}${upd.updateAvailable
            ? ` · update to v${upd.latestVersion}` : ''}`}>
          <div className="space-y-2">
            {upd.updateAvailable ? (
              <button onClick={() => startUpdate(upd.updateUrl)}
                className="btn-primary w-full">
                Update to v{upd.latestVersion}
              </button>
            ) : (
              <div className="rounded-card bg-success/10 px-3 py-2
                text-center text-sm font-semibold text-success">
                App is up to date
              </div>
            )}
            <button onClick={replayTour}
              className="btn-ghost w-full">View app tour</button>
          </div>
        </Row>
      </div>

      {/* Logout - primary danger action. The deletion links that
          used to sit below this button have been moved to the
          Legal &amp; help section above so they no longer
          duplicate. */}
      <button onClick={logout}
        className="mt-3 w-full rounded-card border border-danger py-3
          text-sm font-bold text-danger hover:bg-danger/5">
        Log out
      </button>
    </Layout>
  );
}

// Clickable dashboard row. When open, shows the editor inline below.
function Row({ icon, label, sub, open, onClick, children }) {
  return (
    <div>
      <button onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3 text-left
          hover:bg-bg-light">
        <span className="text-lg leading-none">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-dark-text">
            {label}
          </span>
          {sub && (
            <span className="block truncate text-[11px] text-sub-text">
              {sub}
            </span>
          )}
        </span>
        <span className={`text-sub-text transition-transform ${open
          ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 bg-bg-light/40 px-4
          py-3">{children}</div>
      )}
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
