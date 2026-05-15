import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// settings/config is write:false from the client (blueprint 12.3); saves go
// through the adminUpdateSettings Cloud Function (Admin SDK + audit log).
export default function AdminSettings() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setCfg(s.exists() ? s.data() : {
        platformName: 'AstroConnect', commission_percent: 30,
        min_recharge: 100, signup_bonus: 0,
        free_chat_seconds: 0, free_call_seconds: 0, kundliToolUrl: '',
      }));
  }, []);

  async function save() {
    setMsg('');
    await adminService.updateSettings('config', {
      platformName: cfg.platformName,
      commission_percent: Number(cfg.commission_percent),
      min_recharge: Number(cfg.min_recharge),
      signup_bonus: Number(cfg.signup_bonus),
      free_chat_seconds: Number(cfg.free_chat_seconds),
      free_call_seconds: Number(cfg.free_call_seconds),
      kundliToolUrl: cfg.kundliToolUrl || '',
      gst_percent: Number(cfg.gst_percent || 0),
      gstin: cfg.gstin || '',
      referral_referrer_bonus: Number(cfg.referral_referrer_bonus || 0),
      referral_referee_bonus: Number(cfg.referral_referee_bonus || 0),
    });
    setMsg('Settings saved.');
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const fields = [
    ['platformName', 'Platform Name', 'text'],
    ['commission_percent', 'Commission %', 'number'],
    ['min_recharge', 'Minimum Recharge ₹', 'number'],
    ['signup_bonus', 'Signup Bonus ₹', 'number'],
    ['free_chat_seconds', 'Free Chat Seconds', 'number'],
    ['free_call_seconds', 'Free Call Seconds', 'number'],
    ['kundliToolUrl', 'Kundli Tool URL', 'text'],
    ['gst_percent', 'GST %', 'number'],
    ['gstin', 'Company GSTIN', 'text'],
    ['referral_referrer_bonus', 'Referral Bonus, Referrer ₹', 'number'],
    ['referral_referee_bonus', 'Referral Bonus, New User ₹', 'number'],
  ];

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">System Settings</h1>
      {msg && <div className="card mb-3 bg-success/10 text-success">{msg}</div>}
      <div className="card space-y-3">
        {fields.map(([k, label, type]) => (
          <div key={k}>
            <label className="text-sm text-sub-text">{label}</label>
            <input className="input" type={type} value={cfg[k] ?? ''}
              onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
          </div>
        ))}
        <button onClick={save} className="btn-primary w-full">
          Save Settings
        </button>
      </div>
    </Layout>
  );
}
