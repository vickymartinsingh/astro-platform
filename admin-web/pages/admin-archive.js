import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { adminService, rupees } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Archive browser. Every account reset (Danger Zone delete + bulk
// reset) writes the deleted docs into archives/{id}/items first so
// admins can review and restore.
//
// Earlier the page dumped raw doc IDs and JSON-looking previews in
// little tables. The operator's complaint: "showing in codes, must
// show the info along with the profile review, like reach". So this
// rewrite reads the archived users/{uid} doc out of the items list,
// reconstructs the profile header (avatar, name, email, phone, code,
// joined, wallet), and surfaces high-level metrics + a clean
// preview tabbed by category - the same visual language as
// /admin-user-reach so the operator is never seeing a different
// design between the live list and the archive.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '—'; }
}
function fmtDateOnly(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch (_) { return ''; }
}
function sumCounts(counts) {
  return Object.values(counts || {}).reduce(
    (a, v) => a + (Number(v) || 0), 0);
}

// Heuristics that map an archive item's collection name to a friendly
// icon + label so the operator does not have to translate
// "kundliProfiles" / "callRecordings" / "transactions" in their head.
const CAT_META = {
  users: { icon: '\u{1F464}', label: 'Profile' },
  kundliProfiles: { icon: '\u{1F52E}', label: 'Kundli profiles' },
  transactions: { icon: '₹', label: 'Transactions' },
  sessions: { icon: '\u{1F4DE}', label: 'Sessions' },
  chats: { icon: '\u{1F4AC}', label: 'Chat history' },
  notifications: { icon: '\u{1F514}', label: 'Notifications' },
  reviews: { icon: '⭐', label: 'Reviews' },
  recharges: { icon: '\u{1F4B3}', label: 'Recharges' },
  refunds: { icon: '\u{1F501}', label: 'Refunds' },
  complaints: { icon: '⚠️', label: 'Complaints' },
  history: { icon: '\u{1F4DC}', label: 'History' },
  wallet: { icon: '\u{1F45B}', label: 'Wallet ledger' },
  remedy: { icon: '\u{1F33F}', label: 'Remedies' },
  calls: { icon: '\u{1F4F1}', label: 'Calls' },
  recordings: { icon: '\u{1F39E}️', label: 'Recordings' },
  profile: { icon: '\u{1F4C4}', label: 'Profile fields' },
};

export default function AdminArchive() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | archived | restored

  async function load() {
    setRows(await adminService.listArchives({ limit: 100 }) || []);
  }
  useEffect(() => { if (!loading) load(); }, [loading]);

  // Honour ?filter=archived|restored from the URL so the People
  // directory's Archive + Restore tiles deep-link straight to the
  // pre-filtered view.
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    const f = router.query.filter;
    if (typeof f === 'string'
      && ['all', 'archived', 'restored'].includes(f)) {
      setFilter(f);
    }
  }, [router.isReady, router.query.filter]);

  async function openArchive(id) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail('loading');
    setDetail(await adminService.getArchive(id));
  }
  async function restore(id) {
    if (!window.confirm('Restore this archive? It rewrites the original '
      + 'docs back to their collections.')) return;
    setBusy(true);
    try {
      const r = await adminService.restoreArchive(id);
      flash(`Restored ${r.restored} record(s).`);
      load(); if (openId === id) openArchive(id);
    } catch (e) { flash(`Restore failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }
  async function purge(id) {
    if (!window.confirm('Purge this archive snapshot? The data will '
      + 'NO LONGER be restorable but the user tombstone stays so '
      + 'compliance audit still works. Continue?')) return;
    setBusy(true);
    try {
      await adminService.deleteArchive(id);
      flash('Archive purged.');
      if (openId === id) { setOpenId(null); setDetail(null); }
      load();
    } catch (e) { flash(`Purge failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }
  // Open the password-gated permanent-erase modal. The two-stage
  // browser confirm + the ERASE typed tag are kept as belt-and-
  // braces friction before showing the password prompt. Submission
  // re-authenticates with the admin's own Firebase Auth password
  // before nuking the archive + user tombstone.
  const [erasing, setErasing] = useState(null); // { id, pwd, err, busy }
  async function erase(id) {
    if (!window.confirm('ERASE FOREVER?\n\nThis nukes the archive, '
      + 'every other archive for this user, and the users doc itself. '
      + 'The user will be unrecoverable. Continue?')) return;
    const tag = window.prompt('Type ERASE to confirm.');
    if (String(tag || '').trim().toUpperCase() !== 'ERASE') {
      flash('Cancelled.'); return;
    }
    setErasing({ id, pwd: '', err: '', busy: false });
  }
  async function submitErase() {
    if (!erasing) return;
    if (!erasing.pwd) {
      setErasing((e) => ({ ...e, err: 'Enter your admin password.' }));
      return;
    }
    setErasing((e) => ({ ...e, busy: true, err: '' }));
    try {
      const r = await adminService.permanentlyEraseArchiveWithPassword(
        erasing.id, erasing.pwd);
      flash(`Erased${r.erasedUser ? ' (user doc removed)' : ''}`
        + (r.otherArchives > 1
          ? `, + ${r.otherArchives - 1} other archive(s) for same uid.`
          : '.'));
      if (openId === erasing.id) { setOpenId(null); setDetail(null); }
      setErasing(null);
      load();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const friendly = /wrong-password|invalid-credential/.test(msg)
        ? 'Wrong admin password. Try again.'
        : msg;
      setErasing((cur) => ({ ...(cur || {}), busy: false,
        err: friendly }));
    }
  }

  // Filter + search across the archive list.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter === 'restored' && !r.restored) return false;
      if (filter === 'archived' && r.restored) return false;
      if (!s) return true;
      const hay = [r.uid, r.role, (r.parts || []).join(','),
        r.name, r.email, r.phone].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q, filter]);

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Archive</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Every account reset is archived here first. Inspect the
            snapshot, restore it, or permanently erase it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="rounded-full bg-primary px-3 py-1.5 text-xs
              font-bold text-white">Refresh</button>
        </div>
      </div>

      {/* Quick filter chips + search */}
      <div className="surface mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[200px]"
            placeholder="Search by name, email, phone, uid, role"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <FilterChip on={filter === 'all'}
            onClick={() => setFilter('all')}>
            All ({(rows || []).length})
          </FilterChip>
          <FilterChip on={filter === 'archived'}
            onClick={() => setFilter('archived')}>
            Archived ({(rows || [])
              .filter((r) => !r.restored).length})
          </FilterChip>
          <FilterChip on={filter === 'restored'}
            onClick={() => setFilter('restored')}>
            Restored ({(rows || [])
              .filter((r) => r.restored).length})
          </FilterChip>
        </div>
      </div>

      {!rows ? (
        <div className="card">Loading archives...</div>
      ) : filtered.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2
          p-10 text-center">
          <div className="grid h-12 w-12 place-items-center
            rounded-full bg-bg-light text-2xl text-sub-text">
            {'\u{1F4E6}'}</div>
          <div className="text-sm font-semibold text-dark-text">
            {q.trim() ? 'No archives match this search.'
              : 'No archives yet. Every reset creates one automatically.'}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <ArchiveCard key={a.id} a={a} busy={busy}
              isOpen={openId === a.id}
              detail={openId === a.id ? detail : null}
              onToggle={() => openArchive(a.id)}
              onRestore={() => restore(a.id)}
              onPurge={() => purge(a.id)}
              onErase={() => erase(a.id)} />
          ))}
        </div>
      )}

      {erasing && (
        <div className="fixed inset-0 z-50 flex items-center
          justify-center bg-black/50 p-4"
          onClick={() => !erasing.busy && setErasing(null)}>
          <div className="w-full max-w-sm rounded-card bg-white p-5
            shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-danger">
              Permanent erase
            </h3>
            <p className="mt-1 text-xs text-sub-text">
              Type your admin password to permanently erase this
              archive, every other archive for the same user, and
              the user doc itself. This cannot be undone.
            </p>
            <input className="input mt-3" type="password" autoFocus
              value={erasing.pwd}
              placeholder="Admin password"
              disabled={erasing.busy}
              onChange={(e) => setErasing((cur) => ({
                ...(cur || {}), pwd: e.target.value }))} />
            {erasing.err && (
              <div className="mt-2 rounded-card bg-danger/10 p-2
                text-xs font-semibold text-danger">{erasing.err}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setErasing(null)}
                disabled={erasing.busy}
                className="rounded-full bg-bg-light px-4 py-2 text-sm
                  font-semibold">Cancel</button>
              <button onClick={submitErase} disabled={erasing.busy
                || !erasing.pwd}
                className="rounded-full bg-danger px-4 py-2 text-sm
                  font-bold text-white disabled:opacity-60">
                {erasing.busy ? 'Erasing...' : 'Erase forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function FilterChip({ children, on, onClick }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold
        transition ${on
          ? 'bg-primary text-white'
          : 'bg-bg-light text-sub-text hover:bg-gray-200'}`}>
      {children}
    </button>
  );
}

// One archive snapshot. Renders a reach-style header (avatar +
// identity + key metrics) and, when expanded, a tabbed body with
// a high-level summary, the original profile snapshot, and a
// category-by-category record preview.
function ArchiveCard({ a, isOpen, detail, busy, onToggle, onRestore,
  onPurge, onErase }) {
  const role = a.role || 'client';
  const total = sumCounts(a.counts);
  // We may have a fuller profile in the meta doc itself if the
  // resetAccountData stamped name/email/phone there; otherwise dig
  // into detail.items for the users/{uid} doc.
  const userDoc = (detail && typeof detail === 'object'
    && Array.isArray(detail.items)
    && detail.items.find((it) => it.coll === 'users'
      || it.coll === 'astrologers'))?.data;
  const profile = {
    name: a.name || userDoc?.name || '(unknown user)',
    email: a.email || userDoc?.email || '',
    phone: a.phone || userDoc?.phone || '',
    // Code-only IDs: prefer the user's stored 6-char userCode and
    // NEVER fall back to a raw UID slice in customer-visible labels.
    code: a.userCode || userDoc?.userCode || '',
    wallet: Number(userDoc?.wallet || 0),
    joinedAt: userDoc?.createdAt || a.userCreatedAt || null,
    role,
  };
  const initial = (profile.name || profile.email || '?')
    .charAt(0).toUpperCase();
  const roleColor = role === 'astrologer' ? 'bg-primary'
    : role === 'admin' ? 'bg-slate-700'
    : role === 'support' ? 'bg-amber-700'
    : role === 'hr' ? 'bg-emerald-600'
    : 'bg-amber-500';

  return (
    <div className="surface overflow-hidden">
      {/* Header row - identical visual language to reach */}
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className={`grid h-11 w-11 shrink-0 place-items-center
          rounded-full text-base font-bold text-white ${roleColor}`}>
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold text-dark-text">
              {profile.name}
            </span>
            <span className="rounded-full bg-bg-light px-2 py-0.5
              text-[10px] font-bold uppercase tracking-wider
              text-sub-text">{role}</span>
            {a.restored ? (
              <span className="rounded-full bg-emerald-100 px-2
                py-0.5 text-[10px] font-bold text-emerald-700">
                Restored
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2
                py-0.5 text-[10px] font-bold text-amber-700">
                Archived
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2
            truncate text-[11.5px] text-sub-text">
            {profile.email && <span>{'✉ '}{profile.email}</span>}
            {profile.phone && (
              <>
                <span className="text-gray-300">{'·'}</span>
                <span>{'☎ '}{profile.phone}</span>
              </>
            )}
            <span className="text-gray-300">{'·'}</span>
            <span className="font-mono">{profile.code}</span>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-right
          text-[11px] sm:flex">
          <Stat label="Records" value={total} />
          <Stat label="Reset at" value={fmt(a.createdAt)} />
        </div>
      </div>

      {/* Action strip - never repeats. Restore disabled when already
          restored. Erase always last + sized smaller to discourage
          accidental clicks. */}
      <div className="flex flex-wrap items-center justify-between
        gap-2 border-t border-gray-100 bg-bg-light/40 px-4 py-2">
        <div className="text-[11px] text-sub-text">
          {(a.parts || []).length > 0
            ? (a.parts || []).join(', ')
            : 'no categories logged'}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActBtn onClick={onToggle} tone="ghost">
            {isOpen ? 'Hide details' : 'View details'}
          </ActBtn>
          {/* Compliance jump - works even after Restore + after Purge
              because audit / IP / UA events still hold the uid. */}
          <a href={role === 'astrologer'
            ? `/admin-astro-profile/${a.uid}`
            : `/admin-user-profile/${a.uid}`}
            className="rounded-full bg-bg-light px-3 py-1.5 text-xs
              font-bold text-primary hover:bg-gray-200">
            Open profile
          </a>
          {!a.restored && (
            <ActBtn onClick={onRestore} disabled={busy} tone="emerald">
              Restore
            </ActBtn>
          )}
          <ActBtn onClick={onPurge} disabled={busy} tone="warn">
            Purge snapshot
          </ActBtn>
          <ActBtn onClick={onErase} disabled={busy} tone="danger">
            Erase forever
          </ActBtn>
        </div>
      </div>

      {/* Expanded body */}
      {isOpen && (
        <div className="border-t border-gray-100 p-4">
          {detail === 'loading' && (
            <div className="text-sm text-sub-text">Loading details...</div>
          )}
          {detail && typeof detail === 'object'
            && detail.id === a.id && (
            <ExpandedBody detail={detail} profile={profile} a={a} />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex w-[150px] flex-col items-end">
      <div className="text-[9px] font-bold uppercase tracking-wider
        text-sub-text">{label}</div>
      <div className="mt-0.5 text-xs font-semibold text-dark-text">
        {value}
      </div>
    </div>
  );
}

function ActBtn({ children, onClick, tone, disabled }) {
  const cls = tone === 'danger'
    ? 'bg-white border border-danger text-danger hover:bg-danger/10'
    : tone === 'warn'
      ? 'bg-white border border-amber-400 text-amber-800 '
        + 'hover:bg-amber-50'
      : tone === 'emerald'
        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
        : tone === 'primary'
          ? 'bg-primary text-white hover:bg-primary/90'
          : 'bg-bg-light text-dark-text hover:bg-gray-200';
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs font-bold
        transition disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

// Expanded body: profile review + category counts + a single
// scrollable preview list (sorted by category by default but
// switchable). No more multiple sub-tables that visually repeat.
function ExpandedBody({ detail, profile, a }) {
  const items = detail.items || [];
  const cats = useMemo(() => {
    const m = {};
    items.forEach((it) => {
      const k = it.coll || 'unknown';
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m)
      .sort((x, y) => y[1] - x[1])
      .map(([k, n]) => ({ key: k, n }));
  }, [items]);
  const [tab, setTab] = useState('summary');

  return (
    <div className="space-y-4">
      {/* Tab strip */}
      <div className="flex flex-wrap gap-1">
        <Tab on={tab === 'summary'} onClick={() => setTab('summary')}>
          Summary
        </Tab>
        <Tab on={tab === 'profile'} onClick={() => setTab('profile')}>
          Profile review
        </Tab>
        <Tab on={tab === 'records'} onClick={() => setTab('records')}>
          Records ({items.length})
        </Tab>
      </div>

      {tab === 'summary' && (
        <div className="grid gap-2 sm:grid-cols-3">
          {cats.length === 0 ? (
            <div className="col-span-3 text-sm text-sub-text">
              Profile-only reset {'—'} no records were archived.
            </div>
          ) : cats.map((c) => {
            const meta = CAT_META[c.key]
              || { icon: '\u{1F4C2}', label: c.key };
            return (
              <div key={c.key}
                className="rounded-card border border-gray-200 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{meta.icon}</span>
                  <span className="text-xs font-bold uppercase
                    tracking-wider text-sub-text">{meta.label}</span>
                </div>
                <div className="mt-1 text-2xl font-bold text-dark-text">
                  {c.n}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'profile' && (
        <div className="rounded-card border border-gray-200 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Name" value={profile.name} />
            <Info label="Role" value={profile.role} />
            <Info label="Email" value={profile.email || '—'} />
            <Info label="Phone" value={profile.phone || '—'} />
            <Info label="User code" value={profile.code || '—'} />
            <Info label="Wallet at reset"
              value={profile.wallet ? rupees(profile.wallet) : '₹0'} />
            <Info label="Joined"
              value={fmtDateOnly(profile.joinedAt) || '—'} />
            <Info label="Reset at" value={fmt(a.createdAt)} />
            <Info label="Archive ID" value={a.id} mono />
            {a.restored && (
              <Info label="Restored at" value={fmt(a.restoredAt)} />
            )}
          </div>
        </div>
      )}

      {tab === 'records' && (
        <RecordsPreview items={items} />
      )}
    </div>
  );
}

function Tab({ children, on, onClick }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-bold
        transition ${on
          ? 'bg-primary text-white'
          : 'bg-bg-light text-sub-text hover:bg-gray-200'}`}>
      {children}
    </button>
  );
}

function Info({ label, value, mono }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</div>
      <div className={`mt-0.5 text-sm ${mono
        ? 'font-mono text-[12px] text-dark-text break-all'
        : 'font-semibold text-dark-text'}`}>{value}</div>
    </div>
  );
}

// All archived records as one clean, filterable list. Each row shows
// human fields (amount, reason, title, when) rather than raw JSON.
function RecordsPreview({ items }) {
  const [cat, setCat] = useState('all');
  const cats = useMemo(() => {
    const set = new Set(items.map((it) => it.coll || 'unknown'));
    return ['all', ...Array.from(set).sort()];
  }, [items]);
  const filtered = cat === 'all' ? items
    : items.filter((it) => (it.coll || 'unknown') === cat);
  if (!items.length) {
    return <div className="text-sm text-sub-text">
      No record-level archive (profile-only).
    </div>;
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {cats.map((c) => {
          const meta = CAT_META[c] || null;
          return (
            <Tab key={c} on={cat === c} onClick={() => setCat(c)}>
              {c === 'all' ? `All (${items.length})`
                : `${meta?.icon || ''} ${meta?.label || c} `
                  + `(${items.filter((it) =>
                    (it.coll || 'unknown') === c).length})`}
            </Tab>
          );
        })}
      </div>
      <div className="max-h-[420px] overflow-auto rounded-card
        border border-gray-200">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-bg-light text-sub-text">
            <tr>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 300).map((it, i) => (
              <tr key={it.id || i}
                className="border-t border-gray-100 hover:bg-bg-light/40">
                <td className="px-3 py-2 text-sub-text">
                  {(CAT_META[it.coll]?.label) || it.coll || 'unknown'}
                </td>
                <td className="px-3 py-2 text-sub-text whitespace-nowrap">
                  {fmt(it.data?.createdAt || it.data?.timestamp
                    || it.data?.at)}
                </td>
                <td className="px-3 py-2 text-dark-text">
                  {humanize(it.coll, it.data)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 300 && (
          <div className="px-3 py-2 text-[11px] text-sub-text">
            + {filtered.length - 300} more not shown
          </div>
        )}
      </div>
    </div>
  );
}

// Single source of truth for "what to show for a record in the
// archive list". Mirrors the language the admin sees elsewhere on
// the platform so they recognise the data immediately.
function humanize(coll, d) {
  if (!d || typeof d !== 'object') return String(d || '');
  if (coll === 'transactions' || coll === 'wallet') {
    const amt = Number(d.amount || 0);
    const sign = amt >= 0 ? '+' : '';
    return `${d.type || (amt >= 0 ? 'credit' : 'debit')} `
      + `${sign}${rupees(Math.abs(amt))} ${'·'} `
      + `${d.reason || d.description || ''}`;
  }
  if (coll === 'notifications') {
    return `${d.title || ''} ${'—'} `
      + `${String(d.message || d.body || '').slice(0, 90)}`;
  }
  if (coll === 'sessions' || coll === 'calls') {
    return `${d.type || 'session'} ${'·'} `
      + `${d.status || ''} ${'·'} `
      + `${d.duration ? `${d.duration}s` : ''} `
      + `${d.cost ? `${'·'} ${rupees(d.cost)}` : ''}`;
  }
  if (coll === 'chats') {
    return String(d.lastMessage || d.text || '').slice(0, 120);
  }
  if (coll === 'kundliProfiles') {
    return `${d.name || ''}${d.dob ? ` ${'·'} ${d.dob}` : ''}`;
  }
  if (coll === 'reviews') {
    return `${d.rating ? `${d.rating}/5` : ''} ${'—'} `
      + `${String(d.text || '').slice(0, 90)}`;
  }
  if (coll === 'recharges') {
    return `${rupees(d.amount || 0)} ${'·'} `
      + `${d.status || ''} ${'·'} ${d.method || ''}`;
  }
  if (coll === 'refunds') {
    return `${rupees(d.amount || 0)} ${'·'} `
      + `${d.reason || ''}`;
  }
  if (coll === 'users' || coll === 'astrologers' || coll === 'profile') {
    return `${d.name || ''} ${'·'} `
      + `${d.email || ''} ${'·'} ${d.phone || ''}`;
  }
  // Fallback: pick the friendliest fields.
  const fields = ['text', 'amount', 'reason', 'type', 'status',
    'title', 'name', 'message'];
  const parts = [];
  for (const f of fields) {
    if (d[f] != null) parts.push(`${f}: ${String(d[f]).slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ')
    || JSON.stringify(d).slice(0, 100);
}
