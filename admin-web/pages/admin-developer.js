import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Developer Mode: a single console with EVERY app config in one place.
// (Later this can move to a dedicated developer account; for now it
// lives in admin.)
const SECTIONS = [
  ['Appearance', [
    ['/admin-theme', 'Theme & Colours', 'Full palette + custom themes'],
    ['/admin-settings', 'Branding & Settings',
      'Logo, favicon, name, commission, recharge'],
    ['/admin-features', 'Feature Toggles & Nav Labels',
      'Enable/disable modules, rename bottom tabs'],
  ]],
  ['Commerce', [
    ['/admin-payments', 'Payment Gateways',
      'Razorpay, Cashfree and more'],
    ['/admin-coupons', 'Coupons', 'Discount codes'],
    ['/admin-gifts', 'Gift Cards', 'Generate shareable codes'],
  ]],
  ['Astrology', [
    ['/admin-kundli-api', 'Kundli API Provider',
      'Switch provider + keys'],
    ['/admin-remedies', 'Remedies Catalogue', 'Master remedy list'],
  ]],
  ['Engagement', [
    ['/admin-announcement', 'Announcement Banner', 'Site-wide banner'],
    ['/admin-notifications', 'Notifications', 'Push to users'],
    ['/admin-cms', 'CMS Builder', 'Pages & blocks'],
    ['/admin-live', 'Monitor Live', 'Watch live streams'],
  ]],
];

// Editable app text/content (read by the apps where wired; safe to
// extend - just add a key here and read it in the app).
const TEXT_KEYS = [
  ['homeHeroTitle', 'Home hero title'],
  ['homeHeroSubtitle', 'Home hero subtitle'],
  ['appTagline', 'App tagline'],
  ['supportEmail', 'Support email'],
  ['supportPhone', 'Support phone'],
  ['aboutText', 'About / footer text'],
];

export default function AdminDeveloper() {
  const { loading } = useRequireAdmin();
  const [content, setContent] = useState(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'content')).then((s) =>
      setContent(s.exists() ? s.data() : {}));
  }, []);

  async function saveContent() {
    await adminService.updateSettings('content', content);
    flash('App text saved - live across the apps');
  }

  if (loading || !content) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Developer Mode</h1>
      <p className="mb-4 text-sm text-sub-text">
        Everything that controls the apps - appearance, content, menus,
        text, commerce - in one console. Changes apply across client,
        astrologer and admin (and web) without a rebuild.
      </p>

      {SECTIONS.map(([group, items]) => (
        <div key={group} className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase
            tracking-wide text-sub-text">{group}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2
            lg:grid-cols-3">
            {items.map(([href, title, desc]) => (
              <Link key={href} href={href}
                className="card transition hover:shadow-md">
                <div className="font-semibold text-primary">{title}</div>
                <div className="mt-0.5 text-xs text-sub-text">{desc}</div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="mb-2 mt-6 text-xs font-semibold uppercase
        tracking-wide text-sub-text">App Text / Content</div>
      <div className="card space-y-3">
        <p className="text-xs text-sub-text">
          Edit the wording used across the apps. (More keys can be added
          any time - the apps read these live.)
        </p>
        {TEXT_KEYS.map(([k, label]) => (
          <div key={k}>
            <label className="text-sm text-sub-text">{label}</label>
            {k === 'aboutText' ? (
              <textarea className="input" rows={3}
                value={content[k] || ''}
                onChange={(e) => setContent({
                  ...content, [k]: e.target.value })} />
            ) : (
              <input className="input" value={content[k] || ''}
                onChange={(e) => setContent({
                  ...content, [k]: e.target.value })} />
            )}
          </div>
        ))}
        <button onClick={saveContent} className="btn-primary w-full">
          Save app text
        </button>
      </div>
    </Layout>
  );
}
