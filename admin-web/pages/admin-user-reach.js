import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  adminService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Unified People hub. The old /admin-users + /admin-astrologers
// pages are now consolidated here: one search box, one scope chip
// strip, one virtually-scrolled list. Empty search renders the
// full customer + astrologer list (paginated in 100-row pages); a
// typed query filters across name, email, phone, user code or uid.
// Click any row to jump into the full profile.
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : typeof ts === 'number' ? ts
      : 0;
    if (!ms) return '–';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '–'; }
}
function relTime(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : typeof ts === 'number' ? ts
      : 0;
    if (!ms) return '–';
    const d = Date.now() - ms;
    if (d < 60_000) return 'just now';
    if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
    return `${Math.floor(d / 86400_000)}d ago`;
  } catch (_) { return '–'; }
}

function matchOne(s, hay) {
  if (!s) return true;
  const q = String(s).toLowerCase().trim();
  return [hay.name, hay.email, hay.phone, hay.userCode, hay.uid, hay.id]
    .filter(Boolean).map((v) => String(v).toLowerCase())
    .some((v) => v.includes(q));
}

const PAGE_SIZE = 100;

export default function AdminUserReach() {
  const router = useRouter();
  const { loading } = useRequireAdmin();
  const [users, setUsers] = useState(null);
  const [astros, setAstros] = useState(null);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all'); // all | customer | astrologer
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) =>
      setUsers(list || [])).catch(() => setUsers([]));
    astrologerService.getAstrologers().then((list) =>
      setAstros((list || []).map(
        (a) => ({ ...a, uid: a.id || a.uid })))).catch(() => setAstros([]));
  }, [loading]);

  // Reset to page 1 whenever the query or scope changes so the
  // operator never lands on an empty page just because they
  // filtered the previous result.
  useEffect(() => { setPage(1); }, [q, scope]);

  const customers = useMemo(() =>
    (users || []).filter((u) => (u.role || 'client') === 'client'),
    [users]);
  const customerMatches = useMemo(() =>
    scope === 'astrologer' ? []
      : customers.filter((u) => matchOne(q, u)),
    [customers, scope, q]);
  const astroMatches = useMemo(() =>
    scope === 'customer' ? []
      : (astros || []).filter((a) => matchOne(q, a)),
    [astros, scope, q]);

  const visibleCustomers = customerMatches.slice(0, page * PAGE_SIZE);
  const visibleAstros = astroMatches.slice(0, page * PAGE_SIZE);
  const moreAvailable = customerMatches.length > visibleCustomers.length
    || astroMatches.length > visibleAstros.length;

  if (loading || users == null || astros == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  function go(kind, uid) {
    if (kind === 'astrologer') router.push(`/admin-astro-profile/${uid}`);
    else router.push(`/admin-user-profile/${uid}`);
  }

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">People</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every customer and astrologer in one place. Use the scope
        chips to narrow, type any name, email, phone, user code or
        UID to search. Click a row to open the full profile with
        actions (balance, gifts, roles, recordings, reset).
      </p>

      <div className="card mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1" autoFocus value={q}
            placeholder="Search by name, email, phone, user code or UID"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const total = customerMatches.length + astroMatches.length;
                if (total === 1) {
                  const hit = customerMatches[0] || astroMatches[0];
                  const kind = customerMatches[0] ? 'customer' : 'astrologer';
                  go(kind, hit.uid || hit.id);
                }
              }
            }} />
          <button onClick={() => setQ((v) => v.trim())}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white">
            Search
          </button>
        </div>
        <div className="mt-2 inline-flex rounded-full bg-bg-light p-1
          text-xs font-bold">
          {[['all', 'All'], ['customer', 'Customers'],
            ['astrologer', 'Astrologers']].map(([k, lbl]) => (
            <button key={k} onClick={() => setScope(k)}
              className={`rounded-full px-3 py-1.5 ${scope === k
                ? 'bg-white text-primary shadow-sm' : 'text-sub-text'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-sub-text">
          {customerMatches.length} customer
          {customerMatches.length === 1 ? '' : 's'}
          {' · '}
          {astroMatches.length} astrologer
          {astroMatches.length === 1 ? '' : 's'}
          {q.trim() ? ` matching "${q.trim()}"`
            : ` total · showing ${visibleCustomers.length
              + visibleAstros.length}`}
        </div>
      </div>

      {customerMatches.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide
              text-sub-text">
              Customers ({customerMatches.length})
            </div>
          </div>
          <div className="space-y-2">
            {visibleCustomers.map((u) => (
              <ResultRow key={u.uid || u.id} u={u} kind="customer"
                onClick={() => go('customer', u.uid || u.id)} />
            ))}
          </div>
        </div>
      )}

      {astroMatches.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide
              text-sub-text">
              Astrologers ({astroMatches.length})
            </div>
          </div>
          <div className="space-y-2">
            {visibleAstros.map((a) => (
              <ResultRow key={a.uid || a.id} u={a} kind="astrologer"
                onClick={() => go('astrologer', a.uid || a.id)} />
            ))}
          </div>
        </div>
      )}

      {customerMatches.length === 0 && astroMatches.length === 0 && (
        <div className="card text-sm text-sub-text">
          {q.trim()
            ? `No customer or astrologer matches "${q.trim()}".`
            : 'No people yet.'}
        </div>
      )}

      {moreAvailable && (
        <div className="mt-2 text-center">
          <button onClick={() => setPage((p) => p + 1)}
            className="rounded-full bg-primary px-5 py-2 text-sm
              font-bold text-white">
            Show {PAGE_SIZE} more
          </button>
        </div>
      )}
    </Layout>
  );
}

function VerifiedDot({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full
      px-2 py-0.5 text-[10px] font-bold ${
      ok ? 'bg-emerald-100 text-emerald-700'
        : 'bg-gray-100 text-gray-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {label}{ok ? '' : ' – no'}
    </span>
  );
}

function ResultRow({ u, kind, onClick }) {
  const balance = Number(u.wallet || u.balance || 0);
  const lastSeen = u.lastSeenAt || u.lastLoginAt
    || u.lastActiveAt || u.updatedAt || u.createdAt;
  const blocked = u.status === 'blocked' || u.blocked === true
    || u.isBlocked === true;
  const online = u.status === 'online';
  const emailVerified = !!(u.emailVerified || u.verifiedEmail);
  const phoneVerified = !!(u.phoneVerified || u.verifiedPhone || u.phone);
  return (
    <button onClick={onClick}
      className="flex w-full items-start gap-3 rounded-card border
        border-gray-200 bg-white p-3 text-left hover:bg-bg-light
        hover:shadow-sm transition">
      <span className={`flex h-11 w-11 shrink-0 items-center
        justify-center rounded-full text-base font-bold text-white ${
        kind === 'astrologer' ? 'bg-primary' : 'bg-amber-500'}`}>
        {(u.name || u.email || '?').charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-dark-text">
            {u.name || '(no name)'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px]
            font-bold capitalize ${kind === 'astrologer'
              ? 'bg-primary/15 text-primary'
              : 'bg-amber-100 text-amber-700'}`}>
            {kind}
          </span>
          {u.userCode && (
            <span className="rounded-full bg-bg-light px-2 py-0.5
              text-[10px] font-bold text-sub-text">
              {u.userCode}
            </span>
          )}
          {blocked && (
            <span className="rounded-full bg-red-100 px-2 py-0.5
              text-[10px] font-bold text-red-700">
              Blocked
            </span>
          )}
          {online && !blocked && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5
              text-[10px] font-bold text-emerald-700">
              Online
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-sub-text">
          {u.email || ' – '}
          {u.phone ? ` · ${u.phone}` : ''}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <VerifiedDot ok={emailVerified} label="Email" />
          <VerifiedDot ok={phoneVerified} label="Phone" />
          {kind === 'customer' && (
            <span className="rounded-full bg-emerald-50
              px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              Wallet ₹{balance.toFixed(0)}
            </span>
          )}
          {kind === 'astrologer' && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5
              text-[10px] font-bold text-amber-700">
              Rating {Number(u.ratingAvg || u.rating || 0).toFixed(1)}
            </span>
          )}
          <span className="rounded-full bg-bg-light px-2 py-0.5
            text-[10px] font-bold text-sub-text">
            Last seen {relTime(lastSeen)}
          </span>
        </div>
      </div>
      <span className="self-center text-sub-text">›</span>
    </button>
  );
}
