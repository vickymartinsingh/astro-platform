import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  adminService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Unified People hub. All roles in one place: customer / astrologer
// / admin / support / hr. Five tiles at the top filter the list to
// that role; the search box finds an exact person whose role you do
// not yet know.
//
// Visual was reworked from a pill-stuffed card to a tight, dense
// row that mirrors Linear / Vercel admin tables: avatar + name on
// the left, a single subtle identity line, status icons rather
// than rounded chips, key metrics right-aligned. Per-row hover lift
// + alternating-row background give the list visual rhythm.
function relTime(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : typeof ts === 'number' ? ts
      : 0;
    if (!ms) return '';
    const d = new Date(ms);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const isYest = d.toDateString() === yest.toDateString();
    const hhmm = d.toLocaleTimeString([], { hour: '2-digit',
      minute: '2-digit' });
    if (isToday) {
      const mins = Math.floor((now - d) / 60_000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      return `Today ${hhmm}`;
    }
    if (isYest) return `Yest ${hhmm}`;
    return `${d.toLocaleDateString('en-GB',
      { day: '2-digit', month: 'short' })} ${hhmm}`;
  } catch (_) { return ''; }
}

function matchOne(s, hay) {
  if (!s) return true;
  const q = String(s).toLowerCase().trim();
  return [hay.name, hay.email, hay.phone, hay.userCode, hay.uid, hay.id]
    .filter(Boolean).map((v) => String(v).toLowerCase())
    .some((v) => v.includes(q));
}

function roleOf(u) {
  return String(u.role || 'client').toLowerCase();
}

const PAGE_SIZE = 100;
// Match the AdminShell sidebar palette so the tiles feel like part
// of the same system, not five competing colors.
const ROLE_META = {
  customer: { label: 'Customers', accent: 'from-amber-400 to-amber-600',
    chip: 'bg-amber-100 text-amber-700', avatar: 'bg-amber-500' },
  astrologer: { label: 'Astrologers',
    accent: 'from-[#7F2020] to-[#a83232]',
    chip: 'bg-primary/15 text-primary', avatar: 'bg-primary' },
  admin: { label: 'Admin team', accent: 'from-slate-700 to-slate-900',
    chip: 'bg-slate-100 text-slate-700', avatar: 'bg-slate-700' },
  support: { label: 'Support', accent: 'from-amber-700 to-amber-900',
    chip: 'bg-amber-100 text-amber-800', avatar: 'bg-amber-700' },
  hr: { label: 'HR', accent: 'from-emerald-600 to-emerald-800',
    chip: 'bg-emerald-100 text-emerald-700', avatar: 'bg-emerald-600' },
};

export default function AdminUserReach() {
  const router = useRouter();
  const { loading } = useRequireAdmin();
  const [users, setUsers] = useState(null);
  const [astros, setAstros] = useState(null);
  const [q, setQ] = useState('');
  // scope: all | customer | astrologer | admin | support | hr
  // Initialised from ?scope= so the dashboard tiles deep-link
  // straight into a filtered view.
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!router.isReady) return;
    const s = router.query.scope;
    if (typeof s === 'string'
      && ['all', 'customer', 'astrologer', 'admin', 'support', 'hr']
        .includes(s)) {
      setScope(s);
    }
  }, [router.isReady, router.query.scope]);

  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) =>
      setUsers(list || [])).catch(() => setUsers([]));
    astrologerService.getAstrologers().then((list) =>
      setAstros((list || []).map(
        (a) => ({ ...a, uid: a.id || a.uid })))).catch(() => setAstros([]));
  }, [loading]);

  useEffect(() => { setPage(1); }, [q, scope]);

  // Bucketize once per data load so every count + filter reads
  // from the same source of truth.
  const buckets = useMemo(() => {
    const list = users || [];
    return {
      customer: list.filter((u) => roleOf(u) === 'client'),
      astrologer: astros || [],
      admin: list.filter((u) => roleOf(u) === 'admin'),
      support: list.filter((u) => roleOf(u) === 'support'),
      hr: list.filter((u) => roleOf(u) === 'hr'),
    };
  }, [users, astros]);

  // The list to render for the current scope. 'all' shows
  // customers + astrologers (the two biggest groups); a specific
  // scope shows only that bucket.
  const rowsForScope = useMemo(() => {
    if (scope === 'all') {
      return [
        ...buckets.customer.filter((u) => matchOne(q, u))
          .map((u) => ({ ...u, _scope: 'customer' })),
        ...buckets.astrologer.filter((a) => matchOne(q, a))
          .map((a) => ({ ...a, _scope: 'astrologer' })),
      ];
    }
    return (buckets[scope] || []).filter((x) => matchOne(q, x))
      .map((x) => ({ ...x, _scope: scope }));
  }, [scope, q, buckets]);

  const visible = rowsForScope.slice(0, page * PAGE_SIZE);
  const moreAvailable = rowsForScope.length > visible.length;

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
        Tap a role tile to filter the list. Or search any name,
        email, phone, user code or UID to find a person whose role
        you do not yet know.
      </p>

      {/* Role partition tiles */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {['customer', 'astrologer', 'admin', 'support', 'hr']
          .map((id) => {
            const meta = ROLE_META[id];
            const n = (buckets[id] || []).length;
            const active = scope === id
              || (scope === 'all' && id === 'customer');
            return (
              <button key={id} onClick={() => { setScope(id); setQ(''); }}
                className={`group rounded-2xl bg-gradient-to-br
                  ${meta.accent} p-3 text-left text-white shadow-sm
                  transition hover:shadow-md ${active
                    ? 'ring-2 ring-white ring-offset-2'
                    : 'opacity-90 hover:opacity-100'}`}>
                <div className="text-[10px] font-bold uppercase
                  tracking-widest opacity-90">{meta.label}</div>
                <div className="mt-1 text-2xl font-bold">{n}</div>
                <div className="mt-1 text-[10px] opacity-85">
                  Tap to filter
                </div>
              </button>
            );
          })}
      </div>

      {/* Search bar */}
      <div className="surface mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[200px]" autoFocus
            value={q} placeholder="Search by name, email, phone, user
              code or UID"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rowsForScope.length === 1) {
                const hit = rowsForScope[0];
                go(hit._scope === 'astrologer'
                  ? 'astrologer' : 'customer', hit.uid || hit.id);
              }
            }} />
          {scope !== 'all' && (
            <button onClick={() => setScope('all')}
              className="rounded-full bg-bg-light px-3 py-2 text-xs
                font-bold text-sub-text hover:bg-gray-200">
              × Clear filter
            </button>
          )}
        </div>
        <div className="mt-2 text-[11px] text-sub-text">
          {scope === 'all'
            ? `${buckets.customer.length} customers · `
              + `${buckets.astrologer.length} astrologers`
            : `${(buckets[scope] || []).length} ${
              ROLE_META[scope]?.label.toLowerCase() || scope}`}
          {q.trim()
            ? ` · ${rowsForScope.length} matching "${q.trim()}"`
            : ` · showing ${visible.length}`}
        </div>
      </div>

      {/* List */}
      {rowsForScope.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2
          p-10 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full
            bg-bg-light text-2xl text-sub-text">·</div>
          <div className="text-sm font-semibold text-dark-text">
            {q.trim()
              ? `No profile or user found matching "${q.trim()}".`
              : scope === 'all'
                ? 'No people yet.'
                : `No ${ROLE_META[scope]?.label.toLowerCase()
                  || scope} users yet.`}
          </div>
          {!q.trim() && scope !== 'all' && scope !== 'customer'
            && scope !== 'astrologer' && (
            <div className="text-[12px] text-sub-text">
              Assign this role to an existing user from{' '}
              <span className="font-mono">/admin-user-profile</span>{' '}
              → Roles.
            </div>
          )}
        </div>
      ) : (
        <div className="surface divide-y divide-gray-200/70
          overflow-hidden">
          {visible.map((u) => (
            <Row key={(u.uid || u.id) + ':' + u._scope}
              u={u} kind={u._scope}
              onClick={() => go(u._scope === 'astrologer'
                ? 'astrologer' : 'customer', u.uid || u.id)} />
          ))}
        </div>
      )}

      {moreAvailable && (
        <div className="mt-3 text-center">
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

// One row of the People list. New compact layout (no pill explosion):
//   left  : 32px avatar with online dot (if applicable)
//   mid   : name + role chip + code chip on row 1; email | phone on
//           row 2 with subtle icons for verified state
//   right : Wallet ₹/Rating, then Last seen, then chevron
function Row({ u, kind, onClick }) {
  const meta = ROLE_META[kind] || ROLE_META.customer;
  const balance = Number(u.wallet || u.balance || 0);
  const rating = Number(u.ratingAvg || u.rating || 0);
  const lastSeen = u.lastSeenAt || u.lastLoginAt
    || u.lastActiveAt || u.updatedAt || u.createdAt;
  const blocked = u.status === 'blocked' || u.blocked === true
    || u.isBlocked === true;
  const online = u.status === 'online' && !blocked;
  const seenLabel = relTime(lastSeen);
  const code = u.userCode
    || String(u.uid || u.id || '').slice(0, 6).toUpperCase();
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left
        transition hover:bg-bg-light/60">
      {/* Avatar + presence dot */}
      <div className="relative shrink-0">
        <span className={`flex h-9 w-9 items-center justify-center
          rounded-full text-sm font-bold text-white ${meta.avatar}`}>
          {(u.name || u.email || '?').charAt(0).toUpperCase()}
        </span>
        {online && (
          <span className="absolute -bottom-0.5 -right-0.5 grid
            h-3 w-3 place-items-center rounded-full
            border-2 border-white bg-emerald-500" />
        )}
        {blocked && (
          <span className="absolute -bottom-0.5 -right-0.5 grid
            h-3 w-3 place-items-center rounded-full
            border-2 border-white bg-red-500" />
        )}
      </div>

      {/* Identity column */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold
            text-dark-text">{u.name || '(no name)'}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9px]
            font-bold uppercase tracking-wider ${meta.chip}`}>
            {kind}
          </span>
          <span className="rounded bg-bg-light px-1.5 py-0.5
            font-mono text-[10px] font-bold text-sub-text">
            {code}
          </span>
          {blocked && (
            <span className="rounded-full bg-red-100 px-2 py-0.5
              text-[10px] font-bold text-red-700">Blocked</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 truncate
          text-[11.5px] text-sub-text">
          <Field icon="✉" value={u.email}
            verified={!!(u.emailVerified || u.verifiedEmail)} />
          {u.phone && (
            <>
              <span className="text-gray-300">·</span>
              <Field icon="☏" value={u.phone}
                verified={!!(u.phoneVerified || u.verifiedPhone)} />
            </>
          )}
        </div>
      </div>

      {/* Stat columns */}
      <div className="hidden shrink-0 items-center gap-5 text-right
        text-[11px] sm:flex">
        {kind === 'customer' && (
          <Stat label="Wallet"
            value={`₹${balance.toFixed(0)}`}
            tone="emerald" />
        )}
        {kind === 'astrologer' && (
          <Stat label="Rating"
            value={rating ? rating.toFixed(1) : '–'}
            tone="amber" />
        )}
        <Stat label="Last seen"
          value={seenLabel || 'never'}
          tone={seenLabel.startsWith('Today')
            || seenLabel === 'just now'
            || seenLabel.endsWith('m ago')
            ? 'emerald'
            : seenLabel.startsWith('Yest')
              ? 'amber' : 'gray'} />
      </div>
      <span className="shrink-0 text-base text-sub-text">›</span>
    </button>
  );
}

function Field({ icon, value, verified }) {
  if (!value) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <span className={`grid h-3.5 w-3.5 shrink-0
        place-items-center rounded-full text-[9px]
        ${verified ? 'bg-emerald-100 text-emerald-700'
          : 'bg-gray-100 text-gray-400'}`}>
        {icon}
      </span>
      <span className={`truncate ${verified
        ? 'text-dark-text' : 'text-sub-text'}`}>
        {value}
      </span>
    </span>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'emerald' ? 'text-emerald-600'
    : tone === 'amber' ? 'text-amber-700'
    : 'text-sub-text';
  return (
    <div className="flex w-[110px] flex-col items-end">
      <div className="text-[9px] font-bold uppercase tracking-wider
        text-sub-text">{label}</div>
      <div className={`mt-0.5 truncate text-[12px] font-semibold
        ${color}`}>{value}</div>
    </div>
  );
}
