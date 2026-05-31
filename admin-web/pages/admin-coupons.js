import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const BLANK = {
  code: '', title: '', description: '',
  discountPercent: 10, maxDiscount: 100,
  minAmount: 10, expiry: '',
  usageLimit: 100, active: true,
  firstRechargeOnly: false,
};

export default function AdminCoupons() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function load() { setRows(await adminService.getAllCoupons()); }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function save() {
    if (!f.code.trim()) return;
    setBusy(true);
    try {
      await adminService.saveCoupon(null, {
        ...f,
        code: f.code.trim().toUpperCase(),
        discountPercent: Number(f.discountPercent) || 0,
        maxDiscount: Number(f.maxDiscount) || 0,
        minAmount: Number(f.minAmount) || 0,
        usageLimit: Number(f.usageLimit) || 0,
      });
      setF(BLANK);
      await load();
    } finally { setBusy(false); }
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
      <h1 className="mb-1 text-xl font-bold">Coupons &amp; Bonuses</h1>
      <p className="mb-3 text-xs text-sub-text">
        Every active coupon shows up automatically in the customer&apos;s
        wallet page under &quot;Available offers&quot;. They can browse + tap
        to apply, OR paste a code from outside. Bonus credits hit the
        wallet only on a SUCCESSFUL recharge.
      </p>

      {/* Create form */}
      <div className="card mb-4 space-y-2">
        <div className="font-semibold">Create a new coupon</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <label className="text-xs">
            Code
            <input className="input mt-1"
              placeholder="FIRSTRECHARGE"
              value={f.code}
              onChange={(e) =>
                setF({ ...f, code: e.target.value.toUpperCase() })} />
          </label>
          <label className="text-xs">
            Cashback %
            <input className="input mt-1" type="number"
              placeholder="100"
              value={f.discountPercent}
              onChange={(e) =>
                setF({ ...f, discountPercent: e.target.value })} />
          </label>
          <label className="text-xs">
            Max cashback ₹
            <input className="input mt-1" type="number"
              placeholder="1000"
              value={f.maxDiscount}
              onChange={(e) =>
                setF({ ...f, maxDiscount: e.target.value })} />
          </label>
          <label className="text-xs">
            Min recharge ₹
            <input className="input mt-1" type="number"
              placeholder="10"
              value={f.minAmount}
              onChange={(e) =>
                setF({ ...f, minAmount: e.target.value })} />
          </label>
          <label className="text-xs">
            Global usage cap (0 = unlimited)
            <input className="input mt-1" type="number"
              placeholder="0"
              value={f.usageLimit}
              onChange={(e) =>
                setF({ ...f, usageLimit: e.target.value })} />
          </label>
          <label className="text-xs">
            Expires on
            <input className="input mt-1" type="date"
              value={f.expiry}
              onChange={(e) => setF({ ...f, expiry: e.target.value })} />
          </label>
        </div>
        <label className="block text-xs">
          Display title (shown to the customer)
          <input className="input mt-1"
            placeholder="First recharge cashback - 100% up to ₹1000"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <label className="block text-xs">
          Description / fine print
          <textarea className="input mt-1" rows={2}
            placeholder="Get 100% extra in your wallet, capped at ₹1000,
            on your very first recharge. One-time per customer."
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox"
            checked={f.firstRechargeOnly}
            onChange={(e) =>
              setF({ ...f, firstRechargeOnly: e.target.checked })} />
          <span><b>First-recharge only</b> -
            valid once per customer, only when they have never
            successfully recharged before.</span>
        </label>
        <button onClick={save} disabled={busy}
          className="btn-primary mt-2 w-full">
          {busy ? 'Saving...' : 'Create coupon'}
        </button>
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
        text-sub-text">All coupons</h2>
      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="card space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-base font-bold
                  text-dark-text">{c.code}</span>
                {c.firstRechargeOnly && (
                  <span className="ml-2 rounded-full bg-amber-100
                    px-2 py-0.5 text-[10px] font-bold uppercase
                    tracking-wide text-amber-800">
                    First recharge
                  </span>
                )}
              </div>
              <button onClick={() => toggle(c)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs
                  font-bold ${c.active
                    ? 'bg-success/15 text-success'
                    : 'bg-danger/15 text-danger'}`}>
                {c.active ? 'Active' : 'Inactive'}
              </button>
            </div>
            {c.title && (
              <div className="text-sm font-semibold text-dark-text">
                {c.title}
              </div>
            )}
            {c.description && (
              <div className="text-xs text-sub-text">{c.description}</div>
            )}
            <div className="text-[11px] text-sub-text">
              {c.discountPercent || 0}% cashback ·
              max ₹{c.maxDiscount || 0} ·
              min ₹{c.minAmount || 0} ·
              used {c.usedCount || 0}{c.usageLimit
                ? `/${c.usageLimit}` : ''}
              {c.expiry ? ` · expires ${c.expiry}` : ''}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="card text-sub-text">No coupons yet.</div>
        )}
      </div>
    </Layout>
  );
}
