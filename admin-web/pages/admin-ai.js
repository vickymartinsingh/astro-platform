import { useEffect, useState } from 'react';
import {
  db, adminService, astrologerService, assistantService,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { AI_PROVIDERS } = assistantService;

// AI Assistant control panel. Admin can manage:
//   1. AI providers + API keys (Gemini free, Groq free, OpenRouter,
//      OpenAI, Bedrock) and the preferred order. Keys are saved in
//      Firestore (admin-only) and read live by the push-relay.
//   2. The Vercel Deploy Hook URL + a Deploy button to push a fresh
//      relay deployment in one click.
//   3. Master enable + scope (which astrologers can use the assistant).
//   4. Random human-like reply delay.
export default function AdminAi() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);          // settings/config
  const [providers, setProviders] = useState(null); // settings/aiProviders
  const [astros, setAstros] = useState([]);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    if (loading) return;
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setCfg(s.exists() ? s.data() : {})).catch(() => setCfg({}));
    assistantService.getAiProviders().then((p) => {
      // Seed with defaults if empty.
      const list = Array.isArray(p.providers) ? p.providers : [];
      const map = Object.fromEntries(list.map((r) => [r.id, r]));
      const merged = AI_PROVIDERS.map((d) => ({
        id: d.id,
        enabled: !!(map[d.id] && map[d.id].enabled),
        apiKey: (map[d.id] && map[d.id].apiKey) || '',
        model: (map[d.id] && map[d.id].model) || d.defaultModel || '',
        region: (map[d.id] && map[d.id].region) || d.defaultRegion || '',
        modelId: (map[d.id] && map[d.id].modelId) || '',
      }));
      const order = Array.isArray(p.order) && p.order.length
        ? p.order : AI_PROVIDERS.map((d) => d.id);
      setProviders({
        providers: merged, order,
        deployHookUrl: p.deployHookUrl || '',
      });
    });
    astrologerService.getAstrologers().then((l) => setAstros(l || []))
      .catch(() => {});
  }, [loading]);

  if (loading || !cfg || !providers) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const set = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const selected = Array.isArray(cfg.ai_astrologers)
    ? cfg.ai_astrologers : [];
  const toggleAstro = (id) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id) : [...selected, id];
    set('ai_astrologers', next);
  };

  function updProvider(id, patch) {
    setProviders((p) => ({ ...p,
      providers: p.providers.map((r) => (r.id === id
        ? { ...r, ...patch } : r)) }));
  }
  function moveProvider(id, dir) {
    setProviders((p) => {
      const order = [...p.order];
      const i = order.indexOf(id);
      if (i < 0) return p;
      const j = i + dir;
      if (j < 0 || j >= order.length) return p;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...p, order };
    });
  }

  async function runProbe() {
    setProbing(true);
    setProbe(await assistantService.probeAi());
    setProbing(false);
  }

  const dMin = Number.isFinite(+cfg.ai_delay_min) ? +cfg.ai_delay_min : 3;
  const dMax = Number.isFinite(+cfg.ai_delay_max) ? +cfg.ai_delay_max : 9;

  async function saveAll() {
    setBusy(true);
    try {
      const lo = Math.max(0, Math.round(dMin));
      const hi = Math.max(lo, Math.round(dMax));
      await adminService.updateSettings('config', {
        ai_enabled: !!cfg.ai_enabled,
        ai_scope: cfg.ai_scope === 'selected' ? 'selected' : 'all',
        ai_astrologers: selected,
        ai_delay_min: lo,
        ai_delay_max: hi,
        // Force on for every astrologer in scope. Default true so it
        // works even when an astrologer's old aiAssistant flag is false.
        ai_force_all: cfg.ai_force_all !== false,
      });
      await assistantService.saveAiProviders({
        providers: providers.providers,
        order: providers.order,
        deployHookUrl: providers.deployHookUrl || '',
      });
      flash('Saved. Keys are live on the relay within ~30 seconds.');
    } catch (e) {
      flash(`Could not save: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  async function deployNow() {
    if (!providers.deployHookUrl) {
      flash('Add a Vercel Deploy Hook URL first, then save.', 'error');
      return;
    }
    setDeploying(true);
    try {
      await assistantService.triggerDeploy(providers.deployHookUrl);
      flash('Deploy queued. Vercel is rebuilding the relay now.');
    } catch (e) {
      flash(`Deploy failed: ${e.message || e}`, 'error');
    } finally { setDeploying(false); }
  }

  function metaFor(id) { return AI_PROVIDERS.find((m) => m.id === id) || {}; }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">AI Assistant</h1>
      <p className="mb-4 text-sm text-sub-text">
        Let astrologers turn on an AI that auto-replies to chat
        consultations on their behalf. Add a provider API key below, save,
        and the relay starts using it within ~30 seconds. The “Deploy
        now” button pushes a fresh relay deployment to Vercel in one
        click.
      </p>

      {/* Live key status */}
      <div className="card mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Live relay status</div>
          <button onClick={runProbe} disabled={probing}
            className="rounded-full bg-primary px-3 py-1.5 text-xs
              font-bold text-white disabled:opacity-60">
            {probing ? 'Checking…' : 'Check'}
          </button>
        </div>
        {probe && (
          <div className="mt-2 text-sm">
            {probe.configured ? (
              <>
                <span className="text-success">✓ Relay ready.</span>{' '}
                {Array.isArray(probe.active) && probe.active.length > 0 && (
                  <span>Active: <b>{probe.active.join(', ')}</b></span>
                )}
                {probe.hasDeployHook
                  ? <span className="ml-2 text-success">· deploy hook ✓</span>
                  : <span className="ml-2 text-sub-text">· no deploy hook</span>}
              </>
            ) : (
              <span className="text-danger">✗ No active provider on the
                relay. Add a key + enable a provider below, then Save.
                {probe.error ? ` (${probe.error})` : ''}</span>
            )}
          </div>
        )}
      </div>

      {/* PROVIDERS LIST */}
      <div className="card mb-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">AI providers &amp; API keys</div>
          <span className="text-[11px] text-sub-text">
            Tried in order. First success wins.
          </span>
        </div>
        {providers.order.map((id, idx) => {
          const p = providers.providers.find((r) => r.id === id);
          if (!p) return null;
          const m = metaFor(id);
          return (
            <div key={id}
              className="rounded-card border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between
                gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!p.enabled}
                    onChange={(e) => updProvider(id,
                      { enabled: e.target.checked })} />
                  <span className="font-semibold">{m.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px]
                    font-bold ${m.tag === 'Free'
                      ? 'bg-emerald-100 text-emerald-700'
                      : m.tag === 'Mixed'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-700'}`}>{m.tag}</span>
                </label>
                <div className="flex gap-1 text-xs">
                  <button type="button" disabled={idx === 0}
                    onClick={() => moveProvider(id, -1)}
                    className="rounded bg-bg-light px-2 py-1 font-bold
                      disabled:opacity-30">↑</button>
                  <button type="button"
                    disabled={idx === providers.order.length - 1}
                    onClick={() => moveProvider(id, 1)}
                    className="rounded bg-bg-light px-2 py-1 font-bold
                      disabled:opacity-30">↓</button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  API key
                  <input type="password" autoComplete="new-password"
                    placeholder={p.apiKey ? '(saved)' : 'paste key here'}
                    value={p.apiKey}
                    onChange={(e) => updProvider(id,
                      { apiKey: e.target.value })}
                    className="input mt-1 font-mono text-xs" />
                </label>
                {m.fields && m.fields.includes('model') && (
                  <label className="block text-sm">
                    Model
                    <input className="input mt-1" value={p.model || ''}
                      placeholder={m.defaultModel}
                      onChange={(e) => updProvider(id,
                        { model: e.target.value })} />
                  </label>
                )}
                {m.fields && m.fields.includes('region') && (
                  <label className="block text-sm">
                    Region
                    <input className="input mt-1" value={p.region || ''}
                      placeholder={m.defaultRegion}
                      onChange={(e) => updProvider(id,
                        { region: e.target.value })} />
                  </label>
                )}
                {m.fields && m.fields.includes('modelId') && (
                  <label className="block text-sm">
                    Model ID (optional)
                    <input className="input mt-1" value={p.modelId || ''}
                      placeholder="auto-pick"
                      onChange={(e) => updProvider(id,
                        { modelId: e.target.value })} />
                  </label>
                )}
              </div>
              {m.keyHelp && (
                <p className="mt-1 text-[11px] text-sub-text">
                  Get a key: {m.keyHelp}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* DEPLOY HOOK */}
      <div className="card mb-3">
        <div className="mb-1 font-semibold">Vercel Deploy Hook</div>
        <p className="text-[11px] text-sub-text">
          Vercel → push-relay project → Settings → Git → Deploy Hooks →
          Create Hook → paste the URL here. Save, then click “Deploy now”
          any time to push a fresh relay deployment.
        </p>
        <input className="input mt-2 font-mono text-xs"
          placeholder="https://api.vercel.com/v1/integrations/deploy/..."
          value={providers.deployHookUrl || ''}
          onChange={(e) => setProviders((p) => ({ ...p,
            deployHookUrl: e.target.value }))} />
        <div className="mt-2 flex gap-2">
          <button onClick={saveAll} disabled={busy}
            className="btn-primary">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={deployNow} disabled={deploying
            || !providers.deployHookUrl}
            className="rounded-card bg-emerald-600 px-4 py-2 text-sm
              font-bold text-white disabled:opacity-60">
            {deploying ? 'Deploying…' : 'Deploy now'}
          </button>
        </div>
      </div>

      {/* MASTER + SCOPE */}
      <div className="card space-y-3">
        <label className="flex items-center justify-between">
          <span className="font-semibold">Enable AI Assistant for
            astrologers</span>
          <input type="checkbox" checked={!!cfg.ai_enabled}
            onChange={(e) => set('ai_enabled', e.target.checked)} />
        </label>

        {/* Force-all: ignore per-astrologer aiAssistant flag. Default
            ON so a stray "false" left by earlier toggle tests doesn't
            silently disable AI for that astrologer. */}
        <label className="flex items-start justify-between gap-3 rounded-card
          bg-bg-light p-3">
          <span className="text-sm">
            <span className="font-semibold">Force on for every astrologer in
              scope</span>
            <span className="mt-0.5 block text-[11px] text-sub-text">
              When ON, the AI runs for every astrologer in the chosen scope
              even if their personal AI toggle is off. Recommended.
            </span>
          </span>
          <input type="checkbox"
            checked={cfg.ai_force_all !== false}
            onChange={(e) => set('ai_force_all', e.target.checked)} />
        </label>

        {cfg.ai_enabled && (
          <>
            <label className="block text-sm">
              Who can use it
              <select className="input mt-1"
                value={cfg.ai_scope === 'selected' ? 'selected' : 'all'}
                onChange={(e) => set('ai_scope', e.target.value)}>
                <option value="all">All astrologers</option>
                <option value="selected">Selected astrologers only</option>
              </select>
            </label>

            {cfg.ai_scope === 'selected' && (
              <div className="rounded-card border border-gray-200 p-2">
                <div className="mb-1 text-xs font-semibold text-sub-text">
                  Pick astrologers ({selected.length} selected)
                </div>
                <div className="max-h-72 space-y-1 overflow-auto">
                  {astros.length === 0 && (
                    <div className="text-xs text-sub-text">
                      No astrologers found.
                    </div>
                  )}
                  {astros.map((a) => (
                    <label key={a.id}
                      className="flex items-center gap-2 rounded-card
                        px-2 py-1.5 text-sm hover:bg-bg-light">
                      <input type="checkbox"
                        checked={selected.includes(a.id)}
                        onChange={() => toggleAstro(a.id)} />
                      <span className="flex-1 truncate">
                        {a.name || a.email || a.id}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-card border border-gray-200 p-2">
              <div className="mb-1 text-xs font-semibold text-sub-text">
                Reply delay (makes auto-replies feel human)
              </div>
              <div className="flex items-end gap-3">
                <label className="block text-sm">
                  Min seconds
                  <input type="number" min="0" className="input mt-1 w-24"
                    value={dMin}
                    onChange={(e) => set('ai_delay_min',
                      Math.max(0, Math.round(+e.target.value || 0)))} />
                </label>
                <label className="block text-sm">
                  Max seconds
                  <input type="number" min="0" className="input mt-1 w-24"
                    value={dMax}
                    onChange={(e) => set('ai_delay_max',
                      Math.max(0, Math.round(+e.target.value || 0)))} />
                </label>
              </div>
              <p className="mt-1 text-[11px] text-sub-text">
                Each AI reply waits a random time between Min and Max
                (plus the “typing…” indicator) so the customer sees a
                natural, human-like pause. Recommended 3-9 seconds.
              </p>
            </div>
          </>
        )}

        <button onClick={saveAll} disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <p className="text-[11px] text-sub-text">
          When enabled, eligible astrologers see an “AI Assistant” toggle
          on their dashboard. With it on, incoming chats are auto-accepted
          and answered by AI in their voice.
        </p>
      </div>
    </Layout>
  );
}
