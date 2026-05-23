import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  userService, sessionService, astrologerService, kundliService, db,
} from '@astro/shared';
import {
  collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';
import Layout from '../../components/Layout';
import ResetAccountPanel from '../../components/ResetAccountPanel';
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

export default function AdminUserProfile() {
  const router = useRouter();
  const { id } = router.query;
  const { loading } = useRequireAdmin();
  const [u, setU] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [txns, setTxns] = useState([]);
  const [astroNames, setAstroNames] = useState({});
  const [kundlis, setKundlis] = useState([]);
  const [reports, setReports] = useState({}); // { [kundliId]: data|'loading'|'err' }

  useEffect(() => {
    if (loading || !id) return;
    (async () => {
      try { setU(await userService.getUser(id)); }
      catch (_) { setU(null); }
      try {
        const list = await sessionService.getUserSessions(id);
        setSessions(list || []);
        const ids = [...new Set((list || []).map((s) => s.astroId)
          .filter(Boolean))].slice(0, 30);
        const pairs = await Promise.all(ids.map(async (a) => {
          try {
            const x = await astrologerService.getAstrologer(a);
            return [a, (x && (x.name || x.displayName)) || 'Astrologer'];
          } catch (_) { return [a, 'Astrologer']; }
        }));
        setAstroNames(Object.fromEntries(pairs));
      } catch (_) { /* ignore */ }
      try {
        const snap = await getDocs(query(
          collection(db, 'transactions'),
          where('userId', '==', id), orderBy('createdAt', 'desc'),
          limit(30)));
        setTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (_) { /* ignore (index may be missing - non-fatal) */ }
      try {
        setKundlis(await kundliService.getKundliProfiles(id) || []);
      } catch (_) { /* ignore */ }
    })();
  }, [loading, id]);

  async function viewReport(k) {
    setReports((c) => ({ ...c, [k.id]: 'loading' }));
    try {
      const data = await kundliService.getFullKundli(k);
      setReports((c) => ({ ...c, [k.id]: data || 'err' }));
    } catch (_) { setReports((c) => ({ ...c, [k.id]: 'err' })); }
  }
  async function downloadReport(k) {
    let data = reports[k.id];
    if (!data || typeof data !== 'object') {
      data = await kundliService.getFullKundli(k).catch(() => null);
      if (data) setReports((c) => ({ ...c, [k.id]: data }));
    }
    kundliService.downloadKundliReport(k, data || {});
  }

  if (loading || !u) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const ended = sessions.filter((s) => s.status === 'ended');
  const totalSpent = ended.reduce((a, s) => a + Number(s.cost || 0), 0);
  const totalMinutes = ended.reduce(
    (a, s) => a + Math.round(Number(s.duration || 0) / 60), 0);
  const refunded = sessions.filter((s) => s.refundRequest
    && s.refundRequest.status === 'processed');
  const totalRefunded = refunded.reduce(
    (a, s) => a + Number(s.refundedAmount || 0), 0);

  return (
    <Layout>
      <button onClick={() => router.back()}
        className="mb-3 text-sm font-semibold text-primary">
        ← Back
      </button>

      {/* HEADER */}
      <div className="surface flex flex-wrap items-start gap-4 p-4">
        {u.profileImage ? (
          <img src={u.profileImage} alt={u.name}
            className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center
            rounded-full bg-primary/15 text-3xl font-bold text-primary">
            {(u.name || u.email || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{u.name || 'Customer'}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px]
              font-bold capitalize ${
              u.status === 'blocked' ? 'bg-red-100 text-red-700'
              : 'bg-emerald-100 text-emerald-700'}`}>
              {u.status || 'active'}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5
              text-[10px] font-bold uppercase text-gray-700">
              {u.role || 'client'}
            </span>
          </div>
          <div className="mt-1 text-sm text-sub-text">
            {u.email || '-'}{u.phone ? ` · ${u.phone}` : ''}
          </div>
          <div className="mt-1 text-xs text-sub-text">
            Joined: <b>{fmtDate(u.createdAt)}</b>
            {u.userCode ? ` · Code ${u.userCode}` : ''}
            {' · ID '}<span className="font-mono">{id}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center
            sm:grid-cols-4">
            <Stat label="Wallet" value={`₹${u.wallet || 0}`} />
            <Stat label="Sessions" value={ended.length} />
            <Stat label="Minutes" value={totalMinutes} />
            <Stat label="Spent" value={`₹${totalSpent}`} />
          </div>
          {refunded.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              ⚠ {refunded.length} refund(s) processed · total ₹
              {totalRefunded}
            </p>
          )}
        </div>
      </div>

      {/* PROFILE / KUNDLI */}
      <div className="surface mt-4 p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">Profile</h2>
        <Row k="Gender" v={u.gender || '-'} />
        <Row k="DOB" v={u.dob || '-'} />
        <Row k="Birth time" v={u.tob || u.timeOfBirth || '-'} />
        <Row k="Birth place" v={u.placeOfBirth || u.place || '-'} />
        <Row k="Language" v={u.language || '-'} />
        <Row k="Referral" v={u.referralCode || u.referredBy || '-'} />
        <Row k="Last seen" v={fmt(u.lastSeen || u.updatedAt)} />
      </div>

      {/* KUNDLI PROFILES */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Kundli profiles ({kundlis.length})
        </h2>
        {kundlis.length === 0 ? (
          <div className="text-sm text-sub-text">
            No saved kundli for this customer.
          </div>
        ) : (
          <div className="space-y-2">
            {kundlis.map((k) => (
              <div key={k.id} className="rounded-card border
                border-gray-200 p-2">
                <div className="flex flex-wrap items-center
                  justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">
                      {k.name || 'Native'}
                      {k.isDefault && (
                        <span className="ml-1 rounded-full bg-bg-light
                          px-1.5 py-0.5 text-[10px] font-bold
                          text-primary">Default</span>
                      )}
                    </div>
                    <div className="text-xs text-sub-text">
                      {k.dob} · {k.tob} {k.ampm} · {k.place}
                      {k.zodiac ? ` · ${k.zodiac}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => viewReport(k)}
                      className="rounded-full bg-bg-light px-3 py-1.5
                        text-xs font-bold text-primary">
                      View
                    </button>
                    <button onClick={() => downloadReport(k)}
                      className="rounded-full bg-primary px-3 py-1.5
                        text-xs font-bold text-white">
                      ⬇ PDF
                    </button>
                  </div>
                </div>
                {reports[k.id] === 'loading' && (
                  <div className="mt-2 text-xs text-sub-text">
                    Generating kundli…
                  </div>
                )}
                {reports[k.id] === 'err' && (
                  <div className="mt-2 text-xs text-danger">
                    Kundli service unavailable (set Prokerala keys on the
                    relay).
                  </div>
                )}
                {reports[k.id] && typeof reports[k.id] === 'object' && (
                  <KundliSummary r={reports[k.id]} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SESSIONS */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent consultations ({sessions.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">Astrologer</th>
                <th className="p-2">Dur</th>
                <th className="p-2">Cost</th>
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
                    {astroNames[s.astroId] || '-'}
                  </td>
                  <td className="p-2">{fmtDur(s.duration)}</td>
                  <td className="p-2">₹{s.cost || 0}</td>
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
                <tr><td colSpan={7} className="p-3 text-center
                  text-sub-text">No consultations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TRANSACTIONS */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent transactions ({txns.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{fmt(t.createdAt)}</td>
                  <td className="p-2 capitalize">{t.type || '-'}</td>
                  <td className="p-2 capitalize">{t.reason || '-'}</td>
                  <td className={`p-2 font-semibold ${t.amount >= 0
                    ? 'text-emerald-700' : 'text-red-700'}`}>
                    {t.amount >= 0 ? '+' : ''}₹{t.amount}
                  </td>
                </tr>
              ))}
              {txns.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-center
                  text-sub-text">No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DANGER ZONE: reset account */}
      <ResetAccountPanel uid={id}
        role={(u.role === 'astrologer') ? 'astrologer' : 'client'}
        name={u.name || u.email}
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

// Compact in-page summary of a generated kundli (full detail is in the
// downloadable PDF). Shows the key Vedic markers + personality snippet.
function KundliSummary({ r }) {
  const n = (r && r.narrative) || {};
  return (
    <div className="mt-2 rounded-card bg-bg-light p-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><span className="text-sub-text">Ascendant</span><br />
          <b>{(r.ascendant && r.ascendant.sign) || r.zodiac || '-'}</b></div>
        <div><span className="text-sub-text">Nakshatra</span><br />
          <b>{r.nakshatra || '-'}</b></div>
        <div><span className="text-sub-text">Moon sign</span><br />
          <b>{r.chandra_rasi || '-'}</b></div>
        <div><span className="text-sub-text">Sun sign</span><br />
          <b>{r.soorya_rasi || '-'}</b></div>
      </div>
      {n.personality && (
        <p className="mt-2 text-dark-text">{n.personality}</p>
      )}
      <p className="mt-1 text-[11px] text-sub-text">
        Download the PDF for the complete multi-page report.
      </p>
    </div>
  );
}
