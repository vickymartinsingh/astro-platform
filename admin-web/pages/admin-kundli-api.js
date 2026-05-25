import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Kundli API providers. `supported` = a working adapter is wired in the
// relay (just paste the key and it works). The rest are listed so you
// can store the key now; their adapter is added on request with docs.
const PROVIDERS = [
  // AstroSeer — our own Render-hosted API. POST {baseUrl}/api/kundli
  // with X-API-Key header. The "secret" slot doubles as an optional
  // base-URL override so you can rotate hosts (Render preview, custom
  // domain) without redeploying the relay.
  ['astroseer', 'AstroSeer API (our own, Render)', true,
    ['API Key (as_live_…)', 'Base URL override (optional)']],
  ['prokerala', 'Prokerala', true, ['Client ID', 'Client Secret']],
  ['astrologyapi', 'AstrologyAPI.com', true, ['User ID', 'API Key']],
  ['vedicastroapi', 'VedicAstroAPI.com', true, ['API Key', '']],
  ['freeastrologyapi', 'FreeAstrologyAPI.com', true, ['API Key', '']],
  ['divineapi', 'Divine API', false, ['API Key', 'Auth Token']],
  ['vedika', 'Vedika.io', false, ['API Key', '']],
  ['vedicrishi', 'VedicRishi Astro', false, ['User ID', 'API Key']],
  ['kundliclick', 'Kundli.click', false, ['API Key', '']],
  ['vedastro', 'VedAstro', false, ['API Key', '']],
  ['astroapi', 'Astro-API.com', false, ['API Key', '']],
  ['rapidapi_astro', 'RapidAPI - Astrology', false, ['RapidAPI Key', '']],
  ['horoscopeapi', 'HoroscopeAPI.com', false, ['API Key', '']],
  ['aztro', 'Aztro', false, ['API Key', '']],
  ['astrotalkapi', 'Astrotalk API', false, ['API Key', '']],
  ['ai_astrologer', 'AI Astrologer API', false, ['API Key', '']],
  ['bejan', 'Bejan Daruwalla API', false, ['API Key', '']],
  ['ganeshaspeaks', 'GaneshaSpeaks API', false, ['API Key', '']],
  ['astroyogi', 'Astroyogi API', false, ['API Key', '']],
  ['clickastro', 'Clickastro API', false, ['API Key', '']],
  ['mpanchang', 'mPanchang API', false, ['API Key', '']],
  ['drikpanchang', 'DrikPanchang API', false, ['API Key', '']],
  ['astrosage', 'AstroSage API', false, ['API Key', '']],
  ['onlinejyotish', 'OnlineJyotish API', false, ['API Key', '']],
  ['astrologo', 'AstroLogo API', false, ['API Key', '']],
  ['swisseph', 'Swiss Ephemeris (self)', false, ['', '']],
  ['jyotishapi', 'JyotishAPI', false, ['API Key', '']],
  ['horoapi', 'Horo API', false, ['API Key', '']],
  ['astrodatabank', 'AstroDatabank API', false, ['API Key', '']],
  ['custom', 'Custom (own endpoint)', false, ['Base URL', 'API Key']],
];

export default function AdminKundliApi() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);

  async function runProbe() {
    setProbing(true); setProbe(null);
    try {
      const push = (typeof process !== 'undefined' && process.env
        && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
      const base = push
        || 'https://astro-platform-push-relay.vercel.app/api/sendPush';
      const url = base.replace(/\/sendPush\/?$/, '/kundli') + '?probe=1';
      const r = await fetch(url);
      setProbe(await r.json());
    } catch (e) {
      setProbe({ error: String(e && e.message || e) });
    }
    setProbing(false);
  }

  useEffect(() => {
    getDoc(doc(db, 'settings', 'kundliApi')).then((s) =>
      setCfg(s.exists() ? s.data() : { provider: 'prokerala' }));
  }, []);

  async function save(nextProvider) {
    const next = nextProvider
      ? { ...cfg, provider: nextProvider } : cfg;
    setCfg(next);
    await adminService.updateSettings('kundliApi', next);
    const nm = (PROVIDERS.find((x) => x[0] === next.provider) || [])[1];
    setMsg(`Saved. ${nm} is now the active Kundli provider for the `
      + 'whole app.');
    flash(`Saved - ${nm} is now the active Kundli provider`);
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const cur = PROVIDERS.find((p) => p[0] === cfg.provider) || PROVIDERS[0];
  const fields = cur[3];
  const withKeys = PROVIDERS.filter(
    (x) => (cfg[x[0]] || {}).key || (cfg[x[0]] || {}).secret);
  // ALWAYS include the active provider in the list (even Prokerala
  // running from server credentials with no key saved here), so it is
  // visible and you can enable / disable / switch it yourself.
  const configured = withKeys.some((x) => x[0] === cfg.provider)
    ? withKeys
    : [PROVIDERS.find((x) => x[0] === cfg.provider), ...withKeys]
      .filter(Boolean);
  const activeName = (PROVIDERS.find(
    (x) => x[0] === cfg.provider) || [])[1] || cfg.provider;
  const selHasKey = !!((cfg[cfg.provider] || {}).key
    || (cfg[cfg.provider] || {}).secret);

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Kundli API Provider</h1>
      <p className="mb-3 text-sm text-sub-text">
        Choose a provider and paste its key. Providers marked Supported
        work immediately. The Kundli service reads this configuration, so
        no code change or redeploy is needed when you switch.
      </p>
      {msg && (
        <div className="card mb-3 bg-success/10 text-success">{msg}</div>
      )}

      <div className="card mb-3 bg-primary/5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-sub-text">
              Active provider
            </div>
            <div className="text-lg font-bold text-primary">
              {activeName}
            </div>
            <div className="text-xs text-sub-text">
              The whole app (client + astrologer) uses this for every
              Kundli.
            </div>
          </div>
          <button onClick={runProbe} disabled={probing}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5
              text-xs font-bold text-white disabled:opacity-60">
            {probing ? 'Testing…' : 'Test active provider'}
          </button>
        </div>
        {probe && (
          <div className="mt-3 rounded-card border border-gray-200
            bg-white p-2 text-xs">
            {probe.error ? (
              <div className="text-danger">
                ❌ Relay unreachable: {probe.error}
              </div>
            ) : (
              <>
                <div>Relay says provider:{' '}
                  <b className="text-primary">{probe.provider}</b></div>
                <div>Firestore read by relay:{' '}
                  {probe.adminInit
                    ? <span className="text-success">✅ working</span>
                    : <span className="text-danger">❌ FAILED</span>}
                </div>
                <div>Key present for this provider:{' '}
                  {probe.hasKey
                    ? <span className="text-success">✅ yes</span>
                    : <span className="text-warning">⚠ no</span>}
                </div>
                {probe.providerNote && (
                  <p className="mt-1 text-warning">{probe.providerNote}</p>
                )}
                {probe.provider === 'astroseer' && (
                  <div className="mt-2 space-y-0.5 border-t border-gray-100
                                  pt-2 text-[11px]">
                    <div>Base URL in use:{' '}
                      <code className="break-all">
                        {probe.baseUrlInUse || '(default)'}
                      </code>
                    </div>
                    <div>
                      ASTROSEER_API_URL env on relay:{' '}
                      {probe.envUrl
                        ? <span className="text-success">✅ set</span>
                        : <span className="text-warning">⚠ not set</span>}
                    </div>
                    <div>
                      ASTROSEER_API_KEY env on relay:{' '}
                      {probe.envKey
                        ? <span className="text-success">✅ set</span>
                        : <span className="text-warning">⚠ not set</span>}
                    </div>
                    <div>
                      Firestore key saved:{' '}
                      {probe.firestoreKey
                        ? <span className="text-success">✅ yes</span>
                        : <span className="text-sub-text">— no</span>}
                    </div>
                    <div>
                      <code>/health</code> ping:{' '}
                      {probe.healthError
                        ? <span className="text-danger">
                            ❌ {probe.healthError}
                          </span>
                        : probe.healthStatus === 200
                          ? <span className="text-success">
                              ✅ HTTP 200
                            </span>
                          : <span className="text-warning">
                              HTTP {probe.healthStatus || '?'}
                            </span>}
                    </div>
                    {probe.health && (
                      <pre className="mt-1 max-h-32 overflow-auto
                                       rounded bg-bg-light p-1 text-[10px]
                                       leading-tight">
                        {JSON.stringify(probe.health, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
                {!probe.adminInit && (
                  <p className="mt-1 text-danger">
                    The push-relay's <code>FIREBASE_SERVICE_ACCOUNT</code>
                    {' '}env var is not set on Vercel. Until it is, the
                    relay can't read settings/kundliApi and silently
                    falls back to Prokerala - that's why VedicAstroAPI
                    is being skipped.
                  </p>
                )}
                {probe.provider !== cfg.provider && (
                  <p className="mt-1 text-warning">
                    ⚠ Saved provider <b>{cfg.provider}</b> ≠ relay's{' '}
                    <b>{probe.provider}</b>. Fix env / redeploy relay.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {configured.length > 0 && (
        <div className="card mb-3">
          <div className="mb-2 text-sm font-semibold">
            Your providers - tap one to enable it (make it active)
          </div>
          <div className="space-y-2">
            {configured.map(([id, label]) => {
              const isActive = cfg.provider === id;
              const hasKey = !!((cfg[id] || {}).key
                || (cfg[id] || {}).secret);
              return (
                <div key={id}
                  className="flex items-center justify-between gap-3
                    rounded-card border border-gray-200 p-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{label}</div>
                    <div className="text-xs text-sub-text">
                      {hasKey ? 'Key saved here'
                        : 'No key saved here (server credentials)'}
                    </div>
                  </div>
                  {isActive ? (
                    <span className="rounded-full bg-success/15 px-3
                      py-1 text-xs font-semibold text-success">
                      Active / Enabled
                    </span>
                  ) : (
                    <button onClick={() => save(id)}
                      className="rounded-full border border-primary px-3
                        py-1.5 text-sm font-semibold text-primary">
                      Enable
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <label className="text-sm font-semibold">
          Provider (select + add key, then Save to make it the default)
        </label>
        <select className="input" value={cfg.provider}
          onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
          {PROVIDERS.map(([id, label, sup]) => (
            <option key={id} value={id}>
              {label}{sup ? ' - Supported' : ' - config only'}
            </option>
          ))}
        </select>

        {fields[0] && (
          <input className="input" placeholder={fields[0]}
            value={(cfg[cfg.provider] || {}).key || ''}
            onChange={(e) => setCfg({
              ...cfg,
              [cfg.provider]: {
                ...(cfg[cfg.provider] || {}), key: e.target.value },
            })} />
        )}
        {fields[1] && (
          <input className="input" placeholder={fields[1]}
            value={(cfg[cfg.provider] || {}).secret || ''}
            onChange={(e) => setCfg({
              ...cfg,
              [cfg.provider]: {
                ...(cfg[cfg.provider] || {}), secret: e.target.value },
            })} />
        )}

        {!selHasKey && (
          <div className="rounded-card bg-bg-light p-3 text-xs
                          text-sub-text">
            No key is stored here for {cur[1]}. If it is working anyway
            it is running from server credentials. Paste the key above
            and Save to manage it from this panel.
          </div>
        )}

        {!cur[2] && (
          <div className="rounded-card bg-warning/10 p-3 text-sm
                          text-warning">
            This provider is listed so you can store the key now. Send me
            its API docs and I will wire the adapter; until then the
            Kundli service falls back to the last Supported provider with
            a key, or basic zodiac.
          </div>
        )}

        <div className="rounded-card bg-warning/10 p-3 text-xs
                        text-warning">
          Note: a saved key only takes effect once the Kundli relay can
          read settings. If new keys are &quot;not updating&quot;, the
          relay&apos;s FIREBASE_SERVICE_ACCOUNT on Vercel is the cause
          (same fix as push) - until then it falls back to Prokerala
          server credentials.
        </div>

        <button onClick={() => save()} className="btn-primary w-full">
          Save & set as default provider
        </button>
      </div>

      <div className="card mt-4 text-xs text-sub-text">
        Tip: Prokerala and AstrologyAPI.com are the most reliable for
        full Kundli (ascendant, planets, dasha, charts). All providers
        ultimately use the Swiss Ephemeris, so planetary data is
        consistent across them.
      </div>
    </Layout>
  );
}
