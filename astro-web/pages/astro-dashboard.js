import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, sessionService, userService, pushService,
  hoursService, liveService, assistantService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;
const SVCS = [['chat', 'Chat'], ['call', 'Voice Call'],
  ['video', 'Video Call']];
const ONLINE_SVCS = [['chat', 'Chat'], ['call', 'Call'],
  ['video', 'Video'], ['live', 'Live']];
const RANGES = [['day', 'Today'], ['week', 'This week'],
  ['month', 'This month'], ['custom', 'Custom']];

export default function AstroDashboard() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  const [astro, setAstro] = useState(undefined);
  const [sessions, setSessions] = useState([]);
  const [cur, setCur] = useState([]);     // current/active sessions
  const [names, setNames] = useState({}); // uid -> name
  const [busy, setBusy] = useState(false);
  const [availLogs, setAvailLogs] = useState(null);
  const [liveHist, setLiveHist] = useState([]);
  const [hrange, setHrange] = useState('day');
  const [cfrom, setCfrom] = useState('');
  const [cto, setCto] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false); // admin-enabled

  // Is the AI assistant feature switched on for THIS astrologer by admin?
  useEffect(() => {
    if (!user) return undefined;
    return assistantService.watchAiConfig((cfg) =>
      setAiAvailable(assistantService.aiAvailableForAstro(cfg, user.uid)));
  }, [user && user.uid]);

  async function toggleAi() {
    if (!astro) return;
    const next = !astro.aiAssistant;
    setBusy(true);
    try {
      await astrologerService.updateAstrologer(user.uid,
        { aiAssistant: next });
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!user) return;
    const unsub = astrologerService.listenAstrologer(user.uid, (a) =>
      setAstro(a || null));
    const u2 = sessionService.listenActiveForAstro(user.uid, (list) => {
      setCur(list);
      list.forEach((s) => {
        if (s.userId && !names[s.userId]) {
          userService.getUser(s.userId).then((u) => {
            if (u) setNames((m) => ({ ...m, [s.userId]: u.name
              || 'Customer' }));
          }).catch(() => {});
        }
      });
    });
    // Collect any post-commission earnings from sessions the client
    // already ended (works even after disconnect), then load history.
    sessionService.collectAstrologerEarnings(user.uid)
      .catch(() => {})
      .finally(() => sessionService.getAstrologerSessions(user.uid)
        .then(setSessions));
    return () => { if (unsub) unsub(); if (u2) u2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    hoursService.getAvailLogs(user.uid).then(setAvailLogs).catch(() => {});
    const u = liveService.listenLiveHistory(user.uid, setLiveHist);
    return () => { if (u) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, astro]);

  async function toggleSvc(key) {
    if (!astro) return;
    const cur3 = {
      chat: !!astro.chat_enabled, call: !!astro.call_enabled,
      video: !!astro.video_enabled,
    };
    const turningOn = !cur3[key];
    const label = (SVCS.find(([k]) => k === key) || [])[1] || key;
    if (!window.confirm(turningOn
      ? `Go ONLINE for ${label}?` : `Go OFFLINE for ${label}?`)) return;
    const next = { ...cur3, [key]: turningOn };
    const anyOn = next.chat || next.call || next.video;
    setBusy(true);
    try {
      await astrologerService.updateAvailability(user.uid, {
        chat_enabled: next.chat,
        call_enabled: next.call,
        video_enabled: next.video,
        status: anyOn ? 'online' : 'offline',
      });
    } finally { setBusy(false); }
  }

  async function joinSession(s) {
    pushService.sendPushToUser({
      toUid: s.userId,
      title: 'Astrologer joined',
      body: 'Your astrologer joined the session. Tap to continue.',
      data: { type: 'session',
        route: s.type === 'chat'
          ? `/chat/${s.astroId}` : `/call/${s.astroId}` },
    });
    router.push(`/astro-session/${s.id}`);
  }

  if (loading || astro === undefined) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  if (astro === null) {
    return (
      <Layout>
        <div className="card">
          <h1 className="mb-2 text-xl font-bold">Welcome!</h1>
          <p className="mb-3 text-sub-text">
            Set up your astrologer profile to start receiving consultations.
          </p>
          <Link href="/astro-profile" className="btn-primary">
            Complete Profile
          </Link>
        </div>
      </Layout>
    );
  }

  const now = Date.now();
  const ended = sessions.filter((s) => s.status === 'ended');
  const since = (ms) => ended.filter((s) =>
    s.createdAt?.toDate && now - s.createdAt.toDate().getTime() <= ms);
  const sum = (arr) => arr.reduce((a, s) =>
    a + Number(s.astrologerEarning || 0), 0);

  // Call/chat response stats from real session records.
  const cnt = (st) => sessions.filter((s) => s.status === st).length;
  const answered = sessions.filter((s) =>
    ['ended', 'accepted', 'active'].includes(s.status)).length;
  const missed = cnt('missed');
  const rejected = cnt('rejected');
  const cancelled = cnt('cancelled');
  const respBase = answered + missed + rejected;
  const respRate = respBase
    ? Math.round((answered / respBase) * 100) : 100;

  // Online-hours dashboard (Today / Week / Month / Custom).
  const startToday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  };
  const rb = hrange === 'custom'
    ? {
      from: cfrom ? new Date(`${cfrom}T00:00:00`).getTime() : startToday(),
      to: cto ? new Date(`${cto}T23:59:59`).getTime() : Date.now(),
    }
    : hoursService.rangeBounds(hrange);
  const oh = availLogs
    ? hoursService.computeHours(availLogs, rb.from, rb.to) : null;
  const ohLiveMs = hoursService.liveMs(liveHist, rb.from, rb.to);
  const ohVal = (k) => {
    if (k === 'live') return hoursService.fmtHrs(ohLiveMs);
    return oh ? hoursService.fmtHrs(oh.onlineMs[k]) : '-';
  };
  const actHref = (svc) => `/astro-activity?range=${hrange}`
    + `${cfrom ? `&from=${cfrom}` : ''}${cto ? `&to=${cto}` : ''}`
    + `${svc ? `&svc=${svc}` : ''}`;

  const status = astro.status || 'offline';
  const statusStyle = { online: 'bg-success', busy: 'bg-warning',
    offline: 'bg-danger' }[status] || 'bg-danger';

  return (
    <Layout>
      {!astro.approved && (
        <div className="card mb-3 bg-accent-blue">
          Your profile is <b>under review</b>. You can go online once an
          admin approves your account.
        </div>
      )}

      <div className={`rounded-2xl p-6 text-white shadow-sm ${statusStyle}`}>
        <div className="text-sm opacity-80">Your status</div>
        <div className="text-3xl font-bold uppercase tracking-wide">
          {status}
        </div>
        <div className="mt-1 text-sm opacity-90">
          {status === 'online'
            ? 'You are visible to clients and can receive requests.'
            : status === 'busy'
              ? 'You are in a session. New requests are paused.'
              : 'Turn on a service below to receive consultations.'}
        </div>
      </div>

      {/* Per-service availability. Going Live requires all OFF. */}
      <div className="card mt-4">
        <div className="mb-2 font-semibold">Availability</div>
        <p className="mb-2 text-xs text-sub-text">
          Turn on the services you want right now. Turn ALL off (go
          offline) before you start a Live session.
        </p>
        <div className="space-y-2">
          {SVCS.map(([k, label]) => {
            const on = !!astro[`${k}_enabled`];
            const dis = busy || !astro.approved;
            return (
              <div key={k} className="flex items-center justify-between
                rounded-card border border-gray-200 p-3">
                <span className="font-medium">
                  {label}
                  <span className={`ml-2 text-xs font-semibold ${on
                    ? 'text-success' : 'text-sub-text'}`}>
                    {on ? 'Online' : 'Offline'}
                  </span>
                </span>
                <button type="button" role="switch" aria-checked={on}
                  aria-label={`${label} availability`}
                  onClick={() => !dis && toggleSvc(k)}
                  disabled={dis}
                  className={`relative h-7 w-12 shrink-0 rounded-full
                    transition-colors ${on ? 'bg-success'
                      : 'bg-gray-300'} ${dis ? 'opacity-50' : ''}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full
                    bg-white shadow transition-all ${on
                      ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>

        {/* AI Assistant: only shown once the admin enables it for this
            astrologer. When ON, incoming chats are auto-picked and answered
            for the astrologer (chat only, never calls). */}
        {aiAvailable && (
          <div className="mt-3 flex items-center justify-between rounded-card
            border border-primary/30 bg-primary/5 p-3">
            <span className="font-medium">
              AI Assistant (auto-answer chats)
              <span className={`ml-2 text-xs font-semibold ${
                astro.aiAssistant ? 'text-success' : 'text-sub-text'}`}>
                {astro.aiAssistant ? 'On' : 'Off'}
              </span>
              <span className="mt-0.5 block text-[11px] text-sub-text">
                Once you enable this option, AI will reply to client chats on
                your behalf. It auto picks incoming chats and answers them
                for you. Works for chat only, not calls.
              </span>
            </span>
            <button type="button" role="switch"
              aria-checked={!!astro.aiAssistant}
              aria-label="AI assistant"
              onClick={() => !busy && toggleAi()}
              disabled={busy}
              className={`relative h-7 w-12 shrink-0 rounded-full
                transition-colors ${astro.aiAssistant ? 'bg-primary'
                  : 'bg-gray-300'} ${busy ? 'opacity-50' : ''}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full
                bg-white shadow transition-all ${astro.aiAssistant
                  ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
        )}
      </div>

      {/* Online-hours dashboard. Cards open the Activity report. */}
      <div className="card mt-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Online hours</div>
          <Link href={actHref('')}
            className="text-xs font-semibold text-primary">
            View report
          </Link>
        </div>
        <div className="mb-3 mt-2 flex flex-wrap gap-2">
          {RANGES.map(([k, lbl]) => (
            <button key={k} onClick={() => setHrange(k)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold
                ${hrange === k ? 'bg-primary text-white'
                  : 'bg-bg-light text-sub-text'}`}>
              {lbl}
            </button>
          ))}
        </div>
        {hrange === 'custom' && (
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
          {ONLINE_SVCS.map(([k, label]) => (
            <Stat key={k} label={`${label} online`}
              value={ohVal(k)} href={actHref(k)} />
          ))}
        </div>
      </div>

      {/* Current session - never miss a call/chat. */}
      <div className="card mt-4">
        <div className="mb-2 font-semibold">
          Current session{cur.length ? ` (${cur.length})` : ''}
        </div>
        {cur.length === 0 ? (
          <div className="text-sm text-sub-text">
            No incoming or active sessions right now.
          </div>
        ) : (
          <div className="space-y-2">
            {cur.map((s) => (
              <div key={s.id} className="flex items-center
                justify-between rounded-card border border-gray-200 p-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {names[s.userId] || 'Customer'}
                  </div>
                  <div className="text-xs text-sub-text capitalize">
                    {s.type} - {s.status}
                  </div>
                </div>
                <button onClick={() => joinSession(s)}
                  className="rounded-full bg-primary px-4 py-1.5 text-sm
                    font-semibold text-white">Join</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Today" value={`₹${sum(since(DAY)).toFixed(0)}`}
          href="/astro-earnings" />
        <Stat label="This Week"
          value={`₹${sum(since(7 * DAY)).toFixed(0)}`}
          href="/astro-earnings" />
        <Stat label="Lifetime" value={`₹${Number(astro.earnings || 0)}`}
          href="/astro-earnings" />
        <Stat label="Sessions Today" value={since(DAY).length}
          href="/astro-activity?tab=sessions&range=day" />
        <Stat label="Rating"
          value={<span className="text-gold">★ {astro.rating || 0}</span>}
          href="/astro-reviews" />
        <Stat label="Response Rate" value={`${respRate}%`}
          href="/astro-activity?tab=sessions" />
        <Stat label="Total Sessions" value={astro.totalSessions || 0}
          href="/astro-activity?tab=sessions" />
        <Stat label="Reviews" value={astro.reviewsCount || 0}
          href="/astro-reviews" />
      </div>

      {/* Real response stats: answered vs missed/rejected/cancelled. */}
      <div className="card mt-4">
        <div className="mb-1 font-semibold">Call response</div>
        <p className="mb-3 text-xs text-sub-text">
          How you responded to incoming requests. Response rate counts
          answered out of answered + missed + rejected.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Answered" value={answered}
            href="/astro-activity?tab=sessions" />
          <Stat label="Missed" value={missed}
            href="/astro-activity?tab=sessions" />
          <Stat label="Rejected" value={rejected}
            href="/astro-activity?tab=sessions" />
          <Stat label="Cancelled" value={cancelled}
            href="/astro-activity?tab=sessions" />
        </div>
      </div>

      <h2 className="mb-2 mt-8 text-lg font-bold">Recent requests</h2>
      <div className="space-y-2">
        {sessions.slice(0, 6).map((s) => (
          <div key={s.id}
            className="surface flex items-center justify-between p-3
                       text-sm">
            <span className="capitalize font-medium">
              {s.type} · <span className="text-sub-text">{s.status}</span>
            </span>
            <span className="text-xs text-sub-text">
              {s.createdAt?.toDate
                ? s.createdAt.toDate().toLocaleString() : ''}
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="surface p-4 text-sub-text">No requests yet.</div>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value, href }) {
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-sub-text">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href}
        className="surface block p-4 text-center transition
          hover:shadow-md active:scale-[.98]">
        {inner}
      </Link>
    );
  }
  return <div className="surface p-4 text-center">{inner}</div>;
}
