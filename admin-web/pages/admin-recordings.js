import { useEffect, useState } from 'react';
import { recordService, liveService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

function fmt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function dur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export default function AdminRecordings() {
  const { loading } = useRequireAdmin();
  const [recs, setRecs] = useState([]);
  const [hist, setHist] = useState([]);
  const [tab, setTab] = useState('rec');         // rec | hist
  const [type, setType] = useState('');          // '' | call | video | live

  useEffect(() => {
    if (loading) return undefined;
    const u1 = recordService.listenRecordings(setRecs);
    const u2 = liveService.listenLiveHistory(null, setHist);
    return () => { u1 && u1(); u2 && u2(); };
  }, [loading]);

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const shown = recs.filter((r) => !type || r.type === type);

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Recordings &amp; Live</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every call, video and live session is recorded for monitoring.
        Play the audio or video below.
      </p>

      <div className="mb-3 flex gap-2">
        {[['rec', 'Recordings'], ['hist', 'Live history']].map(
          ([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-card px-4 py-2 text-sm ${tab === k
                ? 'bg-primary text-white' : 'bg-white'}`}>{l}</button>
          ))}
      </div>

      {tab === 'rec' && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {['', 'call', 'video', 'live'].map((t) => (
              <button key={t || 'all'} onClick={() => setType(t)}
                className={`rounded-card px-4 py-2 text-sm capitalize ${
                  type === t ? 'bg-primary text-white' : 'bg-white'}`}>
                {t || 'All'}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="card text-sub-text">No recordings yet.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {shown.map((r) => (
                <div key={r.id} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-bg-light px-2
                      py-0.5 text-xs font-semibold capitalize">
                      {r.type} - {r.kind}
                    </span>
                    <span className="text-xs text-sub-text">
                      {fmt(r.ts)}
                    </span>
                  </div>
                  <div className="text-xs text-sub-text">
                    Astro {String(r.astroId || '').slice(0, 10)}
                    {r.userId
                      ? ` - Client ${String(r.userId).slice(0, 10)}` : ''}
                    {r.sizeKB ? ` - ${r.sizeKB} KB` : ''}
                  </div>
                  {r.kind === 'video' ? (
                    <video src={r.url} controls
                      className="w-full rounded-card bg-black" />
                  ) : (
                    <audio src={r.url} controls className="w-full" />
                  )}
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="block text-xs font-semibold text-primary">
                    Open / download
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'hist' && (
        hist.length === 0 ? (
          <div className="card text-sub-text">No live sessions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-sub-text">
                <tr>
                  <th className="p-2">Astrologer</th>
                  <th className="p-2">Started</th>
                  <th className="p-2">Duration</th>
                  <th className="p-2">Viewers</th>
                  <th className="p-2">Likes</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="p-2">
                      <div className="font-semibold">{h.name}</div>
                      <div className="text-[11px] text-sub-text">
                        {String(h.astroUid || '').slice(0, 10)}
                      </div>
                    </td>
                    <td className="p-2">{fmt(h.startedAtMs || h.ts)}</td>
                    <td className="p-2">{dur(h.durationSec)}</td>
                    <td className="p-2">{h.viewers || 0}</td>
                    <td className="p-2">{h.likes || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Layout>
  );
}
