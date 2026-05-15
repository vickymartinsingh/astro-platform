import { useState } from 'react';
import { kundliService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

// Kundli viewer, look up a client's saved kundli by their user id
// (shown automatically inside an active session; this is a manual lookup).
export default function AstroKundli() {
  const { loading } = useRequireAstrologer();
  const [uid, setUid] = useState('');
  const [list, setList] = useState(null);

  async function lookup() {
    setList(await kundliService.getKundliProfiles(uid.trim()));
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Kundli Viewer</h1>
      <div className="card mb-3 flex gap-2">
        <input className="input flex-1" placeholder="Client user ID"
          value={uid} onChange={(e) => setUid(e.target.value)} />
        <button onClick={lookup} className="btn-primary">Lookup</button>
      </div>
      {list != null && (list.length === 0 ? (
        <div className="card text-sub-text">No kundli profiles found.</div>
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div key={k.id} className="card">
              <div className="font-semibold">{k.name} · {k.zodiac}</div>
              <div className="text-sm text-sub-text">
                {k.dob} · {k.tob} {k.ampm} · {k.place}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Layout>
  );
}
