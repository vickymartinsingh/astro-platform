import { useEffect, useState } from 'react';
import { db, adminService, soundService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Pick the in-app notification tone and the call ringtone from several
// presets, or upload a custom sound. Saved to settings/config and used
// live by the apps (new-message / notification tone, call ringback).
// (The Android lock-screen PUSH sound is fixed at build time and is not
// controllable from here.)
function Row({ title, value, presets, onChange, loop }) {
  const isData = typeof value === 'string' && value.slice(0, 5) === 'data:';
  function upload(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const url = String(fr.result || '');
      if (url.length > 850000) {
        flash('sound too large - use a short clip (under ~600KB)',
          'error');
        return;
      }
      onChange(url);
      flash('Custom sound ready - press Save');
    };
    fr.readAsDataURL(file);
  }
  return (
    <div className="card space-y-3">
      <div className="font-semibold">{title}</div>
      <div className="flex flex-wrap gap-2">
        {presets.map(([k, label]) => (
          <span key={k}
            className={`flex items-center gap-1 rounded-full px-2 py-1
              text-sm ${value === k
                ? 'bg-primary text-white'
                : 'border border-gray-200'}`}>
            <button onClick={() => onChange(k)}
              className="px-1">{label}</button>
            <button onClick={() => soundService.preview(k, false)}
              aria-label={`Preview ${label}`}
              className="rounded-full px-1.5 opacity-80">▶</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-card border
          border-primary px-3 py-1.5 text-sm font-semibold text-primary">
          Upload custom
          <input type="file" accept="audio/*" hidden
            onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {isData && (
          <>
            <span className="rounded-full bg-success/15 px-3 py-1
              text-xs font-semibold text-success">Custom uploaded</span>
            <button
              onClick={() => soundService.preview(value, !!loop)}
              className="rounded-card border border-gray-200 px-3
                py-1.5 text-sm">Preview</button>
          </>
        )}
        {loop && (
          <button onClick={() => soundService.stopRing()}
            className="rounded-card border border-gray-200 px-3 py-1.5
              text-sm">Stop</button>
        )}
      </div>
    </div>
  );
}

export default function AdminSounds() {
  const { loading } = useRequireAdmin();
  const [c, setC] = useState(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) => {
      setC(s.exists() ? s.data() : {});
    });
  }, []);

  if (loading || !c) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  async function save() {
    await adminService.updateSettings('config', {
      sound_notif: c.sound_notif || 'chime',
      sound_ring: c.sound_ring || 'classic',
    });
    flash('Sounds saved - live in the apps');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Notification &amp; Ringtone</h1>
      <p className="mb-4 text-sm text-sub-text">
        Choose a preset or upload your own. Applied on Save across the
        apps. Tap a preset to hear it.
      </p>
      <div className="space-y-4">
        <Row title="Notification tone (new message / alerts)"
          value={c.sound_notif || 'chime'}
          presets={soundService.NOTIF_PRESETS}
          onChange={(v) => setC((p) => ({ ...p, sound_notif: v }))} />
        <Row title="Ringtone (incoming / waiting call)"
          value={c.sound_ring || 'classic'}
          presets={soundService.RING_PRESETS} loop
          onChange={(v) => setC((p) => ({ ...p, sound_ring: v }))} />
        <button onClick={save} className="btn-primary w-full">
          Save sounds
        </button>
      </div>
    </Layout>
  );
}
