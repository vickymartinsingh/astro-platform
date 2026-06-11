import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  astrologerService, sessionService, reviewService, userService, db,
} from '@astro/shared';
import { doc, setDoc } from 'firebase/firestore';
import Layout from '../../components/Layout';
import ResetAccountPanel from '../../components/ResetAccountPanel';
import ComplianceActivity from '../../components/ComplianceActivity';
import ActivityHistory from '../../components/ActivityHistory';
import UserRecordingsPanel from '../../components/UserRecordingsPanel';
import { useRequireAdmin } from '../../lib/useAuth';

const { sessionRefNo } = sessionService;
const TYPE_ICON = { chat: '💬', call: '📞', video: '📹' };

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDate(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '-';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function fmtDur(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return '0m';
  const m = Math.floor(s / 60); const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m${r ? ` ${r}s` : ''}` : `${r}s`;
}

export default function AdminAstroProfile() {
  const router = useRouter();
  const { id } = router.query;
  const { loading } = useRequireAdmin();
  const [astro, setAstro] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [clientNames, setClientNames] = useState({});
  const [aiChatEnabled, setAiChatEnabled] = useState(false);
  const [aiChatSaving, setAiChatSaving] = useState(false);

  useEffect(() => {
    if (loading || !id) return;
    (async () => {
      try {
        const a = await astrologerService.getAstrologer(id);
        setAstro(a);
        setAiChatEnabled(!!a?.aiChatEnabled);
      } catch (_) { setAstro(null); }
      try {
        const list = await sessionService.getAstrologerSessions(id);
        setSessions(list || []);
        const ids = [...new Set((list || []).map((s) => s.userId)
          .filter(Boolean))].slice(0, 30);
        const pairs = await Promise.all(ids.map(async (u) => {
          try {
            const x = await userService.getUser(u);
            return [u, (x && (x.name || x.email)) || 'Customer'];
          } catch (_) { return [u, 'Customer']; }
        }));
        setClientNames(Object.fromEntries(pairs));
      } catch (_) { /* ignore */ }
      try { setReviews(await reviewService.getReviews(id) || []); }
      catch (_) { /* ignore */ }
    })();
  }, [loading, id]);

  async function toggleAiChat() {
    const next = !aiChatEnabled;
    setAiChatEnabled(next);
    setAiChatSaving(true);
    try {
      await setDoc(doc(db, 'users', id),
        { aiChatEnabled: next }, { merge: true });
    } catch (_) { setAiChatEnabled(!next); }
    setAiChatSaving(false);
  }

  if (loading || !astro) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const ended = sessions.filter((s) => s.status === 'ended');
  const totalGross = ended.reduce((a, s) => a + Number(s.cost || 0), 0);
  const totalEarned = ended.reduce(
    (a, s) => a + Number(s.astrologerEarning || 0), 0);
  const totalMinutes = ended.reduce(
    (a, s) => a + Math.round(Number(s.duration || 0) / 60), 0);

  return (
    <Layout>
      <button onClick={() => router.back()}
        className="mb-3 text-sm font-semibold text-primary">
        ← Back
      </button>

      {/* HEADER */}
      <div className="surface flex flex-wrap items-start gap-4 p-4">
        {astro.profileImage ? (
          <img src={astro.profileImage} alt={astro.name}
            className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center
            rounded-full bg-primary/15 text-3xl font-bold text-primary">
            {(astro.name || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{astro.name || '-'}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px]
              font-bold capitalize ${
              astro.status === 'online' ? 'bg-emerald-100 text-emerald-700'
              : astro.status === 'busy' ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600'}`}>
              {astro.status || 'offline'}
            </span>
            {astro.approved && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5
                text-[10px] font-bold text-blue-700">approved</span>
            )}
          </div>
          <div className="mt-1 text-sm text-sub-text">
            {astro.email || '-'}{astro.phone ? ` · ${astro.phone}` : ''}
          </div>
          <div className="mt-1 text-xs text-sub-text">
            Joined: <b>{fmtDate(astro.createdAt)}</b>
            {astro.userCode ? ` · Code ${astro.userCode}` : ''}
            {' · ID '}
            <span className="font-mono">{id}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center
            sm:grid-cols-5">
            <Stat label="Rating"
              value={`${Number(astro.rating || 0).toFixed(1)} ★`} />
            <Stat label="Reviews" value={astro.reviewsCount || 0} />
            <Stat label="Sessions" value={ended.length} />
            <Stat label="Minutes" value={totalMinutes} />
            <Stat label="Earned" value={`₹${totalEarned}`} />
          </div>
        </div>
      </div>

      {/* CALL RECORDINGS for this astrologer (audio + video). */}
      <UserRecordingsPanel uid={id} kind="astrologer" />

      {/* AI CHAT ASSISTANT TOGGLE */}
      <div className="surface mt-4 p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide"
          style={{ color: '#7F2020' }}>
          AI Chat Assistant
        </h2>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: '#7F2020' }}>
              AI Chat Enabled
            </div>
            <div className="mt-0.5 text-xs text-sub-text">
              When enabled, AI handles chats when astrologer is offline
            </div>
          </div>
          <button onClick={toggleAiChat} disabled={aiChatSaving}
            aria-label="Toggle AI Chat"
            className={`relative h-6 w-11 shrink-0 rounded-full transition
              ${aiChatSaving ? 'opacity-50' : ''}
              ${aiChatEnabled ? '' : 'bg-gray-300'}`}
            style={aiChatEnabled ? { background: '#D4A12A' } : {}}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white
              shadow transition-all
              ${aiChatEnabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
        <div className="mt-2 text-xs"
          style={{ color: aiChatEnabled ? '#D4A12A' : '#888' }}>
          {aiChatEnabled ? 'AI assistant is active for this astrologer'
            : 'AI assistant is disabled for this astrologer'}
        </div>
      </div>

      {/* PROFESSIONAL */}
      <div className="surface mt-4 p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">Professional</h2>
        <Row k="Category" v={astro.category || '-'} />
        <Row k="Skills"
          v={(astro.skills || []).join(', ') || '-'} />
        <Row k="Languages"
          v={(astro.languages || []).join(', ') || '-'} />
        <Row k="Experience"
          v={astro.experience ? `${astro.experience} yrs` : '-'} />
        <Row k="Rate"
          v={`Chat ₹${astro.chatRate || 0}/min · Call ₹${
            astro.callRate || 0}/min · Video ₹${
            astro.videoRate || 0}/min`} />
        {astro.about && (
          <div className="mt-2 rounded-card bg-bg-light p-3 text-sm">
            {astro.about}
          </div>
        )}
      </div>

      {/* SESSION HISTORY */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent sessions ({sessions.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Dur</th>
                <th className="p-2">Cost</th>
                <th className="p-2">Earned</th>
                <th className="p-2">Status</th>
                <th className="p-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 30).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">
                    {fmt(s.startTime || s.createdAt)}
                  </td>
                  <td className="p-2">
                    {TYPE_ICON[s.type] || '✨'} {s.type}
                  </td>
                  <td className="p-2">
                    {clientNames[s.userId] || '-'}
                  </td>
                  <td className="p-2">{fmtDur(s.duration)}</td>
                  <td className="p-2">₹{s.cost || 0}</td>
                  <td className="p-2 text-emerald-700">
                    ₹{s.astrologerEarning || 0}
                  </td>
                  <td className="p-2 capitalize">
                    {s.status}
                    {s.refundRequest && s.refundRequest.status
                      === 'processed' && (
                      <span className="ml-1 rounded-full bg-emerald-100
                        px-1.5 py-0.5 text-[9px] font-bold
                        text-emerald-700">refunded</span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    #{sessionRefNo(s)}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={8} className="p-3 text-center
                  text-sub-text">No sessions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REVIEWS */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent reviews ({reviews.length})
        </h2>
        <div className="space-y-2">
          {reviews.slice(0, 20).map((r) => (
            <div key={r.id} className="rounded-card bg-bg-light p-3">
              <div className="flex justify-between text-xs text-sub-text">
                <span>{r.userName || 'Customer'}</span>
                <span>{fmt(r.createdAt)}</span>
              </div>
              <div className="text-amber-600">
                {'★'.repeat(Number(r.rating || 0))}
                <span className="text-gray-300">
                  {'★'.repeat(5 - Number(r.rating || 0))}
                </span>
              </div>
              {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
              {r.astrologerReply && (
                <p className="mt-1 rounded bg-white p-2 text-xs
                  text-sub-text">
                  <b>Astrologer:</b> {r.astrologerReply}
                </p>
              )}
            </div>
          ))}
          {reviews.length === 0 && (
            <div className="p-3 text-center text-sub-text">
              No reviews yet.
            </div>
          )}
        </div>
      </div>

      {/* COMPLIANCE: admin-only device + IP + activity log */}
      <ComplianceActivity uid={id} profile={astro} />

      {/* Activity history with date filter + PDF export. */}
      <ActivityHistory uid={id} user={astro} />

      {/* DANGER ZONE: reset astrologer account */}
      <ResetAccountPanel uid={id} role="astrologer"
        name={astro.name || astro.email}
        onDone={() => router.reload()} />
    </Layout>
  );
}

const Stat = ({ label, value }) => (
  <div className="rounded-card bg-bg-light p-2">
    <div className="text-xs text-sub-text">{label}</div>
    <div className="text-sm font-bold">{value}</div>
  </div>
);
const Row = ({ k, v }) => (
  <div className="flex flex-wrap gap-1 py-0.5 text-sm">
    <span className="w-32 shrink-0 text-sub-text">{k}</span>
    <span className="flex-1 font-semibold">{v}</span>
  </div>
);
