import { useEffect, useState } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Every major Indian payment gateway. Admin picks the active one and
// fills its keys. NOTE: the SECRET key must also be set in the relay
// env for real server-side capture; this page stores the selection +
// public config and the secret (use the relay for production capture).
const GATEWAYS = [
  ['razorpay', 'Razorpay', ['Key ID', 'Key Secret']],
  ['payu', 'PayU', ['Merchant Key', 'Merchant Salt']],
  ['cashfree', 'Cashfree', ['App ID', 'Secret Key']],
  ['paytm', 'Paytm', ['Merchant ID', 'Merchant Key']],
  ['phonepe', 'PhonePe', ['Merchant ID', 'Salt Key']],
  ['instamojo', 'Instamojo', ['API Key', 'Auth Token']],
  ['ccavenue', 'CCAvenue', ['Merchant ID', 'Access/Working Key']],
  ['billdesk', 'BillDesk', ['Merchant ID', 'Checksum Key']],
  ['easebuzz', 'Easebuzz', ['Key', 'Salt']],
  ['stripe', 'Stripe', ['Publishable Key', 'Secret Key']],
  ['paypal', 'PayPal', ['Client ID', 'Client Secret']],
  ['juspay', 'Juspay', ['Merchant ID', 'API Key']],
];

export default function AdminPayments() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'payments')).then((s) =>
      setCfg(s.exists() ? s.data() : { active: 'razorpay' }));
  }, []);

  async function save() {
    await adminService.updateSettings('payments', cfg);
    setMsg('Payment configuration saved.');
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const set = (g, k, v) =>
    setCfg({ ...cfg, [g]: { ...(cfg[g] || {}), [k]: v } });

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Payment Gateways</h1>
      <p className="mb-3 text-sm text-sub-text">
        Choose the active gateway and enter its credentials. For live
        capture, also set the secret in the relay environment. You can
        switch gateways here any time without a code change.
      </p>
      {msg && (
        <div className="card mb-3 bg-success/10 text-success">{msg}</div>
      )}

      <div className="space-y-3">
        {GATEWAYS.map(([id, label, fields]) => {
          const g = cfg[id] || {};
          const active = cfg.active === id;
          return (
            <div key={id}
              className={`card ${active ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="font-bold">{label}</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="active" checked={active}
                    onChange={() => setCfg({ ...cfg, active: id })} />
                  Active gateway
                </label>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {fields.map((fl, i) => (
                  <input key={fl} className="input"
                    placeholder={fl}
                    value={g[`field${i}`] || ''}
                    onChange={(e) => set(id, `field${i}`, e.target.value)} />
                ))}
                <input className="input sm:col-span-2"
                  placeholder="Webhook / extra config (optional)"
                  value={g.extra || ''}
                  onChange={(e) => set(id, 'extra', e.target.value)} />
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!g.enabled}
                  onChange={(e) => set(id, 'enabled', e.target.checked)} />
                Enabled
              </label>
            </div>
          );
        })}
      </div>

      <button onClick={save} className="btn-primary mt-4 w-full">
        Save payment configuration
      </button>
    </Layout>
  );
}
