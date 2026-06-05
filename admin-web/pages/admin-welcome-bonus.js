import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, welcomeBonusService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-welcome-bonus
//
// One screen, one source of truth. Everything saves to settings/config
// and is read SERVER-SIDE by push-relay/api/giftCard.js on every new
// signup - so flipping the toggle takes effect for the very next user
// with zero deploy. Excess-promo killswitch: turn off here and the next
// customer that finishes OTP sees nothing.
//
// Modes:
//   auto_credit       Credit wallet immediately + email + push
//   redemption_code   Generate a unique gift card code, email + push
//                     with the redemption steps
//   email_only        Email + push only, no money
//
// Templates (subject + html for email, title + body for push) accept
// tokens: {{name}} {{amount}} {{code}} {{platform}}. Live preview
// renders below the editors.

const MODES = [
  { id: 'auto_credit', label: 'Auto-credit wallet',
    desc: 'Wallet is credited the moment OTP verification succeeds.' },
  { id: 'redemption_code', label: 'Send giftcard code',
    desc: 'A unique code is generated and emailed. Customer redeems '
      + 'from Wallet -> Redeem code.' },
  { id: 'email_only', label: 'Email only (no money)',
    desc: 'No wallet change. Useful for marketing-only campaigns.' },
];

export default function AdminWelcomeBonus() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  // Live subscribe so multiple admins editing at once see each
  // other's saves immediately.
  useEffect(() => {
    if (loading) return undefined;
    return onSnapshot(doc(db, 'settings', 'config'), (s) => {
      const d = (s.exists() && s.data()) || {};
      const next = {
        welcome_bonus_enabled: !!d.welcome_bonus_enabled,
        welcome_bonus_amount: Number(d.welcome_bonus_amount || 50),
        welcome_bonus_mode: d.welcome_bonus_mode || 'auto_credit',
        welcome_bonus_email_enabled:
          d.welcome_bonus_email_enabled !== false,
        welcome_bonus_push_enabled:
          d.welcome_bonus_push_enabled !== false,
        welcome_bonus_email_subject: d.welcome_bonus_email_subject || '',
        welcome_bonus_email_html: d.welcome_bonus_email_html || '',
        welcome_bonus_push_title: d.welcome_bonus_push_title || '',
        welcome_bonus_push_body: d.welcome_bonus_push_body || '',
        brand_name: d.platformName || d.brand_name || 'AstroSeer',
      };
      setCfg(next);
      // Only seed draft once, so admin edits don't get clobbered by
      // a snapshot tick (live-edit safe).
      setDraft((cur) => cur || next);
    }, () => {});
  }, [loading]);

  if (loading || !cfg) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const d = draft || cfg;
  const dirty = JSON.stringify(d) !== JSON.stringify(cfg);

  function set(k, v) { setDraft({ ...(d), [k]: v }); }

  async function save() {
    setBusy(true);
    try {
      const patch = {
        welcome_bonus_enabled: !!d.welcome_bonus_enabled,
        welcome_bonus_amount: Math.max(0,
          Math.round(Number(d.welcome_bonus_amount) || 0)),
        welcome_bonus_mode: d.welcome_bonus_mode,
        welcome_bonus_email_enabled: !!d.welcome_bonus_email_enabled,
        welcome_bonus_push_enabled: !!d.welcome_bonus_push_enabled,
        welcome_bonus_email_subject: d.welcome_bonus_email_subject || '',
        welcome_bonus_email_html: d.welcome_bonus_email_html || '',
        welcome_bonus_push_title: d.welcome_bonus_push_title || '',
        welcome_bonus_push_body: d.welcome_bonus_push_body || '',
      };
      await setDoc(doc(db, 'settings', 'config'), patch, { merge: true });
      flash('Saved. Next signup uses this configuration.');
    } catch (e) {
      flash(`Save failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  // Instant on/off without confirmation - the whole point of the
  // killswitch is speed during a promo blow-up.
  async function toggleInstantly(value) {
    set('welcome_bonus_enabled', value);
    try {
      await setDoc(doc(db, 'settings', 'config'),
        { welcome_bonus_enabled: value }, { merge: true });
      flash(value ? 'Welcome bonus ON. Next signup will receive it.'
        : 'Welcome bonus OFF. Promo paused.');
    } catch (e) {
      flash(`Toggle failed: ${e.message || e}`, 'error');
    }
  }

  const preview = welcomeBonusService.renderWelcomeBonusPreview(d);

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Welcome bonus</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Auto-credit, giftcard code or marketing email - your call.
            Toggle deploys instantly to every signup. No app rebuild.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || busy}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white disabled:opacity-50">
            {busy ? 'Saving...' : (dirty ? 'Save changes' : 'All saved')}
          </button>
        </div>
      </div>

      {/* Killswitch */}
      <div className={`surface mb-3 flex flex-wrap items-center
        justify-between gap-3 border-l-4 p-4 ${d.welcome_bonus_enabled
          ? 'border-emerald-500' : 'border-gray-300'}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center
            rounded-full text-xl ${d.welcome_bonus_enabled
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-sub-text'}`}>
            {d.welcome_bonus_enabled ? '✓' : '○'}
          </span>
          <div>
            <div className="text-sm font-bold text-dark-text">
              {d.welcome_bonus_enabled
                ? 'Welcome bonus is LIVE'
                : 'Welcome bonus is paused'}
            </div>
            <div className="text-xs text-sub-text">
              {d.welcome_bonus_enabled
                ? 'Every new signup receives the configured bonus.'
                : 'New signups receive nothing. Use this to throttle '
                  + 'a runaway promo.'}
            </div>
          </div>
        </div>
        <Toggle on={d.welcome_bonus_enabled}
          onChange={toggleInstantly} large />
      </div>

      {/* Money */}
      <Section title="What does the user receive?">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Amount (₹)
            </span>
            <input className="input mt-1" type="number" min="0"
              value={d.welcome_bonus_amount}
              onChange={(e) => set('welcome_bonus_amount',
                e.target.value)} />
            <p className="mt-1 text-[11px] text-sub-text">
              Set 0 for an email-only marketing welcome with no
              wallet movement.
            </p>
          </label>
          <div>
            <span className="text-xs font-semibold text-sub-text">
              Delivery mode
            </span>
            <div className="mt-1 space-y-1">
              {MODES.map((m) => (
                <label key={m.id} className={`flex items-start gap-2
                  rounded-card border p-2 cursor-pointer
                  ${d.welcome_bonus_mode === m.id
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:bg-bg-light/60'}`}>
                  <input type="radio" name="mode"
                    checked={d.welcome_bonus_mode === m.id}
                    onChange={() =>
                      set('welcome_bonus_mode', m.id)}
                    className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold
                      text-dark-text">{m.label}</div>
                    <div className="text-[11px] text-sub-text">
                      {m.desc}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Channels */}
      <Section title="Notification channels">
        <div className="grid gap-3 sm:grid-cols-2">
          <ChannelRow
            label="Send email"
            sub="Subject + HTML body below. Stacks on top of the BCC
              list configured in /admin-reports."
            on={d.welcome_bonus_email_enabled}
            onChange={(v) => set('welcome_bonus_email_enabled', v)} />
          <ChannelRow
            label="Send push + in-app"
            sub="Lock-screen banner + an entry in the user's
              Notifications inbox."
            on={d.welcome_bonus_push_enabled}
            onChange={(v) => set('welcome_bonus_push_enabled', v)} />
        </div>
      </Section>

      {/* Email template */}
      <Section title="Email template"
        right={<TokenHints />}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                Subject
              </span>
              <input className="input mt-1"
                value={d.welcome_bonus_email_subject}
                onChange={(e) => set('welcome_bonus_email_subject',
                  e.target.value)}
                placeholder="Welcome to {{platform}}!" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                HTML body (leave empty for the smart default)
              </span>
              <textarea className="input mt-1 h-56 font-mono text-[11px]"
                value={d.welcome_bonus_email_html}
                onChange={(e) => set('welcome_bonus_email_html',
                  e.target.value)}
                placeholder="<p>Hi {{name}}, welcome to {{platform}}! We have added Rs {{amount}} to your wallet...</p>" />
            </label>
          </div>
          {/* Live preview */}
          <div className="rounded-card border border-gray-200 p-3
            bg-bg-light/30">
            <div className="text-[10px] font-bold uppercase tracking-wider
              text-sub-text">Live preview</div>
            <div className="mt-1 text-sm font-bold text-dark-text">
              Subject: {preview.emailSubject}
            </div>
            <div className="mt-2 rounded border border-gray-200 bg-white
              p-3 text-[13px]"
              dangerouslySetInnerHTML={{ __html: preview.emailHtml }} />
          </div>
        </div>
      </Section>

      {/* Push template */}
      <Section title="Push & in-app notification template">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                Title
              </span>
              <input className="input mt-1"
                value={d.welcome_bonus_push_title}
                onChange={(e) => set('welcome_bonus_push_title',
                  e.target.value)}
                placeholder="Welcome to {{platform}}!" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                Body
              </span>
              <input className="input mt-1"
                value={d.welcome_bonus_push_body}
                onChange={(e) => set('welcome_bonus_push_body',
                  e.target.value)}
                placeholder="Rs {{amount}} added to your wallet. Enjoy!" />
            </label>
          </div>
          {/* Push preview - looks like a lock-screen card. */}
          <div className="rounded-card border border-gray-200
            bg-gradient-to-b from-gray-100 to-gray-200 p-5">
            <div className="rounded-2xl bg-white p-3 shadow-md">
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center
                  rounded-md bg-primary text-[11px] font-bold
                  text-white">A</div>
                <div className="text-[10px] font-semibold uppercase
                  tracking-wider text-sub-text">
                  {d.brand_name || 'AstroSeer'}
                </div>
                <div className="ml-auto text-[10px] text-sub-text">now</div>
              </div>
              <div className="mt-2 text-sm font-bold text-dark-text">
                {preview.pushTitle}
              </div>
              <div className="mt-1 text-[12.5px] text-sub-text">
                {preview.pushBody}
              </div>
            </div>
          </div>
        </div>
      </Section>
    </Layout>
  );
}

function Section({ title, children, right }) {
  return (
    <div className="surface mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">{title}</h2>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function ChannelRow({ label, sub, on, onChange }) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-card
      border p-3 ${on ? 'border-primary/40 bg-primary/5'
        : 'border-gray-200 bg-bg-light/40'}`}>
      <div>
        <div className="text-sm font-semibold text-dark-text">{label}</div>
        <div className="text-[11px] text-sub-text">{sub}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function Toggle({ on, onChange, large }) {
  const w = large ? 'w-14 h-8' : 'w-11 h-6';
  const dot = large ? 'h-7 w-7' : 'h-5 w-5';
  const move = large ? (on ? 'translate-x-6' : 'translate-x-0.5')
    : (on ? 'translate-x-5' : 'translate-x-0.5');
  return (
    <button onClick={() => onChange(!on)}
      className={`relative ${w} shrink-0 rounded-full transition
        ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 ${dot} rounded-full bg-white
        shadow transition ${move}`} />
    </button>
  );
}

function TokenHints() {
  const tokens = ['{{name}}', '{{amount}}', '{{code}}', '{{platform}}'];
  return (
    <div className="flex flex-wrap gap-1">
      {tokens.map((t) => (
        <span key={t} className="rounded-full bg-bg-light px-2 py-0.5
          font-mono text-[10px] font-bold text-sub-text">{t}</span>
      ))}
    </div>
  );
}
