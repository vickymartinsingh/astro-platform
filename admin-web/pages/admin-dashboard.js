import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { db, adminService, rupees } from '@astro/shared';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Convert any of Firestore Timestamp / Date / number / undefined into
// milliseconds. Used by the analytics range filters.
function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v.toMillis) return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}
// Pretty 'd MMM' for the range chip.
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short' });
}
// Preset ranges. Custom is handled separately via two date inputs.
const PRESETS = [
  ['today', 'Today', 1],
  ['yest', 'Yesterday', -1],          // special: 1-day window ending today
  ['7d', 'Last 7 days', 7],
  ['30d', 'Last 30 days', 30],
  ['90d', 'Last 90 days', 90],
  ['all', 'All time', 0],
];

const TEST_EMAIL = 'vickymartinsing@gmail.com';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function AdminDashboard() {
  const { loading } = useRequireAdmin();
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allTxns, setAllTxns] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  // Persist the operator's preferred default range across reloads.
  // Saved per-browser in localStorage; reset by the "Reset to today"
  // button below the range chips. Picks 'today' on first ever load.
  const [preset, setPreset] = useState(() => {
    try {
      const v = (typeof window !== 'undefined')
        && window.localStorage.getItem('adminDashPreset');
      return v || 'today';
    } catch (_) { return 'today'; }
  });
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  async function loadData() {
    const [users, astros, txns, astroSnap, cfgSnap,
      sessSnap] = await Promise.all([
      adminService.getAllUsers(),
      adminService.getAllUsers({ role: 'astrologer' }),
      adminService.getAllTransactions({ type: 'debit' }),
      getDocs(collection(db, 'astrologers')),
      getDoc(doc(db, 'settings', 'config')),
      getDocs(collection(db, 'sessions')),
    ]);
    setAllSessions(sessSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setAllUsers(users);
    setAllTxns(txns);
    const cfg = cfgSnap.exists() ? cfgSnap.data() : {};
    const resetAt = Number(cfg.revenueResetAt || 0); // ms cutoff
    // Test account uids are excluded from real revenue.
    const testUids = new Set(users
      .filter((u) => u.email === TEST_EMAIL || u.isTest)
      .map((u) => u.uid));
    const ms = (t) => (t.createdAt?.toDate
      ? t.createdAt.toDate().getTime() : 0);
    const today = Date.now() - 864e5;

    const real = txns.filter((t) => !testUids.has(t.userId)
      && ms(t) >= resetAt);
    const revToday = r2(real
      .filter((t) => ms(t) >= today)
      .reduce((a, t) => a + Math.abs(t.amount), 0));
    const revAll = r2(real.reduce((a, t) => a + Math.abs(t.amount), 0));

    const aList = astroSnap.docs.map((d) => d.data());
    setM({
      users: users.filter((u) => u.role === 'client').length,
      astros: astros.length,
      onlineAstros: aList.filter((a) => a.status === 'online').length,
      // "Pending approval" excludes BOTH approved AND rejected
      // astrologers. Previously rejected ones kept inflating the
      // dashboard alert even though they were never going to be
      // approved.
      pendingApproval: aList.filter((a) => !a.approved && !a.rejected)
        .length,
      pendingPhotos: aList.filter((a) => a.pendingProfileImage).length,
      revToday, revAll, resetAt,
    });
  }

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, []);

  async function resetRevenue() {
    if (!window.confirm(
      'Reset the revenue counter to start fresh from NOW?\n\n'
      + 'Total Revenue will only count earnings after this moment. '
      + 'Past transactions are kept but excluded from the total.')) return;
    setBusy(true);
    try {
      await adminService.updateSettings('config',
        { revenueResetAt: Date.now() });
      await loadData();
    } finally { setBusy(false); }
  }

  if (loading || !m) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  // Online customer count: any client with status==='online'.
  // Mirrors the astrologer breakdown so the operator sees the same
  // "total + currently online" shape on both People tiles.
  const usersOnline = (allUsers || [])
    .filter((u) => (u.role || 'client') === 'client'
      && u.status === 'online').length;
  // Revenue by window. We already have all transactions in allTxns
  // (loaded once on mount); just bucket them locally so the tiles
  // re-render instantly without an extra Firestore round-trip.
  function revInLast(ms) {
    const cutoff = Date.now() - ms;
    return (allTxns || [])
      .filter((t) => toMs(t.createdAt) >= cutoff
        && toMs(t.createdAt) >= (m.resetAt || 0))
      .reduce((a, t) => a + Math.abs(Number(t.amount || 0)), 0);
  }
  const revWeek = revInLast(7 * 86400_000);
  const revMonth = revInLast(30 * 86400_000);

  // KPI cards - wide top strip so the operator gets the daily
  // pulse without scrolling. Every tile is now a Link → its source
  // list, so a click on any number jumps straight to the records
  // that produced it. Sub-line carries a quick breakdown so the
  // operator doesn't have to drill in for the most useful split.
  const KPIS = [
    { label: 'Total Users', value: m.users,
      sub: `${usersOnline} online now`,
      href: '/admin-user-reach?scope=customer' },
    { label: 'Astrologers', value: m.astros,
      sub: `${m.onlineAstros} online now`,
      href: '/admin-user-reach?scope=astrologer' },
    { label: 'Revenue Today', value: `${rupees(m.revToday)}`,
      sub: 'paid orders + sessions', href: '/admin-transactions',
      highlight: true },
    { label: 'This week', value: `${rupees(revWeek)}`,
      sub: 'last 7 days', href: '/admin-transactions' },
    { label: 'This month', value: `${rupees(revMonth)}`,
      sub: 'last 30 days', href: '/admin-transactions' },
    { label: 'Total Revenue', value: `${rupees(m.revAll)}`,
      sub: m.resetAt > 0
        ? `since ${new Date(m.resetAt).toLocaleDateString()}`
        : 'lifetime', href: '/admin-transactions' },
  ];

  // Sectioned shortcut grid. Every customer-platform feature
  // surfaces from here with a one-line subtitle, so the admin
  // never has to memorise the URL map. Group order mirrors the
  // operational priorities: People first (the live ops),
  // Monetisation, Sessions, Content/Astrology, Config, Compliance.
  const SECTIONS = [
    ['People', [
      ['/admin-users', 'Users',
        'Search, audit, profile, device + activity logs'],
      ['/admin-astrologers', 'Astrologers',
        'Onboarded, online, approved, photos, ratings'],
      ['/admin-astro-applications', 'Applications',
        'HR pipeline: review, interview, KYC, bank, approval'],
      ['/admin-hr-dashboard', 'HR dashboard',
        'Recruitment overview + KYC + bank backlog'],
      ['/admin-team', 'Team access',
        'Admin / dev / support / HR roles'],
      ['/admin-user-reach', 'People directory',
        'Search any customer / astrologer activity'],
    ]],
    ['Money', [
      ['/admin-orders', 'Kundli orders',
        'Every PDF report bought - drilldown + resend'],
      ['/admin-transactions', 'Transactions',
        'Wallet credits + debits + reconciliation'],
      ['/admin-payouts', 'Payouts',
        'Astrologer earnings sent to bank'],
      ['/admin-payments', 'Payment gateways',
        'Razorpay / Stripe / Cashfree keys + status'],
      ['/admin-coupons', 'Coupons',
        'Promo codes + first-recharge offers'],
      ['/admin-gifts', 'Gift cards',
        'Issue + redeem gift cards'],
      ['/admin-refer', 'Refer & earn',
        'Customer + astrologer referral payouts'],
      ['/admin-disputes', 'Disputes',
        'Refund requests + customer escalations'],
    ]],
    ['Sessions & Live', [
      ['/admin-sessions', 'Sessions',
        'Chat / call / video session log'],
      ['/admin-live', 'Monitor live',
        'Live streams + viewer count + admin join'],
      ['/admin-recordings', 'Recordings',
        'Call + chat archives'],
      ['/admin-hours', 'Astrologer hours',
        'Scheduling + availability blocks'],
    ]],
    ['Astrology features', [
      ['/admin-kundli-api', 'Kundli API',
        'AstroSeer provider config + price overrides'],
      ['/admin-horoscope', 'Horoscope',
        'Daily / weekly / monthly + CSV import'],
      ['/admin-remedies', 'Remedies',
        'Gemstones, rudraksha, mantras catalogue'],
      ['/admin-tarot', 'Tarot questions',
        'Customer questions queue + replies'],
      ['/admin-reports', 'Reports catalogue',
        'Per-report sections + pricing + visibility'],
    ]],
    ['Content & Notifications', [
      ['/admin-cms', 'CMS builder',
        'Pages, banners, blocks - no-code editor'],
      ['/admin-icons', 'Icons',
        'Zodiac + horoscope + section icon uploads'],
      ['/admin-announcement', 'Announcement',
        'Top-of-app banner across all clients'],
      ['/admin-notifications', 'Push notifications',
        'Broadcast or target by segment'],
      ['/admin-email', 'Email & alerts',
        'SMTP config + full delivery log'],
      ['/admin-sounds', 'Sounds & ringtones',
        'Per-event sound files'],
    ]],
    ['Config & build', [
      ['/admin-settings', 'Core settings',
        'Commission %, free mins, pricing, branding'],
      ['/admin-features', 'Feature toggles',
        'Master switches for every feature + section'],
      ['/admin-theme', 'Theme & colours',
        'Brand palette across all 3 apps'],
      ['/admin-appupdate', 'App update & splash',
        'Force-update + splash + version pinning'],
      ['/admin-builder', 'App builder',
        'No-code menu + tab + screen editor'],
      ['/admin-dev2', 'Developer 2.0',
        'Raw config + deeper builder'],
      ['/admin-ai', 'AI assistant',
        'LLM provider keys + persona + prompts'],
      ['/admin-ai-log', 'AI diagnostics',
        'Token usage + failures + reply quality'],
    ]],
    ['Compliance & health', [
      ['/admin-audit', 'Audit log',
        'Every admin action + login + route'],
      ['/admin-archive', 'Archive & restore',
        'Soft-deleted accounts + compliance access'],
      ['/admin-reset', 'Account reset',
        'Clear user data with full archive trail'],
      ['/admin-health', 'System health',
        'Relay, AstroSeer, SMTP, Firestore status'],
      ['/admin-support', 'Support inbox',
        'Customer messages + admin replies'],
      ['/admin-tickets', 'Support tickets',
        'Open / answered / closed pipeline'],
      ['/admin-reviews', 'Customer reviews',
        'Rate + reply + moderate'],
    ]],
  ];

  return (
    <Layout>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row
        sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-text">
            Admin Dashboard
          </h1>
          <p className="text-xs text-sub-text">
            Operator cockpit · today {new Date().toLocaleDateString(
              'en-GB', { day: '2-digit', month: 'short',
                year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin-test"
            className="rounded-full border border-gray-300
              px-3 py-1.5 text-sm font-semibold">
            Test view
          </Link>
          <button onClick={resetRevenue} disabled={busy}
            className="rounded-full bg-warning px-3 py-1.5 text-sm
                       font-semibold text-white">
            {busy ? 'Resetting…' : 'Reset revenue counter'}
          </button>
        </div>
      </div>

      {(m.pendingApproval > 0 || m.pendingPhotos > 0) && (
        <Link href="/admin-astrologers"
          className="surface mb-4 flex items-center justify-between
            p-3 ring-1 ring-warning/40 hover:shadow-md">
          <div>
            <div className="font-bold text-warning">Action needed</div>
            <div className="text-sm text-sub-text">
              {m.pendingApproval} astrologer(s) awaiting approval ·{' '}
              {m.pendingPhotos} photo(s) pending review
            </div>
          </div>
          <span className="rounded-full bg-warning px-2 py-0.5
            text-xs font-bold text-white">
            {m.pendingApproval + m.pendingPhotos}
          </span>
        </Link>
      )}

      {/* KPI strip - high-density daily pulse. */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3
        xl:grid-cols-6">
        {KPIS.map((k) => (
          <Link key={k.label} href={k.href}
            className={`surface p-4 transition hover:shadow-md
              ${k.highlight ? 'ring-1 ring-primary/30' : ''}`}>
            <div className="text-[10px] uppercase tracking-wider
              text-sub-text">{k.label}</div>
            <div className={`mt-1 text-2xl font-bold ${k.highlight
              ? 'text-primary' : 'text-dark-text'}`}>
              {k.value}
            </div>
            <div className="mt-1 text-[10px] text-sub-text">
              {k.sub}
            </div>
          </Link>
        ))}
      </div>

      {/* Analytics: scoped by a date range (preset or custom). Counts
          new users (created in the range), returning users (existing
          accounts that logged a session in the range), service mix
          (chat / call / video / kundli orders) and revenue. */}
      <AnalyticsPanel
        users={allUsers} txns={allTxns} sessions={allSessions}
        preset={preset} setPreset={setPreset}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd} />

      {/* Sectioned shortcut grid. Every customer-platform feature
          has a card so admin never has to memorise URLs. */}
      <div className="space-y-5">
        {SECTIONS.map(([title, items]) => (
          <section key={title}>
            <h2 className="mb-2 text-[11px] font-bold uppercase
              tracking-[0.2em] text-sub-text">{title}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2
              lg:grid-cols-3">
              {items.map(([href, name, sub]) => (
                <Link key={href} href={href}
                  className="surface group flex items-start gap-3
                    p-3 transition hover:border-primary
                    hover:shadow-md">
                  <span className="grid h-9 w-9 shrink-0
                    place-items-center rounded-full
                    bg-primary/10 text-primary
                    group-hover:bg-primary group-hover:text-white">
                    {name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-dark-text">
                      {name}
                    </div>
                    <div className="text-[11px] text-sub-text">
                      {sub}
                    </div>
                  </div>
                  <span className="self-center text-sub-text
                    group-hover:text-primary">→</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}

// Resolve the [startMs, endMs) window for the picked preset / custom
// range. Returns null,null for "all time" which short-circuits to no
// filter. "Yesterday" is the single 24-hour window ending at the
// start of today.
function resolveRange(preset, customStart, customEnd) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(),
    now.getDate()).getTime();
  if (preset === 'all') return [0, Date.now() + 1];
  if (preset === 'today') return [startOfToday, Date.now() + 1];
  if (preset === 'yest') return [startOfToday - 86400000, startOfToday];
  if (preset === 'custom') {
    const s = customStart ? new Date(customStart).getTime() : 0;
    const e = customEnd ? new Date(customEnd).getTime() + 86400000
      : Date.now() + 1;
    return [s, e];
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30
    : preset === '90d' ? 90 : 30;
  return [Date.now() - days * 86400000, Date.now() + 1];
}

function AnalyticsPanel({ users, txns, sessions, preset, setPreset,
  customStart, setCustomStart, customEnd, setCustomEnd }) {
  const stats = useMemo(() => {
    const [from, to] = resolveRange(preset, customStart, customEnd);
    const inRange = (ms) => ms >= from && ms < to;
    // "New users" = client signups in this range that are still
    // live (NOT deleted/archived). Operator report 2026-06-06:
    // "if after registering the account is deleted then that should
    // not show in the new users." Without this filter the tile
    // counts ghost accounts that the admin already wiped.
    const customers = users.filter((u) => (u.role || 'client') === 'client'
      && String(u.status || '').toLowerCase() !== 'deleted'
      && !u.deleted);
    const newUsers = customers.filter((u) =>
      inRange(toMs(u.createdAt))).length;
    const sessionsInRange = sessions.filter((s) =>
      inRange(toMs(s.createdAt) || toMs(s.startTime) || toMs(s.endTime)));
    // Existing-user activity: sessions whose user was created BEFORE
    // this window started. That tells us how much of the activity is
    // returning customers vs the new acquisitions cohort.
    const newUserIds = new Set(customers
      .filter((u) => inRange(toMs(u.createdAt)))
      .map((u) => u.uid || u.id));
    const existingUserActivity = sessionsInRange
      .filter((s) => !newUserIds.has(s.userId)).length;
    // Service mix
    const svc = { chat: 0, call: 0, video: 0 };
    sessionsInRange.forEach((s) => {
      const t = s.type === 'video' ? 'video'
        : s.type === 'call' ? 'call' : 'chat';
      svc[t] += 1;
    });
    // Revenue in range (debit transactions only).
    const rev = txns
      .filter((t) => inRange(toMs(t.createdAt)))
      .reduce((a, t) => a + Math.abs(Number(t.amount || 0)), 0);
    return {
      from, to, newUsers, existingUserActivity, sessions: sessionsInRange,
      sessionCount: sessionsInRange.length,
      svc, rev: Math.round(rev * 100) / 100,
    };
  }, [users, txns, sessions, preset, customStart, customEnd]);

  const rangeLabel = preset === 'custom' && customStart && customEnd
    ? `${fmtDate(stats.from)} – ${fmtDate(stats.to - 1)}`
    : preset === 'all' ? 'All time'
    : (PRESETS.find(([k]) => k === preset) || [])[1] || '';

  return (
    <div className="surface mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Activity
        </h2>
        <span className="rounded-full bg-bg-light px-2 py-0.5
          text-[11px] font-bold text-sub-text">{rangeLabel}</span>
        <div className="ml-auto inline-flex flex-wrap items-center
          gap-1 rounded-full bg-bg-light p-1">
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)}
              className={`rounded-full px-2.5 py-1 text-[11px]
                font-bold ${preset === k
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-sub-text'}`}>
              {l}
            </button>
          ))}
          <button onClick={() => setPreset('custom')}
            className={`rounded-full px-2.5 py-1 text-[11px]
              font-bold ${preset === 'custom'
                ? 'bg-white text-primary shadow-sm' : 'text-sub-text'}`}>
            Custom
          </button>
        </div>
      </div>
      {/* Set-as-default / Reset row. Saving stores the current range
          in localStorage; next time the operator opens /admin-
          dashboard the page lands on that range without a click.
          Reset blows the override away and returns to "today". */}
      <div className="mb-3 flex flex-wrap items-center gap-2
        text-[11px]">
        <button onClick={() => {
          try { window.localStorage.setItem('adminDashPreset',
            preset); } catch (_) {}
          flash(`Set "${PRESETS.find(([k]) => k === preset)?.[1]
            || preset}" as the default range.`, 'success');
        }} className="rounded-full bg-primary px-2.5 py-1 text-[11px]
          font-bold text-white">
          Set as default
        </button>
        <button onClick={() => {
          try { window.localStorage.removeItem('adminDashPreset');
          } catch (_) {}
          setPreset('today');
          flash('Default range reset to Today.', 'success');
        }} className="rounded-full bg-bg-light px-2.5 py-1 text-[11px]
          font-bold text-sub-text">
          Reset default
        </button>
      </div>
      {preset === 'custom' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <span className="text-sub-text">From</span>
            <input type="date" value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-card border border-gray-200
                px-2 py-1 text-xs" />
          </label>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-sub-text">To</span>
            <input type="date" value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-card border border-gray-200
                px-2 py-1 text-xs" />
          </label>
        </div>
      )}
      {/* Tiles are <Link>s so a click jumps straight to the source
          records (users / sessions / transactions) - "clickable
          dashboard to the source" from the issues doc. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="New users" value={stats.newUsers}
          sub="created in range"
          href={`/admin-user-reach?scope=customer&createdFrom=${
            stats.from}&createdTo=${stats.to}`} />
        <Tile label="Existing user activity"
          value={stats.existingUserActivity}
          sub="sessions by older accounts"
          href="/admin-sessions" />
        <Tile label="Sessions" value={stats.sessionCount}
          sub="total in range"
          href="/admin-sessions" />
        <Tile label="Revenue" value={`${rupees(stats.rev)}`}
          sub="paid sessions + orders" highlight
          href="/admin-transactions" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Tile label="Chat" value={stats.svc.chat}
          sub="conversations" href="/admin-sessions?type=chat" />
        <Tile label="Voice" value={stats.svc.call} sub="calls"
          href="/admin-sessions?type=call" />
        <Tile label="Video" value={stats.svc.video} sub="calls"
          href="/admin-sessions?type=video" />
      </div>
    </div>
  );
}
function Tile({ label, value, sub, highlight, href }) {
  const cls = `rounded-card border border-gray-200 p-3 transition
    ${highlight ? 'ring-1 ring-primary/30' : ''}
    ${href ? 'hover:shadow-md hover:border-primary cursor-pointer'
      : ''}`;
  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-sub-text">
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-bold ${highlight
        ? 'text-primary' : 'text-dark-text'}`}>
        {value}
      </div>
      <div className="text-[10px] text-sub-text">{sub}</div>
    </>
  );
  if (href) {
    return <Link href={href} className={cls}>{inner}</Link>;
  }
  return <div className={cls}>{inner}</div>;
}
