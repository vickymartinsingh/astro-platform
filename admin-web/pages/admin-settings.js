import { useEffect, useState } from 'react';
import { db, adminService, REPORT_TYPES, auth } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

function relayUrl() {
  if (typeof process !== 'undefined'
    && process.env.NEXT_PUBLIC_PUSH_RELAY) {
    return process.env.NEXT_PUBLIC_PUSH_RELAY
      .replace(/\/+$/, '');
  }
  return 'https://astro-platform-push-relay.vercel.app';
}

// settings/config is admin-writable (client-side fallback when Cloud
// Functions are not deployed). Includes branding (logo / favicon).
export default function AdminSettings() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Per-asset: { file, status: ''|'uploading'|'done'|'error' }
  const [pick, setPick] = useState({ logo: {}, favicon: {} });

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setCfg(s.exists() ? s.data() : {
        platformName: 'AstroSeer', commission_percent: 30,
        min_recharge: 100, signup_bonus: 0,
        free_chat_seconds: 0, free_call_seconds: 0, kundliToolUrl: '',
        nudge_delay_seconds: 30,
        // Platform Behavior defaults
        live_quiz_points: 10,
        live_desktop_mode: 'redirect',
        live_app_download_url: 'https://play.google.com/store/apps/details?id=com.astroseer.mobile',
        astro_chat_desktop_layout: 'sidebar',
        chat_inactivity_minutes: 3,
      }));
  }, []);

  async function save() {
    setMsg('');
    // Pricing fields for every report type from shared/reportTypes.js
    // are written into kundli_<id>_price so resolvePrice() picks them
    // up at runtime on both client + relay.
    const reportPrices = {};
    REPORT_TYPES.forEach((t) => {
      const key = `kundli_${t.id}_price`;
      const v = cfg[key];
      if (v !== '' && v != null && Number.isFinite(Number(v))) {
        reportPrices[key] = Number(v);
      }
    });
    await adminService.updateSettings('config', {
      platformName: cfg.platformName,
      commission_percent: Number(cfg.commission_percent),
      min_recharge: Number(cfg.min_recharge),
      signup_bonus: Number(cfg.signup_bonus),
      free_chat_seconds: Number(cfg.free_chat_seconds),
      free_call_seconds: Number(cfg.free_call_seconds),
      nudge_delay_seconds: Number(cfg.nudge_delay_seconds || 30),
      kundliToolUrl: cfg.kundliToolUrl || '',
      gst_percent: Number(cfg.gst_percent || 0),
      gstin: cfg.gstin || '',
      referral_referrer_bonus: Number(cfg.referral_referrer_bonus || 0),
      referral_referee_bonus: Number(cfg.referral_referee_bonus || 0),
      logo: cfg.logo || '',
      favicon: cfg.favicon || '',
      // Platform Behavior
      live_quiz_points: Number(cfg.live_quiz_points ?? 10),
      live_desktop_mode: cfg.live_desktop_mode || 'redirect',
      live_app_download_url: cfg.live_app_download_url || '',
      astro_chat_desktop_layout: cfg.astro_chat_desktop_layout || 'sidebar',
      chat_inactivity_minutes: Number(cfg.chat_inactivity_minutes ?? 3),
      ...reportPrices,
    });
    setMsg('Settings saved.');
    flash('Settings saved');
  }

  function choose(kind, file) {
    setPick((p) => ({ ...p, [kind]: { file, status: '' } }));
  }

  // Store the image directly in Firestore as a data URL - no Firebase
  // Storage / bucket / CORS needed, so it always works. Logos are tiny;
  // we downscale to keep the doc well under Firestore's 1MB limit.
  function fileToScaledDataUrl(file, maxW) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('could not read file'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('invalid image'));
        img.onload = () => {
          const scale = Math.min(1, maxW / (img.width || maxW));
          const w = Math.max(1, Math.round((img.width || maxW) * scale));
          const h = Math.max(1, Math.round((img.height || maxW) * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          // PNG keeps transparency for logos.
          resolve(c.toDataURL('image/png'));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  async function uploadBrand(kind) {
    const file = pick[kind] && pick[kind].file;
    if (!file) { flash('Choose a file first', 'error'); return; }
    setPick((p) => ({ ...p, [kind]: { ...p[kind], status: 'uploading' } }));
    try {
      const maxW = kind === 'favicon' ? 128 : 360;
      const dataUrl = await fileToScaledDataUrl(file, maxW);
      if (dataUrl.length > 850000) {
        throw new Error('image too large - use a smaller / simpler logo');
      }
      setCfg((c) => ({ ...c, [kind]: dataUrl }));
      setPick((p) => ({ ...p, [kind]: { file, status: 'done' } }));
      flash(`${kind === 'logo' ? 'Logo' : 'Icon'} ready - now press Save`);
    } catch (e) {
      setPick((p) => ({ ...p, [kind]: { ...p[kind], status: 'error' } }));
      flash(`Upload failed: ${e?.message || 'error'}`, 'error');
    }
  }

  async function saveBranding() {
    await adminService.updateSettings('config', {
      logo: cfg.logo || '', favicon: cfg.favicon || '' });
    flash('Logo & icon saved - now live across all apps');
  }

  if (loading || !cfg) {
    return <Layout><div className="surface p-4">Loading...</div></Layout>;
  }

  const fields = [
    ['platformName', 'Platform Name', 'text'],
    ['commission_percent', 'Default Commission % (admin cut)', 'number'],
    ['min_recharge', 'Minimum Recharge ₹', 'number'],
    ['signup_bonus', 'Signup Bonus ₹', 'number'],
    ['free_chat_seconds', 'Free Chat Seconds (e.g. 300 = first 5 min)',
      'number'],
    ['free_call_seconds', 'Free Call Seconds (e.g. 300 = first 5 min)',
      'number'],
    ['nudge_delay_seconds',
      'AI Idle Nudge Delay (seconds, default 30 - time before nudge fires if client is silent)',
      'number'],
    ['kundliToolUrl', 'Kundli Tool URL', 'text'],
    ['gst_percent', 'GST %', 'number'],
    ['gstin', 'Company GSTIN', 'text'],
    ['referral_referrer_bonus', 'Referral Bonus, Referrer ₹', 'number'],
    ['referral_referee_bonus', 'Referral Bonus, New User ₹', 'number'],
  ];

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">System Settings</h1>
      {msg && (
        <div className="surface mb-3 bg-success/10 p-3 text-sm
                        text-success">{msg}</div>
      )}

      <div className="surface mb-4 p-4">
        <div className="mb-3 font-semibold">Branding</div>
        <div className="grid gap-6 sm:grid-cols-2">
          {[['logo', 'Platform logo'],
            ['favicon', 'Favicon / icon']].map(([kind, label]) => {
            const st = pick[kind] || {};
            return (
              <div key={kind}>
                <div className="text-sm font-medium text-sub-text">
                  {label}
                </div>
                {cfg[kind] && (
                  <img src={cfg[kind]} alt={kind}
                    className="my-2 h-14 rounded bg-bg-light
                               object-contain p-1" />
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label className="btn-ghost cursor-pointer
                    inline-block !min-h-0 px-3 py-2 text-sm">
                    Choose file
                    <input type="file" accept="image/*" hidden
                      onChange={(e) =>
                        choose(kind, e.target.files?.[0])} />
                  </label>
                  <span className="max-w-[160px] truncate text-xs
                    text-sub-text">
                    {st.file ? st.file.name : 'No file chosen'}
                  </span>
                  <button onClick={() => uploadBrand(kind)}
                    disabled={!st.file || st.status === 'uploading'}
                    className="btn-primary !min-h-0 px-4 py-2 text-sm
                      disabled:opacity-50">
                    {st.status === 'uploading' ? 'Uploading...'
                      : 'Upload'}
                  </button>
                </div>
                {st.status === 'done' && (
                  <div className="mt-1 text-xs font-semibold
                    text-success">Uploaded successfully</div>
                )}
                {st.status === 'error' && (
                  <div className="mt-1 text-xs font-semibold
                    text-danger">Upload failed - try again</div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={saveBranding}
          className="btn-primary mt-4 w-full">
          Save logo &amp; icon (apply everywhere)
        </button>
      </div>

      <div className="surface space-y-3 p-4">
        {fields.map(([k, label, type]) => (
          <div key={k}>
            <label className="text-sm text-sub-text">{label}</label>
            <input className="input" type={type} value={cfg[k] ?? ''}
              onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
          </div>
        ))}

        {/* CURRENCY SYMBOL. Drives every "₹100" pill across the
            customer + astrologer + admin apps via the rupees() /
            rupees2() helpers. Pick one from the curated list OR
            type any custom string (e.g. "AED ", "SGD "). Saved as
            settings/config.currency_symbol; the apps read it on
            boot and rerender every money chip with the new prefix
            (no redeploy required). */}
        <div>
          <label className="text-sm text-sub-text">
            Display currency
          </label>
          <select className="input"
            value={cfg.currency_symbol || '₹'}
            onChange={(e) => setCfg({ ...cfg,
              currency_symbol: e.target.value })}>
            {[
              ['₹', 'Indian Rupee  -  ₹'],
              ['Rs ', 'Rupee (Rs)  -  Rs 100'],
              ['INR ', 'INR code  -  INR 100'],
              ['$', 'US Dollar  -  $'],
              ['€', 'Euro  -  €'],
              ['£', 'British Pound  -  £'],
              ['AED ', 'UAE Dirham  -  AED 100'],
            ].map(([sym, lbl]) => (
              <option key={lbl} value={sym}>{lbl}</option>
            ))}
          </select>
          <input className="input mt-1" type="text"
            placeholder="Or type a custom symbol (e.g. 'SGD ')"
            value={cfg.currency_symbol_custom ?? ''}
            onChange={(e) => setCfg({ ...cfg,
              currency_symbol_custom: e.target.value,
              currency_symbol: e.target.value
                || cfg.currency_symbol })} />
          <div className="mt-1 text-[10.5px] text-sub-text">
            Preview: <span className="font-bold">
              {(cfg.currency_symbol_custom
                || cfg.currency_symbol || '₹')}1,00,000
            </span>
          </div>
        </div>
      </div>

      {/* Kundli report pricing - every report defined in
          shared/reportTypes.js gets a price field. Blank = revert
          to defaultPrice. Free reports stay free. */}
      <h2 className="mt-6 mb-2 text-lg font-bold">Kundli report pricing</h2>
      <p className="mb-2 text-xs text-sub-text">
        Per-report price (₹). Read live by the customer buy button
        and by the relay's wallet deduction. Leave blank to fall
        back to the default below.
      </p>
      <div className="surface space-y-3 p-4">
        {REPORT_TYPES.map((t) => {
          const key = `kundli_${t.id}_price`;
          return (
            <div key={t.id}>
              <label className="text-sm text-sub-text">
                {t.name}
                <span className="ml-2 text-[10px] text-sub-text">
                  default ₹{t.defaultPrice}
                </span>
              </label>
              <input className="input" type="number" min={0}
                placeholder={String(t.defaultPrice)}
                value={cfg[key] ?? ''}
                onChange={(e) =>
                  setCfg({ ...cfg, [key]: e.target.value })} />
            </div>
          );
        })}
        <button onClick={save} className="btn-grad w-full justify-center">
          Save Settings
        </button>
      </div>

      {/* ── PLATFORM BEHAVIOR ──────────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-lg font-bold"
        style={{ color: '#7F2020' }}>
        Platform Behavior
      </h2>
      <p className="mb-2 text-xs text-sub-text">
        Controls live quiz scoring, desktop stream handling, astrologer
        portal layout, and chat session timeouts.
      </p>

      <div className="surface space-y-5 p-4"
        style={{ borderTop: '3px solid #D4A12A',
                 background: '#FFF8E7' }}>

        {/* LIVE QUIZ */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide"
            style={{ color: '#7F2020' }}>
            Live Quiz
          </div>
          <div>
            <label className="text-sm text-sub-text">
              Quiz points per correct answer
            </label>
            <input
              className="input"
              type="number"
              min={1}
              value={cfg.live_quiz_points ?? 10}
              onChange={(e) =>
                setCfg({ ...cfg, live_quiz_points: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-sub-text">
              Astrologers cannot change this value. Points awarded per
              correct answer.
            </p>
          </div>
        </div>

        <hr style={{ borderColor: '#D4A12A', opacity: 0.4 }} />

        {/* DESKTOP LIVE */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide"
            style={{ color: '#7F2020' }}>
            Desktop Live
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-sub-text">
                When a PC user opens a live stream
              </label>
              <select
                className="input"
                value={cfg.live_desktop_mode || 'redirect'}
                onChange={(e) =>
                  setCfg({ ...cfg, live_desktop_mode: e.target.value })}>
                <option value="show">Show live as-is</option>
                <option value="redirect">Redirect to app download</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-sub-text">
                App download URL
              </label>
              <input
                className="input"
                type="text"
                placeholder="https://play.google.com/store/apps/details?id=..."
                value={cfg.live_app_download_url ?? 'https://play.google.com/store/apps/details?id=com.astroseer.mobile'}
                onChange={(e) =>
                  setCfg({ ...cfg,
                    live_app_download_url: e.target.value })}
              />
            </div>
          </div>
        </div>

        <hr style={{ borderColor: '#D4A12A', opacity: 0.4 }} />

        {/* ASTROLOGER PORTAL */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide"
            style={{ color: '#7F2020' }}>
            Astrologer Portal
          </div>
          <div>
            <label className="text-sm text-sub-text">
              How chat appears on desktop for astrologers
            </label>
            <select
              className="input"
              value={cfg.astro_chat_desktop_layout || 'sidebar'}
              onChange={(e) =>
                setCfg({ ...cfg,
                  astro_chat_desktop_layout: e.target.value })}>
              <option value="full">Full screen (current)</option>
              <option value="sidebar">Side panel (like support widget)</option>
            </select>
            <p className="mt-1 text-[11px] text-sub-text">
              Mobile and tablet always use full screen.
            </p>
          </div>
        </div>

        <hr style={{ borderColor: '#D4A12A', opacity: 0.4 }} />

        {/* CHAT INACTIVITY */}
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide"
            style={{ color: '#7F2020' }}>
            Chat Inactivity
          </div>
          <div>
            <label className="text-sm text-sub-text">
              Auto-end chat after inactivity (minutes)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              value={cfg.chat_inactivity_minutes ?? 3}
              onChange={(e) =>
                setCfg({ ...cfg,
                  chat_inactivity_minutes: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-sub-text">
              Chat sessions auto-end if no customer message is received
              for this many minutes.
            </p>
          </div>
        </div>

        <button onClick={save}
          className="btn-grad w-full justify-center"
          style={{ background: '#7F2020', borderColor: '#7F2020' }}>
          Save Platform Behavior
        </button>
      </div>

      <WalletReconcile />
    </Layout>
  );
}

function WalletReconcile() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('scan');

  async function run(apply) {
    setBusy(true);
    setResult(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch(`${relayUrl()}/api/adminTools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tool: 'reconcileWallet', apply }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'request failed');
      setResult(j);
      flash(apply
        ? `Reconciled ${j.mismatches} wallet(s)`
        : `Found ${j.mismatches} mismatch(es) across ${j.scanned} users`);
    } catch (e) {
      flash(String(e.message || e), 'error');
    } finally { setBusy(false); }
  }

  return (
    <>
      <h2 className="mt-8 mb-2 text-lg font-bold">Wallet Health</h2>
      <p className="mb-2 text-xs text-sub-text">
        Scan all user wallets against transaction ledger to find
        mismatches. Apply to fix drifted balances.
      </p>
      <div className="surface space-y-3 p-4">
        <div className="flex gap-2">
          <button disabled={busy}
            onClick={() => { setMode('scan'); run(false); }}
            className="btn-outline flex-1 justify-center">
            {busy && mode === 'scan' ? 'Scanning...' : 'Scan (dry run)'}
          </button>
          <button disabled={busy}
            onClick={() => { setMode('fix'); run(true); }}
            className="btn-grad flex-1 justify-center">
            {busy && mode === 'fix'
              ? 'Reconciling...' : 'Scan & Fix'}
          </button>
        </div>
        {result && (
          <div className="rounded-lg bg-bg-light p-3 text-sm">
            <p className="font-semibold">
              Scanned {result.scanned} users
              {result.applied ? ' - APPLIED' : ' - dry run'}
            </p>
            {result.mismatches === 0 && (
              <p className="mt-1 text-green-700">
                All wallets match their transaction ledger.
              </p>
            )}
            {result.mismatches > 0 && (
              <>
                <p className="mt-1 text-amber-700">
                  {result.mismatches} mismatch(es) found
                </p>
                <div className="mt-2 max-h-60 overflow-auto text-xs">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b text-sub-text">
                        <th className="pb-1">User</th>
                        <th className="pb-1">Current</th>
                        <th className="pb-1">Correct</th>
                        <th className="pb-1">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.results || []).map((r) => (
                        <tr key={r.uid} className="border-b border-bg-light">
                          <td className="py-1">
                            {r.name || r.email || r.userCode || r.uid}
                          </td>
                          <td className="py-1">
                            {'₹'}{r.current}
                          </td>
                          <td className="py-1">
                            {'₹'}{r.correct}
                          </td>
                          <td className={`py-1 font-semibold ${
                            r.diff > 0 ? 'text-green-700'
                              : r.diff < 0 ? 'text-rose-700'
                                : ''}`}>
                            {r.diff > 0 ? '+' : ''}{'₹'}{r.diff}
                            {r.applied ? ' ✓' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
