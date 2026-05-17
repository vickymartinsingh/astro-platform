import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Kundli API providers. `supported` = a working adapter is wired in the
// relay (just paste the key and it works). The rest are listed so you
// can store the key now; their adapter is added on request with docs.
const PROVIDERS = [
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
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const cur = PROVIDERS.find((p) => p[0] === cfg.provider) || PROVIDERS[0];
  const fields = cur[3];
  const configured = PROVIDERS.filter(
    (x) => (cfg[x[0]] || {}).key || (cfg[x[0]] || {}).secret);
  const activeName = (PROVIDERS.find(
    (x) => x[0] === cfg.provider) || [])[1] || cfg.provider;

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
        <div className="text-xs uppercase tracking-wide text-sub-text">
          Active provider
        </div>
        <div className="text-lg font-bold text-primary">{activeName}</div>
        <div className="text-xs text-sub-text">
          The whole app (client + astrologer) uses this for every Kundli.
        </div>
      </div>

      {configured.length > 0 && (
        <div className="card mb-3">
          <div className="mb-2 text-sm font-semibold">
            Providers with a saved key (tap to make active)
          </div>
          <div className="flex flex-wrap gap-2">
            {configured.map(([id, label]) => (
              <button key={id} onClick={() => save(id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  cfg.provider === id
                    ? 'bg-primary text-white'
                    : 'border border-gray-200'}`}>
                {label}{cfg.provider === id ? ' (active)' : ''}
              </button>
            ))}
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

        {!cur[2] && (
          <div className="rounded-card bg-warning/10 p-3 text-sm
                          text-warning">
            This provider is listed so you can store the key now. Send me
            its API docs and I will wire the adapter; until then the
            Kundli service falls back to the last Supported provider with
            a key, or basic zodiac.
          </div>
        )}

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
