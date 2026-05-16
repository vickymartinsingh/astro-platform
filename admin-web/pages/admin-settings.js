import { useEffect, useState } from 'react';
import { db, storage, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// settings/config is admin-writable (client-side fallback when Cloud
// Functions are not deployed). Includes branding (logo / favicon).
export default function AdminSettings() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

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
      logo: cfg.logo || '',
      favicon: cfg.favicon || '',
    });
    setMsg('Settings saved.');
  }

  async function uploadBrand(kind, file) {
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const r = ref(storage, `media/${kind}-${Date.now()}-${file.name}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      const next = { ...cfg, [kind]: url };
      setCfg(next);
      await adminService.updateSettings('config', { [kind]: url });
      setMsg(`${kind} uploaded and saved.`);
    } catch (e) {
      setMsg(`Upload failed: ${e?.message || 'error'}`);
    } finally { setBusy(false); }
  }

  if (loading || !cfg) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const fields = [
    ['platformName', 'Platform Name', 'text'],
    ['commission_percent', 'Default Commission % (admin cut)', 'number'],
    ['min_recharge', 'Minimum Recharge ₹', 'number'],
    ['signup_bonus', 'Signup Bonus ₹', 'number'],
    ['free_chat_seconds', 'Free Chat Seconds (e.g. 300 = first 5 min)',
      'number'],
    ['free_call_seconds', 'Free Call Seconds (e.g. 300 = first 5 min)',
      'number'],
    ['kundliToolUrl', 'Kundli Tool URL', 'text'],
    ['gst_percent', 'GST %', 'number'],
    ['gstin', 'Company GSTIN', 'text'],
    ['referral_referrer_bonus', 'Referral Bonus, Referrer ₹', 'number'],
    ['referral_referee_bonus', 'Referral Bonus, New User ₹', 'number'],
  ];

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">System Settings</h1>
      {msg && (
        <div className="surface mb-3 bg-success/10 p-3 text-sm
                        text-success">{msg}</div>
      )}

      <div className="surface mb-4 p-4">
        <div className="mb-3 font-semibold">Branding</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm text-sub-text">Platform logo</div>
            {cfg.logo && (
              <img src={cfg.logo} alt="logo"
                className="my-2 h-12 rounded bg-bg-light object-contain" />
            )}
            <label className="btn-ghost cursor-pointer inline-block">
              {busy ? 'Uploading…' : 'Upload logo'}
              <input type="file" accept="image/*" hidden
                onChange={(e) => uploadBrand('logo', e.target.files?.[0])} />
            </label>
          </div>
          <div>
            <div className="text-sm text-sub-text">Favicon / icon</div>
            {cfg.favicon && (
              <img src={cfg.favicon} alt="favicon"
                className="my-2 h-12 w-12 rounded bg-bg-light
                           object-contain" />
            )}
            <label className="btn-ghost cursor-pointer inline-block">
              {busy ? 'Uploading…' : 'Upload icon'}
              <input type="file" accept="image/*" hidden
                onChange={(e) =>
                  uploadBrand('favicon', e.target.files?.[0])} />
            </label>
          </div>
        </div>
      </div>

      <div className="surface space-y-3 p-4">
        {fields.map(([k, label, type]) => (
          <div key={k}>
            <label className="text-sm text-sub-text">{label}</label>
            <input className="input" type={type} value={cfg[k] ?? ''}
              onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
          </div>
        ))}
        <button onClick={save} className="btn-grad w-full justify-center">
          Save Settings
        </button>
      </div>
    </Layout>
  );
}
