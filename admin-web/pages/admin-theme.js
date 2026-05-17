import { useEffect, useState } from 'react';
import { adminService, themeService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { THEMES, applyTheme, THEME_FIELDS } = themeService;
const BLANK = {
  label: '', primary: '#6C2BD9', gradA: '#6C2BD9', gradB: '#8B5CF6',
  bgLight: '#F3EEFF', accent: '#DB2777', success: '#1B6B2F',
  warning: '#E67E22', danger: '#C0392B', verify: '#7F2020',
  tarot: '#2A1A63',
};
const MAX_PRESETS = 5;

// Hex text box + colour pointer side by side. The text box lets you
// paste the full code; it never auto-closes.
function ColorField({ label, value, onChange }) {
  const v = value || '#000000';
  const valid = /^#[0-9a-fA-F]{6}$/.test(v);
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input
          className="w-28 rounded border border-gray-300 px-2 py-1
                     font-mono text-xs"
          value={v}
          onChange={(e) => {
            let x = e.target.value.replace(/[^#0-9a-fA-F]/g, '');
            if (!x.startsWith('#')) x = '#' + x.replace(/#/g, '');
            onChange(x.slice(0, 7));
          }} />
        <input type="color" value={valid ? v : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border" />
      </div>
    </div>
  );
}

// Small "this is how the client portal will look" preview. Uses the
// CSS theme vars currently applied (so it reflects the live preview).
function ClientPreview() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="hero-grad rounded-xl p-4 text-white">
        <div className="text-lg font-bold">The stars have answers</div>
        <div className="text-xs opacity-90">Client home hero</div>
        <button className="mt-2 rounded-full bg-white px-3 py-1
          text-xs font-semibold text-primary">Browse astrologers</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary !min-h-0 px-3 py-2 text-xs">
          Primary
        </button>
        <span className="badge bg-bg-light text-primary">Pill</span>
        <span className="badge" style={{ background: 'rgb(var(--c-accent)'
          + ' / .15)', color: 'rgb(var(--c-accent))' }}>Accent</span>
        <span className="badge bg-success/15 text-success">Success</span>
        <span className="badge bg-danger/15 text-danger">Danger</span>
        <span className="h-8 w-8 rounded-lg"
          style={{ background: 'var(--c-tarot2)' }} title="Tarot" />
      </div>
    </div>
  );
}

export default function AdminTheme() {
  const { loading } = useRequireAdmin();
  const [docData, setDocData] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [previewId, setPreviewId] = useState(null);

  useEffect(() => {
    themeService.getThemeDoc().then((d) =>
      setDocData({ active: d.active || 'classic',
        custom: d.custom || {} }));
  }, []);

  // Apply whatever is being previewed; otherwise the saved active one.
  useEffect(() => {
    if (!docData) return;
    const all = { ...THEMES, ...(docData.custom || {}) };
    const id = previewId || docData.active;
    applyTheme(all[id] || THEMES.classic);
  }, [docData, previewId]);
  // Restore the real saved theme when leaving the page.
  useEffect(() => () => themeService.watchTheme(), []);

  if (loading || !docData) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const all = { ...THEMES, ...(docData.custom || {}) };
  const customCount = Object.keys(docData.custom || {}).length;

  async function persist(next) {
    setDocData(next);
    await adminService.updateSettings('theme', next);
  }
  async function setActive(id) {
    setPreviewId(null);
    await persist({ ...docData, active: id });
    flash(`"${(all[id] || {}).label || id}" applied across the app`);
  }
  function customizeFrom(id) {
    const t = all[id] || THEMES.classic;
    setDraft({ ...BLANK, ...t,
      label: (t.label || id) + ' copy' });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: document.body.scrollHeight,
        behavior: 'smooth' });
    }
  }
  async function saveCustom() {
    if (!draft.label.trim()) { flash('Enter a theme name', 'error');
      return; }
    const id = 'custom_' + draft.label.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    const exists = docData.custom && docData.custom[id];
    if (!exists && customCount >= MAX_PRESETS) {
      flash(`Max ${MAX_PRESETS} presets - delete one first`, 'error');
      return;
    }
    const custom = { ...(docData.custom || {}),
      [id]: { ...draft, label: draft.label.trim(),
        swatch: [draft.primary, draft.gradB, draft.tarot] } };
    await persist({ ...docData, custom });
    flash('Preset saved to the list');
  }
  async function delCustom(id) {
    if (!window.confirm('Delete this preset?')) return;
    const custom = { ...(docData.custom || {}) };
    delete custom[id];
    const active = docData.active === id ? 'classic' : docData.active;
    setPreviewId(null);
    await persist({ ...docData, custom, active });
    flash('Preset deleted');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Theme</h1>
      <p className="mb-3 text-sm text-sub-text">
        Preview a theme before applying. Active applies it across client
        + astrologer + admin (and web) instantly - installed apps
        re-skin live. Up to {MAX_PRESETS} custom presets.
      </p>

      {previewId && (
        <div className="card mb-3 flex flex-wrap items-center gap-3
          bg-primary/5">
          <span className="text-sm font-semibold">
            Previewing &quot;{(all[previewId] || {}).label
              || previewId}&quot; (not applied yet). Current:{' '}
            {(all[docData.active] || {}).label || docData.active}
          </span>
          <button onClick={() => setActive(previewId)}
            className="btn-primary !min-h-0 px-4 py-2 text-sm">
            Apply across app
          </button>
          <button onClick={() => setPreviewId(null)}
            className="rounded-card border border-gray-300 px-4 py-2
              text-sm">Cancel preview</button>
        </div>
      )}

      <ClientPreview />

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(all).map(([id, t]) => (
          <div key={id} className={`card ${docData.active === id
            ? 'ring-2 ring-primary' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold">{t.label || id}</div>
              {docData.active === id && (
                <span className="badge bg-success/15 text-success">
                  Active
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {[t.primary, t.gradB, t.accent || t.gradB, t.tarot]
                .map((c, i) => (
                  <span key={i} className="h-8 w-8 rounded-full"
                    style={{ background: c }} />
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setPreviewId(id)}
                className="rounded-card border border-primary px-3
                  py-1.5 text-sm text-primary">Preview</button>
              <button onClick={() => setActive(id)}
                className="btn-primary !min-h-0 px-3 py-1.5 text-sm">
                {docData.active === id ? 'Active' : 'Set active'}
              </button>
              <button onClick={() => customizeFrom(id)}
                className="rounded-card border border-gray-300 px-3
                  py-1.5 text-sm">Customize</button>
              {!THEMES[id] && (
                <button onClick={() => delCustom(id)}
                  className="rounded-card border border-danger px-3
                    py-1.5 text-sm text-danger">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-1 mt-6 text-lg font-bold">
        Custom theme ({customCount}/{MAX_PRESETS} presets)
      </h2>
      <p className="mb-2 text-xs text-sub-text">
        Tip: press &quot;Customize&quot; on any theme above to load its
        exact colour codes here, tweak, and save as a new preset.
      </p>
      <div className="card space-y-2">
        <input className="input" placeholder="Preset name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        {THEME_FIELDS.map(([k, label]) => (
          <ColorField key={k} label={label} value={draft[k]}
            onChange={(v) => setDraft({ ...draft, [k]: v })} />
        ))}
        <button onClick={saveCustom} className="btn-primary w-full">
          Save preset to the list
        </button>
      </div>
    </Layout>
  );
}
