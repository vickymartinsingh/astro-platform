import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Operator 2026-06-07: per-app URL config so the Play-Store-style
// update modal fires across customer / astrologer / admin / hr /
// support without code changes. Stored at settings/appLinks keyed by
// app slug. The same doc is read by the lib/appUpdate.js hook + the
// twice-daily scrape script writes latestBuild back here.

const APPS = [
  { key: 'customer', label: 'Customer app',
    pkg: 'com.astroseer.mobile' },
  { key: 'astrologer', label: 'Astrologer app',
    pkg: 'com.astroseer.astrologer' },
  { key: 'admin', label: 'Admin app',
    pkg: 'com.astroseer.admin' },
  { key: 'hr', label: 'HR app',
    pkg: 'com.astroseer.hr' },
  { key: 'support', label: 'Support app',
    pkg: 'com.astroseer.support' },
];

const BLANK = {
  storeUrl: '', displayName: '', latestBuild: 0, latestVersion: '',
  minRequiredBuild: 0, sizeMb: '', rating: '4.6', notes: '',
  popupEnabled: true,
};

export default function AdminAppUpdate() {
  const { loading } = useRequireAdmin();
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'appLinks'));
        if (s.exists()) {
          const d = s.data();
          setData(d);
          if (d._scrapedAt) setLastCheck(d._scrapedAt);
        }
      } catch (_) { /* empty doc is fine */ }
    })();
  }, [loading]);

  function set(key, field, value) {
    setData((d) => ({ ...d, [key]: { ...BLANK, ...(d[key] || {}),
      [field]: value } }));
  }

  async function save(key) {
    setBusy(true);
    try {
      const cur = { ...BLANK, ...(data[key] || {}) };
      cur.latestBuild = Number(cur.latestBuild) || 0;
      cur.minRequiredBuild = Number(cur.minRequiredBuild) || 0;
      await setDoc(doc(db, 'settings', 'appLinks'),
        { [key]: cur, updatedAt: serverTimestamp() }, { merge: true });
      flash(`Saved ${key}`);
    } catch (e) {
      flash(`Save failed: ${e?.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <header className="mb-3">
        <h1 className="text-2xl font-bold text-dark-text">
          In-app update popup
        </h1>
        <div className="mt-1 inline-flex flex-wrap items-center gap-2
          rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold
          text-emerald-700">
          <span>✓ This is the right place</span>
          <span className="opacity-70">·</span>
          <a href="/admin-appupdate"
            className="underline opacity-80 hover:opacity-100">
            Legacy OTA tool lives at /admin-appupdate
          </a>
        </div>
        <h2 className="mt-3 text-lg font-bold text-dark-text">
          App update links
        </h2>
        <p className="mt-0.5 text-sm text-sub-text">
          Configure the Play Store URL + latest build per app. The
          in-app banner fires automatically the moment installed{' '}
          <code>APP_BUILD</code> is lower than{' '}
          <b>Latest build</b>. The twice-daily scraper writes the
          Play Store version back into <b>Latest build</b> so this
          can be on auto-pilot. Set <b>Min required build</b> only
          when a release MUST be installed (force update).
        </p>
        {lastCheck && (
          <p className="mt-1 text-[11px] text-sub-text">
            Last Play Store scrape:{' '}
            <b>{new Date(lastCheck.toMillis
              ? lastCheck.toMillis()
              : lastCheck.seconds * 1000).toLocaleString('en-GB')}</b>
          </p>
        )}
      </header>

      <div className="space-y-3">
        {APPS.map((a) => {
          const cur = { ...BLANK, ...(data[a.key] || {}) };
          return (
            <div key={a.key} className="surface p-4">
              <div className="mb-3 flex flex-wrap items-center
                justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold uppercase
                    tracking-wider text-sub-text">{a.label}</h2>
                  <p className="text-[11px] text-sub-text">
                    Package: <span className="font-mono">{a.pkg}</span>
                  </p>
                </div>
                <button onClick={() => save(a.key)} disabled={busy}
                  className="rounded-full bg-primary px-4 py-2
                    text-xs font-bold text-white disabled:opacity-50">
                  Save
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Play Store URL"
                  hint="https://play.google.com/store/apps/details?id=..."
                  span="sm:col-span-2">
                  <input className="input" value={cur.storeUrl}
                    onChange={(e) =>
                      set(a.key, 'storeUrl', e.target.value)}
                    placeholder={`https://play.google.com/store/apps/details?id=${a.pkg}`} />
                </Field>
                <Field label="Display name">
                  <input className="input" value={cur.displayName}
                    onChange={(e) =>
                      set(a.key, 'displayName', e.target.value)}
                    placeholder="AstroSeer" />
                </Field>
                <Field label="Latest version (display)">
                  <input className="input" value={cur.latestVersion}
                    onChange={(e) =>
                      set(a.key, 'latestVersion', e.target.value)}
                    placeholder="1.0.99" />
                </Field>
                <Field label="Latest build">
                  <input type="number" className="input"
                    value={cur.latestBuild}
                    onChange={(e) =>
                      set(a.key, 'latestBuild', e.target.value)} />
                </Field>
                <Field label="Min required build (force update)">
                  <input type="number" className="input"
                    value={cur.minRequiredBuild}
                    onChange={(e) =>
                      set(a.key, 'minRequiredBuild', e.target.value)} />
                </Field>
                <Field label="Size (MB)">
                  <input className="input" value={cur.sizeMb}
                    onChange={(e) =>
                      set(a.key, 'sizeMb', e.target.value)}
                    placeholder="14" />
                </Field>
                <Field label="Play rating">
                  <input className="input" value={cur.rating}
                    onChange={(e) =>
                      set(a.key, 'rating', e.target.value)}
                    placeholder="4.6" />
                </Field>
                <Field label="What's new" span="sm:col-span-2">
                  <textarea className="input" rows={3}
                    value={cur.notes}
                    onChange={(e) =>
                      set(a.key, 'notes', e.target.value)}
                    placeholder="Release notes shown inside the modal." />
                </Field>
                <Field label="Banner enabled" span="sm:col-span-2">
                  <label className="inline-flex items-center gap-2
                    text-sm">
                    <input type="checkbox"
                      checked={cur.popupEnabled !== false}
                      onChange={(e) => set(a.key, 'popupEnabled',
                        e.target.checked)} />
                    Show the modal in-app when out of date
                  </label>
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}

function Field({ label, hint, children, span }) {
  return (
    <div className={span || ''}>
      <label className="text-[10px] font-bold uppercase
        tracking-wider text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-sub-text">{hint}</div>
      )}
    </div>
  );
}
