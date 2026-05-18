import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Configure the Refer & Earn programme. Everything here is read live by
// the customer app's "Refer & Earn" card (settings/config) - edit and
// Save, it updates everywhere with no rebuild.
export default function AdminRefer() {
  const { loading } = useRequireAdmin();
  const [c, setC] = useState(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setC(s.exists() ? s.data() : {}));
  }, []);

  if (loading || !c) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));

  async function save() {
    await adminService.updateSettings('config', {
      refer_enabled: c.refer_enabled !== false,
      refer_reward: Number(c.refer_reward || 0),
      refer_friend_reward: Number(c.refer_friend_reward || 0),
      refer_title: c.refer_title || '',
      refer_desc: c.refer_desc || '',
      refer_terms: c.refer_terms || '',
    });
    flash('Refer & Earn saved - live in the app');
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Refer &amp; Earn</h1>
      <p className="mb-4 text-sm text-sub-text">
        Controls the customer Refer &amp; Earn card. Changes apply
        instantly to every app on Save.
      </p>
      <div className="card space-y-3">
        <label className="flex items-center justify-between text-sm">
          <span className="font-semibold">Enable Refer &amp; Earn</span>
          <input type="checkbox" checked={c.refer_enabled !== false}
            onChange={(e) => set('refer_enabled', e.target.checked)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Referrer reward (Rs)
            <input className="input mt-1" type="number" min={0}
              value={c.refer_reward == null ? '' : c.refer_reward}
              onChange={(e) => set('refer_reward',
                e.target.value === '' ? '' : Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            Friend reward (Rs)
            <input className="input mt-1" type="number" min={0}
              value={c.refer_friend_reward == null
                ? '' : c.refer_friend_reward}
              onChange={(e) => set('refer_friend_reward',
                e.target.value === '' ? '' : Number(e.target.value))} />
          </label>
        </div>
        <label className="block text-sm">
          Headline
          <input className="input mt-1"
            placeholder="Refer & Earn"
            value={c.refer_title || ''}
            onChange={(e) => set('refer_title', e.target.value)} />
        </label>
        <label className="block text-sm">
          Description
          <textarea className="input mt-1" rows={3}
            placeholder="Share your code; you and your friend both get
              wallet credit when they join."
            value={c.refer_desc || ''}
            onChange={(e) => set('refer_desc', e.target.value)} />
        </label>
        <label className="block text-sm">
          Terms &amp; conditions
          <textarea className="input mt-1" rows={4}
            placeholder="e.g. Reward credited after the friend's first
              paid consultation. Limited to N referrals..."
            value={c.refer_terms || ''}
            onChange={(e) => set('refer_terms', e.target.value)} />
        </label>
        <button onClick={save} className="btn-primary w-full">
          Save Refer &amp; Earn
        </button>
      </div>
    </Layout>
  );
}
