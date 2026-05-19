import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import {
  db, adminService, menuService, themeService,
  APP_BUILD, appVersionName,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';
import { getPortalUrls } from '../lib/portal';

// Developer 2.0 - one no-code builder portal. Everything here writes to
// the live settings docs (settings/content|features|config|announcement
// |theme), which every app reads in real time, so Save == Publish
// instantly (no redeploy). A literal Wix free-canvas over hand-coded
// React pages is not possible, so this is a structured builder + full
// sitemap covering every editable label, menu, section and button text.

const DEVICES = [['desktop', 'Desktop'], ['mobile', 'Mobile'],
  ['app', 'App']];

const SIDEBAR = [
  ['map', 'Site map / Blueprint'],
  ['branding', 'Branding'],
  ['theme', 'Theme & colours'],
  ['menus', 'Menus & navigation'],
  ['home', 'Home page'],
  ['text', 'Button & section text'],
  ['versions', 'App versions & downloads'],
  ['announce', 'Announcement bar'],
  ['preview', 'Live preview'],
];

// Editable copy keys the client home reads from settings/content.text.
const TEXT_KEYS = [
  ['home.browseCta', 'Hero button - "Browse astrologers"'],
  ['home.getStarted', 'Hero button - "Get started"'],
  ['home.qa./tarot', 'Quick tile - Tarot'],
  ['home.qa./kundli', 'Quick tile - Kundli'],
  ['home.qa./matching', 'Quick tile - Matching'],
  ['home.qa./horoscope', 'Quick tile - Horoscope'],
  ['home.starsTitle', 'Section title - "Your stars today"'],
  ['home.catTitle', 'Section title - "Browse by category"'],
  ['home.topRatedTitle', 'Section title - "Top rated astrologers"'],
  ['home.seeAll', 'Link - "See all"'],
];

// Client app sitemap (blueprint) - route + what is editable where.
const SITEMAP = [
  ['/dashboard', 'Home', 'Hero, quick tiles, stats, categories, '
    + 'top-rated, reviews, "Your stars today" - edit in Home page + '
    + 'Button & section text'],
  ['/astrologers', 'Astrologers list', 'Cards from live data; menu '
    + 'label via Menus'],
  ['/horoscope', 'Horoscope', 'Content from Horoscope CSV admin'],
  ['/tarot', 'Tarot', 'Mode + intro copy in App Builder / Display'],
  ['/kundli', 'Kundli', 'Kundli API admin'],
  ['/matching', 'Matching', 'Algorithm-driven'],
  ['/remedies', 'Remedies', 'Remedies admin'],
  ['/profile', 'Profile', 'Profile dropdown via Menus (Profile)'],
  ['/wallet', 'Wallet', 'Pricing in Settings/config'],
  ['/support', 'Help & Support', 'Tickets / Support desk'],
  ['/page/[slug]', 'CMS pages (Terms, Privacy, ...)', 'Full CMS '
    + 'builder (admin-cms)'],
];

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-sub-text">{label}</span>
      {children}
    </label>
  );
}

// Drag-and-drop menu editor (rename / hide / reorder / add / remove).
function MenuEditor({ items, onChange }) {
  const drag = useRef(null);
  const set = (i, patch) => onChange(items.map((x, j) =>
    (j === i ? { ...x, ...patch } : x)));
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const a = items.slice();
    const [m] = a.splice(from, 1);
    a.splice(to, 0, m);
    onChange(a);
  };
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={`${it.href}-${i}`}
          draggable
          onDragStart={() => { drag.current = i; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { move(drag.current, i); drag.current = null; }}
          className="flex flex-wrap items-center gap-2 rounded-card
            border border-gray-200 bg-white p-2">
          <span className="cursor-grab select-none px-1 text-sub-text"
            title="Drag to reorder">⠿</span>
          <input className="input !min-h-0 w-36 py-1.5"
            value={it.label || ''}
            onChange={(e) => set(i, { label: e.target.value })} />
          <input className="input !min-h-0 flex-1 py-1.5 text-xs"
            value={it.href || ''}
            onChange={(e) => set(i, { href: e.target.value })} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={!it.hidden}
              onChange={(e) => set(i, { hidden: !e.target.checked })} />
            Show
          </label>
          <button type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="rounded-card px-2 py-1 text-xs text-danger">
            Remove
          </button>
        </div>
      ))}
      <button type="button"
        onClick={() => onChange([...items,
          { href: '/', label: 'New item', custom: true }])}
        className="rounded-card border border-dashed border-gray-300
          px-3 py-2 text-sm text-sub-text">
        + Add menu item
      </button>
    </div>
  );
}

export default function AdminDev2() {
  const { loading } = useRequireAdmin();
  const [device, setDevice] = useState('desktop');
  const [pane, setPane] = useState('map');
  const [content, setContent] = useState(null);
  const [features, setFeatures] = useState(null);
  const [config, setConfig] = useState(null);
  const [ann, setAnn] = useState(null);
  const [theme, setTheme] = useState(null);
  const [pvKey, setPvKey] = useState(0); // bump to reload the preview

  useEffect(() => {
    if (loading) return;
    const load = async (n, set) => {
      try {
        const s = await getDoc(doc(db, 'settings', n));
        set(s.exists() ? s.data() : {});
      } catch (_) { set({}); }
    };
    load('content', setContent);
    load('features', setFeatures);
    load('config', setConfig);
    load('announcement', setAnn);
    load('theme', setTheme);
  }, [loading]);

  if (loading || !content || !features || !config) {
    return <Layout><div className="surface p-4">Loading...</div></Layout>;
  }

  const publish = async (name, patch, label) => {
    try {
      await adminService.updateSettings(name, patch);
      flash(`${label || 'Saved'} - published live`);
    } catch (_) { flash('Could not save'); }
  };

  // Resolve the menu list for the current device from features.
  const resolved = menuService.resolveMenus(features);
  const menuKey = device === 'mobile' ? 'menu_links_mobile'
    : 'menu_links_desktop';
  const menuItems = device === 'app'
    ? null
    : (Array.isArray(features[menuKey]) && features[menuKey].length
      ? features[menuKey]
      : (device === 'mobile' ? resolved.menuMobile : resolved.menu));

  const setMenu = (arr) => setFeatures({ ...features, [menuKey]: arr });
  const setProfileMenu = (arr) =>
    setFeatures({ ...features, profile_menu: arr });

  const C = (k, v) => setContent({ ...content, [k]: v });
  const TX = (k, v) => setContent({
    ...content, text: { ...(content.text || {}), [k]: v },
  });

  const themes = Object.keys(themeService.THEMES || {});
  const activeTheme = (theme && theme.active) || 'classic';

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <div>
          <h1 className="text-xl font-bold">Developer 2.0</h1>
          <p className="text-xs text-sub-text">
            No-code site builder. Every change is published live to all
            apps instantly.
          </p>
        </div>
        <div className="flex gap-1 rounded-full bg-bg-light p-1">
          {DEVICES.map(([k, l]) => (
            <button key={k} onClick={() => setDevice(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold
                ${device === k ? 'bg-primary text-white'
                  : 'text-sub-text'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav className="surface h-max p-2">
          {SIDEBAR.map(([k, l]) => (
            <button key={k} onClick={() => setPane(k)}
              className={`block w-full rounded-card px-3 py-2 text-left
                text-sm ${pane === k ? 'bg-primary text-white'
                  : 'hover:bg-bg-light'}`}>{l}</button>
          ))}
          <div className="mt-2 border-t border-gray-200 pt-2">
            <Link href="/admin-cms"
              className="block rounded-card px-3 py-2 text-left text-sm
                hover:bg-bg-light">Full CMS pages →</Link>
            <Link href="/admin-icons"
              className="block rounded-card px-3 py-2 text-left text-sm
                hover:bg-bg-light">Icons editor →</Link>
            <Link href="/admin-theme"
              className="block rounded-card px-3 py-2 text-left text-sm
                hover:bg-bg-light">Advanced theme →</Link>
          </div>
        </nav>

        <section className="surface p-4">
          {pane === 'map' && (
            <div>
              <h2 className="mb-1 font-bold">Site map / Blueprint</h2>
              <p className="mb-3 text-xs text-sub-text">
                The client app structure. Each row says where its text /
                layout is edited.
              </p>
              <div className="space-y-2">
                {SITEMAP.map(([route, name, where]) => (
                  <div key={route}
                    className="rounded-card border border-gray-200 p-3">
                    <div className="flex items-center justify-between
                      gap-2">
                      <span className="font-semibold">{name}</span>
                      <code className="text-[11px] text-sub-text">
                        {route}</code>
                    </div>
                    <div className="mt-1 text-xs text-sub-text">
                      {where}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pane === 'branding' && (
            <div className="space-y-3">
              <h2 className="font-bold">Branding</h2>
              <Field label="Platform name">
                <input className="input"
                  value={config.platformName || ''}
                  onChange={(e) => setConfig({ ...config,
                    platformName: e.target.value })} />
              </Field>
              <Field label="Logo URL or data-URL">
                <input className="input" value={config.logo || ''}
                  onChange={(e) => setConfig({ ...config,
                    logo: e.target.value })} />
              </Field>
              <Field label="Favicon URL (optional)">
                <input className="input" value={config.favicon || ''}
                  onChange={(e) => setConfig({ ...config,
                    favicon: e.target.value })} />
              </Field>
              <button className="btn-primary"
                onClick={() => publish('config', {
                  platformName: config.platformName || '',
                  logo: config.logo || '',
                  favicon: config.favicon || '',
                }, 'Branding')}>Save &amp; publish</button>
            </div>
          )}

          {pane === 'theme' && (
            <div className="space-y-3">
              <h2 className="font-bold">Theme</h2>
              <p className="text-xs text-sub-text">
                Pick the active palette. Fine colour tuning is in
                Advanced theme.
              </p>
              <div className="flex flex-wrap gap-2">
                {themes.map((t) => (
                  <button key={t}
                    onClick={() => setTheme({ ...(theme || {}),
                      active: t })}
                    className={`rounded-full px-4 py-2 text-sm capitalize
                      ${activeTheme === t ? 'bg-primary text-white'
                        : 'border border-gray-200'}`}>{t}</button>
                ))}
              </div>
              <button className="btn-primary"
                onClick={() => publish('theme',
                  { active: activeTheme }, 'Theme')}>
                Save &amp; publish
              </button>
            </div>
          )}

          {pane === 'menus' && (
            <div className="space-y-4">
              <h2 className="font-bold">
                Menus - {device === 'app' ? 'App bottom tabs'
                  : `${device} top menu`}
              </h2>
              {device === 'app' ? (
                <p className="text-sm text-sub-text">
                  The native app bottom tab bar (client &amp;
                  astrologer) is managed in the App Builder.{' '}
                  <Link href="/admin-builder"
                    className="font-semibold text-primary">
                    Open App Builder →</Link>
                </p>
              ) : (
                <>
                  <p className="text-xs text-sub-text">
                    Drag ⠿ to reorder, edit the label, toggle Show,
                    add/remove items. Publishes to{' '}
                    <code>{menuKey}</code>.
                  </p>
                  <MenuEditor items={menuItems}
                    onChange={setMenu} />
                  <button className="btn-primary"
                    onClick={() => publish('features',
                      { [menuKey]: menuItems }, 'Menu')}>
                    Save &amp; publish menu
                  </button>
                </>
              )}
              <div className="border-t border-gray-200 pt-3">
                <div className="mb-2 font-semibold">
                  Desktop header - beside the Profile dropdown
                </div>
                <p className="mb-2 text-xs text-sub-text">
                  Logout already lives inside the Profile menu. Choose
                  what shows in the top-right pill (review and switch
                  any time).
                </p>
                <select className="input"
                  value={features.desktop_profile_side || 'logout'}
                  onChange={(e) => setFeatures({ ...features,
                    desktop_profile_side: e.target.value })}>
                  <option value="logout">Logout button (current)</option>
                  <option value="name">User&apos;s full name</option>
                  <option value="hidden">
                    Nothing (Logout stays in Profile menu)
                  </option>
                </select>
                <button className="btn-primary mt-2"
                  onClick={() => publish('features', {
                    desktop_profile_side:
                      features.desktop_profile_side || 'logout',
                  }, 'Header option')}>
                  Save &amp; publish
                </button>
              </div>

              <div className="border-t border-gray-200 pt-3">
                <div className="mb-2 font-semibold">
                  Profile dropdown
                </div>
                <MenuEditor items={resolved.profile}
                  onChange={setProfileMenu} />
                <button className="btn-primary mt-2"
                  onClick={() => publish('features',
                    { profile_menu: features.profile_menu
                      || resolved.profile }, 'Profile menu')}>
                  Save &amp; publish profile menu
                </button>
              </div>

              <div className="border-t border-gray-200 pt-3">
                <div className="mb-1 font-semibold">
                  🔮 Astrologer portal menu
                </div>
                <p className="mb-2 text-xs text-sub-text">
                  The top menu astrologers see (Dashboard, Go Live,
                  Earnings…). Drag ⠿ to reorder, rename, show/hide, or
                  “+ Add menu item” for a brand-new entry. Publishes to{' '}
                  <code>astro_links</code> — live in the Astrologer
                  portal instantly.
                </p>
                <MenuEditor items={resolved.astro}
                  onChange={(arr) => setFeatures({
                    ...features, astro_links: arr })} />
                <button className="btn-primary mt-2"
                  onClick={() => publish('features',
                    { astro_links: features.astro_links
                      || resolved.astro }, 'Astrologer menu')}>
                  Save &amp; publish astrologer menu
                </button>
              </div>
            </div>
          )}

          {pane === 'home' && (
            <div className="space-y-3">
              <h2 className="font-bold">Home page</h2>
              <Field label="Hero title">
                <input className="input"
                  value={content.homeHeroTitle || ''}
                  onChange={(e) => C('homeHeroTitle', e.target.value)} />
              </Field>
              <Field label="Hero subtitle">
                <textarea className="input" rows={2}
                  value={content.homeHeroSubtitle || ''}
                  onChange={(e) =>
                    C('homeHeroSubtitle', e.target.value)} />
              </Field>
              <div className="font-semibold">Sections to show</div>
              {[['sec_quickActions', 'Quick tiles'],
                ['sec_starsToday', 'Your stars today'],
                ['sec_categories', 'Browse by category'],
                ['sec_topRated', 'Top rated astrologers'],
                ['sec_reviews', 'Customer reviews']].map(([k, l]) => (
                <label key={k}
                  className="flex items-center gap-2 text-sm">
                  <input type="checkbox"
                    checked={content[k] !== false}
                    onChange={(e) => C(k, e.target.checked)} />
                  {l}
                </label>
              ))}
              <button className="btn-primary"
                onClick={() => publish('content', {
                  homeHeroTitle: content.homeHeroTitle || '',
                  homeHeroSubtitle: content.homeHeroSubtitle || '',
                  sec_quickActions: content.sec_quickActions !== false,
                  sec_starsToday: content.sec_starsToday !== false,
                  sec_categories: content.sec_categories !== false,
                  sec_topRated: content.sec_topRated !== false,
                  sec_reviews: content.sec_reviews !== false,
                }, 'Home')}>Save &amp; publish</button>
            </div>
          )}

          {pane === 'text' && (
            <div className="space-y-3">
              <h2 className="font-bold">Button &amp; section text</h2>
              <p className="text-xs text-sub-text">
                Override the exact words shown on the client home. Blank
                = use the built-in default.
              </p>
              {TEXT_KEYS.map(([k, l]) => (
                <Field key={k} label={l}>
                  <input className="input"
                    value={(content.text && content.text[k]) || ''}
                    onChange={(e) => TX(k, e.target.value)} />
                </Field>
              ))}
              <button className="btn-primary"
                onClick={() => publish('content',
                  { text: content.text || {} }, 'Text')}>
                Save &amp; publish text
              </button>
            </div>
          )}

          {pane === 'versions' && (
            <div className="space-y-3">
              <h2 className="font-bold">App versions &amp; downloads</h2>
              <p className="text-xs text-sub-text">
                The version auto-increments on every build (single
                source: shared/appVersion.js). This build is{' '}
                <b>1.0.{APP_BUILD}</b> (build {APP_BUILD}).
              </p>
              <div className="space-y-1 rounded-card border
                border-gray-200 p-3 text-sm">
                <div>Customer app: <b>{appVersionName('client-web')}
                </b> (code {APP_BUILD})</div>
                <div>Astrologer app: <b>{appVersionName('astro-web')}
                </b> (code {APP_BUILD})</div>
                <div>Admin app: <b>{appVersionName('admin-web')}</b>
                  {' '}(code {APP_BUILD})</div>
                <div className="text-xs text-sub-text">
                  iOS uses the same version (built via the iOS workflow).
                </div>
              </div>
              <p className="text-xs text-sub-text">
                Paste your download links (Google Drive share links work)
                so users on an old version are prompted to update. The
                customer app uses the APK URL + latest build below for
                its in-app update.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Latest version label (shown to users)">
                  <input className="input"
                    value={config.app_latest_version || ''}
                    onChange={(e) => setConfig({ ...config,
                      app_latest_version: e.target.value })} />
                </Field>
                <Field label="Latest build number (must be > installed)">
                  <input className="input" type="number"
                    value={config.app_latest_build || ''}
                    onChange={(e) => setConfig({ ...config,
                      app_latest_build: e.target.value })} />
                </Field>
              </div>
              <Field label="Customer APK / Drive link (in-app update)">
                <input className="input"
                  value={config.app_apk_url || ''}
                  onChange={(e) => setConfig({ ...config,
                    app_apk_url: e.target.value })} />
              </Field>
              <Field label="Astrologer APK / Drive link">
                <input className="input"
                  value={config.app_apk_astro_url || ''}
                  onChange={(e) => setConfig({ ...config,
                    app_apk_astro_url: e.target.value })} />
              </Field>
              <Field label="Admin APK / Drive link">
                <input className="input"
                  value={config.app_apk_admin_url || ''}
                  onChange={(e) => setConfig({ ...config,
                    app_apk_admin_url: e.target.value })} />
              </Field>
              <Field label="iOS IPA / Drive link (all apps)">
                <input className="input"
                  value={config.app_ipa_url || ''}
                  onChange={(e) => setConfig({ ...config,
                    app_ipa_url: e.target.value })} />
              </Field>
              <Field label="Update notes (optional)">
                <textarea className="input" rows={2}
                  value={config.app_update_notes || ''}
                  onChange={(e) => setConfig({ ...config,
                    app_update_notes: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox"
                  checked={config.app_update_popup !== false}
                  onChange={(e) => setConfig({ ...config,
                    app_update_popup: e.target.checked })} />
                Show the update popup on launch for old versions
              </label>
              <button className="btn-primary"
                onClick={() => publish('config', {
                  app_latest_version: config.app_latest_version || '',
                  app_latest_build:
                    Number(config.app_latest_build) || 0,
                  app_apk_url: config.app_apk_url || '',
                  app_apk_astro_url: config.app_apk_astro_url || '',
                  app_apk_admin_url: config.app_apk_admin_url || '',
                  app_ipa_url: config.app_ipa_url || '',
                  app_update_notes: config.app_update_notes || '',
                  app_update_popup: config.app_update_popup !== false,
                }, 'App versions')}>Save &amp; publish</button>
            </div>
          )}

          {pane === 'announce' && (
            <div className="space-y-3">
              <h2 className="font-bold">Announcement bar</h2>
              <Field label="Message">
                <input className="input" value={(ann && ann.text) || ''}
                  onChange={(e) => setAnn({ ...(ann || {}),
                    text: e.target.value })} />
              </Field>
              <Field label="Button label (optional)">
                <input className="input"
                  value={(ann && ann.ctaLabel) || ''}
                  onChange={(e) => setAnn({ ...(ann || {}),
                    ctaLabel: e.target.value })} />
              </Field>
              <Field label="Button link (optional)">
                <input className="input"
                  value={(ann && ann.ctaLink) || ''}
                  onChange={(e) => setAnn({ ...(ann || {}),
                    ctaLink: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!(ann && ann.active)}
                  onChange={(e) => setAnn({ ...(ann || {}),
                    active: e.target.checked })} />
                Show the bar
              </label>
              <button className="btn-primary"
                onClick={() => publish('announcement', ann || {},
                  'Announcement')}>Save &amp; publish</button>
            </div>
          )}

          {pane === 'preview' && (
            <div className="space-y-2">
              <h2 className="font-bold">Live preview ({device})</h2>
              <p className="text-xs text-sub-text">
                Pick a portal, edit menus/text/theme in the tabs above,
                hit Save &amp; publish, then ↻ Refresh — changes appear
                here instantly (same site your users see).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="rounded-full bg-primary px-3 py-1.5
                  text-sm font-semibold text-white"
                  onClick={() => C('previewUrl',
                    getPortalUrls().client)}>
                  👤 Client portal
                </button>
                <button className="rounded-full bg-amber-500 px-3 py-1.5
                  text-sm font-semibold text-white"
                  onClick={() => C('previewUrl',
                    getPortalUrls().astrologer)}>
                  🔮 Astrologer portal
                </button>
                <button className="rounded-full border border-gray-300
                  px-3 py-1.5 text-sm font-semibold"
                  onClick={() => setPvKey((k) => k + 1)}>
                  ↻ Refresh
                </button>
              </div>
              <Field label="Preview URL">
                <input className="input"
                  value={content.previewUrl || ''}
                  onChange={(e) => C('previewUrl', e.target.value)}
                  onBlur={() => publish('content',
                    { previewUrl: content.previewUrl || '' },
                    'Preview URL')} />
              </Field>
              {content.previewUrl ? (
                <div className="overflow-auto rounded-card border
                  border-gray-200 bg-bg-light p-3">
                  <iframe title="preview"
                    key={`${content.previewUrl}-${pvKey}`}
                    src={content.previewUrl}
                    style={{
                      width: device === 'desktop' ? '100%' : 390,
                      height: 640, border: 0, background: '#fff',
                      margin: '0 auto', display: 'block',
                    }} />
                </div>
              ) : (
                <p className="text-sm text-sub-text">
                  Set the live site URL (e.g.
                  https://astro.vickymartinsingh.com) to preview it
                  here at the selected device width.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
