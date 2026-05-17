import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

export default function AdminGifts() {
  const { loading } = useRequireAdmin();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState(null);
  const [cards, setCards] = useState([]);

  async function refresh() {
    try { setCards(await adminService.listGiftCards()); }
    catch (_) { setCards([]); }
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  async function create() {
    setBusy(true); setMsg(''); setLast(null);
    try {
      const r = await adminService.createGiftCard(amount);
      setLast(r);
      setMsg(`Gift card for Rs ${r.amount} created.`);
      flash(`Gift card ${r.code} created`);
      refresh();
    } catch (e) {
      setMsg('Failed: ' + (e?.message || 'error'));
    } finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Gift Cards</h1>
      <div className="card space-y-3">
        <label className="text-sm font-semibold">Amount (Rs)</label>
        <input className="input" type="number" min={1} value={amount}
          onChange={(e) => setAmount(Number(e.target.value))} />
        <button onClick={create} disabled={busy || !(amount > 0)}
          className="btn-primary w-full">
          {busy ? 'Generating...' : 'Generate gift card'}
        </button>
        {msg && (
          <div className="rounded-card bg-success/10 p-3 text-success">
            {msg}
          </div>
        )}
        {last && (
          <div className="rounded-card border-2 border-dashed
                          border-primary p-4 text-center">
            <div className="text-xs text-sub-text">Share this code</div>
            <div className="mt-1 text-2xl font-bold tracking-widest">
              {last.code}
            </div>
            <div className="mt-1 text-sm">Worth Rs {last.amount}</div>
          </div>
        )}
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">Recent gift cards</h2>
      <div className="space-y-2">
        {cards.length === 0 ? (
          <div className="card text-sub-text">No gift cards yet.</div>
        ) : cards.map((c) => (
          <div key={c.code} className="card flex items-center
                                       justify-between">
            <div>
              <div className="font-bold tracking-widest">{c.code}</div>
              <div className="text-xs text-sub-text">Rs {c.amount}</div>
            </div>
            <span className={`badge ${c.redeemed
              ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
              {c.redeemed ? 'Used' : 'Active'}
            </span>
          </div>
        ))}
      </div>
    </Layout>
  );
}
