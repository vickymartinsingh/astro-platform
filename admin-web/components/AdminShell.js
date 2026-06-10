import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authService, brandingService } from '@astro/shared';
import { usePortal } from '../lib/portal';
import PullToRefresh from './PullToRefresh';
import Flash from './Flash';

// New admin shell: persistent left sidebar + sticky top bar.
//
// The old TopNav drove the whole admin UI off horizontal dropdowns,
// which felt cramped on wider screens and slow on small ones. This
// shell mirrors the Linear / Vercel / Notion admin pattern: a quiet
// dark sidebar on the left holds every page (grouped + searchable),
// a sticky top bar carries the global controls (search, portal,
// theme, account). Breadcrumb + page chrome live in the top bar so
// individual pages don't repeat them.
//
// PORTAL-AWARE: the sidebar groups swap when the operator flips
// between Admin / Developer / Support / HR portals - same shell,
// different items. The portal switcher in the top bar still does
// the same thing it always did.
//
// NOTHING IS REMOVED: every page that lived in TopNav still lives
// here, just better organised. Cmd+K opens the global jumper.

// ============================================================
// SIDEBAR GROUPS - each portal has its own.
// Each item: [href, label, hint, icon?]. Icons are tiny single-
// glyph spans so the sidebar renders identically without an icon
// library.
// ============================================================
const ICON = {
  dashboard: '◐', analytics: '⌬', users: '◔', astrologers: '☆',
  applications: '✎', reviews: '★', tickets: '◈', tarot: '⌥',
  support: '◌', team: '◍', sessions: '⌗', live: '○',
  recordings: '◫', hours: '◷', orders: '◇', txns: '⇄',
  payouts: '⇧', payments: '⌖', coupons: '◌', gifts: '◫',
  refer: '⇋', disputes: '◭', cms: '☵', icons: '◍',
  announcement: '⊜', notifications: '◔', kundli: 'ॐ',
  horoscope: '☉', remedies: '◈', reports: '⊟',
  builder: '⊞', dev: '⌬', settings: '⚙', features: '☷',
  free: '⊘', appupdate: '⤒', testers: '◐', sounds: '♪',
  theme: '◑', ai: '◬', ailog: '◗', email: '✉',
  reset: '⟲', archive: '⛁', resetTxns: '⟳', content: '✎',
  audit: '⌖', health: '◉', reach: '⌕', users2: '◔',
  engagement: '★',
  membership: '👑',
};

const ADMIN_GROUPS = [
  ['Overview', [
    ['/admin-dashboard', 'Dashboard', 'KPI cockpit', 'dashboard'],
    ['/admin-analytics', 'Analytics', 'Engagement + revenue charts', 'analytics'],
    ['/admin-reports', 'Reports catalogue', 'PDF report tiers + pricing', 'reports'],
    ['/admin-audit', 'Audit log', 'Every admin action', 'audit'],
    ['/admin-health', 'System health', 'Relay + Firestore + SMTP', 'health'],
  ]],
  ['People', [
    ['/admin-user-reach', 'People directory',
      'Everyone in one place', 'reach'],
    ['/admin-users', 'Customers', 'All client accounts', 'users'],
    ['/admin-astrologers', 'Astrologers', 'Onboarded + online', 'astrologers'],
    ['/admin-astro-applications', 'Applications', 'HR pipeline', 'applications'],
    ['/admin-reviews', 'Customer reviews', 'Rate + moderate', 'reviews'],
    ['/admin-tickets', 'Support tickets', 'Open / answered', 'tickets'],
    ['/admin-tarot', 'Tarot questions', 'Customer queue', 'tarot'],
    ['/admin-support', 'Support inbox', 'Live customer messages', 'support'],
    ['/admin-team', 'Team access', 'Admin / dev / support roles', 'team'],
  ]],
  ['Sessions & live', [
    ['/admin-sessions', 'Sessions', 'Chat / call / video log', 'sessions'],
    ['/admin-live', 'Monitor live', 'Live streams + admin join', 'live'],
    ['/admin-live-bots', 'Live audience bots',
      'Dummy viewers + questions', 'live'],
    ['/admin-recordings', 'Recordings', 'Call + chat archives', 'recordings'],
    ['/admin-hours', 'Astrologer hours', 'Availability blocks', 'hours'],
  ]],
  ['Money', [
    ['/admin-orders', 'Kundli orders', 'Per-PDF order log', 'orders'],
    ['/admin-transactions', 'Transactions', 'Wallet ledger', 'txns'],
    ['/admin-reset-transactions', 'Reset transactions',
      'User or global counter', 'resetTxns'],
    ['/admin-payouts', 'Payouts', 'Astrologer earnings', 'payouts'],
    ['/admin-payments', 'Payment gateways', 'Razorpay / Cashfree', 'payments'],
    ['/admin-coupons', 'Coupons', 'Promo codes', 'coupons'],
    ['/admin-gifts', 'Gift cards', 'Issue + redeem', 'gifts'],
    ['/admin-refer', 'Refer & earn', 'Referral payouts', 'refer'],
    ['/admin-welcome-bonus', 'Welcome bonus',
      'Signup bonus + email + push', 'welcomeBonus'],
    ['/admin-disputes', 'Disputes', 'Refund requests', 'disputes'],
  ]],
  ['Content', [
    ['/admin-home-hero', 'Home hero banner',
      '"Stars have answers" card on customer home', 'cms'],
    ['/admin-daily-quotes', 'Daily quote banner',
      '"Hey, Cosmic Explorer" + rotating quote of the day', 'cms'],
    ['/admin-engagement', 'Engagement',
      'Tiles, quizzes, points economy', 'engagement'],
    ['/admin-membership', 'Membership',
      'Tiers, benefits, FAQ', 'membership'],
    ['/admin-content-text', 'Text & copy editor',
      'Edit every visible string', 'content'],
    ['/admin-cms', 'CMS builder', 'Pages + banners', 'cms'],
    ['/admin-icons', 'Icons', 'Zodiac + section icons', 'icons'],
    ['/admin-announcement', 'Announcement', 'App-wide banner', 'announcement'],
    ['/admin-notifications', 'Push notifications', 'Broadcast', 'notifications'],
  ]],
  ['Astrology', [
    ['/admin-kundli-api', 'Kundli API', 'AstroSeer config', 'kundli'],
    ['/admin-report-activity', 'Report activity', 'PDF generation log', 'reports'],
    ['/admin-horoscope', 'Horoscope CSV', 'Daily / weekly', 'horoscope'],
    ['/admin-remedies', 'Remedies', 'Gemstones, rudraksha', 'remedies'],
  ]],
  ['Config & build', [
    ['/admin-builder', 'App builder', 'No-code menus', 'builder'],
    ['/admin-dev2', 'Developer 2.0', 'Raw config', 'dev'],
    ['/admin-developer', 'Developer mode', 'Diagnostic console', 'dev'],
    ['/admin-settings', 'Core settings', 'Commission, pricing', 'settings'],
    ['/admin-features', 'Feature toggles', 'Master switches', 'features'],
    ['/admin-free', 'Free sessions', 'First-session offer', 'free'],
    ['/admin-app-update', 'In-app update popup',
      'Play-Store-style modal config per app', 'appupdate'],
    ['/admin-appupdate', 'App update & splash (legacy)',
      'Old OTA bundle release tool', 'appupdate'],
    ['/admin-profile-nudge', 'Profile nudge',
      'Ask customers to complete missing profile fields',
      'appupdate'],
    ['/admin-testers', 'Invite testers', 'Play closed track', 'testers'],
    ['/admin-sounds', 'Sounds & ringtones', 'Per-event sound', 'sounds'],
    ['/admin-theme', 'Theme & colours', 'Brand palette', 'theme'],
    ['/admin-ai', 'AI assistant', 'LLM keys', 'ai'],
    ['/admin-ai-log', 'AI diagnostics', 'Token usage', 'ailog'],
    ['/admin-email', 'Email & alerts', 'SMTP + delivery log', 'email'],
    ['/admin-country-codes', 'Country codes',
      'Phone dial codes catalogue', 'countryCodes'],
  ]],
  ['Compliance', [
    ['/admin-reset', 'Account reset', 'Clear user data', 'reset'],
    ['/admin-archive', 'Archive & restore',
      'Soft-deleted accounts', 'archive'],
  ]],
];

const DEV_GROUPS = [
  ['Build', [
    ['/admin-builder', 'App builder', 'Menus + nav', 'builder'],
    ['/admin-theme', 'Theme & colours', 'Brand palette', 'theme'],
    ['/admin-features', 'Feature toggles', 'Master switches', 'features'],
    ['/admin-free', 'Free sessions', 'First-session', 'free'],
    ['/admin-appupdate', 'App update', 'Force-update', 'appupdate'],
    ['/admin-sounds', 'Sounds & ringtones', '', 'sounds'],
    ['/admin-refer', 'Refer & earn', '', 'refer'],
  ]],
  ['Content', [
    ['/admin-content-text', 'Text & copy editor', 'Every string', 'content'],
    ['/admin-engagement', 'Engagement', 'Tiles + points', 'engagement'],
    ['/admin-cms', 'CMS / pages', '', 'cms'],
    ['/admin-icons', 'Icons', '', 'icons'],
    ['/admin-horoscope', 'Horoscope CSV', '', 'horoscope'],
    ['/admin-reviews', 'Customer reviews', '', 'reviews'],
    ['/admin-tickets', 'Support tickets', '', 'tickets'],
    ['/admin-tarot', 'Tarot questions', '', 'tarot'],
    ['/admin-announcement', 'Announcement', '', 'announcement'],
    ['/admin-notifications', 'Push notifications', '', 'notifications'],
  ]],
  ['Integrations', [
    ['/admin-kundli-api', 'Kundli API', 'AstroSeer', 'kundli'],
    ['/admin-payments', 'Payment gateways', '', 'payments'],
    ['/admin-ai', 'AI assistant', '', 'ai'],
    ['/admin-settings', 'Core settings', '', 'settings'],
  ]],
  ['Advanced', [
    ['/admin-dev2', 'Developer 2.0', 'Raw config builder', 'dev'],
    ['/admin-developer', 'Raw config editor', '', 'dev'],
    ['/admin-email', 'Email & alerts', '', 'email'],
    ['/admin-audit', 'Audit log', '', 'audit'],
    ['/admin-health', 'System health', '', 'health'],
    ['/admin-reset', 'Account reset', '', 'reset'],
    ['/admin-archive', 'Archive & restore', '', 'archive'],
  ]],
];

const HR_GROUPS = [
  ['Recruitment', [
    ['/admin-hr-dashboard', 'HR dashboard', 'Recruitment overview', 'dashboard'],
    ['/admin-astro-applications', 'Applications',
      'Review + interview', 'applications'],
    ['/admin-user-reach', 'People directory',
      'Search any account', 'reach'],
  ]],
  ['Onboarding', [
    ['/admin-astro-applications?stage=kyc', 'KYC pending',
      '', 'applications'],
    ['/admin-astro-applications?stage=bank', 'Bank pending',
      '', 'applications'],
    ['/admin-astro-applications?stage=declaration', 'Declaration pending',
      '', 'applications'],
    ['/admin-astro-applications?stage=approved', 'Approved', '',
      'applications'],
  ]],
  ['People', [
    ['/admin-astrologers', 'Astrologers', '', 'astrologers'],
    ['/admin-users', 'Customers', '', 'users'],
    ['/admin-team', 'Team access', '', 'team'],
  ]],
  ['Orders', [
    ['/admin-orders', 'Kundli orders', '', 'orders'],
    ['/admin-transactions', 'Transactions', '', 'txns'],
  ]],
  ['Compliance', [
    ['/admin-audit', 'Audit log', '', 'audit'],
    ['/admin-archive', 'Archive & restore', '', 'archive'],
    ['/admin-email', 'Email & alerts', '', 'email'],
  ]],
];

const SUPPORT_GROUPS = [
  ['Support', [
    ['/admin-support', 'Support inbox', '', 'support'],
    ['/admin-tickets', 'Support tickets', '', 'tickets'],
    ['/admin-reviews', 'Customer reviews', '', 'reviews'],
    ['/admin-disputes', 'Disputes', '', 'disputes'],
  ]],
  ['Lookup', [
    ['/admin-user-reach', 'People directory', '', 'reach'],
    ['/admin-users', 'Customers', '', 'users'],
    ['/admin-astrologers', 'Astrologers', '', 'astrologers'],
    ['/admin-orders', 'Kundli orders', '', 'orders'],
    ['/admin-transactions', 'Transactions', '', 'txns'],
    ['/admin-sessions', 'Sessions', '', 'sessions'],
    ['/admin-recordings', 'Recordings', '', 'recordings'],
  ]],
  ['Live', [
    ['/admin-live', 'Monitor live', '', 'live'],
  ]],
];

function groupsFor(portal) {
  if (portal === 'developer') return DEV_GROUPS;
  if (portal === 'support') return SUPPORT_GROUPS;
  if (portal === 'hr') return HR_GROUPS;
  return ADMIN_GROUPS;
}
function portalLabel(p) {
  if (p === 'developer') return 'Developer';
  if (p === 'support') return 'Support';
  if (p === 'hr') return 'HR';
  return 'Admin';
}
function portalTint(p) {
  if (p === 'developer') return {
    side: 'from-[#1A0F0F] to-[#0F0708]',
    chip: 'bg-amber-500/20 text-amber-200',
  };
  if (p === 'support') return {
    side: 'from-amber-900 to-amber-950',
    chip: 'bg-amber-500/20 text-amber-100',
  };
  if (p === 'hr') return {
    side: 'from-emerald-900 to-emerald-950',
    chip: 'bg-emerald-500/20 text-emerald-100',
  };
  return {
    side: 'from-[#0F172A] to-[#0B1220]',
    chip: 'bg-slate-500/20 text-slate-200',
  };
}

// ============================================================
// AdminShell
// ============================================================
export default function AdminShell({ children }) {
  const router = useRouter();
  const [portal, setPortal] = usePortal();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logo, setLogo] = useState('');
  const [q, setQ] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const groups = groupsFor(portal);
  const allItems = useMemo(() =>
    groups.flatMap(([, items]) => items), [groups]);
  const tint = portalTint(portal);

  // Persist collapsed state across navigations.
  useEffect(() => {
    try {
      const v = localStorage.getItem('adminSidebarCollapsed');
      if (v === '1') setCollapsed(true);
    } catch (_) {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('adminSidebarCollapsed',
        collapsed ? '1' : '0');
    } catch (_) {}
  }, [collapsed]);

  // Brand logo - watch live so an admin save flows in without reload.
  useEffect(() => {
    const off = brandingService.watchBranding((b) => setLogo(b?.logo || ''));
    return () => { try { off && off(); } catch (_) {} };
  }, []);

  // Cmd+K / Ctrl+K opens the global jumper.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); setPaletteOpen(true);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-close mobile sidebar on route change.
  useEffect(() => {
    const off = () => setMobileOpen(false);
    router.events.on('routeChangeStart', off);
    return () => router.events.off('routeChangeStart', off);
  }, [router.events]);

  function isActive(href) {
    const path = href.split('?')[0];
    return router.pathname === path
      || router.pathname.startsWith(`${path}/`);
  }

  // Breadcrumb derived from the active item's label.
  const breadcrumb = (() => {
    for (const [groupName, items] of groups) {
      for (const [href, label] of items) {
        if (isActive(href)) return { group: groupName, label };
      }
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-[#F4F6FB] text-dark-text">
      <PullToRefresh />
      <Flash />

      {/* MOBILE backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)} />
      )}

      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col
          bg-gradient-to-b ${tint.side} text-slate-100
          shadow-xl transition-all duration-200
          ${collapsed ? 'w-[64px]' : 'w-[260px]'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0`}>
        {/* Logo + collapse */}
        <div className={`flex items-center gap-2
          border-b border-white/10 px-3 py-3
          ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && (
            <Link href="/admin-dashboard"
              className="flex items-center gap-2">
              {logo
                ? <img src={logo} alt="AstroSeer"
                    className="h-7 w-7 rounded" />
                : <span className="grid h-7 w-7 place-items-center
                    rounded bg-white/15 text-xs font-bold">A</span>}
              <span className="text-sm font-bold tracking-wide">
                AstroSeer
              </span>
              <span className={`rounded-full px-1.5 py-0.5
                text-[9px] font-bold uppercase tracking-wider
                ${tint.chip}`}>
                {portalLabel(portal)}
              </span>
            </Link>
          )}
          <button onClick={() => setCollapsed((v) => !v)}
            className="grid h-7 w-7 place-items-center rounded
              hover:bg-white/10 text-sm" aria-label="Collapse sidebar"
            title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Quick search */}
        {!collapsed && (
          <div className="px-3 pt-3">
            <button onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2 rounded-md
                border border-white/10 bg-white/5 px-2.5 py-1.5
                text-left text-[12px] text-slate-300
                hover:bg-white/10">
              <span className="opacity-60">⌕</span>
              <span className="flex-1">Search pages...</span>
              <span className="rounded border border-white/15 px-1
                text-[9px] font-bold opacity-80">⌘K</span>
            </button>
          </div>
        )}

        {/* Groups */}
        <nav className="flex-1 overflow-y-auto px-2 py-3
          [scrollbar-width:thin]">
          {groups.map(([title, items]) => (
            <div key={title} className="mb-3">
              {!collapsed && (
                <div className="px-2 pb-1 text-[9.5px] font-bold
                  uppercase tracking-widest text-slate-400">
                  {title}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map(([href, label, hint, iconKey]) => {
                  const active = isActive(href);
                  return (
                    <li key={href}>
                      <Link href={href}
                        title={collapsed ? label : (hint || '')}
                        className={`group flex items-center gap-2.5
                          rounded-md px-2 py-1.5 text-[12.5px]
                          transition ${active
                            ? 'bg-white/15 text-white shadow-inner'
                            : 'text-slate-300 hover:bg-white/8 '
                              + 'hover:text-white'}`}>
                        <span className={`grid h-5 w-5 shrink-0
                          place-items-center rounded text-[12px]
                          ${active ? 'text-white'
                            : 'text-slate-400 group-hover:text-white'}`}>
                          {ICON[iconKey] || '·'}
                        </span>
                        {!collapsed && (
                          <span className="min-w-0 flex-1 truncate
                            font-medium">{label}</span>
                        )}
                        {!collapsed && active && (
                          <span className="h-1.5 w-1.5 rounded-full
                            bg-emerald-400" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Account footer */}
        <div className="border-t border-white/10 p-2">
          <button onClick={() => authService.signOut()}
            className={`flex w-full items-center gap-2 rounded-md
              px-2 py-1.5 text-[12px] text-slate-300
              hover:bg-white/8 hover:text-white
              ${collapsed ? 'justify-center' : ''}`}>
            <span>⎋</span>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className={`min-h-screen ${collapsed
        ? 'lg:ml-[64px]' : 'lg:ml-[260px]'}`}>
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex items-center gap-3
          border-b border-gray-200/80 bg-white/90 px-4 py-2.5
          backdrop-blur">
          <button onClick={() => setMobileOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-md
              text-base lg:hidden hover:bg-gray-100"
            aria-label="Open menu">☰</button>
          {/* Breadcrumb */}
          <div className="flex min-w-0 flex-1 items-center gap-2
            text-[12px]">
            <span className="hidden text-sub-text sm:inline">
              {portalLabel(portal)}
            </span>
            {breadcrumb && (
              <>
                <span className="hidden text-sub-text sm:inline">/</span>
                <span className="hidden font-semibold text-dark-text
                  sm:inline">{breadcrumb.group}</span>
                <span className="text-sub-text">/</span>
                <span className="truncate font-bold text-dark-text">
                  {breadcrumb.label}
                </span>
              </>
            )}
          </div>
          {/* Global search */}
          <button onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-md border
              border-gray-200 bg-bg-light px-2.5 py-1 text-[12px]
              text-sub-text hover:bg-white sm:flex">
            <span>⌕</span>
            <span>Search anything</span>
            <span className="rounded border border-gray-300 px-1
              text-[9px] font-bold">⌘K</span>
          </button>
          {/* Portal switcher */}
          <select value={portal}
            onChange={(e) => setPortal(e.target.value)}
            className="rounded-md border border-gray-200 bg-white
              px-2 py-1 text-[12px] font-semibold"
            title="Switch portal">
            <option value="admin">Admin</option>
            <option value="developer">Developer</option>
            <option value="support">Support</option>
            <option value="hr">HR</option>
          </select>
        </header>

        {/* CONTENT */}
        <main className="mx-auto w-full max-w-7xl px-4 py-5
          sm:px-6">
          {children}
        </main>
      </div>

      {/* Cmd+K palette */}
      {paletteOpen && (
        <CommandPalette items={allItems} onClose={() => setPaletteOpen(false)}
          q={q} setQ={setQ} />
      )}
    </div>
  );
}

function CommandPalette({ items, onClose, q, setQ }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const filtered = items.filter(([, label, hint]) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (label || '').toLowerCase().includes(needle)
      || (hint || '').toLowerCase().includes(needle);
  }).slice(0, 25);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center
      bg-black/40 px-3 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl
        bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b
          border-gray-200 px-3 py-2.5">
          <span className="text-sub-text">⌕</span>
          <input ref={inputRef} value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to any page..."
            className="w-full bg-transparent text-sm outline-none" />
          <button onClick={onClose} aria-label="Close"
            className="rounded-full bg-bg-light px-2 py-0.5
              text-[10px] font-bold">ESC</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm
              text-sub-text">No matches.</div>
          ) : (
            filtered.map(([href, label, hint]) => (
              <Link key={href} href={href} onClick={onClose}
                className="flex items-center gap-3 px-3 py-2
                  text-sm hover:bg-bg-light">
                <span className="grid h-7 w-7 place-items-center
                  rounded-md bg-primary/10 text-primary
                  text-[12px]">
                  {label.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold
                    text-dark-text">{label}</div>
                  {hint && (
                    <div className="truncate text-[11px]
                      text-sub-text">{hint}</div>
                  )}
                </div>
                <span className="text-xs text-sub-text">↵</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
