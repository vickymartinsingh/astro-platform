import { useEffect, useState } from 'react';
import { db, adminService, themeService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { THEMES, applyTheme } = themeService;

export default function AdminTheme() {
  const { loading } = useRequireAdmin();
  const [active, setActive] = useState('classic');
  const [saved, setSaved] = useState('classic');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'theme')).then((s) => {
      const a = (s.exists() && s.data().active) || 'classic';
      setActive(a); setSaved(a);
    });
  }, []);

  // Live preview while choosing; reverts to saved on unmount.
  useEffect(() => { applyTheme(active); }, [active]);
  useEffect(() => () => applyTheme(saved), [saved]);

  async function save() {
    await adminService.updateSettings('theme', { active });
    setSaved(active);
    flash('Theme applied across the whole app');
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Theme</h1>
      <p className="mb-3 text-sm text-sub-text">
        Pick a colour theme. Saving applies it instantly across the
        client, astrologer and admin apps + web - one click, no rebuild.
        You can switch back any time.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.entries(THEMES).map(([id, t]) => (
          <button key={id} onClick={() => setActive(id)}
            className={`card text-left transition ${active === id
              ? 'ring-2 ring-primary' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="font-bold">{t.label}</div>
              {saved === id && (
                <span className="badge bg-success/15 text-success">
                  Active
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {t.swatch.map((c) => (
                <span key={c} className="h-9 w-9 rounded-full"
                  style={{ background: c }} />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <span className="rounded-full px-3 py-1 text-xs
                font-semibold text-white"
                style={{
                  backgroundImage:
                    `linear-gradient(135deg, ${t.gradA}, ${t.gradB})` }}>
                Button preview
              </span>
            </div>
          </button>
        ))}
      </div>

      <button onClick={save}
        className="btn-primary mt-4 w-full">
        Apply &quot;{(THEMES[active] || {}).label}&quot; everywhere
      </button>
    </Layout>
  );
}
