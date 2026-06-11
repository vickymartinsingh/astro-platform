import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  astrologerService, sessionService, userService, pushService,
  hoursService, liveService, assistantService, walletService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;
const SVCS = [['chat', 'Chat'], ['call', 'Voice Call'],
  ['video', 'Video Call']];
const ONLINE_SVCS = [['chat', 'Chat'], ['call', 'Call'],
  ['video', 'Video'], ['live', 'Live']];
const RANGES = [['day', 'Today'], ['week', 'This week'],
  ['month', 'This month'], ['custom', 'Custom']];

const SVC_ICONS = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  call: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.16 6.16l.91-.9a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17z" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
};

const NAV_LINKS = [
  {
    href: '/astro-session',
    label: 'Sessions',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
  },
  {
    href: '/astro-earnings',
    label: 'Earnings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" />
      </svg>
    ),
  },
  {
    href: '/astro-reviews',
    label: 'Reviews',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    href: '/astro-profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

const SESSION_TYPE_ICONS = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  call: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.16 6.16l.91-.9a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17z" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  ),
};

const STATUS_CONFIG = {
  online: {
    label: 'Online',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-800',
    desc: 'You are visible to clients and can receive requests.',
    toggleLabel: 'Go Offline',
    toggleOff: true,
  },
  busy: {
    label: 'Busy',
    dot: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800',
    desc: 'You are in a session. New requests are paused.',
    toggleLabel: 'In Session',
    toggleOff: null,
  },
  offline: {
    label: 'Offline',
    dot: 'bg-red-500',
    badge: 'bg-red-100 text-red-800',
    desc: 'Turn on a service below to go online.',
    toggleLabel: 'Go Online',
    toggleOff: false,
  },
};

// Simple toast that slides up from bottom and auto-dismisses after 3s
function SaveToast({ msg, kind, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999,
      background: kind === 'ok' ? '#F0FDF4' : '#FFF8E7',
      border: `1.5px solid ${kind === 'ok' ? '#16a34a' : '#7F2020'}`,
      borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 13,
      color: kind === 'ok' ? '#15803d' : '#7F2020',
      boxShadow: '0 4px 20px rgba(0,0,0,.12)',
      whiteSpace: 'nowrap',
    }}>
      {kind === 'ok' ? '✓ ' : '! '}{msg}
    </div>
  );
}

export default function AstroDashboard() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();
  const [astro, setAstro] = useState(undefined);
  const [sessions, setSessions] = useState([]);
  const [cur, setCur] = useState([]);     // current/active sessions
  const [names, setNames] = useState({}); // uid -> name
  const [busy, setBusy] = useState(false);
  const [availLogs, setAvailLogs] = useState(null);
  const [liveHist, setLiveHist] = useState([]);
  const [hrange, setHrange] = useState('day');
  const [cfrom, setCfrom] = useState('');
  const [cto, setCto] = useState('');
  const [aiAvailable, setAiAvailable] = useState(false); // admin-enabled
  const [walletBal, setWalletBal] = useState(null);
  const [toast, setToast] = useState(null); // { msg, kind }

  // Is the AI assistant feature switched on for THIS astrologer by admin?
  useEffect(() => {
    if (!user) return undefined;
    return assistantService.watchAiConfig((cfg) =>
      setAiAvailable(assistantService.aiAvailableForAstro(cfg, user.uid)));
  }, [user && user.uid]);

  // Live wallet balance via walletService
  useEffect(() => {
    if (!user) return undefined;
    const unsub = walletService.listenWallet(user.uid, (bal) =>
      setWalletBal(bal));
    return () => { if (unsub) unsub(); };
  }, [user && user.uid]);

  useEffect(() => {
    if (!user) return;
    const unsub = astrologerService.listenAstrologer(user.uid, (a) =>
      setAstro(a || null));
    const u2 = sessionService.listenActiveForAstro(user.uid, (list) => {
      setCur(list);
      list.forEach((s) => {
        if (s.userId && !names[s.userId]) {
          userService.getUser(s.userId).then((u) => {
            if (u) setNames((m) => ({ ...m, [s.userId]: u.name
              || 'Customer' }));
          }).catch(() => {});
        }
      });
    });
    // Collect any post-commission earnings from sessions the client
    // already ended (works even after disconnect), then load history.
    sessionService.collectAstrologerEarnings(user.uid)
      .catch(() => {})
      .finally(() => sessionService.getAstrologerSessions(user.uid)
        .then(setSessions));
    return () => { if (unsub) unsub(); if (u2) u2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    hoursService.getAvailLogs(user.uid).then(setAvailLogs).catch(() => {});
    const u = liveService.listenLiveHistory(user.uid, setLiveHist);
    return () => { if (u) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, astro]);

  async function toggleAi() {
    if (!astro) return;
    // Opt-out semantics: default ON when undefined; toggling sets the
    // explicit boolean.
    const current = astro.aiAssistant !== false;
    setBusy(true);
    try {
      await astrologerService.updateAstrologer(user.uid,
        { aiAssistant: !current });
      setToast({
        msg: !current ? 'AI assistant: Enabled' : 'AI assistant: Disabled',
        kind: 'ok',
      });
    } finally { setBusy(false); }
  }

  async function toggleSvc(key) {
    if (!astro) return;
    const cur3 = {
      chat: !!astro.chat_enabled, call: !!astro.call_enabled,
      video: !!astro.video_enabled,
    };
    const turningOn = !cur3[key];
    const label = (SVCS.find(([k]) => k === key) || [])[1] || key;
    // Themed confirm (matches the rest of the app). Lazy-imported so
    // the modal host code doesn't sit in this page's boot chunk.
    const { confirmModal } = await import('../components/ConfirmModal');
    const ok = await confirmModal({
      title: turningOn ? `Go ONLINE for ${label}?`
        : `Go OFFLINE for ${label}?`,
      message: turningOn
        ? `Customers will be able to start ${label.toLowerCase()} sessions `
          + 'with you immediately.'
        : `You won't receive new ${label.toLowerCase()} requests until you `
          + 'turn this back on.',
      yes: turningOn ? 'Go online' : 'Go offline',
      no: 'Cancel',
      danger: !turningOn,
    });
    if (!ok) return;
    const next = { ...cur3, [key]: turningOn };
    const anyOn = next.chat || next.call || next.video;
    setBusy(true);
    try {
      await astrologerService.updateAvailability(user.uid, {
        chat_enabled: next.chat,
        call_enabled: next.call,
        video_enabled: next.video,
        status: anyOn ? 'online' : 'offline',
      });
      setToast({
        msg: turningOn ? `${label}: Now online` : `${label}: Now offline`,
        kind: 'ok',
      });
    } finally { setBusy(false); }
  }

  async function quickToggleOnline() {
    if (!astro || busy) return;
    const status = astro.status || 'offline';
    if (status === 'busy') return; // cannot toggle while in session
    const turningOn = status === 'offline';
    const { confirmModal } = await import('../components/ConfirmModal');
    const ok = await confirmModal({
      title: turningOn ? 'Go Online?' : 'Go Offline?',
      message: turningOn
        ? 'All services you have enabled will become visible to clients.'
        : 'You will stop receiving all new consultation requests.',
      yes: turningOn ? 'Go Online' : 'Go Offline',
      no: 'Cancel',
      danger: !turningOn,
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (turningOn) {
        // Restore at least chat online; user controls per-service below
        await astrologerService.updateAvailability(user.uid, {
          chat_enabled: true,
          call_enabled: !!astro.call_enabled,
          video_enabled: !!astro.video_enabled,
          status: 'online',
        });
      } else {
        await astrologerService.updateAvailability(user.uid, {
          chat_enabled: false,
          call_enabled: false,
          video_enabled: false,
          status: 'offline',
        });
      }
    } finally { setBusy(false); }
  }

  async function joinSession(s) {
    pushService.sendPushToUser({
      toUid: s.userId,
      title: 'Astrologer joined',
      body: 'Your astrologer joined the session. Tap to continue.',
      data: { type: 'session',
        route: s.type === 'chat'
          ? `/chat/${s.astroId}` : `/call/${s.astroId}` },
    });
    router.push(`/astro-session/${s.id}`);
  }

  if (loading || astro === undefined) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-4 border-[#7F2020]
              border-t-transparent animate-spin" />
            <p className="text-sm text-sub-text">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (astro === null) {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-12 rounded-2xl border border-gray-200
          bg-[#FFF8E7] p-8 text-center shadow-sm">
          <div className="mb-4 mx-auto w-16 h-16 rounded-full bg-[#7F2020]/10
            flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="#7F2020" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">Welcome!</h1>
          <p className="mb-6 text-sub-text">
            Set up your astrologer profile to start receiving consultations.
          </p>
          <Link href="/astro-profile"
            className="inline-block rounded-xl bg-[#7F2020] px-6 py-3 text-sm
              font-semibold text-white shadow-sm hover:bg-[#6a1a1a] transition">
            Complete Profile
          </Link>
        </div>
      </Layout>
    );
  }

  const now = Date.now();
  const ended = sessions.filter((s) => s.status === 'ended');
  const since = (ms) => ended.filter((s) =>
    s.createdAt?.toDate && now - s.createdAt.toDate().getTime() <= ms);
  const sum = (arr) => arr.reduce((a, s) =>
    a + Number(s.astrologerEarning || 0), 0);

  // Call/chat response stats from real session records.
  const cnt = (st) => sessions.filter((s) => s.status === st).length;
  const answered = sessions.filter((s) =>
    ['ended', 'accepted', 'active'].includes(s.status)).length;
  const missed = cnt('missed');
  const rejected = cnt('rejected');
  const cancelled = cnt('cancelled');
  const respBase = answered + missed + rejected;
  const respRate = respBase
    ? Math.round((answered / respBase) * 100) : 100;

  // Online-hours dashboard (Today / Week / Month / Custom).
  const startToday = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  };
  const rb = hrange === 'custom'
    ? {
      from: cfrom ? new Date(`${cfrom}T00:00:00`).getTime() : startToday(),
      to: cto ? new Date(`${cto}T23:59:59`).getTime() : Date.now(),
    }
    : hoursService.rangeBounds(hrange);
  const oh = availLogs
    ? hoursService.computeHours(availLogs, rb.from, rb.to) : null;
  const ohLiveMs = hoursService.liveMs(liveHist, rb.from, rb.to);
  const ohVal = (k) => {
    if (k === 'live') return hoursService.fmtHrs(ohLiveMs);
    return oh ? hoursService.fmtHrs(oh.onlineMs[k]) : '-';
  };
  const actHref = (svc) => `/astro-activity?range=${hrange}`
    + `${cfrom ? `&from=${cfrom}` : ''}${cto ? `&to=${cto}` : ''}`
    + `${svc ? `&svc=${svc}` : ''}`;

  const status = astro.status || 'offline';
  const sCfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
  const todayEarnings = sum(since(DAY));

  return (
    <Layout>
      {/* Pending approval banner */}
      {!astro.approved && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200
          bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="mt-0.5 w-4 h-4 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            Your profile is <strong>under review</strong>. You can go online
            once an admin approves your account.
          </span>
        </div>
      )}

      {/* ── HERO CARD ── */}
      <div className="rounded-2xl overflow-hidden shadow-md mb-4"
        style={{ background: 'linear-gradient(135deg, #7F2020 0%, #5a1616 100%)' }}>
        <div className="px-6 py-5">
          {/* Top row: name + status badge */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-medium text-white/60 uppercase tracking-widest
                mb-0.5">
                Astrologer Dashboard
              </p>
              <h1 className="text-xl font-bold text-white leading-tight">
                {astro.name || profile?.displayName || 'My Dashboard'}
              </h1>
            </div>
            <span className={`shrink-0 flex items-center gap-1.5 rounded-full px-3
              py-1 text-xs font-bold ${sCfg.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />
              {sCfg.label}
            </span>
          </div>

          {/* Metrics row */}
          <div className="grid grid-cols-3 divide-x divide-white/20
            rounded-xl bg-black/20 overflow-hidden">
            {/* Wallet balance */}
            <div className="flex flex-col items-center px-4 py-3 text-center">
              <span className="text-[11px] font-medium text-white/60 uppercase
                tracking-wide mb-1">
                Wallet
              </span>
              <span className="text-lg font-extrabold text-white leading-none">
                {walletBal !== null
                  ? `₹${Number(walletBal).toFixed(0)}`
                  : `₹${Number(astro.wallet || astro.earnings || 0).toFixed(0)}`}
              </span>
            </div>
            {/* Today earnings */}
            <div className="flex flex-col items-center px-4 py-3 text-center">
              <span className="text-[11px] font-medium text-white/60 uppercase
                tracking-wide mb-1">
                Today
              </span>
              <span className="text-lg font-extrabold text-[#D4A12A] leading-none">
                ₹{todayEarnings.toFixed(0)}
              </span>
            </div>
            {/* Rating */}
            <div className="flex flex-col items-center px-4 py-3 text-center">
              <span className="text-[11px] font-medium text-white/60 uppercase
                tracking-wide mb-1">
                Rating
              </span>
              <span className="flex items-center gap-1 text-lg font-extrabold
                text-[#D4A12A] leading-none">
                <svg viewBox="0 0 24 24" fill="#D4A12A" className="w-4 h-4">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {astro.rating
                  ? Number(astro.rating).toFixed(1) : '0.0'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick nav strip */}
        <div className="flex divide-x divide-white/10 bg-black/30">
          {NAV_LINKS.map(({ href, label, icon }) => (
            <Link key={href} href={href}
              className="flex flex-1 flex-col items-center gap-1 py-3 text-white/70
                hover:text-white hover:bg-white/10 transition text-center">
              {icon}
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── STATUS SECTION ── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
        mb-4 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Animated dot */}
            <div className="relative shrink-0 w-4 h-4">
              <span className={`absolute inset-0 rounded-full ${sCfg.dot}`} />
              {status === 'online' && (
                <span className={`absolute inset-0 rounded-full ${sCfg.dot}
                  animate-ping opacity-60`} />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 leading-tight">
                {sCfg.label}
              </p>
              <p className="text-xs text-sub-text leading-snug">{sCfg.desc}</p>
            </div>
          </div>
          {sCfg.toggleOff !== null && (
            <button
              type="button"
              onClick={quickToggleOnline}
              disabled={busy || !astro.approved}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold
                shadow-sm transition disabled:opacity-50
                ${sCfg.toggleOff
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : 'bg-[#7F2020] text-white hover:bg-[#6a1a1a]'}`}>
              {sCfg.toggleLabel}
            </button>
          )}
        </div>
      </div>

      {/* ── CURRENT SESSIONS ── */}
      {cur.length > 0 && (
        <div className="rounded-2xl border-2 border-[#7F2020]/30 bg-[#FFF8E7]
          shadow-sm mb-4 overflow-hidden">
          <div className="px-5 py-3 flex items-center gap-2 border-b
            border-[#7F2020]/20">
            {/* Pulsing indicator */}
            <div className="relative w-3 h-3 shrink-0">
              <span className="absolute inset-0 rounded-full bg-[#7F2020]" />
              <span className="absolute inset-0 rounded-full bg-[#7F2020]
                animate-ping opacity-70" />
            </div>
            <span className="text-sm font-bold text-[#7F2020] uppercase
              tracking-wide">
              Active Session{cur.length > 1 ? `s (${cur.length})` : ''}
            </span>
          </div>
          <div className="divide-y divide-[#7F2020]/10">
            {cur.map((s) => (
              <div key={s.id}
                className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm leading-tight">
                    {names[s.userId] || 'Customer'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[#7F2020]">
                      {SESSION_TYPE_ICONS[s.type] || null}
                    </span>
                    <span className="text-xs text-sub-text capitalize">
                      {s.type} &bull; {s.status}
                    </span>
                  </div>
                </div>
                <button type="button" onClick={() => joinSession(s)}
                  className="shrink-0 rounded-xl bg-[#7F2020] px-4 py-2 text-sm
                    font-semibold text-white hover:bg-[#6a1a1a] transition
                    shadow-sm">
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AVAILABILITY TOGGLES ── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
        mb-4">
        <div className="px-5 pt-4 pb-2 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Availability</h2>
          <p className="text-xs text-sub-text mt-0.5">
            Turn on the services you want right now. Turn ALL off before
            starting a Live session.
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {SVCS.map(([k, label]) => {
            const on = !!astro[`${k}_enabled`];
            const dis = busy || !astro.approved;
            return (
              <div key={k}
                className="flex items-center gap-4 px-5 py-3.5">
                <span className={`shrink-0 rounded-xl p-2 ${on
                  ? 'bg-[#7F2020]/10 text-[#7F2020]'
                  : 'bg-gray-100 text-gray-400'}`}>
                  {SVC_ICONS[k]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {label}
                  </p>
                  <p className={`text-xs font-medium ${on
                    ? 'text-emerald-600' : 'text-sub-text'}`}>
                    {on ? 'Online' : 'Offline'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${label} availability`}
                  onClick={() => !dis && toggleSvc(k)}
                  disabled={dis}
                  className={`relative h-7 w-12 shrink-0 rounded-full
                    transition-colors ${on
                      ? 'bg-[#7F2020]' : 'bg-gray-300'}
                    ${dis ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full
                    bg-white shadow-sm transition-all ${on
                      ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
            );
          })}
        </div>

        {/* AI Assistant toggle - shown only when admin enables it */}
        {aiAvailable && (() => {
          const aiOn = astro.aiAssistant !== false; // default ON
          return (
            <div className="mx-5 mb-4 mt-2 flex items-start gap-4 rounded-xl
              border border-[#D4A12A]/30 bg-[#FFF8E7] px-4 py-3">
              <span className={`mt-0.5 shrink-0 rounded-xl p-2 ${aiOn
                ? 'bg-[#D4A12A]/20 text-[#D4A12A]'
                : 'bg-gray-100 text-gray-400'}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="w-5 h-5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l3 3" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  AI Assistant
                  <span className={`ml-2 text-xs font-bold ${aiOn
                    ? 'text-emerald-600' : 'text-sub-text'}`}>
                    {aiOn ? 'On' : 'Off'}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-sub-text leading-snug">
                  AI replies to client chats on your behalf. Chat only,
                  never calls.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={aiOn}
                aria-label="AI assistant"
                onClick={() => !busy && toggleAi()}
                disabled={busy}
                className={`mt-0.5 relative h-7 w-12 shrink-0 rounded-full
                  transition-colors ${aiOn
                    ? 'bg-[#D4A12A]' : 'bg-gray-300'}
                  ${busy ? 'opacity-50' : ''}`}>
                <span className={`absolute top-0.5 h-6 w-6 rounded-full
                  bg-white shadow-sm transition-all ${aiOn
                    ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
          );
        })()}
      </div>

      {/* No active sessions placeholder (only shown when section above is hidden) */}
      {cur.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
          mb-4 px-5 py-4 flex items-center gap-3">
          <span className="shrink-0 w-8 h-8 rounded-full bg-gray-100 flex
            items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Current Sessions
            </p>
            <p className="text-xs text-sub-text">
              No incoming or active sessions right now.
            </p>
          </div>
        </div>
      )}

      {/* ── STATS GRID ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today Earned"
          value={`₹${sum(since(DAY)).toFixed(0)}`}
          href="/astro-earnings"
          accent />
        <StatCard label="This Week"
          value={`₹${sum(since(7 * DAY)).toFixed(0)}`}
          href="/astro-earnings" />
        <StatCard label="Lifetime"
          value={`₹${Number(astro.earnings || 0).toFixed(0)}`}
          href="/astro-earnings" />
        <StatCard label="Sessions Today"
          value={since(DAY).length}
          href="/astro-activity?tab=sessions&range=day" />
        <StatCard label="Rating"
          value={
            <span className="flex items-center justify-center gap-1">
              <svg viewBox="0 0 24 24" fill="#D4A12A" className="w-4 h-4">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>{astro.rating || '0.0'}</span>
            </span>
          }
          href="/astro-reviews" />
        <StatCard label="Response Rate"
          value={`${respRate}%`}
          href="/astro-activity?tab=sessions" />
        <StatCard label="Total Sessions"
          value={astro.totalSessions || 0}
          href="/astro-activity?tab=sessions" />
        <StatCard label="Reviews"
          value={astro.reviewsCount || 0}
          href="/astro-reviews" />
      </div>

      {/* ── RESPONSE STATS ── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
        mb-4">
        <div className="flex items-center justify-between px-5 pt-4 pb-2
          border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Call Response</h2>
            <p className="text-xs text-sub-text mt-0.5">
              Answered vs missed / rejected. Rate = answered / (answered +
              missed + rejected).
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold text-[#7F2020]">
              {respRate}%
            </p>
            <p className="text-[10px] text-sub-text uppercase tracking-wide">
              Response
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 divide-x divide-gray-100 px-0">
          {[
            { label: 'Answered', val: answered,
              color: 'text-emerald-600', href: '/astro-activity?tab=sessions' },
            { label: 'Missed', val: missed,
              color: 'text-amber-600', href: '/astro-activity?tab=sessions' },
            { label: 'Rejected', val: rejected,
              color: 'text-[#7F2020]', href: '/astro-activity?tab=sessions' },
            { label: 'Cancelled', val: cancelled,
              color: 'text-gray-500', href: '/astro-activity?tab=sessions' },
          ].map(({ label, val, color, href }) => (
            <Link key={label} href={href}
              className="flex flex-col items-center py-4 hover:bg-[#FFF8E7]
                transition text-center">
              <span className={`text-xl font-extrabold ${color}`}>{val}</span>
              <span className="text-[10px] text-sub-text uppercase tracking-wide
                mt-0.5">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── ONLINE HOURS ── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
        mb-4">
        <div className="flex items-center justify-between px-5 pt-4 pb-3
          border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Online Hours</h2>
          <Link href={actHref('')}
            className="text-xs font-semibold text-[#7F2020] hover:underline">
            View report
          </Link>
        </div>
        <div className="px-5 pt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {RANGES.map(([k, lbl]) => (
              <button key={k} type="button" onClick={() => setHrange(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold
                  transition ${hrange === k
                    ? 'bg-[#7F2020] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {lbl}
              </button>
            ))}
          </div>
          {hrange === 'custom' && (
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="text-xs text-sub-text">
                From
                <input type="date" value={cfrom}
                  onChange={(e) => setCfrom(e.target.value)}
                  className="input mt-1 !min-h-0 py-1.5 block" />
              </label>
              <label className="text-xs text-sub-text">
                To
                <input type="date" value={cto}
                  onChange={(e) => setCto(e.target.value)}
                  className="input mt-1 !min-h-0 py-1.5 block" />
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pb-4 md:grid-cols-4">
            {ONLINE_SVCS.map(([k, label]) => (
              <Stat key={k} label={`${label} online`}
                value={ohVal(k)} href={actHref(k)} />
            ))}
          </div>
        </div>
      </div>

      {/* ── RECENT REQUESTS ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Recent Requests</h2>
          <Link href="/astro-activity?tab=sessions"
            className="text-xs font-semibold text-[#7F2020] hover:underline">
            View all
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm
            px-5 py-6 text-center text-sub-text text-sm">
            No requests yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 6).map((s) => {
              const statusColors = {
                ended: 'bg-emerald-100 text-emerald-700',
                missed: 'bg-amber-100 text-amber-700',
                rejected: 'bg-red-100 text-red-700',
                cancelled: 'bg-gray-100 text-gray-600',
                active: 'bg-blue-100 text-blue-700',
              };
              const earning = Number(s.astrologerEarning || 0);
              return (
                <div key={s.id}
                  className="flex items-center gap-3 rounded-2xl border
                    border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <span className={`shrink-0 rounded-xl p-2 ${
                    s.status === 'ended'
                      ? 'bg-[#7F2020]/10 text-[#7F2020]'
                      : 'bg-gray-100 text-gray-400'}`}>
                    {SESSION_TYPE_ICONS[s.type] || SESSION_TYPE_ICONS.chat}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900
                        capitalize">
                        {s.type}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px]
                        font-bold capitalize ${statusColors[s.status]
                          || 'bg-gray-100 text-gray-600'}`}>
                        {s.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-sub-text mt-0.5">
                      {s.createdAt?.toDate
                        ? s.createdAt.toDate().toLocaleString() : ''}
                    </p>
                  </div>
                  {earning > 0 && (
                    <span className="shrink-0 text-sm font-bold text-[#D4A12A]">
                      +&#8377;{earning.toFixed(0)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global toast overlay */}
      {toast && (
        <SaveToast
          msg={toast.msg}
          kind={toast.kind}
          onDone={() => setToast(null)}
        />
      )}
    </Layout>
  );
}

function StatCard({ label, value, href, accent }) {
  const inner = (
    <div className={`rounded-2xl border px-4 py-4 text-center shadow-sm
      transition hover:shadow-md active:scale-[.98]
      ${accent
        ? 'border-[#7F2020]/20 bg-[#FFF8E7]'
        : 'border-gray-200 bg-white'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest
        text-sub-text mb-1">
        {label}
      </p>
      <p className={`text-xl font-extrabold leading-none ${accent
        ? 'text-[#7F2020]' : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
  if (href) {
    return <Link href={href} className="block">{inner}</Link>;
  }
  return inner;
}

function Stat({ label, value, href }) {
  const inner = (
    <>
      <div className="text-xs uppercase tracking-wide text-sub-text">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href}
        className="surface block p-4 text-center transition
          hover:shadow-md active:scale-[.98]">
        {inner}
      </Link>
    );
  }
  return <div className="surface p-4 text-center">{inner}</div>;
}
