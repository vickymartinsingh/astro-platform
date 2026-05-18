import { useEffect, useState } from 'react';
import { db, adminService, storage } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Manage app updates with no code. Bump the build number + version,
// give the APK link (or upload the .apk), optional notes, and choose
// whether the launch popup shows. Every app reads this live from
// settings/config and shows the update banner / popup until the user
// is on (or past) this build. Also upload the launch splash image.
export default function AdminAppUpdate() {
  const { loading } = useRequireAdmin();
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) => {
      setC(s.exists() ? s.data() : {});
    });
  }, []);

  if (loading || !c) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));

  async function uploadApk(file) {
    if (!file) return;
    setBusy('apk');
    try {
      const r = ref(storage, `apk/app-${Date.now()}.apk`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      set('app_apk_url', url);
      flash('APK uploaded - press Save');
    } catch (e) {
      flash('Upload failed - paste a public APK URL instead', 'error');
    } finally { setBusy(''); }
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
        setBusy(''); flash('Splash ready - press Save');
      };
      img.onerror = () => { setBusy(''); flash('invalid image', 'error'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  async function save() {
    await adminService.updateSettings('config', {
      app_latest_build: Number(c.app_latest_build || 0),
      app_latest_version: c.app_latest_version || '',
      app_update_mode: c.app_update_mode === 'store' ? 'store' : 'apk',
      app_apk_url: c.app_apk_url || '',
      app_store_url: c.app_store_url || '',
      app_update_notes: c.app_update_notes || '',
      app_update_popup: c.app_update_popup !== false,
      splash_image: c.splash_image || '',
    });
    flash('Saved - live in all apps');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">App Update &amp; Splash</h1>
      <p className="mb-4 text-sm text-sub-text">
        Publish a new app version. Apps with an older build show an
        update banner (and a once-per-open popup if enabled) until the
        user updates. Changes are live on Save - no code.
      </p>

      <div className="card space-y-3">
        <div className="font-semibold">New version</div>
        <label className="block text-sm">
          Latest build number (whole number, must be higher than the
          installed build to trigger an update)
          <input className="input mt-1" type="number" min={0}
            value={c.app_latest_build == null ? '' : c.app_latest_build}
            onChange={(e) => set('app_latest_build',
              e.target.value === '' ? '' : Number(e.target.value))} />
        </label>
        <label className="block text-sm">
          Version label (e.g. 1.1.0)
          <input className="input mt-1"
            value={c.app_latest_version || ''}
            onChange={(e) => set('app_latest_version', e.target.value)} />
        </label>
        <label className="block text-sm">
          How users update
          <select className="input mt-1"
            value={c.app_update_mode === 'store' ? 'store' : 'apk'}
            onChange={(e) => set('app_update_mode', e.target.value)}>
            <option value="apk">
              Download APK (now, before Play Store)
            </option>
            <option value="store">
              Redirect to Play Store (after publishing)
            </option>
          </select>
          <span className="mt-1 block text-xs text-sub-text">
            Switch to &quot;Play Store&quot; once the app is live on
            the store - the Update button then opens the store listing.
          </span>
        </label>
        <label className="block text-sm">
          Play Store URL
          <input className="input mt-1"
            placeholder="https://play.google.com/store/apps/details?id=..."
            value={c.app_store_url || ''}
            onChange={(e) => set('app_store_url', e.target.value)} />
        </label>
        <label className="block text-sm">
          APK download URL
          <input className="input mt-1" placeholder="https://.../app.apk"
            value={c.app_apk_url || ''}
            onChange={(e) => set('app_apk_url', e.target.value)} />
        </label>
        <label className="cursor-pointer inline-block rounded-card border
          border-primary px-4 py-2 text-sm font-semibold text-primary">
          {busy === 'apk' ? 'Uploading APK...' : 'Or upload .apk file'}
          <input type="file" accept=".apk" hidden
            onChange={(e) => uploadApk(e.target.files?.[0])} />
        </label>
        <label className="block text-sm">
          Update notes (shown in the popup)
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

      <button onClick={save} className="btn-primary mt-4 w-full">
        Save
      </button>
    </Layout>
  );
}
