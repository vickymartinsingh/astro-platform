import { useEffect, useState } from 'react';
import { db, adminService, iconsService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Change the home quick-action and category icons with NO code. Set an
// emoji OR upload an image. Saved to settings/content.icons and read
// live by every app (mobile + web) - applies on Save, no rebuild.
function fileToDataUrl(file, maxW) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('could not read file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round((img.width || maxW) * scale));
        const h = Math.max(1, Math.round((img.height || maxW) * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export default function AdminIcons() {
  const { loading } = useRequireAdmin();
  const [icons, setIcons] = useState(null);   // overrides only
  const [busy, setBusy] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'content')).then((s) => {
      const d = s.exists() ? s.data() : {};
      setIcons(d.icons || {});
    });
  }, []);

  if (loading || !icons) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const val = (k) => (icons[k] != null && icons[k] !== ''
    ? icons[k] : iconsService.DEFAULT_ICONS[k]);

  async function upload(k, file) {
    if (!file) return;
    setBusy(k);
    try {
      const url = await fileToDataUrl(file, 96);
      if (url.length > 200000) {
        throw new Error('image too big - use a small simple icon');
      }
      setIcons((p) => ({ ...p, [k]: url }));
      flash('Icon ready - press Save');
    } catch (e) {
      flash(e.message || 'upload failed', 'error');
    } finally { setBusy(''); }
  }

  async function save() {
    await adminService.updateSettings('content', { icons });
    flash('Icons saved - live across all apps');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Icons</h1>
      <p className="mb-4 text-sm text-sub-text">
        Set an emoji or upload an image for any home quick-action or
        category tile. Changes apply on Save across client + astrologer
        + admin and the mobile app - no rebuild.
      </p>

      <div className="card space-y-3">
        {iconsService.ICON_SLOTS.map(([k, label]) => {
          const v = val(k);
          const img = iconsService.isImage(v);
          return (
            <div key={k} className="flex flex-wrap items-center gap-3
              border-b border-gray-100 pb-3 last:border-0">
              <span className="flex h-10 w-10 items-center justify-center
                rounded-xl bg-bg-light text-2xl">
                {img ? (
                  <img src={v} alt="" className="h-8 w-8 object-contain" />
                ) : v}
              </span>
              <div className="min-w-[140px] text-sm">{label}</div>
              <input
                className="w-24 rounded border border-gray-200 px-2
                  py-1 text-center text-xl"
                value={img ? '' : (icons[k] || '')}
                placeholder="emoji"
                onChange={(e) => setIcons((p) => ({
                  ...p, [k]: e.target.value }))} />
              <label className="cursor-pointer rounded-card border
                border-primary px-3 py-1.5 text-sm text-primary">
                {busy === k ? 'Uploading...' : 'Upload image'}
                <input type="file" accept="image/*" hidden
                  onChange={(e) => upload(k, e.target.files?.[0])} />
              </label>
              <button onClick={() => setIcons((p) => {
                const n = { ...p }; delete n[k]; return n; })}
                className="rounded-card border border-gray-300 px-3
                  py-1.5 text-sm text-sub-text">Reset</button>
            </div>
          );
        })}
        <button onClick={save} className="btn-primary w-full">
          Save icons
        </button>
      </div>
    </Layout>
  );
}
