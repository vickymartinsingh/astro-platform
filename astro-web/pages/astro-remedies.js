import { useEffect, useState } from 'react';
import { remedyService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

// Astrologers add their OWN remedies and set their OWN price. They can
// also see the admin master catalog for reference.
export default function AstroRemedies() {
  const { user, loading } = useRequireAstrologer();
  const [mine, setMine] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [f, setF] = useState({ name: '', description: '', price: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function refresh() {
    if (!user) return;
    setMine(await remedyService.getAstrologerRemedies(user.uid));
    setCatalog(await remedyService.getCatalog());
  }
  useEffect(() => { if (user) refresh(); }, [user]);

  async function add() {
    if (!f.name.trim()) { setMsg('Enter a remedy name.'); return; }
    setBusy(true); setMsg('');
    try {
      await remedyService.addAstrologerRemedy(user.uid, f);
      setF({ name: '', description: '', price: 0 });
      setMsg('Your remedy was added.');
      refresh();
    } catch (e) {
      setMsg('Failed: ' + (e?.message || 'error'));
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this remedy?')) return;
    await remedyService.deleteAstrologerRemedy(user.uid, id);
    refresh();
  }

  async function copyFromCatalog(c) {
    setF({ name: c.name, description: c.description || '',
      price: c.basePrice || 0 });
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">My Remedies</h1>
      <p className="mb-3 text-sm text-sub-text">
        Add remedies you suggest to clients and set your own price. You
        can recommend any of these inside a chat consultation.
      </p>

      <div className="card space-y-3">
        <input className="input" placeholder="Remedy name"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })} />
        <textarea className="input" rows={2} placeholder="How it helps"
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input className="input" type="number" min={0}
          placeholder="Your price (Rs)" value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) })} />
        {msg && <div className="text-sm text-primary">{msg}</div>}
        <button onClick={add} disabled={busy}
          className="btn-primary w-full">
          {busy ? 'Saving...' : 'Add my remedy'}
        </button>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-bold">
        My remedies ({mine.length})
      </h2>
      <div className="space-y-2">
        {mine.length === 0 ? (
          <div className="card text-sub-text">
            You have not added any remedies yet.
          </div>
        ) : mine.map((r) => (
          <div key={r.id} className="card flex items-start
                                     justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs font-semibold text-primary">
                Rs {r.price}
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

      {catalog.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-bold">
            Admin catalog (reference)
          </h2>
          <div className="space-y-2">
            {catalog.map((c) => (
              <div key={c.id} className="card flex items-center
                                         justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-sub-text">
                    {c.category}
                    {c.basePrice ? ` - Rs ${c.basePrice}` : ''}
                  </div>
                </div>
                <button onClick={() => copyFromCatalog(c)}
                  className="shrink-0 rounded-full border border-primary
                    px-3 py-1.5 text-sm text-primary">Use</button>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}
