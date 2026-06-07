import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-home-hero - dedicated editor for the customer home hero
// banner ("The stars have answers"). Replaces the scattered config
// previously split across /admin-content-text + /admin-cms.
//
// All fields live on settings/content (the same doc the customer
// dashboard already subscribes to via onSnapshot), so every save
// pushes live to every open app without a reload. Fields:
//
//   homeHeroTitle             string  - big headline
//   homeHeroSubtitle          string  - support paragraph
//   text['home.browseCta']    string  - primary button label
//   hero_btn_primary_href     string  - primary button target URL
//   text['home.getStarted']   string  - secondary button label
//   hero_btn_secondary_href   string  - secondary button target
//                                       (empty -> hide button)
//   hero_btn_secondary_signup boolean - when true, secondary button
//                                       opens the signup modal
//                                       instead of navigating (used
//                                       only for guests by default)
//   home_hero_show_mobile     boolean - show on phones (default on)
//   home_hero_show_desktop    boolean - show on desktop (default on)
//
// A live preview at the top mirrors the customer card pixel-for-pixel
// so the operator can iterate without flipping tabs.

const DEFAULTS = {
  homeHeroTitle: 'The stars have answers',
  homeHeroSubtitle: 'Speak with verified astrologers on chat, call or '
    + 'video. Clarity on love, career, marriage and the road ahead.',
  primaryLabel: 'Browse astrologers',
  primaryHref: '/astrologers',
  secondaryLabel: 'Get started',
  secondaryHref: '',
  secondarySignup: true,
  showMobile: true,
  showDesktop: true,
};

export default function AdminHomeHero() {
  const { loading } = useRequireAdmin();
  const [form, setForm] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'content'));
        const d = s.exists() ? (s.data() || {}) : {};
        const txt = (d.text && typeof d.text === 'object') ? d.text : {};
        setForm({
          homeHeroTitle: d.homeHeroTitle || DEFAULTS.homeHeroTitle,
          homeHeroSubtitle: d.homeHeroSubtitle
            || DEFAULTS.homeHeroSubtitle,
          primaryLabel: txt['home.browseCta'] || DEFAULTS.primaryLabel,
          primaryHref: d.hero_btn_primary_href || DEFAULTS.primaryHref,
          secondaryLabel: txt['home.getStarted']
            || DEFAULTS.secondaryLabel,
          secondaryHref: d.hero_btn_secondary_href || '',
          secondarySignup: d.hero_btn_secondary_signup !== false,
          showMobile: d.home_hero_show_mobile !== false,
          showDesktop: d.home_hero_show_desktop !== false,
        });
      } catch (_) { /* empty doc is fine */ }
      setLoaded(true);
    })();
  }, [loading]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    setBusy(true);
    try {
      // Pull the existing text map so we merge into it (other keys
      // like home.callCta etc. must survive).
      const s = await getDoc(doc(db, 'settings', 'content'));
      const cur = s.exists() ? (s.data() || {}) : {};
      const text = (cur.text && typeof cur.text === 'object')
        ? { ...cur.text } : {};
      text['home.browseCta'] = form.primaryLabel.trim()
        || DEFAULTS.primaryLabel;
      text['home.getStarted'] = form.secondaryLabel.trim()
        || DEFAULTS.secondaryLabel;
      await setDoc(doc(db, 'settings', 'content'), {
        homeHeroTitle: form.homeHeroTitle.trim()
          || DEFAULTS.homeHeroTitle,
        homeHeroSubtitle: form.homeHeroSubtitle.trim()
          || DEFAULTS.homeHeroSubtitle,
        hero_btn_primary_href: form.primaryHref.trim()
          || DEFAULTS.primaryHref,
        hero_btn_secondary_href: form.secondaryHref.trim(),
        hero_btn_secondary_signup: !!form.secondarySignup,
        home_hero_show_mobile: !!form.showMobile,
        home_hero_show_desktop: !!form.showDesktop,
        text,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      flash('Home hero saved. Live on every open app.');
    } catch (e) {
      flash(`Save failed: ${e?.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  async function reset() {
    if (!window.confirm('Reset the hero to the AstroSeer defaults?')) {
      return;
    }
    setForm(DEFAULTS);
    flash('Defaults loaded. Click Save to publish.');
  }

  if (loading || !loaded) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const masterOff = !form.showMobile && !form.showDesktop;

  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-dark-text">
          Home hero banner
        </h1>
        <p className="mt-1 text-sm text-sub-text">
          The big "Stars have answers" card at the top of the
          customer home. Every change pushes live to all open apps -
          no deploy needed.
        </p>
      </header>

      {/* Live preview */}
      <section className="mb-5">
        <div className="mb-2 text-[11px] font-bold uppercase
          tracking-wider text-sub-text">
          Live preview
        </div>
        <div className={`rounded-2xl p-6 text-white md:px-8 md:py-8 ${
          masterOff ? 'opacity-40' : ''}`}
          style={{
            background: 'linear-gradient(135deg, #D4A12A 0%, '
              + '#7F2020 55%, #4a1212 100%)',
          }}>
          <h2 className="text-2xl font-bold md:text-3xl">
            {form.homeHeroTitle || DEFAULTS.homeHeroTitle}
          </h2>
          <p className="mt-2 max-w-lg text-sm opacity-90 md:text-base">
            {form.homeHeroSubtitle || DEFAULTS.homeHeroSubtitle}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-5 py-2.5
              text-sm font-semibold text-[#7F2020]">
              {form.primaryLabel || DEFAULTS.primaryLabel}
            </span>
            {(form.secondaryLabel
              && (form.secondaryHref || form.secondarySignup)) && (
              <span className="rounded-full bg-white/20 px-5 py-2.5
                text-sm font-semibold text-white">
                {form.secondaryLabel}
              </span>
            )}
          </div>
          {masterOff && (
            <div className="mt-4 inline-block rounded-full
              bg-black/40 px-3 py-1 text-[11px] font-bold">
              Hidden on both mobile and desktop
            </div>
          )}
        </div>
      </section>

      {/* Toggles */}
      <section className="surface mb-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Visibility
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Toggle label="Show on phones"
            on={form.showMobile}
            onChange={(v) => set('showMobile', v)} />
          <Toggle label="Show on desktop"
            on={form.showDesktop}
            onChange={(v) => set('showDesktop', v)} />
        </div>
        <p className="mt-2 text-[11px] text-sub-text">
          Turn both off to hide the hero entirely. The rest of the
          home page (categories, top-rated, reviews) stays intact.
        </p>
      </section>

      {/* Copy */}
      <section className="surface mb-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Copy
        </h2>
        <div className="mt-3 grid gap-3">
          <Field label="Headline">
            <input className="input" maxLength={80}
              value={form.homeHeroTitle}
              onChange={(e) => set('homeHeroTitle', e.target.value)} />
            <div className="mt-0.5 text-[10px] text-sub-text">
              {form.homeHeroTitle.length}/80
            </div>
          </Field>
          <Field label="Subtitle">
            <textarea className="input" rows={3} maxLength={240}
              value={form.homeHeroSubtitle}
              onChange={(e) =>
                set('homeHeroSubtitle', e.target.value)} />
            <div className="mt-0.5 text-[10px] text-sub-text">
              {form.homeHeroSubtitle.length}/240
            </div>
          </Field>
        </div>
      </section>

      {/* Primary button */}
      <section className="surface mb-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Primary button
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Label">
            <input className="input" maxLength={30}
              value={form.primaryLabel}
              onChange={(e) => set('primaryLabel', e.target.value)} />
          </Field>
          <Field label="Goes to (path)" hint="e.g. /astrologers, /live, /kundli">
            <input className="input" maxLength={120}
              value={form.primaryHref}
              onChange={(e) => set('primaryHref', e.target.value)}
              placeholder="/astrologers" />
          </Field>
        </div>
      </section>

      {/* Secondary button */}
      <section className="surface mb-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Secondary button
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Label (empty to hide)">
            <input className="input" maxLength={30}
              value={form.secondaryLabel}
              onChange={(e) => set('secondaryLabel', e.target.value)} />
          </Field>
          <Field label="Behaviour"
            hint="Signup modal shows only to guests; path goes to a URL">
            <select className="input"
              value={form.secondarySignup ? 'signup' : 'href'}
              onChange={(e) =>
                set('secondarySignup', e.target.value === 'signup')}>
              <option value="signup">Open sign-up modal (guests only)</option>
              <option value="href">Go to a path</option>
            </select>
          </Field>
          {!form.secondarySignup && (
            <Field label="Goes to (path)" span="sm:col-span-2">
              <input className="input" maxLength={120}
                value={form.secondaryHref}
                onChange={(e) => set('secondaryHref', e.target.value)}
                placeholder="/signup or /wallet or any path" />
            </Field>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-sm
            font-bold text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
        <button onClick={reset} disabled={busy}
          className="rounded-full border border-primary px-5 py-2
            text-sm font-bold text-primary disabled:opacity-50">
          Reset to default
        </button>
      </div>
    </Layout>
  );
}

function Field({ label, hint, children, span }) {
  return (
    <div className={span || ''}>
      <label className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-sub-text">{hint}</div>
      )}
    </div>
  );
}

function Toggle({ label, on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`flex items-center justify-between rounded-card
        px-4 py-3 text-sm font-semibold transition ${on
          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
          : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'}`}>
      <span>{label}</span>
      <span className={`relative inline-block h-5 w-9 rounded-full
        transition ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 inline-block h-4 w-4
          rounded-full bg-white shadow transition ${on
            ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
