import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const TOGGLES = [
  ['enable_chat', 'Chat'],
  ['enable_call', 'Voice Call'],
  ['enable_video', 'Video Call'],
  ['enable_live', 'Live Streaming'],
  ['enable_kundli', 'Kundli'],
  ['enable_horoscope', 'Horoscope'],
  ['enable_remedies', 'Remedies'],
  ['enable_ai', 'AI Features'],
  ['enable_tour', 'Guided Tour'],
  ['free_chat_enabled', 'Free Chat'],
  ['free_call_enabled', 'Free Call'],
  // Sign-in / signup controls - persist in Firestore; auto live across
  // every app the moment you Save. No code deploy needed.
  ['google_signin_mobile', 'Google sign-in on mobile app'],
  ['google_signin_desktop', 'Google sign-in on desktop / web'],
  ['email_verification', 'Require email verification on signup'],
  ['register_as_astro_show', 'Show "Register as astrologer" on client'],
];
const NAV_LABELS = [
  ['nav_home', 'Home'],
  ['nav_chat', 'Chat'],
  ['nav_live', 'Live'],
  ['nav_call', 'Call'],
  ['nav_remedies', 'Remedies'],
];

export default function AdminFeatures() {
  const { loading } = useRequireAdmin();
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'features')).then((s) =>
      setF(s.exists() ? s.data() : {}));
  }, []);

  async function save() {
    await adminService.updateSettings('features', f);
    setMsg('Saved.');
    flash('Settings saved');
  }

  if (loading || !f) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Feature Toggle System</h1>
      {msg && <div className="card mb-3 bg-success/10 text-success">{msg}</div>}
      <div className="card space-y-2">
        {TOGGLES.map(([k, label]) => (
          <label key={k} className="flex items-center justify-between
                                    border-b py-2 last:border-0">
            <span>{label}</span>
            <input type="checkbox" checked={f[k] !== false}
              onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
          </label>
        ))}
        <button onClick={save} className="btn-primary mt-2 w-full">
          Save Toggles
        </button>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">
        Bottom navigation labels (client app)
      </h2>
      <div className="card space-y-2">
        {NAV_LABELS.map(([k, def]) => (
          <label key={k} className="flex items-center gap-3">
            <span className="w-24 text-sm text-sub-text">{def}</span>
            <input className="input flex-1"
              placeholder={def} value={f[k] || ''}
              onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </label>
        ))}
        <button onClick={save} className="btn-primary mt-2 w-full">
          Save Navigation
        </button>
      </div>
    </Layout>
  );
}
