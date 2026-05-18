import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, hoursService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
const fH = (ms) => (ms / 3600000).toFixed(2);

export default function AdminHours() {
  const { loading } = useRequireAdmin();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const fromMs = new Date(`${from}T00:00:00`).getTime();
      const toMs = new Date(`${to}T23:59:59`).getTime();
      const snap = await getDocs(collection(db, 'astrologers'));
      const astros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const out = [];
      for (let i = 0; i < astros.length; i += 1) {
        const a = astros[i];
        // eslint-disable-next-line no-await-in-loop
        const logs = await hoursService.getAvailLogs(a.id);
        const h = hoursService.computeHours(logs, fromMs, toMs);
        out.push({
          id: a.id, name: a.name || a.id.slice(0, 8),
          on: h.onlineMs, off: h.offlineMs,
        });
      }
      out.sort((x, y) =>
        (y.on.chat + y.on.call + y.on.video)
        - (x.on.chat + x.on.call + x.on.video));
      setRows(out);
    } finally { setBusy(false); }
  }

  useEffect(() => { if (!loading) run(); }, [loading]); // eslint-disable-line

  function exportCsv() {
    const head = 'astrologer,uid,chat_online_h,chat_offline_h,'
      + 'call_online_h,call_offline_h,video_online_h,video_offline_h\n';
    const body = (rows || []).map((r) =>
      `"${r.name}",${r.id},${fH(r.on.chat)},${fH(r.off.chat)},`
      + `${fH(r.on.call)},${fH(r.off.call)},`
      + `${fH(r.on.video)},${fH(r.off.video)}`).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `astrologer-hours_${from}_to_${to}.csv`;
    a.click();
  }

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Astrologer Hours</h1>
      <div className="card mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          From
          <input type="date" value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input mt-1" />
        </label>
        <label className="text-sm">
          To
          <input type="date" value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input mt-1" />
        </label>
        <button onClick={run} disabled={busy}
          className="btn-primary !min-h-0 px-5 py-2">
          {busy ? 'Loading…' : 'Generate report'}
        </button>
        <button onClick={exportCsv} disabled={!rows || !rows.length}
          className="btn-ghost">Download CSV</button>
      </div>

      {rows == null ? (
        <div className="card">Pick a date range and generate.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">Astrologer</th>
                <th className="p-2">Chat on/off</th>
                <th className="p-2">Call on/off</th>
                <th className="p-2">Video on/off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-[11px] text-sub-text">
                      {r.id.slice(0, 10)}
                    </div>
                  </td>
                  <td className="p-2">
                    <span className="text-success">
                      {hoursService.fmtHrs(r.on.chat)}
                    </span> / {hoursService.fmtHrs(r.off.chat)}
                  </td>
                  <td className="p-2">
                    <span className="text-success">
                      {hoursService.fmtHrs(r.on.call)}
                    </span> / {hoursService.fmtHrs(r.off.call)}
                  </td>
                  <td className="p-2">
                    <span className="text-success">
                      {hoursService.fmtHrs(r.on.video)}
                    </span> / {hoursService.fmtHrs(r.off.video)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
