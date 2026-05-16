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
    const data = await kundliService.getProkeralaKundli(k);
    setChart((c) => ({ ...c, [k.id]: data || 'err' }));
  }

  async function refresh() {
    setList(await kundliService.getKundliProfiles(user.uid));
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
                  Generating kundli…
                </div>
              )}
              {chart[k.id] === 'err' && (
                <div className="mt-2 text-sm text-danger">
                  Kundli service not available yet. (Admin: set Prokerala
                  keys on the relay.)
                </div>
              )}
              {chart[k.id] && typeof chart[k.id] === 'object' && (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-card
                                bg-bg-light p-3 text-sm">
                  <div><span className="text-sub-text">Zodiac:</span>{' '}
                    <b>{chart[k.id].zodiac || '—'}</b></div>
                  <div><span className="text-sub-text">Nakshatra:</span>{' '}
                    <b>{chart[k.id].nakshatra || '—'}</b></div>
                  <div><span className="text-sub-text">Moon sign:</span>{' '}
                    <b>{chart[k.id].chandra_rasi || '—'}</b></div>
                  <div><span className="text-sub-text">Sun sign:</span>{' '}
                    <b>{chart[k.id].soorya_rasi || '—'}</b></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
