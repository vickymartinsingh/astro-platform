import { useEffect, useState } from 'react';
import { kundliService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { DateField, TimeField, CityField } from '../components/BirthInputs';

const EMPTY = { name: '', dob: '', tob: '', ampm: 'AM', place: '', isDefault: false };

export default function Kundli() {
  const { user, profile, loading } = useRequireClient();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [toolUrl, setToolUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState({});   // { [kundliId]: data|'loading'|'err' }

  async function viewFull(k) {
    setChart((c) => ({ ...c, [k.id]: 'loading' }));
    const data = await kundliService.getFullKundli(k);
    setChart((c) => ({ ...c, [k.id]: data || 'err' }));
  }

  async function refresh() {
    const l = await kundliService.getKundliProfiles(user.uid);
    setList(l);
    // By default, show the saved full report of the default profile
    // (cached - no API call unless dob / time / place changed).
    const def = l.find((k) => k.isDefault) || l[0];
    if (def) {
      setChart((c) => (c[def.id] ? c : { ...c, [def.id]: 'loading' }));
      const data = await kundliService.getFullKundli(def);
      setChart((c) => ({ ...c, [def.id]: data || 'err' }));
    }
  }

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, name: profile?.name || '' }));
    refresh();
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setToolUrl(s.exists() ? (s.data().kundliToolUrl || '') : ''));
    // eslint-disable-next-line
  }, [user, profile]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await kundliService.saveKundli(user.uid, form);
      setForm({ ...EMPTY, name: profile?.name || '' });
      await refresh();
    } finally { setBusy(false); }
  }

  async function makeDefault(id) {
    await kundliService.setDefaultKundli(user.uid, id);
    refresh();
  }
  async function remove(id) {
    await kundliService.deleteKundli(id);
    refresh();
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Kundli Profiles</h1>

      <form onSubmit={save} className="card mb-4 space-y-3">
        <input className="input" placeholder="Name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateField value={form.dob}
            onChange={(dob) => setForm({ ...form, dob })} />
          <TimeField value={form.tob} ampm={form.ampm}
            onChange={(tob, ampm) => setForm({ ...form, tob, ampm })} />
          <div className="sm:col-span-2">
            <CityField value={form.place}
              onChange={(place) => setForm({ ...form, place })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDefault}
            onChange={(e) =>
              setForm({ ...form, isDefault: e.target.checked })} />
          Set as default profile (auto-shared at session start)
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save Kundli'}
        </button>
      </form>

      {toolUrl && (
        <a href={toolUrl} target="_blank" rel="noreferrer"
          className="btn-ghost mb-4 inline-block">
          Open Kundli Chart Tool ↗
        </a>
      )}

      {list == null ? (
        <SkeletonList count={2} />
      ) : list.length === 0 ? (
        <div className="card text-sub-text">No profiles saved yet.</div>
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div key={k.id} className="card">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {k.name}{' '}
                  {k.isDefault && (
                    <span className="badge bg-bg-light text-primary">
                      Default
                    </span>
                  )}
                </div>
                <span className="text-gold text-sm">{k.zodiac}</span>
              </div>
              <div className="mt-1 text-sm text-sub-text">
                {k.dob} · {k.tob} {k.ampm} · {k.place}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <button onClick={() => viewFull(k)}
                  className="font-semibold text-primary">
                  View full Kundli
                </button>
                {!k.isDefault && (
                  <button onClick={() => makeDefault(k.id)}
                    className="text-primary font-semibold">
                    Make default
                  </button>
                )}
                <button onClick={() => remove(k.id)} className="text-danger">
                  Delete
                </button>
              </div>
              {chart[k.id] === 'loading' && (
                <div className="mt-2 text-sm text-sub-text">
                  Generating kundli...
                </div>
              )}
              {chart[k.id] === 'err' && (
                <div className="mt-2 text-sm text-danger">
                  Kundli service not available yet. (Admin: set Prokerala
                  keys on the relay.)
                </div>
              )}
              {chart[k.id] && typeof chart[k.id] === 'object' && (
                <FullKundli r={chart[k.id]} />
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

function FullKundli({ r }) {
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  return (
    <div className="mt-3 rounded-card bg-bg-light p-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">Full Kundli</div>
        <span className="text-[11px] text-sub-text">
          {r.cached ? 'Saved report' : 'Newly generated'}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><span className="text-sub-text">Zodiac</span><br />
          <b>{r.zodiac || '-'}</b></div>
        <div><span className="text-sub-text">Nakshatra</span><br />
          <b>{r.nakshatra || '-'}</b></div>
        <div><span className="text-sub-text">Moon sign</span><br />
          <b>{r.chandra_rasi || '-'}</b></div>
        <div><span className="text-sub-text">Sun sign</span><br />
          <b>{r.soorya_rasi || '-'}</b></div>
      </div>

      {n.personality && <Sec title="Personality">{n.personality}</Sec>}
      {n.career && <Sec title="Career">{n.career}</Sec>}
      {n.health && <Sec title="Health">{n.health}</Sec>}
      {n.love && <Sec title="Love & Relationships">{n.love}</Sec>}
      {n.life && <Sec title="Life Path">{n.life}</Sec>}

      <Sec title="Lucky">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <div>Deity: <b>{lucky.deity}</b></div>
          <div>Colour: <b>{lucky.color}</b></div>
          <div>Stone: <b>{lucky.stone}</b></div>
          <div>Direction: <b>{lucky.direction}</b></div>
          <div>Syllables: <b>{lucky.syllables}</b></div>
        </div>
      </Sec>

      {Array.isArray(r.planets) && r.planets.length > 0 && (
        <Sec title="Planets">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-sub-text">
                <tr><th className="py-1 pr-3">Planet</th>
                  <th className="py-1 pr-3">Sign</th>
                  <th className="py-1 pr-3">House</th>
                  <th className="py-1">Retro</th></tr>
              </thead>
              <tbody>
                {r.planets.map((p) => (
                  <tr key={p.name} className="border-t border-white">
                    <td className="py-1 pr-3 font-semibold">{p.name}</td>
                    <td className="py-1 pr-3">{p.sign || '-'}</td>
                    <td className="py-1 pr-3">{p.house ?? '-'}</td>
                    <td className="py-1">{p.retrograde ? 'R' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>
      )}

      {Array.isArray(r.dasha) && r.dasha.length > 0 && (
        <Sec title="Dasha periods">
          <div className="space-y-0.5">
            {r.dasha.map((d, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="font-semibold">{d.planet}</span>
                <span className="text-sub-text">
                  {String(d.start || '').slice(0, 10)} to{' '}
                  {String(d.end || '').slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </Sec>
      )}
    </div>
  );
}
