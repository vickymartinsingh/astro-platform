import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  adminService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Unified compliance lookup. One search box that finds any customer OR
// astrologer by name / email / phone / user code / uid, with a Search
// button. Click any result to jump straight into their full profile
// (which already shows transactions, sessions, kundli, reviews,
// compliance device/IP/activity, danger-zone reset, etc).
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}

function matchOne(s, hay) {
  if (!s) return true;
  const q = String(s).toLowerCase().trim();
  return [hay.name, hay.email, hay.phone, hay.userCode, hay.uid, hay.id]
    .filter(Boolean).map((v) => String(v).toLowerCase())
    .some((v) => v.includes(q));
}

export default function AdminUserReach() {
  const router = useRouter();
  const { loading } = useRequireAdmin();
  const [users, setUsers] = useState(null);
  const [astros, setAstros] = useState(null);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all'); // all | customer | astrologer

  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) =>
      setUsers(list || [])).catch(() => setUsers([]));
    astrologerService.getAstrologers().then((list) =>
      setAstros((list || []).map(
        (a) => ({ ...a, uid: a.id || a.uid })))).catch(() => setAstros([]));
  }, [loading]);

  if (loading || users == null || astros == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const customers = users.filter((u) => (u.role || 'client') === 'client');
  const customerMatches = scope === 'astrologer' ? []
    : customers.filter((u) => matchOne(q, u));
  const astroMatches = scope === 'customer' ? []
    : astros.filter((a) => matchOne(q, a));
  const total = customerMatches.length + astroMatches.length;

  function go(kind, uid) {
    if (kind === 'astrologer') router.push(`/admin-astro-profile/${uid}`);
    else router.push(`/admin-user-profile/${uid}`);
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">User Reach</h1>
      <p className="mb-3 text-sm text-sub-text">
        One-stop lookup. Find any customer or astrologer by name, email,
        phone, user code or UID, then open their full profile to see
        every consultation, transaction, kundli, review, the compliance
        device/IP/activity log, and the reset / restore controls.
      </p>

      <div className="card mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1" autoFocus value={q}
            placeholder="Search by name, email, phone, user code or UID"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
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
          {q.trim()
            ? `${total} result${total === 1 ? '' : 's'}`
            : `Total: ${customers.length} customers, ${astros.length}`
              + ' astrologers'}
        </div>
      </div>

      {/* Customer matches */}
      {customerMatches.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide
            text-sub-text">Customers ({customerMatches.length})</div>
          <div className="space-y-2">
            {customerMatches.slice(0, 30).map((u) => (
              <ResultRow key={u.uid || u.id} u={u} kind="customer"
                onClick={() => go('customer', u.uid || u.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Astrologer matches */}
      {astroMatches.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide
            text-sub-text">Astrologers ({astroMatches.length})</div>
          <div className="space-y-2">
            {astroMatches.slice(0, 30).map((a) => (
              <ResultRow key={a.uid || a.id} u={a} kind="astrologer"
                onClick={() => go('astrologer', a.uid || a.id)} />
            ))}
          </div>
        </div>
      )}

      {q.trim() && total === 0 && (
        <div className="card text-sm text-sub-text">
          No customer or astrologer matches that search.
        </div>
      )}

      {/* When idle, show jump links to the dedicated lists. */}
      {!q.trim() && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link href="/admin-users"
            className="card text-center font-semibold hover:bg-bg-light">
            Browse all customers
          </Link>
          <Link href="/admin-astrologers"
            className="card text-center font-semibold hover:bg-bg-light">
            Browse all astrologers
          </Link>
        </div>
      )}
    </Layout>
  );
}

function ResultRow({ u, kind, onClick }) {
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border
        border-gray-200 bg-white p-3 text-left hover:bg-bg-light">
      <span className={`flex h-10 w-10 shrink-0 items-center
        justify-center rounded-full text-sm font-bold text-white ${
        kind === 'astrologer' ? 'bg-primary' : 'bg-amber-500'}`}>
        {(u.name || u.email || '?').charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
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
          {u.status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px]
              font-bold capitalize ${u.status === 'blocked'
                ? 'bg-red-100 text-red-700'
                : u.status === 'online'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-700'}`}>
              {u.status}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-sub-text">
          {u.email || '—'}
          {u.phone ? ` · ${u.phone}` : ''}
          {u.createdAt ? ` · joined ${fmt(u.createdAt)}` : ''}
        </div>
      </div>
      <span className="text-sub-text">›</span>
    </button>
  );
}
