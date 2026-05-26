import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// 3-tuple: [key, label, defaultOn?]. defaultOn defaults to true (opt-OUT
// = visible unless admin unchecks). Set defaultOn:false for toggles
// that should stay HIDDEN unless the admin explicitly opts in.
const TOGGLES = [
  // --- Core product surfaces ---
  ['enable_chat', 'Chat'],
  ['enable_call', 'Voice Call'],
  ['enable_video', 'Video Call'],
  ['enable_live', 'Live Streaming'],
  ['enable_kundli', 'Kundli'],
  ['enable_horoscope', 'Horoscope'],
  ['enable_remedies', 'Remedies'],
  ['enable_ai', 'AI Features'],
  ['enable_tour', 'Guided Tour'],
  ['free_chat_enabled', 'Free Chat'],
  ['free_call_enabled', 'Free Call'],
  // --- Reports / monetisation ---
  // Master kill-switch for the paid + free PDF reports. When OFF the
  // /kundli buy buttons hide and the relay refuses /api/kundli/report.
  ['reports_enabled', 'Kundli PDF reports (free + paid)'],
  ['paid_reports_enabled', 'Paid kundli reports specifically'],
  ['wallet_enabled', 'Wallet top-up + spending'],
  ['gifts_enabled', 'Gift cards'],
  ['coupons_enabled', 'Coupons'],
  // --- Authentication ---
  ['login_enabled', 'Customer login'],
  ['login_astrologer_enabled', 'Astrologer login'],
  ['signup_enabled', 'New customer sign-up'],
  ['email_otp_enabled', 'Email OTP on sign-up'],
  ['phone_otp_enabled', 'Phone OTP (opt-in)', false],
  // Google sign-in is opt-IN (default OFF). The web flow opens Safari
  // for the redirect; the native plugin is stripped on iOS to avoid a
  // CocoaPods conflict + plist crash, so leave OFF until you're sure
  // you want to expose it. Email + password works regardless.
  ['google_signin_mobile', 'Google sign-in on mobile app', false],
  ['google_signin_desktop', 'Google sign-in on desktop / web', false],
  ['email_verification', 'Require email verification on signup'],
  ['register_as_astro_show', 'Show "Register as astrologer" on client'],
  // --- API / external integrations ---
  ['api_kundli_enabled', 'AstroSeer kundli API'],
  ['api_email_enabled', 'Outbound email (SMTP)'],
  ['api_push_enabled', 'Push notifications relay'],
  ['api_ai_enabled', 'AI / LLM relay'],
  ['api_payments_enabled', 'Payments gateway'],
  // --- Referrals ---
  ['referral_customer_enabled', 'Customer refers customer'],
  ['referral_astro_enabled', 'Astrologer refers astrologer'],
  // --- Notifications surfaces ---
  ['notify_email_enabled', 'Send email notifications'],
  ['notify_push_enabled', 'Send push notifications'],
  ['notify_inapp_enabled', 'In-app banners'],
];
const isOn = (val, defaultOn) => (defaultOn === false
  ? val === true        // opt-IN: only ON when explicitly true
  : val !== false);     // opt-OUT: ON unless explicitly false
const NAV_LABELS = [
  ['nav_home', 'Home'],
  ['nav_chat', 'Chat'],
  ['nav_live', 'Live'],
  ['nav_call', 'Call'],
  ['nav_remedies', 'Remedies'],
];

export default function AdminFeatures() {
  const { loading } = useRequireAdmin();
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'features')).then((s) =>
      setF(s.exists() ? s.data() : {}));
  }, []);

  async function save() {
    await adminService.updateSettings('features', f);
    setMsg('Saved.');
    flash('Settings saved');
  }

  if (loading || !f) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Feature Toggle System</h1>
      {msg && <div className="card mb-3 bg-success/10 text-success">{msg}</div>}
      <div className="card space-y-2">
        {TOGGLES.map(([k, label, defaultOn]) => (
          <label key={k} className="flex items-center justify-between
                                    border-b py-2 last:border-0">
            <span>
              {label}
              {defaultOn === false && (
                <span className="ml-2 rounded-full bg-bg-light px-2
                  py-0.5 text-[10px] font-bold text-sub-text">opt-in</span>
              )}
            </span>
            <input type="checkbox" checked={isOn(f[k], defaultOn)}
              onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
          </label>
        ))}
        <button onClick={save} className="btn-primary mt-2 w-full">
          Save Toggles
        </button>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">
        Bottom navigation labels (client app)
      </h2>
      <div className="card space-y-2">
        {NAV_LABELS.map(([k, def]) => (
          <label key={k} className="flex items-center gap-3">
            <span className="w-24 text-sm text-sub-text">{def}</span>
            <input className="input flex-1"
              placeholder={def} value={f[k] || ''}
              onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </label>
        ))}
        <button onClick={save} className="btn-primary mt-2 w-full">
          Save Navigation
        </button>
      </div>

      {/* Kundli UI variant: primary (current production UI) or
          secondary (test-only AstroTalk-style build). The customer
          /kundli page reads settings/features.kundli_ui_variant
          live, so flipping this here switches everyone instantly.
          Either side can be deleted with explicit confirmation so
          the inactive variant stops touching builds / Firestore. */}
      <h2 className="mb-2 mt-6 text-lg font-bold">Kundli UI variant</h2>
      <p className="mb-2 text-xs text-sub-text">
        Pick which customer kundli interface is served at /kundli.
        Primary is the live production UI. Secondary is a parallel
        test build (not yet ready); keep it on Primary until you
        sign off on the secondary in a staging session.
      </p>
      <div className="card space-y-3">
        {[
          ['primary',
            'Primary (current, production)',
            'The 7-tab AstroTalk-style kundli viewer you see today. '
              + 'Use this for everyone — safe.'],
          ['secondary',
            'Secondary (test only, do NOT promote)',
            'Parallel build for A/B testing. Will not be present '
              + 'unless explicitly built. Keep OFF in production.'],
        ].map(([v, label, sub]) => {
          const cur = f.kundli_ui_variant || 'primary';
          const sel = cur === v;
          return (
            <label key={v} className={`flex cursor-pointer
              items-start gap-2 rounded-card p-2
              ${sel ? 'bg-primary/10' : 'bg-bg-light'}`}>
              <input type="radio" name="kundli_ui_variant"
                checked={sel}
                onChange={() => setF({ ...f, kundli_ui_variant: v })} />
              <span className="block">
                <span className="block text-sm font-bold">{label}</span>
                <span className="block text-[11px] text-sub-text">
                  {sub}
                </span>
              </span>
            </label>
          );
        })}
        <div className="rounded-card border border-warning/40
          bg-warning/5 p-3 text-[11px] text-warning">
          <b>Danger:</b> the buttons below delete the chosen variant&apos;s
          build flag. The customer /kundli page will fall back to
          the remaining variant. Use only if you&apos;re sure.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button"
            onClick={async () => {
              if (!window.confirm(
                'Delete the PRIMARY (current) build flag? '
                + 'The page will fall back to the secondary variant.'
                + ' Type Yes to proceed.')) return;
              const next = { ...f,
                kundli_ui_variant_primary_disabled: true };
              setF(next);
              await adminService.updateSettings('features', next);
              flash('Primary variant disabled');
            }}
            className="rounded-full border border-danger
              px-3 py-1.5 text-xs font-bold text-danger
              hover:bg-danger/10">
            Delete primary
          </button>
          <button type="button"
            onClick={async () => {
              if (!window.confirm(
                'Delete the SECONDARY (test) build flag? '
                + 'The page will use the primary variant only.')) return;
              const next = { ...f,
                kundli_ui_variant_secondary_disabled: true,
                kundli_ui_variant: 'primary' };
              setF(next);
              await adminService.updateSettings('features', next);
              flash('Secondary variant disabled');
            }}
            className="rounded-full border border-danger
              px-3 py-1.5 text-xs font-bold text-danger
              hover:bg-danger/10">
            Delete secondary
          </button>
        </div>
        <button onClick={save} className="btn-primary mt-2 w-full">
          Save variant
        </button>
      </div>
    </Layout>
  );
}
