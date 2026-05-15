import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminAnnouncement() {
  const { loading } = useRequireAdmin();
  const [a, setA] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'announcement')).then((s) =>
      setA(s.exists() ? s.data() : {
        text: '', ctaLabel: '', ctaLink: '',
        target: 'all', active: false }));
  }, []);

  async function save() {
    await adminService.updateSettings('announcement', a);
    setMsg('Saved.');
  }

  if (loading || !a) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Announcement Banner</h1>
      {msg && <div className="card mb-3 bg-success/10 text-success">{msg}</div>}
      <div className="card space-y-3">
        <input className="input" placeholder="Banner text" value={a.text}
          onChange={(e) => setA({ ...a, text: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="CTA label"
            value={a.ctaLabel}
            onChange={(e) => setA({ ...a, ctaLabel: e.target.value })} />
          <input className="input" placeholder="CTA link"
            value={a.ctaLink}
            onChange={(e) => setA({ ...a, ctaLink: e.target.value })} />
        </div>
        <select className="input" value={a.target}
          onChange={(e) => setA({ ...a, target: e.target.value })}>
          <option value="all">All users</option>
          <option value="clients">Clients only</option>
          <option value="astrologers">Astrologers only</option>
        </select>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!a.active}
            onChange={(e) => setA({ ...a, active: e.target.checked })} />
          Active
        </label>
        <button onClick={save} className="btn-primary w-full">Save Banner</button>
      </div>
    </Layout>
  );
}
