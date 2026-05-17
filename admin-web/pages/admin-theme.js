import { useEffect, useState } from 'react';
import { adminService, themeService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { THEMES, applyTheme } = themeService;
const BLANK = {
  label: '', primary: '#6C2BD9', bgLight: '#F3EEFF',
  gradA: '#6C2BD9', gradB: '#8B5CF6', tarot: '#2A1A63',
};

export default function AdminTheme() {
  const { loading } = useRequireAdmin();
  const [docData, setDocData] = useState(null); // {active, custom}
  const [draft, setDraft] = useState(BLANK);

  useEffect(() => {
    themeService.getThemeDoc().then((d) =>
      setDocData({ active: d.active || 'classic',
        custom: d.custom || {} }));
  }, []);

  // Live preview of the active selection; restore on unmount.
  useEffect(() => {
    if (!docData) return undefined;
    const all = { ...THEMES, ...(docData.custom || {}) };
    applyTheme(all[docData.active] || THEMES.classic);
    return () => themeService.watchTheme();
  }, [docData]);

  if (loading || !docData) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const all = { ...THEMES, ...(docData.custom || {}) };

  async function persist(next) {
    setDocData(next);
    await adminService.updateSettings('theme', next);
  }
  async function setActive(id) {
    await persist({ ...docData, active: id });
    flash(`"${(all[id] || {}).label || id}" applied across the app`);
  }
  async function saveCustom() {
    if (!draft.label.trim()) { flash('Enter a theme name', 'error');
      return; }
    const id = 'custom_' + draft.label.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    const custom = { ...(docData.custom || {}),
      [id]: { ...draft, label: draft.label.trim(),
        swatch: [draft.primary, draft.gradB, draft.tarot] } };
    await persist({ ...docData, custom });
    setDraft(BLANK);
    flash('Custom theme saved to the list');
  }
  async function delCustom(id) {
    if (!window.confirm('Delete this custom theme?')) return;
    const custom = { ...(docData.custom || {}) };
    delete custom[id];
    const active = docData.active === id ? 'classic' : docData.active;
    await persist({ ...docData, custom, active });
    flash('Custom theme deleted');
  }

  const Field = ({ k, label }) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="color" value={draft[k]}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
        className="h-9 w-14 rounded border" />
    </label>
  );

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Theme</h1>
      <p className="mb-3 text-sm text-sub-text">
        Pick a theme or build your own. Saving applies it instantly
        across client + astrologer + admin apps and web - installed
        apps re-skin live, no reinstall. The tarot card colour is
        themed too.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {[t.primary, t.gradB, t.tarot].map((c, i) => (
                <span key={i} className="h-9 w-9 rounded-full"
                  style={{ background: c }} />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setActive(id)}
                className="btn-primary !min-h-0 px-4 py-2 text-sm">
                {docData.active === id ? 'Active' : 'Set active'}
              </button>
              {!THEMES[id] && (
                <button onClick={() => delCustom(id)}
                  className="rounded-card border border-danger px-3
                    text-sm text-danger">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">Create a custom theme</h2>
      <div className="card space-y-2">
        <input className="input" placeholder="Theme name"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <Field k="primary" label="Primary colour" />
        <Field k="gradA" label="Gradient start" />
        <Field k="gradB" label="Gradient end" />
        <Field k="bgLight" label="Soft background" />
        <Field k="tarot" label="Tarot card colour" />
        <button onClick={saveCustom} className="btn-primary w-full">
          Save custom theme to the list
        </button>
      </div>
    </Layout>
  );
}
