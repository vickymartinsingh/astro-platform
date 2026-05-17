import { useEffect, useRef, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const TAB_DEFS = [
  ['home', 'Home'], ['chat', 'Chat'], ['live', 'Live'],
  ['call', 'Call'], ['profile', 'Profile'],
];
const HOME_SECTIONS = [
  ['quickActions', 'Quick actions (Tarot/Kundli/etc.)'],
  ['starsToday', 'Your stars today'],
  ['categories', 'Browse by category'],
  ['topRated', 'Top rated astrologers'],
  ['reviews', 'Customer reviews'],
];

export default function AdminBuilder() {
  const { loading } = useRequireAdmin();
  const [feat, setFeat] = useState(null);     // settings/features
  const [ann, setAnn] = useState(null);       // settings/announcement
  const [content, setContent] = useState(null); // settings/content
  const dragKey = useRef(null);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'settings', 'features')),
      getDoc(doc(db, 'settings', 'announcement')),
      getDoc(doc(db, 'settings', 'content')),
    ]).then(([f, a, c]) => {
      const fd = f.exists() ? f.data() : {};
      const keys = TAB_DEFS.map(([k]) => k);
      const prev = Array.isArray(fd.nav_order)
        ? fd.nav_order.filter((k) => keys.includes(k)) : [];
      fd.nav_order = [...prev,
        ...keys.filter((k) => !prev.includes(k))];
      setFeat(fd);
      setAnn(a.exists() ? a.data() : { text: '', ctaLabel: '',
        ctaLink: '', target: 'all', active: false });
      setContent(c.exists() ? c.data() : {});
    });
  }, []);

  if (loading || !feat || !ann || !content) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const order = feat.nav_order;
  function reorder(from, to) {
    if (from === to) return;
    const a = [...order];
    const i = a.indexOf(from); const j = a.indexOf(to);
    a.splice(j, 0, a.splice(i, 1)[0]);
    setFeat({ ...feat, nav_order: a });
  }

  async function saveMenu() {
    await adminService.updateSettings('features', feat);
    flash('Menu saved - live in the client app');
  }
  async function saveBanner() {
    await adminService.updateSettings('announcement', ann);
    flash('Banner saved');
  }
  async function saveContent() {
    await adminService.updateSettings('content', content);
    flash('Home content saved');
  }

  const previewUrl = content.previewUrl || '';

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Builder</h1>
      <p className="mb-4 text-sm text-sub-text">
        Edit the app with no code. Drag to reorder menu tabs, rename or
        hide them, edit the banner and home sections - it changes the
        client app everywhere on Save.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* MENU */}
          <div className="card">
            <div className="mb-2 font-semibold">Bottom menu (drag to
              reorder)</div>
            {order.map((k) => {
              const label = (TAB_DEFS.find(([x]) => x === k) || [])[1]
                || k;
              const hidden = !!feat[`nav_hidden_${k}`];
              return (
                <div key={k} draggable
                  onDragStart={() => { dragKey.current = k; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorder(dragKey.current, k)}
                  className="mb-2 flex items-center gap-2 rounded-card
                    border border-gray-200 bg-white p-2">
                  <span className="cursor-grab select-none px-1
                    text-sub-text">≡</span>
                  <input
                    className="w-32 rounded border border-gray-200 px-2
                      py-1 text-sm"
                    value={feat[`nav_${k}`] != null
                      ? feat[`nav_${k}`] : label}
                    onChange={(e) => setFeat({ ...feat,
                      [`nav_${k}`]: e.target.value })} />
                  <span className="text-xs text-sub-text">({k})</span>
                  <label className="ml-auto flex items-center gap-1
                    text-sm">
                    <input type="checkbox" checked={!hidden}
                      onChange={(e) => setFeat({ ...feat,
                        [`nav_hidden_${k}`]: !e.target.checked })} />
                    Visible
                  </label>
                </div>
              );
            })}
            <button onClick={saveMenu}
              className="btn-primary mt-1 w-full">Save menu</button>
          </div>

          {/* BANNER */}
          <div className="card space-y-2">
            <div className="font-semibold">Top banner</div>
            <input className="input" placeholder="Banner text"
              value={ann.text || ''}
              onChange={(e) => setAnn({ ...ann, text: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="CTA label"
                value={ann.ctaLabel || ''}
                onChange={(e) => setAnn({
                  ...ann, ctaLabel: e.target.value })} />
              <input className="input" placeholder="CTA link"
                value={ann.ctaLink || ''}
                onChange={(e) => setAnn({
                  ...ann, ctaLink: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!ann.active}
                onChange={(e) => setAnn({
                  ...ann, active: e.target.checked })} />
              Show banner
            </label>
            <button onClick={saveBanner}
              className="btn-primary w-full">Save banner</button>
          </div>

          {/* HOME CONTENT */}
          <div className="card space-y-2">
            <div className="font-semibold">Home screen</div>
            <input className="input" placeholder="Hero title"
              value={content.homeHeroTitle || ''}
              onChange={(e) => setContent({
                ...content, homeHeroTitle: e.target.value })} />
            <input className="input" placeholder="Hero subtitle"
              value={content.homeHeroSubtitle || ''}
              onChange={(e) => setContent({
                ...content, homeHeroSubtitle: e.target.value })} />
            <div className="pt-1 text-xs font-semibold text-sub-text">
              Sections to show
            </div>
            {HOME_SECTIONS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox"
                  checked={content[`sec_${k}`] !== false}
                  onChange={(e) => setContent({
                    ...content, [`sec_${k}`]: e.target.checked })} />
                {label}
              </label>
            ))}
            <input className="input" placeholder="Client site URL (for
              the live preview, e.g. https://...)"
              value={content.previewUrl || ''}
              onChange={(e) => setContent({
                ...content, previewUrl: e.target.value })} />
            <button onClick={saveContent}
              className="btn-primary w-full">Save home content</button>
          </div>
        </div>

        {/* LIVE PREVIEW */}
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Live preview</span>
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noreferrer"
                className="text-xs font-semibold text-primary">
                Open
              </a>
            )}
          </div>
          {previewUrl ? (
            <div className="overflow-hidden rounded-xl border
              border-gray-200" style={{ height: '70vh' }}>
              <iframe title="client preview" src={previewUrl}
                className="h-full w-full"
                style={{ border: 0 }} />
            </div>
          ) : (
            <div className="rounded-xl bg-bg-light p-6 text-center
              text-sm text-sub-text">
              Add your client site URL above and Save to see a live
              preview here. Changes appear after Save + refresh.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
