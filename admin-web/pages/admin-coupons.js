import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const BLANK = {
  code: '', discountPercent: 10, maxDiscount: 100,
  expiry: '', usageLimit: 100, active: true,
};

export default function AdminCoupons() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(BLANK);

  async function load() { setRows(await adminService.getAllCoupons()); }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function save() {
    await adminService.saveCoupon(null, f);
    setF(BLANK);
    load();
  }
  async function toggle(c) {
    await adminService.saveCoupon(c.id, { ...c, active: !c.active });
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Coupon & Bonus System</h1>
      <div className="card mb-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        <input className="input" placeholder="CODE" value={f.code}
          onChange={(e) =>
            setF({ ...f, code: e.target.value.toUpperCase() })} />
        <input className="input" type="number" placeholder="Discount %"
          value={f.discountPercent}
          onChange={(e) =>
            setF({ ...f, discountPercent: e.target.value })} />
        <input className="input" type="number" placeholder="Max ₹"
          value={f.maxDiscount}
          onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
        <input className="input" type="date" value={f.expiry}
          onChange={(e) => setF({ ...f, expiry: e.target.value })} />
        <input className="input" type="number" placeholder="Usage limit"
          value={f.usageLimit}
          onChange={(e) => setF({ ...f, usageLimit: e.target.value })} />
        <button onClick={save} className="btn-primary">Create</button>
      </div>
      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="card flex justify-between">
            <div>
              <span className="font-bold">{c.code}</span>{' '}
              <span className="text-sub-text">
                {c.discountPercent}% · max ₹{c.maxDiscount} ·
                used {c.usedCount || 0}/{c.usageLimit}
              </span>
            </div>
            <button onClick={() => toggle(c)}
              className={c.active ? 'text-success' : 'text-danger'}>
              {c.active ? 'Active' : 'Inactive'}
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="card text-sub-text">No coupons yet.</div>
        )}
      </div>
    </Layout>
  );
}
