import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db, adminService } from '@astro/shared';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const TEST_EMAIL = 'vickymartinsing@gmail.com';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function AdminDashboard() {
  const { loading } = useRequireAdmin();
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadData() {
    const [users, astros, txns, astroSnap, cfgSnap] = await Promise.all([
      adminService.getAllUsers(),
      adminService.getAllUsers({ role: 'astrologer' }),
      adminService.getAllTransactions({ type: 'debit' }),
      getDocs(collection(db, 'astrologers')),
      getDoc(doc(db, 'settings', 'config')),
    ]);
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

  // KPI cards - wide top strip so the operator gets the daily
  // pulse without scrolling.
  const KPIS = [
    { label: 'Total Users', value: m.users,
      sub: 'across all client accounts', href: '/admin-users' },
    { label: 'Astrologers', value: m.astros,
      sub: `${m.onlineAstros} online now`,
      href: '/admin-astrologers' },
    { label: 'Revenue Today', value: `₹${m.revToday.toFixed(0)}`,
      sub: 'paid orders + sessions', href: '/admin-transactions',
      highlight: true },
    { label: 'Total Revenue', value: `₹${m.revAll.toFixed(0)}`,
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
      ['/admin-user-reach', 'User reach',
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
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
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
