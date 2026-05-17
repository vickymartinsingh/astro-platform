import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// EVERY screen in the platform (kept complete - nothing hidden).
const ALL = [
  ['Overview', [
    ['/admin-dashboard', 'Dashboard'], ['/admin-analytics', 'Analytics'],
    ['/admin-reports', 'Reports'], ['/admin-audit', 'Audit Log'],
    ['/admin-health', 'System Health'],
  ]],
  ['People', [
    ['/admin-users', 'Users'], ['/admin-astrologers', 'Astrologers'],
    ['/admin-reviews', 'Customer Reviews'],
    ['/admin-support', 'Support Inbox'],
  ]],
  ['Sessions', [
    ['/admin-sessions', 'Sessions'], ['/admin-live', 'Monitor Live'],
  ]],
  ['Finance', [
    ['/admin-transactions', 'Transactions'],
    ['/admin-payouts', 'Payouts'],
    ['/admin-payments', 'Payment Gateways'],
    ['/admin-coupons', 'Coupons'], ['/admin-gifts', 'Gift Cards'],
    ['/admin-disputes', 'Disputes'],
  ]],
  ['Content & Engagement', [
    ['/admin-cms', 'CMS Builder'],
    ['/admin-announcement', 'Announcement'],
    ['/admin-notifications', 'Notifications'],
  ]],
  ['Astrology', [
    ['/admin-kundli-api', 'Kundli API'],
    ['/admin-remedies', 'Remedies'],
  ]],
  ['Appearance & Build', [
    ['/admin-builder', 'App Builder (menus/sections/banner)'],
    ['/admin-theme', 'Theme & Colours'],
    ['/admin-settings', 'Branding & System Settings'],
    ['/admin-features', 'Feature Toggles & Nav Labels'],
    ['/admin-free', 'Free Sessions'],
  ]],
];

// Every settings document = every configurable field/menu/option.
const DOCS = [
  ['config', 'System / branding / commission / GST'],
  ['features', 'Feature toggles + bottom-nav labels/order/hidden'],
  ['content', 'All app text, hero, section show/hide'],
  ['theme', 'Active theme + custom theme presets'],
  ['payments', 'Payment gateways + keys'],
  ['announcement', 'Top banner'],
  ['kundliApi', 'Kundli API provider + keys'],
];

function Editor({ name }) {
  const [data, setData] = useState(null);
  const [raw, setRaw] = useState({});

  useEffect(() => {
    getDoc(doc(db, 'settings', name)).then((s) => {
      const d = s.exists() ? s.data() : {};
      setData(d);
      const r = {};
      Object.entries(d).forEach(([k, v]) => {
        r[k] = (v && typeof v === 'object')
          ? JSON.stringify(v, null, 2) : String(v);
      });
      setRaw(r);
    });
  }, [name]);

  if (!data) return <div className="text-sm text-sub-text">Loading...</div>;

  async function save() {
    const out = {};
    let bad = '';
    Object.entries(raw).forEach(([k, v]) => {
      const orig = data[k];
      if (orig && typeof orig === 'object') {
        try { out[k] = JSON.parse(v); }
        catch (_) { bad = k; }
      } else if (typeof orig === 'number') {
        out[k] = v === '' ? 0 : Number(v);
      } else if (typeof orig === 'boolean') {
        out[k] = v === 'true' || v === true;
      } else { out[k] = v; }
    });
    if (bad) { flash(`Invalid JSON in "${bad}"`, 'error'); return; }
    await adminService.updateSettings(name, out);
    flash(`settings/${name} saved - live everywhere`);
  }

  const keys = Object.keys(raw);
  return (
    <div className="space-y-2">
      {keys.length === 0 && (
        <div className="text-sm text-sub-text">
          No fields yet. Add one below.
        </div>
      )}
      {keys.map((k) => {
        const isObj = data[k] && typeof data[k] === 'object';
        const isBool = typeof data[k] === 'boolean';
        return (
          <div key={k}>
            <label className="text-xs font-semibold text-sub-text">
              {k}
            </label>
            {isObj ? (
              <textarea className="input font-mono text-xs" rows={4}
                value={raw[k]}
                onChange={(e) => setRaw({ ...raw, [k]: e.target.value })} />
            ) : isBool ? (
              <select className="input" value={String(raw[k])}
                onChange={(e) => setRaw({ ...raw, [k]: e.target.value })}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input className="input" value={raw[k]}
                onChange={(e) => setRaw({ ...raw, [k]: e.target.value })} />
            )}
          </div>
        );
      })}
      <AddField onAdd={(k) => { setData({ ...data, [k]: '' });
        setRaw({ ...raw, [k]: '' }); }} />
      <button onClick={save} className="btn-primary w-full">
        Save settings/{name}
      </button>
    </div>
  );
}

function AddField({ onAdd }) {
  const [k, setK] = useState('');
  return (
    <div className="flex gap-2">
      <input className="input flex-1" placeholder="Add a new field key"
        value={k} onChange={(e) => setK(e.target.value)} />
      <button onClick={() => { if (k.trim()) { onAdd(k.trim()); setK(''); } }}
        className="rounded-card border border-gray-300 px-3 text-sm">
        Add
      </button>
    </div>
  );
}

export default function AdminDeveloper() {
  const { loading } = useRequireAdmin();
  const [docName, setDocName] = useState('config');

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-3 rounded-card bg-dark-text px-4 py-2 text-sm
        font-semibold uppercase tracking-widest text-white">
        Developer Portal
      </div>
      <p className="mb-4 text-sm text-sub-text">
        Full control of the entire platform from one place - every
        screen, menu, field, text and option. Changes apply across
        client + astrologer + admin (and web) with no code/deploy.
      </p>

      {ALL.map(([group, items]) => (
        <div key={group} className="mb-4">
          <div className="mb-2 text-xs font-semibold uppercase
            tracking-wide text-sub-text">{group}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2
            lg:grid-cols-3">
            {items.map(([href, title]) => (
              <Link key={href} href={href}
                className="card transition hover:shadow-md">
                <div className="font-semibold text-primary">{title}</div>
                <div className="mt-0.5 text-xs text-sub-text">
                  {href}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="mb-2 mt-6 text-xs font-semibold uppercase
        tracking-wide text-sub-text">
        Raw configuration (every field &amp; menu)
      </div>
      <div className="card space-y-3">
        <p className="text-xs text-sub-text">
          Edit ANY setting directly - menus, labels, toggles, text,
          theme presets, gateway keys. Objects/arrays edit as JSON. Save
          and it is live everywhere instantly.
        </p>
        <select className="input" value={docName}
          onChange={(e) => setDocName(e.target.value)}>
          {DOCS.map(([id, desc]) => (
            <option key={id} value={id}>
              settings/{id} - {desc}
            </option>
          ))}
        </select>
        <Editor key={docName} name={docName} />
      </div>
    </Layout>
  );
}
