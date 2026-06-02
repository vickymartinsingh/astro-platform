import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  recordService, liveService, adminService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Recordings & Live history.
//
// One row per recording, sortable + searchable. Every call / video /
// live archive shows the astrologer NAME (not the uid), the customer
// NAME, the 8-digit session id, duration, date+time, and an inline
// player. Search box filters across astrologer name, customer name,
// session id and uids. This is the page support uses for any
// compliance request, so the IDs are the FIRST visible cell.
function fmtDt(ms) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${rem}s`;
  return `${s}s`;
}

export default function AdminRecordings() {
  const { loading } = useRequireAdmin();
  const [recs, setRecs] = useState([]);
  const [hist, setHist] = useState([]);
  const [users, setUsers] = useState([]);
  const [astros, setAstros] = useState([]);
  const [tab, setTab] = useState('rec');         // rec | hist
  const [type, setType] = useState('');          // '' | call | video | live
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('ts');    // ts | dur | size
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (loading) return undefined;
    const u1 = recordService.listenRecordings(setRecs);
    const u2 = liveService.listenLiveHistory(null, setHist);
    adminService.getAllUsers().then((list) =>
      setUsers(list || [])).catch(() => setUsers([]));
    astrologerService.getAstrologers().then((list) =>
      setAstros(list || [])).catch(() => setAstros([]));
    return () => { u1 && u1(); u2 && u2(); };
  }, [loading]);

  // Lookup maps: uid -> name. Built once when users + astros load.
  // Falls back to the uid prefix if no name is found.
  const astroMap = useMemo(() => {
    const m = new Map();
    astros.forEach((a) => m.set(a.id || a.uid,
      a.name || (a.email && a.email.split('@')[0]) || ''));
    return m;
  }, [astros]);
  const userMap = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.uid || u.id,
      u.name || (u.email && u.email.split('@')[0]) || ''));
    return m;
  }, [users]);

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  // Hydrate each recording with the resolved names + a typed search hay.
  const rows = recs.map((r) => {
    const astroName = astroMap.get(r.astroId) || '';
    const userName = userMap.get(r.userId) || '';
    return { ...r, astroName, userName };
  });

  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => !type || r.type === type)
    .filter((r) => !ql || [
      r.sessionId, r.astroId, r.userId, r.astroName, r.userName,
    ].filter(Boolean).some((v) =>
      String(v).toLowerCase().includes(ql)))
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const get = (x) => sortBy === 'dur' ? (x.durationSec || 0)
        : sortBy === 'size' ? (x.sizeKB || 0)
        : (x.ts || 0);
      return (get(a) - get(b)) * dir;
    });

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }
  const sortMark = (col) => sortBy === col
    ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Recordings &amp; Live</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every call, video and live session is recorded for monitoring.
        Search by astrologer name, customer name or 8-digit session ID
        and play the audio inline.
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
          <div className="card mb-3 space-y-3">
            <input className="input w-full" value={q}
              placeholder="Search by astrologer name, customer name or
                8-digit session ID"
              onChange={(e) => setQ(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              {['', 'call', 'video', 'live'].map((t) => (
                <button key={t || 'all'} onClick={() => setType(t)}
                  className={`rounded-full px-3 py-1 text-xs
                    font-semibold capitalize ${
                    type === t
                      ? 'bg-primary text-white'
                      : 'bg-bg-light text-sub-text'}`}>
                  {t || 'All types'}
                </button>
              ))}
              <span className="ml-auto text-xs text-sub-text">
                {shown.length} of {rows.length}
              </span>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="card text-sub-text">
              No recordings match your filter.
            </div>
          ) : (
            <div className="surface overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase
                  tracking-wider text-sub-text">
                  <tr>
                    <th className="p-3">Session ID</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Astrologer</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3 cursor-pointer"
                      onClick={() => toggleSort('ts')}>
                      Date{sortMark('ts')}
                    </th>
                    <th className="p-3 cursor-pointer"
                      onClick={() => toggleSort('dur')}>
                      Duration{sortMark('dur')}
                    </th>
                    <th className="p-3 cursor-pointer"
                      onClick={() => toggleSort('size')}>
                      Size{sortMark('size')}
                    </th>
                    <th className="p-3">Play</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}
                      className="border-t border-gray-200 align-top">
                      <td className="p-3 font-mono text-xs font-bold">
                        {r.sessionId || '–'}
                      </td>
                      <td className="p-3">
                        <span className="rounded-full bg-bg-light
                          px-2 py-0.5 text-[11px] font-semibold
                          capitalize">
                          {r.type} · {r.kind || 'audio'}
                        </span>
                      </td>
                      <td className="p-3">
                        {r.astroId ? (
                          <Link
                            href={`/admin-astro-profile/${r.astroId}`}
                            className="font-semibold text-primary
                              hover:underline">
                            {r.astroName || '(unnamed)'}
                          </Link>
                        ) : '–'}
                        <div className="text-[10px] text-sub-text">
                          {String(r.astroId || '').slice(0, 12)}
                        </div>
                      </td>
                      <td className="p-3">
                        {r.userId ? (
                          <Link
                            href={`/admin-user-profile/${r.userId}`}
                            className="font-semibold text-primary
                              hover:underline">
                            {r.userName || '(unnamed)'}
                          </Link>
                        ) : '–'}
                        <div className="text-[10px] text-sub-text">
                          {String(r.userId || '').slice(0, 12)}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        {fmtDt(r.ts)}
                      </td>
                      <td className="p-3 text-xs">
                        {fmtDur(r.durationSec)}
                      </td>
                      <td className="p-3 text-xs">
                        {r.sizeKB ? `${r.sizeKB} KB` : '–'}
                      </td>
                      <td className="p-3">
                        <div className="space-y-1">
                          {r.kind === 'video' ? (
                            <video src={r.url} controls
                              className="h-20 w-40 rounded bg-black" />
                          ) : (
                            <audio src={r.url} controls
                              className="w-56" />
                          )}
                          <a href={r.url} target="_blank"
                            rel="noreferrer"
                            className="block text-[10px] font-semibold
                              text-primary">
                            Download
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'hist' && (
        hist.length === 0 ? (
          <div className="card text-sub-text">No live sessions yet.</div>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase
                tracking-wider text-sub-text">
                <tr>
                  <th className="p-3">Astrologer</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Viewers</th>
                  <th className="p-3">Likes</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.id} className="border-t border-gray-200">
                    <td className="p-3">
                      <div className="font-semibold">{h.name}</div>
                      <div className="text-[11px] text-sub-text">
                        {String(h.astroUid || '').slice(0, 10)}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5
                        text-[11px] font-semibold ${
                        h.status === 'cancelled'
                          ? 'bg-danger/15 text-danger'
                          : 'bg-success/15 text-success'}`}>
                        {h.status === 'cancelled' ? 'Cancelled' : 'Ended'}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {fmtDt(h.startedAtMs || h.ts)}
                    </td>
                    <td className="p-3 text-xs">
                      {fmtDur(h.durationSec)}
                    </td>
                    <td className="p-3">{h.viewers || 0}</td>
                    <td className="p-3">{h.likes || 0}</td>
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
