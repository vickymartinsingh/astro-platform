/* eslint-disable react/no-array-index-key */
import { useEffect, useRef, useState } from 'react';
import { db, adminService, menuService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Drag-reorder + rename + show/hide editor for any menu (client menu,
// profile menu, astrologer menu). Writes [{href,label,hidden}] to the
// given settings/features key.
function MenuEditor({ title, defaults, value, onChange }) {
  const dragHref = useRef(null);
  const [nl, setNl] = useState('');
  const [nh, setNh] = useState('');
  const merged = menuService.mergeMenu(defaults, value);
  function update(href, patch) {
    onChange(merged.map((m) => (m.href === href
      ? { ...m, ...patch } : m)));
  }
  function reorder(from, to) {
    if (from === to) return;
    const a = [...merged];
    const i = a.findIndex((x) => x.href === from);
    const j = a.findIndex((x) => x.href === to);
    a.splice(j, 0, a.splice(i, 1)[0]);
    onChange(a);
  }
  function remove(href) {
    onChange(merged.filter((m) => m.href !== href));
  }
  function add() {
    let href = nh.trim();
    const label = nl.trim();
    if (!label) return;
    if (!href) href = '/' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!href.startsWith('/') && !/^https?:\/\//.test(href)) href = '/' + href;
    if (merged.some((m) => m.href === href)) return;
    onChange([...merged, { href, label, hidden: false, custom: true }]);
    setNl(''); setNh('');
  }
  return (
    <div className="card">
      <div className="mb-2 font-semibold">{title}</div>
      {merged.map((m) => (
        <div key={m.href} draggable
          onDragStart={() => { dragHref.current = m.href; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => reorder(dragHref.current, m.href)}
          className="mb-2 flex items-center gap-2 rounded-card border
            border-gray-200 bg-white p-2">
          <span className="cursor-grab select-none px-1
            text-sub-text">≡</span>
          <input className="w-40 rounded border border-gray-200 px-2
            py-1 text-sm" value={m.label}
            onChange={(e) => update(m.href, { label: e.target.value })} />
          <span className="text-xs text-sub-text">{m.href}</span>
          {m.custom && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5
              text-[10px] font-semibold text-amber-700">CUSTOM</span>
          )}
          <label className="ml-auto flex items-center gap-1 text-sm">
            <input type="checkbox" checked={!m.hidden}
              onChange={(e) =>
                update(m.href, { hidden: !e.target.checked })} />
            Visible
          </label>
          {m.custom && (
            <button onClick={() => remove(m.href)} title="Remove"
              className="rounded-full border border-danger px-2 py-0.5
                text-xs text-danger">✕</button>
          )}
        </div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t
        border-gray-100 pt-2">
        <input className="w-40 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="New item label" value={nl}
          onChange={(e) => setNl(e.target.value)} />
        <input className="w-40 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="/path or https://..." value={nh}
          onChange={(e) => setNh(e.target.value)} />
        <button onClick={add}
          className="rounded-card bg-primary px-3 py-1 text-sm
            font-semibold text-white">+ Add item</button>
      </div>
    </div>
  );
}

const TAB_DEFS = [
  ['home', 'Home'], ['chat', 'Chat'], ['live', 'Live'],
  ['tarot', 'Tarot'], ['call', 'Call'], ['profile', 'Profile'],
];
// Tabs hidden by default (kept in sync with client BottomNav). The admin
// can switch Call back on / hide Tarot here at any time.
const NAV_DEFAULT_HIDDEN = { call: true };
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
  const [navNew, setNavNew] = useState({ label: '', href: '' });
  const dragKey = useRef(null);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'settings', 'features')),
      getDoc(doc(db, 'settings', 'announcement')),
      getDoc(doc(db, 'settings', 'content')),
    ]).then(([f, a, c]) => {
      const fd = f.exists() ? f.data() : {};
      const customK = Array.isArray(fd.nav_custom)
        ? fd.nav_custom.map((x) => x && x.key).filter(Boolean) : [];
      const keys = [...TAB_DEFS.map(([k]) => k), ...customK];
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
  const customByKey = Object.fromEntries(
    (Array.isArray(feat.nav_custom) ? feat.nav_custom : [])
      .filter((c) => c && c.key).map((c) => [c.key, c]));
  function reorder(from, to) {
    if (from === to) return;
    const a = [...order];
    const i = a.indexOf(from); const j = a.indexOf(to);
    a.splice(j, 0, a.splice(i, 1)[0]);
    setFeat({ ...feat, nav_order: a });
  }
  function addNavItem() {
    const label = navNew.label.trim();
    let href = navNew.href.trim();
    if (!label) return;
    if (!href) {
      href = '/' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
    if (!href.startsWith('/') && !/^https?:\/\//.test(href)) {
      href = '/' + href;
    }
    const taken = new Set([...TAB_DEFS.map(([k]) => k),
      ...(feat.nav_custom || []).map((c) => c.key)]);
    const base = 'c_' + (label.toLowerCase()
      .replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'tab');
    let key = base; let n = 1;
    while (taken.has(key)) { key = base + n; n += 1; }
    const custom = [...(Array.isArray(feat.nav_custom)
      ? feat.nav_custom : []), { key, label, href }];
    setFeat({ ...feat, nav_custom: custom,
      nav_order: [...(feat.nav_order || []), key] });
    setNavNew({ label: '', href: '' });
  }
  function removeNavItem(key) {
    const f = { ...feat,
      nav_custom: (feat.nav_custom || []).filter((c) => c.key !== key),
      nav_order: (feat.nav_order || []).filter((k) => k !== key) };
    delete f[`nav_${key}`];
    delete f[`nav_hidden_${key}`];
    setFeat(f);
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
              const cu = customByKey[k];
              const label = cu ? cu.label
                : ((TAB_DEFS.find(([x]) => x === k) || [])[1] || k);
              const hv = feat[`nav_hidden_${k}`];
              const hidden = hv === undefined
                ? !!NAV_DEFAULT_HIDDEN[k] : !!hv;
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
                    value={feat[`nav_${k}`] || label}
                    onChange={(e) => setFeat({ ...feat,
                      [`nav_${k}`]: e.target.value })} />
                  <span className="truncate text-xs text-sub-text">
                    ({cu ? cu.href : k})
                  </span>
                  {cu && (
                    <span className="rounded-full bg-amber-100 px-2
                      py-0.5 text-[10px] font-semibold text-amber-700">
                      CUSTOM
                    </span>
                  )}
                  <label className="ml-auto flex items-center gap-1
                    text-sm">
                    <input type="checkbox" checked={!hidden}
                      onChange={(e) => setFeat({ ...feat,
                        [`nav_hidden_${k}`]: !e.target.checked })} />
                    Visible
                  </label>
                  {cu && (
                    <button onClick={() => removeNavItem(k)} title="Remove"
                      className="rounded-full border border-danger px-2
                        py-0.5 text-xs text-danger">✕</button>
                  )}
                </div>
              );
            })}
            <div className="mt-2 flex flex-wrap items-center gap-2
              border-t border-gray-100 pt-2">
              <input className="w-32 rounded border border-gray-200 px-2
                py-1 text-sm" placeholder="New tab label"
                value={navNew.label}
                onChange={(e) => setNavNew({
                  ...navNew, label: e.target.value })} />
              <input className="w-40 rounded border border-gray-200 px-2
                py-1 text-sm" placeholder="/path or https://..."
                value={navNew.href}
                onChange={(e) => setNavNew({
                  ...navNew, href: e.target.value })} />
              <button onClick={addNavItem}
                className="rounded-card bg-primary px-3 py-1 text-sm
                  font-semibold text-white">+ Add tab</button>
            </div>
            <button onClick={saveMenu}
              className="btn-primary mt-2 w-full">Save bottom menu</button>
          </div>

          <MenuEditor title="Client top menu (web/desktop + drawer)"
            defaults={menuService.DEFAULT_CLIENT_MENU}
            value={feat.menu_links}
            onChange={(v) => setFeat({ ...feat, menu_links: v })} />
          <MenuEditor title="Client profile menu"
            defaults={menuService.DEFAULT_CLIENT_PROFILE}
            value={feat.profile_menu}
            onChange={(v) => setFeat({ ...feat, profile_menu: v })} />
          <MenuEditor title="Astrologer app menu"
            defaults={menuService.DEFAULT_ASTRO_MENU}
            value={feat.astro_links}
            onChange={(v) => setFeat({ ...feat, astro_links: v })} />
          <button onClick={saveMenu}
            className="btn-primary w-full">
            Save all menus (client + astrologer)
          </button>

          {/* DISPLAY OPTIONS */}
          <div className="card space-y-2">
            <div className="font-semibold">Display options</div>
            <label className="flex items-center justify-between text-sm">
              <span>
                Zodiac selector
                <span className="block text-xs text-sub-text">
                  Off = swipeable sign carousel (default). On = classic
                  dropdown.
                </span>
              </span>
              <input type="checkbox"
                checked={feat.zodiac_dropdown === true}
                onChange={(e) => setFeat({
                  ...feat, zodiac_dropdown: e.target.checked })} />
            </label>
            <button onClick={saveMenu}
              className="btn-primary w-full">Save display options</button>
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
