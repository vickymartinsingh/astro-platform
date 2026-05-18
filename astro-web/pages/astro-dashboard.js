import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, sessionService, userService, pushService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;
const SVCS = [['chat', 'Chat'], ['call', 'Voice Call'],
  ['video', 'Video Call']];

export default function AstroDashboard() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  const [astro, setAstro] = useState(undefined);
  const [sessions, setSessions] = useState([]);
  const [cur, setCur] = useState([]);     // current/active sessions
  const [names, setNames] = useState({}); // uid -> name
  const [busy, setBusy] = useState(false);

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
            return (
              <div key={k} className="flex items-center justify-between
                rounded-card border border-gray-200 p-3">
                <span className="font-medium">{label}</span>
                <button onClick={() => toggleSvc(k)} disabled={busy
                  || !astro.approved}
                  className={`rounded-full px-4 py-1.5 text-sm
                    font-semibold ${on
                      ? 'bg-success text-white'
                      : 'border border-gray-300 text-sub-text'}`}>
                  {on ? 'Online' : 'Offline'}
                </button>
              </div>
            );
          })}
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
        <Stat label="Today" value={`₹${sum(since(DAY)).toFixed(0)}`} />
        <Stat label="This Week" value={`₹${sum(since(7 * DAY)).toFixed(0)}`} />
        <Stat label="Lifetime" value={`₹${Number(astro.earnings || 0)}`} />
        <Stat label="Sessions Today" value={since(DAY).length} />
        <Stat label="Rating"
          value={<span className="text-gold">★ {astro.rating || 0}</span>} />
        <Stat label="Response Rate" value={`${astro.responseRate || 0}%`} />
        <Stat label="Total Sessions" value={astro.totalSessions || 0} />
        <Stat label="Reviews" value={astro.reviewsCount || 0} />
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

function Stat({ label, value }) {
  return (
    <div className="surface p-4 text-center">
      <div className="text-xs uppercase tracking-wide text-sub-text">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
