import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  adminService, astrologerService, authService, rupees,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin, useAuth } from '../lib/useAuth';
import { flash } from '../lib/flash';

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
  const { user: adminUser } = useAuth();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [users, setUsers] = useState(null);
  const [astros, setAstros] = useState(null);
  const [q, setQ] = useState('');
  // scope: all | customer | astrologer | admin | support | hr
  // Initialised from ?scope= so the dashboard tiles deep-link
  // straight into a filtered view.
  const [scope, setScope] = useState('all');
  const [page, setPage] = useState(1);
  // Inline-action state. The row buttons (Edit / Gift / Block /
  // Wallet / Delete) open this single shared modal at the page
  // level instead of navigating into the profile - the operator
  // can act on dozens of accounts back-to-back without losing the
  // list scroll position.
  const [actionFor, setActionFor] = useState(null); // {kind, user}
  function openAction(kind, user) { setActionFor({ kind, user }); }
  function closeAction() { setActionFor(null); }

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
  // from the same source of truth. Tombstoned users (status='deleted',
  // set by adminService.deleteUser) are excluded so deleted
  // accounts never resurface here either.
  const buckets = useMemo(() => {
    const live = (users || [])
      .filter((u) => String(u.status || '').toLowerCase() !== 'deleted');
    return {
      customer: live.filter((u) => roleOf(u) === 'client'),
      astrologer: astros || [],
      admin: live.filter((u) => roleOf(u) === 'admin'),
      support: live.filter((u) => roleOf(u) === 'support'),
      hr: live.filter((u) => roleOf(u) === 'hr'),
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
          <button onClick={() => setMergeOpen(true)}
            className="rounded-full bg-primary px-3 py-2 text-xs
              font-bold text-white">
            Merge accounts
          </button>
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
                ? 'astrologer' : 'customer', u.uid || u.id)}
              onAction={(k) => openAction(k, u)} />
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

      {mergeOpen && (
        <MergeAccountsModal
          allCustomers={buckets.customer}
          adminEmail={adminUser?.email}
          onClose={() => setMergeOpen(false)}
          onDone={async () => {
            setMergeOpen(false);
            // Refresh the list so the secondary (now tombstoned)
            // disappears.
            adminService.getAllUsers().then((list) =>
              setUsers(list || [])).catch(() => {});
          }} />
      )}

      {actionFor && (
        <InlineActionModal
          action={actionFor.kind}
          user={actionFor.user}
          onClose={closeAction}
          onDone={() => {
            // Refresh source-of-truth so wallet / block / delete
            // changes show on the row.
            adminService.getAllUsers().then((list) =>
              setUsers(list || [])).catch(() => {});
          }} />
      )}
    </Layout>
  );
}

// One row of the People list. New compact layout (no pill explosion):
//   left  : 32px avatar with online dot (if applicable)
//   mid   : name + role chip + code chip on row 1; email | phone on
//           row 2 with subtle icons for verified state
//   right : Wallet ₹/Rating, then Last seen, then chevron
function Row({ u, kind, onClick, onAction }) {
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
  // Each action button calls stopPropagation so it never bubbles to
  // the row navigation.
  function fire(e, kind) {
    e.preventDefault(); e.stopPropagation();
    if (onAction) onAction(kind);
  }
  return (
    <div onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 px-4
        py-3 text-left transition hover:bg-bg-light/60">
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

      {/* Inline action strip - lets the admin act without leaving
          the list. Hidden on very small screens where the row is
          already tight; the row still opens the profile on tap so
          mobile keeps full reach. */}
      <div className="hidden shrink-0 items-center gap-1 md:flex"
        onClick={(e) => e.stopPropagation()}>
        <ActBtn onClick={(e) => fire(e, 'edit')}
          tone="ghost">Edit</ActBtn>
        <ActBtn onClick={(e) => fire(e, 'gift')}
          tone="amber">Gift {'₹'}</ActBtn>
        <ActBtn onClick={(e) => fire(e, 'block')}
          tone={blocked ? 'warn-on' : 'warn'}>
          {blocked ? 'Unblock' : 'Block'}
        </ActBtn>
        <ActBtn onClick={(e) => fire(e, 'wallet')}
          tone="primary">Wallet {'±'}</ActBtn>
        <ActBtn onClick={(e) => fire(e, 'delete')}
          tone="danger">Delete</ActBtn>
      </div>

      <span className="shrink-0 text-base text-sub-text">{'›'}</span>
    </div>
  );
}

function ActBtn({ children, onClick, tone }) {
  const cls = tone === 'danger'
    ? 'text-danger hover:bg-danger/10'
    : tone === 'warn'
      ? 'text-amber-700 hover:bg-amber-100'
      : tone === 'warn-on'
        ? 'text-emerald-700 hover:bg-emerald-100'
        : tone === 'primary'
          ? 'text-primary hover:bg-primary/10'
          : tone === 'amber'
            ? 'text-amber-700 hover:bg-amber-100'
            : 'text-sub-text hover:bg-bg-light';
  return (
    <button onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold
        transition ${cls}`}>
      {children}
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

// Account merge modal. Three-step flow:
//   1) Picker - admin types or selects PRIMARY + SECONDARY accounts
//      (from the customer bucket). The same uid cannot fill both
//      slots.
//   2) Field comparison - side-by-side rows for email / phone / dob
//      / wallet etc. Each field has two radios (primary's value vs
//      secondary's value); admin chooses the survivor per field.
//      Equal-values rows just show "same" and don't ask.
//   3) Confirm - admin types their own password (Firebase Auth
//      re-auth via authService.loginUser) and clicks the final
//      red Merge button. Wallet moves, sessions reassign, kundli
//      transfers, orders copy, secondary tombstones.
const MERGE_FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['dob', 'Date of birth'],
  ['tob', 'Time of birth'],
  ['placeOfBirth', 'Place of birth'],
  ['gender', 'Gender'],
];

function asDisplay(v) {
  if (v == null || v === '') return '–';
  if (typeof v === 'object') {
    return v.label || v.place || v.city || JSON.stringify(v);
  }
  return String(v);
}

function MergeAccountsModal({ allCustomers, adminEmail, onClose,
  onDone }) {
  const [primary, setPrimary] = useState(null);
  const [secondary, setSecondary] = useState(null);
  const [picks, setPicks] = useState({});
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1); // 1 = pick | 2 = compare | 3 = confirm

  const candidates = (allCustomers || []).filter((u) =>
    String(u.status || '').toLowerCase() !== 'deleted');

  function pickField(field, winner) {
    setPicks((p) => ({ ...p, [field]: winner }));
  }

  async function run() {
    if (!primary || !secondary) {
      flash('Pick both accounts first.', 'error'); return;
    }
    if ((primary.uid || primary.id) === (secondary.uid || secondary.id)) {
      flash('Primary and secondary cannot be the same account.',
        'error'); return;
    }
    if (!pwd) {
      flash('Type your admin password to confirm.', 'error'); return;
    }
    setBusy(true);
    try {
      // Re-auth the signed-in admin so an unattended browser cannot
      // merge accounts.
      await authService.loginUser(adminEmail, pwd);
      const out = await adminService.mergeAccounts(
        primary.uid || primary.id,
        secondary.uid || secondary.id,
        picks);
      flash(`Merge complete. Wallet ${rupees(out.walletMoved || 0)} `
        + `moved · ${out.movedSessions} session(s) · `
        + `${out.movedTxns} txn(s) · ${out.movedKundli} kundli `
        + `· ${out.movedOrders} order(s) transferred.`,
        'success');
      onDone && onDone();
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/wrong-password|invalid|user-not-found/i.test(msg)) {
        flash('Admin password incorrect. Cancelled.', 'error');
      } else {
        flash(`Merge failed: ${msg}`, 'error');
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center
      justify-center bg-black/55 px-3 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col
          overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-primary p-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase
                tracking-widest opacity-80">
                Step {step} of 3
              </div>
              <div className="text-lg font-bold">
                Merge two accounts
              </div>
            </div>
            <button onClick={onClose}
              className="rounded-full bg-white/20 px-3 py-1
                text-sm font-bold">
              Cancel
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[12px] text-sub-text">
                Pick the PRIMARY account (the one that survives) and
                the SECONDARY (the one being absorbed into the
                primary). Wallet balance, sessions, kundli profiles
                and orders move to the primary. The secondary is
                soft-deleted and the user is signed out on next
                attempt to sign in.
              </p>
              <AccountPicker label="Primary (survivor)"
                value={primary} onChange={setPrimary}
                others={[secondary]} candidates={candidates} />
              <AccountPicker label="Secondary (absorbed + closed)"
                value={secondary} onChange={setSecondary}
                others={[primary]} candidates={candidates} />
              <div className="flex justify-end">
                <button onClick={() => setStep(2)}
                  disabled={!primary || !secondary
                    || (primary.uid || primary.id)
                      === (secondary.uid || secondary.id)}
                  className="rounded-full bg-primary px-5 py-2
                    text-sm font-bold text-white
                    disabled:opacity-50">
                  Compare fields →
                </button>
              </div>
            </div>
          )}

          {step === 2 && primary && secondary && (
            <div className="space-y-3">
              <p className="text-[12px] text-sub-text">
                For each field below, pick which account&apos;s value
                the merged record should keep. Defaults to the
                primary&apos;s value.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[10.5px]
                    uppercase tracking-wider text-sub-text">
                    <tr>
                      <th className="p-2">Field</th>
                      <th className="p-2">Primary</th>
                      <th className="p-2">Secondary</th>
                      <th className="p-2">Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MERGE_FIELDS.map(([f, lbl]) => {
                      const pv = asDisplay(primary[f]);
                      const sv = asDisplay(secondary[f]);
                      const same = pv === sv;
                      const winner = picks[f] || 'primary';
                      return (
                        <tr key={f} className="border-t
                          border-gray-200">
                          <td className="p-2 font-semibold">{lbl}</td>
                          <td className="p-2 text-xs">{pv}</td>
                          <td className="p-2 text-xs">{sv}</td>
                          <td className="p-2">
                            {same ? (
                              <span className="rounded-full
                                bg-bg-light px-2 py-0.5 text-[10px]
                                font-bold text-sub-text">same</span>
                            ) : (
                              <div className="inline-flex
                                rounded-full bg-bg-light p-0.5
                                text-[10px] font-bold">
                                <button onClick={() => pickField(f,
                                  'primary')}
                                  className={`rounded-full px-2
                                    py-0.5 ${winner === 'primary'
                                      ? 'bg-white text-primary'
                                      : 'text-sub-text'}`}>
                                  Primary
                                </button>
                                <button onClick={() => pickField(f,
                                  'secondary')}
                                  className={`rounded-full px-2
                                    py-0.5 ${winner === 'secondary'
                                      ? 'bg-white text-primary'
                                      : 'text-sub-text'}`}>
                                  Secondary
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-gray-200">
                      <td className="p-2 font-semibold">Wallet</td>
                      <td className="p-2 text-xs">
                        {rupees(primary.wallet || 0)}
                      </td>
                      <td className="p-2 text-xs">
                        {rupees(secondary.wallet || 0)}
                      </td>
                      <td className="p-2">
                        <span className="rounded-full
                          bg-emerald-100 px-2 py-0.5 text-[10px]
                          font-bold text-emerald-700">
                          Sum: {rupees(
                            (Number(primary.wallet || 0)
                              + Number(secondary.wallet || 0)))}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(1)}
                  className="rounded-full bg-bg-light px-4 py-2
                    text-sm font-semibold">
                  ← Back
                </button>
                <button onClick={() => setStep(3)}
                  className="rounded-full bg-primary px-5 py-2
                    text-sm font-bold text-white">
                  Confirm merge →
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded-card bg-amber-50 p-3
                text-[12px] text-amber-900">
                <b>Final review.</b> This is permanent. After
                clicking the red button: the secondary account is
                closed, its wallet (
                {rupees(secondary?.wallet || 0)}) moves to the
                primary, every session / kundli / order is
                reassigned, and the secondary&apos;s next sign-in
                attempt is auto-rejected.
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-sub-text">
                  Type your admin password ({adminEmail || 'admin'})
                </span>
                <input type="password" className="input mt-1 w-full"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="Password" />
              </label>
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} disabled={busy}
                  className="rounded-full bg-bg-light px-4 py-2
                    text-sm font-semibold">
                  ← Back
                </button>
                <button onClick={run} disabled={busy || !pwd}
                  className="rounded-full bg-danger px-5 py-2
                    text-sm font-bold text-white
                    disabled:opacity-50">
                  {busy ? 'Merging...' : 'Merge accounts now'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountPicker({ label, value, onChange, others = [],
  candidates }) {
  const [q, setQ] = useState('');
  const blockedUids = new Set(others.filter(Boolean)
    .map((o) => o.uid || o.id));
  const filtered = q.trim()
    ? candidates.filter((c) => {
      if (blockedUids.has(c.uid || c.id)) return false;
      const t = q.trim().toLowerCase();
      return [c.name, c.email, c.phone, c.userCode]
        .filter(Boolean).map((x) => String(x).toLowerCase())
        .some((x) => x.includes(t));
    }).slice(0, 8)
    : [];
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider
        text-sub-text">{label}</div>
      {value ? (
        <div className="mt-1 flex items-center justify-between
          rounded-card border border-primary/30 bg-primary/5 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {value.name || '(no name)'}
            </div>
            <div className="truncate text-[11px] text-sub-text">
              {value.email || ''}
              {value.phone ? ` · ${value.phone}` : ''}
              {' · '}{rupees(value.wallet || 0)}
            </div>
          </div>
          <button onClick={() => onChange(null)}
            className="rounded-full bg-bg-light px-2.5 py-1
              text-[11px] font-bold text-sub-text">
            Change
          </button>
        </div>
      ) : (
        <>
          <input className="input mt-1 w-full" value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, phone, code..." />
          {filtered.length > 0 && (
            <div className="mt-1 max-h-44 overflow-y-auto
              rounded-card border border-gray-200">
              {filtered.map((c) => (
                <button key={c.uid || c.id}
                  onClick={() => { onChange(c); setQ(''); }}
                  className="flex w-full items-center justify-between
                    gap-2 border-b border-gray-100 px-3 py-2
                    text-left text-sm last:border-b-0
                    hover:bg-bg-light">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {c.name || '(no name)'}
                    </div>
                    <div className="truncate text-[11px]
                      text-sub-text">
                      {c.email}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-sub-text">
                    {rupees(c.wallet || 0)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Inline action modal --------------------------------------------
// One modal, one set of handlers, dispatched by `action`. Mirrors the
// per-profile UserActionBar but lives on the list so the admin can act
// without losing the scroll position. Auto-closes 1.2s after success
// to match the fix made to UserActionBar.
function InlineActionModal({ action, user, onClose, onDone }) {
  const uid = user.uid || user.id;
  const blocked = user.status === 'blocked' || user.isBlocked === true;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState('credit'); // wallet only
  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!success) return undefined;
    const t = setTimeout(() => {
      try { onDone && onDone(); } catch (_) {}
      onClose && onClose();
    }, 1200);
    return () => clearTimeout(t);
  }, [success, onClose, onDone]);

  async function run(fn, okMsg) {
    setBusy(true); setErr(''); setSuccess('');
    try { const out = await fn(); setSuccess(okMsg); return out; }
    catch (e) { setErr(String((e && e.message) || e)); }
    finally { setBusy(false); }
  }

  async function doEdit() {
    await run(async () => {
      const { userService } = await import('@astro/shared');
      return userService.updateUser(uid, { name, email, phone });
    }, 'Profile updated.');
  }
  async function doGift() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return; }
    await run(async () => {
      const r = await adminService.createGiftCard(amt);
      setCode((r && (r.code || r.giftCode)) || '');
      return r;
    }, `Gift card ${'₹'}${amt} created.`);
  }
  async function doBlock() {
    await run(() => adminService.blockUser(uid, !blocked),
      blocked ? 'Account unblocked.' : 'Account blocked.');
  }
  async function doWallet() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return; }
    const delta = direction === 'debit' ? -amt : amt;
    await run(() => adminService.adjustWallet(uid, delta,
      note || (direction === 'debit' ? 'admin_debit' : 'admin_topup')),
      `${direction === 'debit' ? '-' : '+'} ${'₹'}${amt} ${
        direction === 'debit' ? 'debited' : 'credited'}.`);
  }
  async function doDelete() {
    await run(() => adminService.deleteUser(uid),
      'Account soft-deleted. Recoverable from /admin-archive.');
  }

  const titles = {
    edit: 'Edit profile',
    gift: 'Issue gift card',
    block: blocked ? 'Unblock account' : 'Block account',
    wallet: 'Wallet adjustment',
    delete: 'Delete account',
  };
  const ctas = {
    edit: 'Save', gift: 'Create gift card',
    block: blocked ? 'Unblock' : 'Block',
    wallet: direction === 'debit' ? 'Debit wallet' : 'Credit wallet',
    delete: 'Delete account',
  };
  const tones = {
    edit: 'primary', gift: 'primary',
    block: blocked ? 'primary' : 'warn',
    wallet: 'primary', delete: 'danger',
  };
  const submit = {
    edit: doEdit, gift: doGift, block: doBlock,
    wallet: doWallet, delete: doDelete,
  }[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full
            bg-primary text-sm font-bold text-white">
            {(user.name || user.email || '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">
              {user.name || '(no name)'}
            </div>
            <div className="truncate text-[11px] text-sub-text">
              {user.email || user.phone || uid}
            </div>
          </div>
        </div>
        <h3 className="mt-3 text-lg font-bold">{titles[action]}</h3>

        {!success && action === 'edit' && (
          <div className="mt-3 space-y-2">
            <Lbl text="Name"><input className="input mt-1" value={name}
              onChange={(e) => setName(e.target.value)} /></Lbl>
            <Lbl text="Email"><input className="input mt-1" value={email}
              onChange={(e) => setEmail(e.target.value)} /></Lbl>
            <Lbl text="Phone"><input className="input mt-1" value={phone}
              onChange={(e) => setPhone(e.target.value)} /></Lbl>
          </div>
        )}
        {!success && action === 'gift' && (
          <div className="mt-3 space-y-2">
            <Lbl text="Amount (₹)">
              <input className="input mt-1" type="number" min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </Lbl>
            <p className="text-[11px] text-sub-text">
              Creates a fresh code. Email + push delivery follow the
              welcome-bonus template if enabled in settings.
            </p>
          </div>
        )}
        {!success && action === 'block' && (
          <p className="mt-3 text-xs text-sub-text">
            {blocked
              ? 'Customer will be able to sign in and consult again.'
              : 'Soft-block: sign-in still works but consultations '
                + 'are refused. Reversible from this list.'}
          </p>
        )}
        {!success && action === 'wallet' && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <button onClick={() => setDirection('credit')}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs
                  font-bold ${direction === 'credit'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-bg-light text-sub-text'}`}>
                Credit (+)
              </button>
              <button onClick={() => setDirection('debit')}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs
                  font-bold ${direction === 'debit'
                    ? 'bg-danger text-white'
                    : 'bg-bg-light text-sub-text'}`}>
                Debit (-)
              </button>
            </div>
            <Lbl text="Amount (₹)">
              <input className="input mt-1" type="number" min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </Lbl>
            <Lbl text="Note (reason)">
              <input className="input mt-1" value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Refund for failed kundli, manual top-up..." />
            </Lbl>
          </div>
        )}
        {!success && action === 'delete' && (
          <p className="mt-3 text-xs text-sub-text">
            Soft-delete: account is archived and recoverable from
            /admin-archive. Their kundli + consultation history is
            preserved for compliance.
          </p>
        )}

        {err && (
          <div className="mt-3 rounded-card bg-danger/10 p-2 text-xs
            font-semibold text-danger">{err}</div>
        )}
        {success && (
          <div className="mt-3 rounded-card bg-emerald-50 p-3 text-sm
            font-semibold text-emerald-700 flex items-center gap-2">
            <span aria-hidden>{'✓'}</span>{success}
          </div>
        )}
        {!success && code && (
          <div className="mt-2 rounded-card border border-emerald-300
            bg-emerald-50 p-2 text-center font-mono text-sm
            text-emerald-700">{code}</div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="rounded-full bg-bg-light px-4 py-2 text-sm
              font-semibold">
            {success ? 'Done' : 'Close'}
          </button>
          {!success && (
            <button onClick={submit} disabled={busy}
              className={`rounded-full px-4 py-2 text-sm font-bold
                ${tones[action] === 'danger'
                  ? 'bg-danger text-white'
                  : tones[action] === 'warn'
                    ? 'bg-warning text-white'
                    : 'bg-primary text-white'}`}>
              {busy ? 'Working...' : ctas[action]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Lbl({ text, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-sub-text">{text}</span>
      {children}
    </label>
  );
}
