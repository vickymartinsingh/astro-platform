import { useEffect, useMemo, useState } from 'react';
import {
  db, adminService, storage, appReleaseService, APP_BUILD, APP_VERSION,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import {
  ref, uploadBytesResumable, getDownloadURL,
} from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Manage app updates with no code.
//
// Releases are kept in Firestore at appReleases/{build} (auto-seeded
// from the admin app's own bundle on every open, so the dropdown is
// never empty). The admin picks a build from the dropdown - the latest
// is preselected - and clicks "Publish this version now" to write it
// into settings/config. Every customer / astrologer app reads that
// live and shows the update banner + popup the moment their installed
// build is lower.
//
// To register a NEW build (e.g. just produced a fresh AAB / APK at
// build 63): expand "Register a new release", fill in the build number
// + URL + notes, Save. The dropdown immediately picks it up.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}

export default function AdminAppUpdate() {
  const { loading } = useRequireAdmin();
  const [c, setC] = useState(null);             // settings/config
  const [releases, setReleases] = useState([]); // appReleases collection
  const [pickedBuild, setPickedBuild] = useState(0);
  const [busy, setBusy] = useState('');
  const [pct, setPct] = useState(0);
  const [urlTest, setUrlTest] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [n, setN] = useState({                  // new-release form state
    build: APP_BUILD + 1, version: '', apkUrl: '', notes: '',
    channel: 'apk',
  });

  async function refresh() {
    // 1. Make sure the build the admin app is on is registered.
    try { await appReleaseService.seedFromAppVersion(); }
    catch (_) { /* ignore */ }
    // 2. Load registry + current settings in parallel.
    const [list, snap] = await Promise.all([
      appReleaseService.listReleases(),
      getDoc(doc(db, 'settings', 'config')),
    ]);
    const cfg = snap.exists() ? snap.data() : {};
    setReleases(list || []);
    setC(cfg);
    // Pick whatever is currently published (so the operator can see at
    // a glance) OR the newest release if nothing is published yet.
    const cur = appReleaseService.asBuild(cfg.app_latest_build);
    const newest = (list && list[0] && Number(list[0].build)) || 0;
    setPickedBuild(cur || newest || APP_BUILD);
    setN((p) => ({ ...p, build: (newest || APP_BUILD) + 1,
      version: `1.0.${(newest || APP_BUILD) + 1}` }));
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  const picked = useMemo(
    () => releases.find((r) => Number(r.build) === pickedBuild) || null,
    [releases, pickedBuild]);

  async function testApkUrl(u) {
    const url = String(u || '').trim();
    if (!url) { setUrlTest('fail'); return; }
    setUrlTest('checking');
    try {
      let r = await fetch(url, { method: 'HEAD', mode: 'cors' })
        .catch(() => null);
      if (!r || !r.ok) {
        r = await fetch(url, { headers: { Range: 'bytes=0-1' } })
          .catch(() => null);
      }
      setUrlTest(r && (r.ok || r.status === 206) ? 'ok' : 'fail');
    } catch (_) { setUrlTest('fail'); }
  }

  if (loading || !c) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const setNew = (k, v) => setN((p) => ({ ...p, [k]: v }));

  const installedBuild = APP_BUILD;
  const publishedBuild = appReleaseService.asBuild(c.app_latest_build);
  const publishedVersion = c.app_latest_version || '-';
  const wouldUpdate = picked
    && Number(picked.build) > publishedBuild;

  // ---- Actions --------------------------------------------------------

  async function publishPicked(popup) {
    if (!picked) return;
    setBusy('publish');
    try {
      await appReleaseService.publishRelease({
        build: picked.build, version: picked.version,
        apkUrl: picked.apkUrl, storeUrl: picked.storeUrl,
        notes: picked.notes, channel: picked.channel || 'apk',
        popup: popup !== false,
      });
      flash(`Published build ${picked.build} (${picked.version}). `
        + 'All older installs will now see the update banner.');
      refresh();
    } catch (e) { flash(`Publish failed: ${e.message || e}`, 'error'); }
    finally { setBusy(''); }
  }

  async function saveSplashAndPopup() {
    setBusy('save');
    try {
      await adminService.updateSettings('config', {
        app_update_notes: c.app_update_notes || '',
        app_update_popup: c.app_update_popup !== false,
        splash_image: c.splash_image || '',
      });
      flash('Saved.');
    } catch (e) { flash(`Save failed: ${e.message || e}`, 'error'); }
    finally { setBusy(''); }
  }

  async function registerNew() {
    if (!n.build || appReleaseService.asBuild(n.build) <= 0) {
      flash('Build must be a whole number above 0.', 'error'); return;
    }
    if (!n.apkUrl.trim() && n.channel !== 'store') {
      flash('Paste a direct APK download URL (or upload one).', 'error');
      return;
    }
    setBusy('register');
    try {
      await appReleaseService.registerRelease({
        build: n.build, version: n.version || `1.0.${n.build}`,
        apkUrl: n.apkUrl, notes: n.notes, channel: n.channel,
      });
      flash(`Registered build ${appReleaseService.asBuild(n.build)}.`);
      setShowNew(false);
      setN({ build: appReleaseService.asBuild(n.build) + 1,
        version: '', apkUrl: '', notes: '', channel: 'apk' });
      // Auto-pick the new one in the dropdown so a single "Publish"
      // click ships it.
      setPickedBuild(appReleaseService.asBuild(n.build));
      refresh();
    } catch (e) { flash(`Register failed: ${e.message || e}`, 'error'); }
    finally { setBusy(''); }
  }

  async function deletePicked() {
    if (!picked) return;
    if (!window.confirm(`Delete release ${picked.version} (build `
      + `${picked.build}) from the registry? This does NOT unpublish `
      + 'if it is the currently published build.')) return;
    setBusy('delete');
    try {
      await appReleaseService.deleteRelease(picked.build);
      flash(`Deleted build ${picked.build} from the registry.`);
      refresh();
    } catch (e) { flash(`Delete failed: ${e.message || e}`, 'error'); }
    finally { setBusy(''); }
  }

  async function uploadApk(file) {
    if (!file) return;
    setBusy('apk'); setPct(0);
    const safe = String(file.name || 'app.apk').replace(/[^\w.\-]+/g, '_');
    const r = ref(storage, `media/apk/${Date.now()}_${safe}`);
    let lastTransferred = 0; let stuckSince = Date.now(); let watchdog;
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(r, file,
        { contentType: 'application/vnd.android.package-archive' });
      watchdog = setInterval(() => {
        if (Date.now() - stuckSince > 25000) {
          clearInterval(watchdog);
          try { task.cancel(); } catch (_) {}
          reject(new Error('storage/cors-or-network - no progress in 25s'));
        }
      }, 1000);
      task.on('state_changed', (snap) => {
        if (snap.bytesTransferred > lastTransferred) {
          lastTransferred = snap.bytesTransferred; stuckSince = Date.now();
        }
        setPct(Math.round((snap.bytesTransferred * 100)
          / Math.max(1, snap.totalBytes)));
      }, (err) => { clearInterval(watchdog); reject(err); },
      () => { clearInterval(watchdog); resolve(); });
    }).then(async () => {
      const url = await getDownloadURL(r);
      setNew('apkUrl', url);
      setShowNew(true);
      flash('APK uploaded - now fill the build number + Save below.');
    }).catch((e) => {
      const code = (e && e.code) || (e && e.message) || 'error';
      const isCors = /cors-or-network|preflight|network|0%/.test(code);
      flash(isCors
        ? 'Upload stuck (bucket CORS not configured for browser uploads). '
          + 'Workaround: upload your .apk to Google Drive / Dropbox, copy '
          + 'the direct download URL, and paste it manually.'
        : `Upload failed (${code}) - paste a public APK URL instead.`,
        'error');
    });
    clearInterval(watchdog);
    setBusy(''); setPct(0);
  }

  function splashFile(file) {
    if (!file) return;
    setBusy('splash');
    const fr = new FileReader();
    fr.onerror = () => { setBusy(''); flash('could not read', 'error'); };
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 720;
        const sc = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round((img.width || maxW) * sc));
        const h = Math.max(1, Math.round((img.height || maxW) * sc));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const url = cv.toDataURL('image/jpeg', 0.85);
        if (url.length > 850000) {
          setBusy(''); flash('image too large', 'error'); return;
        }
        set('splash_image', url);
        setBusy(''); flash('Splash ready - press Save below');
      };
      img.onerror = () => { setBusy(''); flash('invalid image', 'error'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  // ---- Render ---------------------------------------------------------

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Update &amp; Splash</h1>
      <p className="mb-3 text-sm text-sub-text">
        Pick a published build below. The instant you click <b>Publish
        this version now</b>, every installed customer / astrologer app
        on an older build shows the update banner + popup. No code, no
        Play Store wait.
      </p>

      {/* Current state at a glance */}
      <div className="card mb-3 grid grid-cols-1 gap-2 text-sm
        sm:grid-cols-3">
        <Cell label="Installed (this admin app)"
          value={`v${APP_VERSION} (build ${installedBuild})`}
          tone="info" />
        <Cell label="Currently published"
          value={publishedBuild
            ? `v${publishedVersion} (build ${publishedBuild})`
            : 'Nothing published yet'}
          tone={publishedBuild ? 'ok' : 'warn'} />
        <Cell label="Registered releases"
          value={`${releases.length} build${releases.length === 1 ? '' : 's'}`}
          tone="info" />
      </div>

      {/* Pick + publish */}
      <div className="card space-y-3">
        <div className="font-semibold">Publish an app version</div>

        <label className="block text-sm">
          Pick a build to publish
          <select className="input mt-1"
            value={pickedBuild || ''}
            onChange={(e) => { setPickedBuild(Number(e.target.value));
              setUrlTest(''); }}>
            {releases.length === 0 && (
              <option value="">No releases registered yet</option>
            )}
            {releases.map((r) => (
              <option key={r.build} value={r.build}>
                v{r.version || `1.0.${r.build}`} · build {r.build}
                {Number(r.build) === publishedBuild ? '  (live)' : ''}
                {r.releasedAt ? `  · ${fmt(r.releasedAt)}` : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-sub-text">
            Latest is preselected. Pick an older build to roll back.
          </span>
        </label>

        {picked && (
          <div className="rounded-card border border-gray-200 p-3
            text-[12px]">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary px-2 py-0.5
                text-[10px] font-bold text-white">
                build {picked.build}
              </span>
              <span className="font-bold">v{picked.version}</span>
              {Number(picked.build) === publishedBuild && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5
                  text-[10px] font-bold text-emerald-700">LIVE</span>
              )}
              <span className="text-sub-text">
                {picked.channel === 'store'
                  ? '· via Play Store' : '· via APK download'}
              </span>
            </div>
            {picked.apkUrl ? (
              <div className="break-all">
                APK:{' '}
                <a className="text-primary underline"
                  href={picked.apkUrl} target="_blank" rel="noreferrer">
                  {picked.apkUrl}
                </a>
                {' '}
                <button type="button"
                  onClick={() => testApkUrl(picked.apkUrl)}
                  className="ml-1 rounded-full bg-bg-light px-2 py-0.5
                    text-[10px] font-bold text-primary">
                  Test link
                </button>
                {urlTest === 'ok' && (
                  <span className="ml-1 text-[11px] text-success">
                    ✓ reachable
                  </span>
                )}
                {urlTest === 'fail' && (
                  <span className="ml-1 text-[11px] text-danger">
                    ✗ not reachable
                  </span>
                )}
              </div>
            ) : (
              <div className="text-danger">
                No APK URL on this release - register one before publishing.
              </div>
            )}
            {picked.storeUrl && (
              <div className="mt-1 break-all">
                Store: <a className="text-primary underline"
                  href={picked.storeUrl} target="_blank" rel="noreferrer">
                  {picked.storeUrl}
                </a>
              </div>
            )}
            {picked.notes && (
              <p className="mt-1 whitespace-pre-line text-sub-text">
                {picked.notes}
              </p>
            )}
          </div>
        )}

        {picked && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => publishPicked(true)}
              disabled={busy === 'publish' || !picked.apkUrl
                && !picked.storeUrl}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm
                font-bold text-white disabled:opacity-60">
              {busy === 'publish'
                ? 'Publishing…'
                : (wouldUpdate
                  ? 'Publish this version now (popup ON)'
                  : Number(picked.build) === publishedBuild
                    ? 'Re-publish (refresh popup)'
                    : 'Publish (older than what is live)')}
            </button>
            <button onClick={() => publishPicked(false)}
              disabled={busy === 'publish'}
              className="rounded-full border border-emerald-600 px-4
                py-2 text-sm font-bold text-emerald-700
                disabled:opacity-60">
              Publish silently (banner only, no popup)
            </button>
            <button onClick={deletePicked} disabled={busy === 'delete'}
              className="rounded-full border border-danger px-4 py-2
                text-sm font-bold text-danger disabled:opacity-60">
              Remove from registry
            </button>
          </div>
        )}
      </div>

      {/* Register a new release */}
      <div className="card mt-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Register a new release</div>
          <button onClick={() => setShowNew((v) => !v)}
            className="rounded-full bg-bg-light px-3 py-1 text-xs
              font-bold text-primary">
            {showNew ? 'Hide' : 'Open'}
          </button>
        </div>
        {showNew && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Build number (whole integer, e.g. 63)">
                <input className="input" type="number" min={1} step={1}
                  value={n.build}
                  onChange={(e) => setNew('build',
                    appReleaseService.asBuild(e.target.value))} />
              </Field>
              <Field label="Version label (e.g. 1.0.63)">
                <input className="input" value={n.version}
                  placeholder={`1.0.${n.build || ''}`}
                  onChange={(e) => setNew('version', e.target.value)} />
              </Field>
            </div>
            <Field label="Channel">
              <select className="input" value={n.channel}
                onChange={(e) => setNew('channel', e.target.value)}>
                <option value="apk">Direct APK download</option>
                <option value="store">Play Store (live listing)</option>
              </select>
            </Field>
            <Field label={n.channel === 'store'
              ? 'Play Store URL'
              : 'APK download URL (direct .apk link)'}>
              <input className="input"
                placeholder={n.channel === 'store'
                  ? 'https://play.google.com/store/apps/details?id=...'
                  : 'https://.../AstroSeerConnect.apk'}
                value={n.apkUrl}
                onChange={(e) => setNew('apkUrl', e.target.value)} />
            </Field>
            <Field label="Update notes (shown in the popup)">
              <textarea className="input" rows={3} value={n.notes}
                onChange={(e) => setNew('notes', e.target.value)} />
            </Field>
            <label className="block cursor-pointer text-xs text-sub-text
              underline">
              {busy === 'apk'
                ? `Uploading to Firebase… ${pct}%`
                : 'Or upload an .apk to Firebase (auto-fills the URL)'}
              <input type="file" accept=".apk" hidden
                onChange={(e) => uploadApk(e.target.files?.[0])} />
            </label>
            <button onClick={registerNew} disabled={busy === 'register'}
              className="rounded-full bg-primary px-4 py-2 text-sm
                font-bold text-white disabled:opacity-60">
              {busy === 'register'
                ? 'Saving…' : 'Save release to registry'}
            </button>
            <p className="text-[11px] leading-relaxed text-sub-text">
              Easiest APK hosts:
              <br />• <b>GitHub Releases</b> (free): create a release,
              attach the .apk, copy its asset URL (ends in <code>.apk</code>).
              <br />• <b>Google Drive</b>: upload, share &quot;Anyone with
              the link&quot;, then use
              <code> https://drive.google.com/uc?export=download&amp;id=FILE_ID</code>.
            </p>
          </div>
        )}
      </div>

      {/* Default notes + popup setting + splash */}
      <div className="card mt-4 space-y-3">
        <div className="font-semibold">Defaults</div>
        <label className="block text-sm">
          Default update notes (used if a release has none)
          <textarea className="input mt-1" rows={3}
            value={c.app_update_notes || ''}
            onChange={(e) => set('app_update_notes', e.target.value)} />
        </label>
        <label className="flex items-center justify-between text-sm">
          <span>Show the update popup on app open</span>
          <input type="checkbox"
            checked={c.app_update_popup !== false}
            onChange={(e) => set('app_update_popup', e.target.checked)} />
        </label>
        <button onClick={saveSplashAndPopup} disabled={busy === 'save'}
          className="btn-primary !min-h-0 py-2 text-sm">
          {busy === 'save' ? 'Saving…' : 'Save defaults'}
        </button>
      </div>

      <div className="card mt-4 space-y-3">
        <div className="font-semibold">Launch splash image</div>
        <p className="text-xs text-sub-text">
          Shown full screen on a themed background while the app starts.
          Falls back to the logo if not set.
        </p>
        {c.splash_image && (
          <img src={c.splash_image} alt="splash"
            className="max-h-40 rounded-card object-contain" />
        )}
        <label className="cursor-pointer inline-block rounded-card border
          border-primary px-4 py-2 text-sm font-semibold text-primary">
          {busy === 'splash' ? 'Processing...' : 'Upload splash image'}
          <input type="file" accept="image/*" hidden
            onChange={(e) => splashFile(e.target.files?.[0])} />
        </label>
        {c.splash_image && (
          <button onClick={() => set('splash_image', '')}
            className="ml-2 rounded-card border border-gray-300 px-3
              py-2 text-sm text-sub-text">Remove</button>
        )}
      </div>
    </Layout>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="block text-[11px] font-bold uppercase
        tracking-wider text-sub-text">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Cell({ label, value, tone }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-800'
    : tone === 'warn' ? 'bg-amber-50 text-amber-800'
      : 'bg-bg-light text-dark-text';
  return (
    <div className={`rounded-card p-2.5 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider
        opacity-70">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
