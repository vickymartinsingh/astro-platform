import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  hoursService, liveService, sessionService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const RANGES = [['day', 'Today'], ['week', 'This week'],
  ['month', 'This month'], ['custom', 'Custom']];
const SVCS = [['chat', 'Chat'], ['call', 'Call'], ['video', 'Video']];

function fmt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function fmtT(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
}
function dur(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export default function AstroActivity() {
  const { user, loading } = useRequireAstrologer();
  const router = useRouter();
  const q = router.query;
  const [range, setRange] = useState('day');
  const [cfrom, setCfrom] = useState('');
  const [cto, setCto] = useState('');
  const [logs, setLogs] = useState(null);
  const [hist, setHist] = useState([]);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    if (!q) return;
    if (q.range) setRange(String(q.range));
    if (q.from) setCfrom(String(q.from));
    if (q.to) setCto(String(q.to));
  }, [q.range, q.from, q.to]); // eslint-disable-line

  useEffect(() => {
    if (!user) return undefined;
    hoursService.getAvailLogs(user.uid).then(setLogs).catch(() => {});
    sessionService.getAstrologerSessions(user.uid)
      .then(setSessions).catch(() => {});
    const u = liveService.listenLiveHistory(user.uid, setHist);
    return () => { if (u) u(); };
  }, [user]);

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const startToday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  };
  const rb = range === 'custom'
    ? {
      from: cfrom ? new Date(`${cfrom}T00:00:00`).getTime() : startToday(),
      to: cto ? new Date(`${cto}T23:59:59`).getTime() : Date.now(),
    }
    : hoursService.rangeBounds(range);

  const oh = logs ? hoursService.computeHours(logs, rb.from, rb.to) : null;
  const liveMs = hoursService.liveMs(hist, rb.from, rb.to);

  // Reconstruct online segments from the availability points.
  const pts = (logs || [])
    .filter((l) => typeof l.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
  const segs = [];
  for (let i = 0; i < pts.length; i += 1) {
    const cur = pts[i];
    const nextTs = i + 1 < pts.length ? pts[i + 1].ts : Date.now();
    const s = Math.max(cur.ts, rb.from);
    const e = Math.min(nextTs, rb.to);
    if (e <= s) continue;
    const on = SVCS.filter(([k]) => cur[k]).map(([, l]) => l);
    if (on.length === 0) continue; // online segments only
    segs.push({ s, e, on });
  }
  segs.reverse();

  const liveInRange = hist
    .filter((h) => (h.ts || 0) >= rb.from && (h.ts || 0) <= rb.to)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const sInRange = sessions
    .filter((x) => {
      const t = x.createdAt?.toDate
        ? x.createdAt.toDate().getTime() : 0;
      return t >= rb.from && t <= rb.to;
    })
    .sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return tb - ta;
    });

  const Card = ({ label, value }) => (
    <div className="surface p-4 text-center">
      <div className="text-xs uppercase tracking-wide text-sub-text">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );

  return (
    <Layout>
      <button onClick={() => router.push('/astro-dashboard')}
        className="mb-2 text-sm font-semibold text-primary">
        &lt; Dashboard
      </button>
      <h1 className="mb-1 text-xl font-bold">Activity report</h1>
      <p className="mb-3 text-sm text-sub-text">
        View only. Your online time, live sessions and consultations
        for the selected period.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {RANGES.map(([k, lbl]) => (
          <button key={k} onClick={() => setRange(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold
              ${range === k ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text'}`}>
            {lbl}
          </button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-sub-text">
            From
            <input type="date" value={cfrom}
              onChange={(e) => setCfrom(e.target.value)}
              className="input mt-1 !min-h-0 py-1.5" />
          </label>
          <label className="text-xs text-sub-text">
            To
            <input type="date" value={cto}
              onChange={(e) => setCto(e.target.value)}
              className="input mt-1 !min-h-0 py-1.5" />
          </label>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Chat online"
          value={oh ? hoursService.fmtHrs(oh.onlineMs.chat) : '-'} />
        <Card label="Call online"
          value={oh ? hoursService.fmtHrs(oh.onlineMs.call) : '-'} />
        <Card label="Video online"
          value={oh ? hoursService.fmtHrs(oh.onlineMs.video) : '-'} />
        <Card label="Live online"
          value={hoursService.fmtHrs(liveMs)} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase
        tracking-wide text-sub-text">Online activity</h2>
      {segs.length === 0 ? (
        <div className="surface p-4 text-sm text-sub-text">
          No online time in this period.
        </div>
      ) : (
        <div className="space-y-2">
          {segs.map((g) => (
            <div key={`${g.s}-${g.e}`}
              className="surface flex items-center justify-between
                gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  {fmt(g.s)} to {fmtT(g.e)}
                </div>
                <div className="text-xs text-sub-text">
                  {g.on.join(', ')}
                </div>
              </div>
              <span className="shrink-0 font-semibold text-success">
                {dur(g.e - g.s)}
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase
        tracking-wide text-sub-text">Live sessions</h2>
      {liveInRange.length === 0 ? (
        <div className="surface p-4 text-sm text-sub-text">
          No live sessions in this period.
        </div>
      ) : (
        <div className="space-y-2">
          {liveInRange.map((h) => {
            const cancelled = h.status === 'cancelled';
            return (
              <div key={h.id} className="surface p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {h.title || 'Live consultation'}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5
                    text-[11px] font-semibold ${cancelled
                      ? 'bg-danger/15 text-danger'
                      : 'bg-success/15 text-success'}`}>
                    {cancelled ? 'Cancelled' : 'Ended'}
                  </span>
                </div>
                <div className="mt-1 text-xs text-sub-text">
                  {cancelled
                    ? `Was scheduled for ${fmt(h.startedAtMs)}`
                    : `Started ${fmt(h.startedAtMs)} - Ended `
                      + `${fmt(h.endedAtMs)} - ${dur(
                        (h.durationSec || 0) * 1000)}`}
                  {!cancelled && ` - ${h.viewers || 0} viewers`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase
        tracking-wide text-sub-text">Consultations</h2>
      {sInRange.length === 0 ? (
        <div className="surface p-4 text-sm text-sub-text">
          No consultations in this period.
        </div>
      ) : (
        <div className="space-y-2">
          {sInRange.map((s) => (
            <div key={s.id}
              className="surface flex items-center justify-between
                gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium capitalize">
                  {s.type} - <span className="text-sub-text">
                    {s.status}</span>
                </div>
                <div className="text-xs text-sub-text">
                  {s.createdAt?.toDate
                    ? s.createdAt.toDate().toLocaleString() : ''}
                </div>
              </div>
              <span className="shrink-0 font-semibold">
                ₹{Number(s.astrologerEarning || 0).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
