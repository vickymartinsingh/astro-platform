import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const TOGGLES = [
  ['enable_chat', 'Chat'],
  ['enable_call', 'Voice Call'],
  ['enable_video', 'Video Call'],
  ['enable_kundli', 'Kundli'],
  ['enable_horoscope', 'Horoscope'],
  ['enable_ai', 'AI Features'],
  ['enable_tour', 'Guided Tour'],
  ['free_chat_enabled', 'Free Chat'],
  ['free_call_enabled', 'Free Call'],
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
    </Layout>
  );
}
