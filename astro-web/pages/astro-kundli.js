import { useEffect, useMemo, useState } from 'react';
import {
  kundliService, sessionService, userService,
} from '@astro/shared';
import Layout from '../components/Layout';
import FullKundli from '../components/FullKundli';
import { useRequireAstrologer } from '../lib/useAuth';

// Kundli viewer. Pick a client from a dropdown (your past / current
// clients) - no need to know their ID. If you have an active session
// its client is preselected automatically.
export default function AstroKundli() {
  const { user, loading } = useRequireAstrologer();
  const [clients, setClients] = useState([]);
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState({}); // { [id]: data|'loading'|'err' }

  async function viewFull(k) {
    setFull((c) => ({ ...c, [k.id]: 'loading' }));
    const data = await kundliService.getFullKundli(k);
    setFull((c) => ({ ...c, [k.id]: data || 'err' }));
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const ss = await sessionService.getAstrologerSessions(user.uid)
        .catch(() => []);
      const seen = new Map();
      let activeUid = '';
      for (const s of ss) {
        if (!s.userId) continue;
        if (['accepted', 'active'].includes(s.status) && !activeUid) {
          activeUid = s.userId;
        }
        if (!seen.has(s.userId)) seen.set(s.userId, null);
      }
      // Parallel fan-out for all client lookups (was serial N+1 — a
      // 30-client list took ~3s on a slow connection). With Promise.all
      // it's one round-trip wide instead of N round-trips deep.
      const arr = await Promise.all(
        Array.from(seen.keys()).map(async (uid) => {
          const u = await userService.getUser(uid).catch(() => null);
          return {
            uid,
            name: (u && u.name) || 'Client',
            code: (u && u.userCode) || '',
          };
        }),
      );
      setClients(arr);
      if (activeUid) { setSel(activeUid); }
    })();
  }, [user]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) =>
      c.name.toLowerCase().includes(s)
      || String(c.code).includes(s) || c.uid.toLowerCase().includes(s));
  }, [q, clients]);

  async function lookup(uid) {
    const id = (uid || sel || '').trim();
    if (!id) return;
    setBusy(true);
    setList(await kundliService.getKundliProfiles(id).catch(() => []));
    setBusy(false);
  }
  useEffect(() => { if (sel) lookup(sel); /* auto on select */ },
    [sel]); // eslint-disable-line

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Kundli Viewer</h1>
      <div className="card mb-3 space-y-2">
        <input className="input" placeholder="Search your clients"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={sel}
          onChange={(e) => setSel(e.target.value)}>
          <option value="">Select a client</option>
          {filtered.map((c) => (
            <option key={c.uid} value={c.uid}>
              {c.name}{c.code ? ` (${c.code})` : ''}
            </option>
          ))}
        </select>
        {clients.length === 0 && (
          <p className="text-xs text-sub-text">
            No clients yet. Clients appear here after a consultation.
          </p>
        )}
      </div>
      {busy && <div className="card text-sub-text">Loading kundli...</div>}
      {!busy && list != null && (list.length === 0 ? (
        <div className="card text-sub-text">No kundli profiles found.</div>
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div key={k.id} className="card">
              <div className="font-semibold">{k.name} - {k.zodiac}</div>
              <div className="text-sm text-sub-text">
                {k.dob} - {k.tob} {k.ampm} - {k.place}
              </div>
              <button onClick={() => viewFull(k)}
                className="mt-2 text-sm font-semibold text-primary">
                View full Kundli
              </button>
              {full[k.id] === 'loading' && (
                <div className="mt-2 text-sm text-sub-text">
                  Generating kundli...
                </div>
              )}
              {full[k.id] === 'err' && (
                <div className="mt-2 text-sm text-danger">
                  Kundli service not available yet.
                </div>
              )}
              {full[k.id] && typeof full[k.id] === 'object' && (
                <FullKundli r={full[k.id]} kundli={k} />
              )}
            </div>
          ))}
        </div>
      ))}
    </Layout>
  );
}
