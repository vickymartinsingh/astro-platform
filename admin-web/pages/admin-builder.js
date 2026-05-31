/* eslint-disable react/no-array-index-key */
import { useEffect, useState } from 'react';
import { db, adminService, menuService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import MenuEditor from '../components/MenuEditor';
import BottomNavEditor, {
  ASTRO_NAV_DEFS,
} from '../components/BottomNavEditor';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const DEFAULT_STATS = [
  { n: '{experts}+', l: 'Verified Experts' },
  { n: '1M+', l: 'Consultations' },
  { n: '4.8', l: 'Rating Average' },
  { n: '12+', l: 'Languages' },
];
const CAT_KEYS = [
  ['Love', 'Love & Relationships'], ['Career', 'Career'],
  ['Marriage', 'Marriage'], ['Health', 'Health'],
  ['Finance', 'Finance'], ['Education', 'Education'],
];
const HOME_SECTIONS = [
  ['quickActions', 'Quick actions (Tarot/Kundli/etc.)'],
  ['starsToday', 'Your stars today'],
  ['categories', 'Browse by category'],
  ['topRated', 'Top rated astrologers'],
  ['reviews', 'Customer reviews'],
];

// ---------------------------------------------------------------------
// Modals & popups text registry.
//
// Every customer-facing modal exposes a list of editable strings here.
// Admin picks a modal from the dropdown, edits the fields, hits Save -
// the change lands in settings/content.text[<key>] and propagates live
// to every device via the existing onSnapshot listener in
// client-web/lib/useContentText.js.
//
// To add a new modal: append a new entry. The customer-facing component
// reads each string via T('<key>', '<default>') so the field is editable
// from day one with no code change required from the admin.
const MODAL_REGISTRY = [
  {
    id: 'orderPlaced',
    label: 'Order placed / Report generation popup',
    note: 'Shown after a paid kundli / forecast order is placed. '
      + 'Use {title} as a placeholder for the product name.',
    fields: [
      { key: 'modals.orderPlaced.label',
        label: 'Header label',
        def: 'Order placed' },
      { key: 'modals.orderPlaced.title',
        label: 'Header title (supports {title})',
        def: 'Thank you, your {title} is on its way',
        multiline: true },
      { key: 'modals.orderPlaced.pendingLabel',
        label: 'Header label - placing order state',
        def: 'Placing order' },
      { key: 'modals.orderPlaced.readyLabel',
        label: 'Header label - report ready state',
        def: 'Report ready' },
      { key: 'modals.orderPlaced.errorLabel',
        label: 'Header label - error state',
        def: 'Order could not be placed' },
      { key: 'modals.orderPlaced.readyTitle',
        label: 'Header title - cached / ready state',
        def: '{title} is ready' },
      { key: 'modals.orderPlaced.errorTitle',
        label: 'Header title - error state',
        def: 'We could not place your {title} order',
        multiline: true },
      { key: 'modals.orderPlaced.expectedDeliveryLabel',
        label: 'Expected-delivery row label',
        def: 'Expected delivery' },
      { key: 'modals.orderPlaced.footer',
        label: 'Footer body (after the SLA, normal flow)',
        def: 'You can close this window. We will email you '
          + 'the moment the PDF is ready, and the download link '
          + 'lives permanently in My Orders.',
        multiline: true },
      { key: 'modals.orderPlaced.pendingBody',
        label: 'Footer body (pending / placing state)',
        def: 'Confirming with our system... your order will be ready '
          + 'shortly. You can close this window now and check My '
          + 'Orders at any time.',
        multiline: true },
      { key: 'modals.orderPlaced.orderIdLabel',
        label: 'Order ID label',
        def: 'Order ID' },
      { key: 'modals.orderPlaced.orderIdPending',
        label: 'Order ID placeholder (while pending)',
        def: 'Order ID will appear here once the system confirms '
          + 'your purchase.',
        multiline: true },
      { key: 'modals.orderPlaced.downloadCta',
        label: 'Download PDF button',
        def: 'Download PDF' },
      { key: 'modals.orderPlaced.primaryCta',
        label: 'Primary button (My Orders)',
        def: 'Open My Orders' },
      { key: 'modals.orderPlaced.closeCta',
        label: 'Close button',
        def: 'Close' },
    ],
  },
];

export default function AdminBuilder() {
  const { loading } = useRequireAdmin();
  const [feat, setFeat] = useState(null);     // settings/features
  const [ann, setAnn] = useState(null);       // settings/announcement
  const [content, setContent] = useState(null); // settings/content
  const [plat, setPlat] = useState('app'); // 'app' | 'desktop'
  const [modalId, setModalId] = useState(MODAL_REGISTRY[0]?.id || '');

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, 'settings', 'features')),
      getDoc(doc(db, 'settings', 'announcement')),
      getDoc(doc(db, 'settings', 'content')),
    ]).then(([f, a, c]) => {
      setFeat(f.exists() ? f.data() : {});
      setAnn(a.exists() ? a.data() : { text: '', ctaLabel: '',
        ctaLink: '', target: 'all', active: false });
      setContent(c.exists() ? c.data() : {});
    });
  }, []);

  if (loading || !feat || !ann || !content) {
    return <Layout><div className="card">Loading...</div></Layout>;
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

      <div className="mb-4 flex gap-2">
        {[['app', 'App (mobile)'], ['desktop', 'Desktop (web)']].map(
          ([v, l]) => (
            <button key={v} onClick={() => setPlat(v)}
              className={`flex-1 rounded-card border px-4 py-2 text-sm
                font-semibold ${plat === v
                  ? 'border-primary bg-primary text-white'
                  : 'border-gray-200'}`}>
              {l}
            </button>
          ))}
      </div>
      <p className="mb-3 text-xs text-sub-text">
        {plat === 'app'
          ? 'Configuring the MOBILE app: bottom tab bar + slide drawer.'
          : 'Configuring the DESKTOP / web top navigation.'}
        {' '}Shared sections below apply to both.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {plat === 'app' && (
          <>
          <BottomNavEditor feat={feat} setFeat={setFeat} />
          <button onClick={saveMenu}
            className="btn-primary w-full">Save bottom menu</button>
          <MenuEditor title="Client menu - MOBILE (slide drawer)"
            defaults={menuService.DEFAULT_CLIENT_MENU}
            value={feat.menu_links_mobile || feat.menu_links}
            onChange={(v) =>
              setFeat({ ...feat, menu_links_mobile: v })} />
          </>
          )}

          {plat === 'desktop' && (
          <MenuEditor title="Client menu - DESKTOP / web (top bar)"
            defaults={menuService.DEFAULT_CLIENT_MENU}
            value={feat.menu_links_desktop || feat.menu_links}
            onChange={(v) =>
              setFeat({ ...feat, menu_links_desktop: v })} />
          )}

          <div className="text-xs font-semibold uppercase tracking-wide
            text-sub-text">Shared (App + Web)</div>
          <MenuEditor title="Client profile menu"
            defaults={menuService.DEFAULT_CLIENT_PROFILE}
            value={feat.profile_menu}
            onChange={(v) => setFeat({ ...feat, profile_menu: v })} />
          <MenuEditor title="Astrologer app menu"
            defaults={menuService.DEFAULT_ASTRO_MENU}
            value={feat.astro_links}
            onChange={(v) => setFeat({ ...feat, astro_links: v })} />
          <BottomNavEditor feat={feat} setFeat={setFeat}
            ns="anav" defs={ASTRO_NAV_DEFS} defaultHidden={{}}
            title="Astrologer bottom tab bar - drag to reorder" />
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
            <label className="flex items-center justify-between text-sm">
              <span>
                Split stars sections
                <span className="block text-xs text-sub-text">
                  On (default) = a personal &quot;Your stars today&quot;
                  from the user&apos;s kundli PLUS a generic
                  &quot;Horoscope&quot;. Off = one combined &quot;Your
                  stars today&quot; sign picker (the old layout).
                </span>
              </span>
              <input type="checkbox"
                checked={feat.stars_split !== false}
                onChange={(e) => setFeat({
                  ...feat, stars_split: e.target.checked })} />
            </label>
            <div className="border-t border-gray-100 pt-2">
              <div className="text-sm font-semibold">
                Tarot &quot;Pick your card&quot; preset
              </div>
              <div className="mt-1 flex gap-2">
                {[['classic', 'Classic (current)'],
                  ['guided', 'Guided (aspect + question)']].map(
                  ([v, l]) => (
                    <button key={v}
                      onClick={() => setFeat({
                        ...feat, tarot_mode: v })}
                      className={`flex-1 rounded-card border px-3 py-2
                        text-sm ${
                        (feat.tarot_mode === 'classic' ? 'classic'
                          : 'guided') === v
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-200'}`}>
                      {l}
                    </button>
                  ))}
              </div>
              <p className="mt-1 text-xs text-sub-text">
                Switch back to Classic anytime - it is unchanged.
              </p>
              <input className="input mt-2"
                placeholder="Guided intro line"
                value={feat.tarot_intro || ''}
                onChange={(e) => setFeat({
                  ...feat, tarot_intro: e.target.value })} />
              <input className="input mt-2"
                placeholder="Single card description"
                value={feat.tarot_single_def || ''}
                onChange={(e) => setFeat({
                  ...feat, tarot_single_def: e.target.value })} />
              <input className="input mt-2"
                placeholder="3 cards description"
                value={feat.tarot_three_def || ''}
                onChange={(e) => setFeat({
                  ...feat, tarot_three_def: e.target.value })} />
            </div>
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
            {/* Per-device visibility for the hero banner. Same pattern
                as the stats strip below. Live: Firestore listener
                pushes the change instantly. */}
            <div className="flex flex-wrap items-center gap-4
              rounded-md bg-bg-light/60 px-2 py-1 text-xs">
              <span className="font-semibold text-sub-text">Hero banner:</span>
              <label className="flex items-center gap-2">
                <input type="checkbox"
                  checked={content.home_hero_show_mobile !== false}
                  onChange={(e) => setContent({
                    ...content,
                    home_hero_show_mobile: e.target.checked })} />
                Show on mobile
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox"
                  checked={content.home_hero_show_desktop !== false}
                  onChange={(e) => setContent({
                    ...content,
                    home_hero_show_desktop: e.target.checked })} />
                Show on desktop
              </label>
            </div>
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
            <div className="pt-2 text-xs font-semibold text-sub-text">
              Stats row (label + value, or hide). Use {'{experts}'} for
              the live astrologer count.
            </div>
            {/* Master visibility for the entire stats strip. Two
                independent toggles let admins hide the strip on one
                form factor without affecting the other. Live: the
                Firestore listener on the home page reflects this
                change instantly with no app reload. */}
            <div className="flex flex-wrap items-center gap-4
              rounded-md bg-bg-light/60 px-2 py-1 text-xs">
              <span className="font-semibold text-sub-text">Stats strip:</span>
              <label className="flex items-center gap-2">
                <input type="checkbox"
                  checked={content.home_stats_show_mobile !== false}
                  onChange={(e) => setContent({
                    ...content,
                    home_stats_show_mobile: e.target.checked })} />
                Show on mobile
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox"
                  checked={content.home_stats_show_desktop !== false}
                  onChange={(e) => setContent({
                    ...content,
                    home_stats_show_desktop: e.target.checked })} />
                Show on desktop
              </label>
            </div>
            {(() => {
              const stats = Array.isArray(content.home_stats)
                && content.home_stats.length
                ? content.home_stats : DEFAULT_STATS;
              const upd = (i, patch) => setContent({
                ...content,
                home_stats: stats.map((s, idx) => (idx === i
                  ? { ...s, ...patch } : { ...s })),
              });
              return stats.slice(0, 4).map((s, i) => (
                /* eslint-disable-next-line react/no-array-index-key */
                <div key={i} className="flex items-center gap-2">
                  <input className="w-24 rounded border border-gray-200
                    px-2 py-1 text-sm" placeholder="Value"
                    value={s.n || ''}
                    onChange={(e) => upd(i, { n: e.target.value })} />
                  <input className="flex-1 rounded border
                    border-gray-200 px-2 py-1 text-sm"
                    placeholder="Label" value={s.l || ''}
                    onChange={(e) => upd(i, { l: e.target.value })} />
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={s.show !== false}
                      onChange={(e) => upd(i,
                        { show: e.target.checked })} />
                    Show
                  </label>
                </div>
              ));
            })()}

            <div className="pt-2 text-xs font-semibold text-sub-text">
              Category labels
            </div>
            {CAT_KEYS.map(([k, def]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-20 text-xs text-sub-text">{k}</span>
                <input className="flex-1 rounded border border-gray-200
                  px-2 py-1 text-sm" placeholder={def}
                  value={(content.cat_labels || {})[k] || ''}
                  onChange={(e) => setContent({
                    ...content,
                    cat_labels: {
                      ...(content.cat_labels || {}),
                      [k]: e.target.value },
                  })} />
              </div>
            ))}

            <input className="input" placeholder="Client site URL (for
              the live preview, e.g. https://...)"
              value={content.previewUrl || ''}
              onChange={(e) => setContent({
                ...content, previewUrl: e.target.value })} />
            <button onClick={saveContent}
              className="btn-primary w-full">Save home content</button>
          </div>

          {/* MODALS & POPUPS - admin-editable text for every customer-
              facing modal. Each modal lives in MODAL_REGISTRY at the
              top of this file. Adding a new modal there + reading
              T('<key>', '<default>') in the modal's component makes
              every field editable here from day one. */}
          <div className="card space-y-2">
            <div className="font-semibold">Modals &amp; popups</div>
            <p className="text-xs text-sub-text">
              Edit the labels, headings, body text and button copy
              for any modal in the customer app. Changes go live
              instantly with no rebuild. The input is PRE-FILLED with
              the current copy - tweak a word, hit save, done. Use
              the template selector below to switch between named
              variants (e.g. seasonal sale copy, regional language
              variants).
            </p>
            <label className="block text-xs font-semibold text-sub-text">
              Pick a modal
              <select
                className="input mt-1"
                value={modalId}
                onChange={(e) => setModalId(e.target.value)}>
                {MODAL_REGISTRY.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            {/* Templates row. Saved templates live in
                content.modalTemplates as
                  { id, name, text: { key: value, ... } }
                Loading a template overwrites every override key in
                content.text with the template's values, so the entire
                modal copy switches in one click. */}
            <ModalTemplates
              modalId={modalId}
              content={content}
              setContent={setContent}
              saveContent={saveContent} />
            {(() => {
              const modal = MODAL_REGISTRY.find((m) => m.id === modalId);
              if (!modal) return null;
              const text = (content.text && typeof content.text === 'object')
                ? content.text : {};
              const upd = (k, v) => setContent({
                ...content,
                text: { ...text, [k]: v },
              });
              const revert = (k) => {
                const next = { ...text };
                delete next[k];
                setContent({ ...content, text: next });
              };
              return (
                <>
                  {modal.note && (
                    <div className="rounded-md bg-bg-light px-2 py-1
                      text-[11px] text-sub-text">{modal.note}</div>
                  )}
                  {modal.fields.map((f) => {
                    // Pre-fill the input with the live override
                    // value, OR fall back to the default copy.
                    // Admin edits the visible text directly without
                    // having to retype the whole sentence.
                    const overridden = text[f.key] != null
                      && String(text[f.key]).trim() !== '';
                    const live = overridden ? text[f.key] : f.def;
                    return (
                      <div key={f.key} className="space-y-1 pt-2">
                        <div className="flex items-center justify-between
                          gap-2">
                          <div className="text-xs font-semibold
                            text-dark-text">{f.label}</div>
                          {overridden && (
                            <button type="button"
                              onClick={() => revert(f.key)}
                              className="text-[10px] font-semibold
                                text-primary hover:underline">
                              Revert to default
                            </button>
                          )}
                        </div>
                        {f.multiline ? (
                          <textarea className="input min-h-[64px]"
                            value={live}
                            onChange={(e) => upd(f.key, e.target.value)} />
                        ) : (
                          <input className="input"
                            value={live}
                            onChange={(e) => upd(f.key, e.target.value)} />
                        )}
                        <div className="text-[11px] text-sub-text">
                          {overridden ? 'Custom override.'
                            : 'Showing default. Edit + save to override.'}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={saveContent}
                    className="btn-primary mt-3 w-full">
                    Save modal copy
                  </button>
                </>
              );
            })()}
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

// Reusable: extracts the subset of content.text keys that belong to
// the given modal. We use this to snapshot the current visible copy
// (overrides AND defaults) into a template so loading the template
// later restores EXACTLY what the admin saw when they saved it.
function snapshotModalText(modalId, content) {
  const modal = MODAL_REGISTRY.find((m) => m.id === modalId);
  if (!modal) return {};
  const text = (content.text && typeof content.text === 'object')
    ? content.text : {};
  const out = {};
  for (const f of modal.fields) {
    // Snapshot the LIVE value (override if set, else the code default).
    out[f.key] = (text[f.key] != null && String(text[f.key]).trim() !== '')
      ? text[f.key] : f.def;
  }
  return out;
}

function applyTemplateText(content, templateText) {
  const text = (content.text && typeof content.text === 'object')
    ? { ...content.text } : {};
  for (const [k, v] of Object.entries(templateText || {})) {
    text[k] = v;
  }
  return { ...content, text };
}

// Templates panel - sits between the modal picker and the field
// editor. Saved templates live in content.modalTemplates[modalId]
// as an array of {id, name, text:{}, savedAt}. Picking a template
// overwrites the live text overrides; saving creates a new template
// or updates the currently-selected one.
function ModalTemplates({ modalId, content, setContent, saveContent }) {
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const all = (content.modalTemplates
    && typeof content.modalTemplates === 'object')
    ? content.modalTemplates : {};
  const list = Array.isArray(all[modalId]) ? all[modalId] : [];

  // Reset selection when admin switches modal so a template ID from
  // a different modal doesn't bleed across.
  useEffect(() => { setSelected(''); }, [modalId]);

  function load(id) {
    setSelected(id);
    const t = list.find((x) => x.id === id);
    if (!t || !t.text) return;
    setContent(applyTemplateText(content, t.text));
  }

  async function saveAsNew() {
    const name = String(newName || '').trim();
    if (!name) return;
    const id = `t_${Date.now().toString(36)}`;
    const snap = snapshotModalText(modalId, content);
    const nextList = [...list, { id, name, text: snap,
      // No Date.now() in journaled scripts; here we're in admin
      // browser context so it's safe.
      savedAt: new Date().toISOString() }];
    const next = {
      ...content,
      modalTemplates: { ...all, [modalId]: nextList },
    };
    setContent(next);
    setNewName('');
    setSelected(id);
    await saveContent();
  }
  async function update() {
    if (!selected) return;
    const snap = snapshotModalText(modalId, content);
    const nextList = list.map((t) => (t.id === selected
      ? { ...t, text: snap, savedAt: new Date().toISOString() }
      : t));
    const next = {
      ...content,
      modalTemplates: { ...all, [modalId]: nextList },
    };
    setContent(next);
    await saveContent();
  }
  async function remove() {
    if (!selected) return;
    if (typeof window !== 'undefined'
      // eslint-disable-next-line no-alert
      && !window.confirm('Delete this template?')) return;
    const nextList = list.filter((t) => t.id !== selected);
    const next = {
      ...content,
      modalTemplates: { ...all, [modalId]: nextList },
    };
    setContent(next);
    setSelected('');
    await saveContent();
  }

  return (
    <div className="rounded-md border border-gray-200 bg-bg-light/60
      px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide
          text-sub-text">Templates</div>
        <div className="text-[10px] text-sub-text">
          {list.length} saved
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input flex-1 !min-w-[160px] !py-1.5 text-xs"
          value={selected}
          onChange={(e) => load(e.target.value)}>
          <option value="">— Live overrides —</option>
          {list.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {selected && (
          <>
            <button type="button" onClick={update}
              className="rounded-full bg-primary px-3 py-1 text-[11px]
                font-bold text-white">
              Update this template
            </button>
            <button type="button" onClick={remove}
              className="rounded-full border border-danger px-3 py-1
                text-[11px] font-bold text-danger">
              Delete
            </button>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input className="input flex-1 !py-1.5 text-xs"
          placeholder="Name a new template (e.g. Diwali Sale)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)} />
        <button type="button" onClick={saveAsNew} disabled={!newName.trim()}
          className="rounded-full bg-primary px-3 py-1 text-[11px]
            font-bold text-white disabled:opacity-50">
          Save as template
        </button>
      </div>
    </div>
  );
}
