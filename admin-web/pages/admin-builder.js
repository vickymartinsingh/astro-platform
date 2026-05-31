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

export default function AdminBuilder() {
  const { loading } = useRequireAdmin();
  const [feat, setFeat] = useState(null);     // settings/features
  const [ann, setAnn] = useState(null);       // settings/announcement
  const [content, setContent] = useState(null); // settings/content
  const [plat, setPlat] = useState('app'); // 'app' | 'desktop'

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
