import { useEffect, useState } from 'react';
import {
  db, adminService, astrologerService, assistantService,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// AI Assistant control. Master on/off, scope (all / selected
// astrologers), and a live check of whether the relay's Bedrock key is
// configured. The actual API key is NEVER entered here - it lives only
// as BEDROCK_API_KEY on the push-relay (Vercel). This page just decides
// who gets the feature.
export default function AdminAi() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [astros, setAstros] = useState([]);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (loading) return;
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setCfg(s.exists() ? s.data() : {})).catch(() => setCfg({}));
    astrologerService.getAstrologers().then((l) => setAstros(l || []))
      .catch(() => {});
  }, [loading]);

  if (loading || !cfg) {
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

  async function runProbe() {
    setProbing(true);
    setProbe(await assistantService.probeAi());
    setProbing(false);
  }
  // Random reply delay (seconds) so AI replies feel typed by a human.
  const dMin = Number.isFinite(+cfg.ai_delay_min) ? +cfg.ai_delay_min : 3;
  const dMax = Number.isFinite(+cfg.ai_delay_max) ? +cfg.ai_delay_max : 9;
  async function save() {
    try {
      const lo = Math.max(0, Math.round(dMin));
      const hi = Math.max(lo, Math.round(dMax));
      await adminService.updateSettings('config', {
        ai_enabled: !!cfg.ai_enabled,
        ai_scope: cfg.ai_scope === 'selected' ? 'selected' : 'all',
        ai_astrologers: selected,
        ai_delay_min: lo,
        ai_delay_max: hi,
      });
      flash('AI settings saved — live for astrologers');
    } catch (_) { flash('Could not save', 'error'); }
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">AI Assistant</h1>
      <p className="mb-4 text-sm text-sub-text">
        Let astrologers turn on an AI that auto-replies to chat
        consultations on their behalf. You control who gets the feature.
        The API key is configured on the server, never here.
      </p>

      {/* Key status */}
      <div className="card mb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Server key (Amazon Bedrock)</div>
          <button onClick={runProbe} disabled={probing}
            className="rounded-full bg-primary px-3 py-1.5 text-xs
              font-bold text-white disabled:opacity-60">
            {probing ? 'Checking…' : 'Check key'}
          </button>
        </div>
        {probe && (
          <div className="mt-2 text-sm">
            {probe.configured
              ? <span className="text-success">✓ Key configured
                  ({probe.model} · {probe.region})</span>
              : <span className="text-danger">✗ Not configured — set
                  BEDROCK_API_KEY on the push-relay (Vercel) and redeploy.
                  {probe.error ? ` (${probe.error})` : ''}</span>}
          </div>
        )}
        <p className="mt-2 text-[11px] text-sub-text">
          The AWS Bedrock API key must be set as the
          <code> BEDROCK_API_KEY</code> environment variable on the
          push-relay project in Vercel — not in the app. Optional:
          <code> BEDROCK_REGION</code>, <code>BEDROCK_MODEL_ID</code>.
        </p>
      </div>

      {/* Master + scope */}
      <div className="card space-y-3">
        <label className="flex items-center justify-between">
          <span className="font-semibold">Enable AI Assistant</span>
          <input type="checkbox" checked={!!cfg.ai_enabled}
            onChange={(e) => set('ai_enabled', e.target.checked)} />
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
                natural, human-like pause. Recommended 3–9 seconds.
              </p>
            </div>
          </>
        )}

        <button onClick={save} className="btn-primary">
          Save &amp; publish
        </button>
        <p className="text-[11px] text-sub-text">
          When enabled, eligible astrologers see an “AI Assistant” toggle
          inside each chat. With it on, incoming chat messages are
          answered automatically in their voice.
        </p>
      </div>
    </Layout>
  );
}
