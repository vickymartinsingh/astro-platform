import { useEffect, useState } from 'react';
import Link from 'next/link';
import { astrologerService, sessionService, userService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;

export default function AstroDashboard() {
  const { user, profile, loading } = useRequireAstrologer();
  const [astro, setAstro] = useState(undefined);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    if (!user) return;
    const unsub = astrologerService.listenAstrologer(user.uid, (a) =>
      setAstro(a || null));
    sessionService.getAstrologerSessions(user.uid).then(setSessions);
    return () => unsub && unsub();
  }, [user]);

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

      <div className={`rounded-card p-6 text-white ${statusStyle}`}>
        <div className="text-sm opacity-80">Status</div>
        <div className="text-3xl font-bold uppercase">{status}</div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Today" value={`₹${sum(since(DAY)).toFixed(0)}`} />
        <Stat label="This Week" value={`₹${sum(since(7 * DAY)).toFixed(0)}`} />
        <Stat label="Lifetime" value={`₹${Number(astro.earnings || 0)}`} />
        <Stat label="Sessions Today" value={since(DAY).length} />
        <Stat label="Rating" value={`⭐ ${astro.rating || 0}`} />
        <Stat label="Response Rate" value={`${astro.responseRate || 0}%`} />
        <Stat label="Total Sessions" value={astro.totalSessions || 0} />
        <Stat label="Reviews" value={astro.reviewsCount || 0} />
      </div>

      <h2 className="mt-6 mb-2 font-bold">Recent Requests</h2>
      <div className="space-y-2">
        {sessions.slice(0, 5).map((s) => (
          <div key={s.id} className="card flex justify-between text-sm">
            <span className="capitalize">{s.type} · {s.status}</span>
            <span className="text-sub-text">
              {s.createdAt?.toDate
                ? s.createdAt.toDate().toLocaleString() : ''}
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="card text-sub-text">No requests yet.</div>
        )}
      </div>
    </Layout>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card text-center">
      <div className="text-xs text-sub-text">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
