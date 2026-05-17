import { useEffect, useState } from 'react';
import { remedyService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const CATS = ['General', 'Gemstone', 'Rudraksha', 'Yantra', 'Puja',
  'Mantra', 'Donation', 'Spiritual item'];

export default function AdminRemedies() {
  const { loading } = useRequireAdmin();
  const [items, setItems] = useState([]);
  const [f, setF] = useState({
    name: '', category: 'General', description: '', basePrice: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function refresh() {
    setItems(await remedyService.getCatalog());
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  async function add() {
    if (!f.name.trim()) { setMsg('Enter a remedy name.'); return; }
    setBusy(true); setMsg('');
    try {
      await remedyService.addCatalogItem(f);
      setF({ name: '', category: 'General', description: '',
        basePrice: 0 });
      setMsg('Remedy added to the catalog.');
      refresh();
    } catch (e) {
      setMsg('Failed: ' + (e?.message || 'error'));
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this remedy from the catalog?')) return;
    await remedyService.deleteCatalogItem(id);
    refresh();
  }

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Remedies Catalog</h1>
      <p className="mb-3 text-sm text-sub-text">
        Only admin manages this master catalog. Astrologers can also add
        their own remedies and set their own price from their app.
      </p>

      <div className="card space-y-3">
        <input className="input" placeholder="Remedy name"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input" type="number" min={0}
            placeholder="Base price (Rs)" value={f.basePrice}
            onChange={(e) => setF({
              ...f, basePrice: Number(e.target.value) })} />
        </div>
        <textarea className="input" rows={2} placeholder="Description"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })} />
        {msg && <div className="text-sm text-success">{msg}</div>}
        <button onClick={add} disabled={busy}
          className="btn-primary w-full">
          {busy ? 'Saving...' : 'Add to catalog'}
        </button>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">
        Catalog ({items.length})
      </h2>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="card text-sub-text">No remedies yet.</div>
        ) : items.map((r) => (
          <div key={r.id} className="card flex items-start
                                     justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-sub-text">
                {r.category} {r.basePrice ? `- Rs ${r.basePrice}` : ''}
              </div>
              {r.description && (
                <div className="mt-1 text-sm text-sub-text">
                  {r.description}
                </div>
              )}
            </div>
            <button onClick={() => remove(r.id)}
              className="shrink-0 rounded-full border border-danger px-3
                         py-1.5 text-sm text-danger">Delete</button>
          </div>
        ))}
      </div>
    </Layout>
  );
}
