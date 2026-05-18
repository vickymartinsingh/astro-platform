import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSettings } from '../lib/useSettings';

// Astrotalk-style fixed bottom tab bar (mobile only). Default tabs:
// Home / Chat / Live / Tarot / Profile. Call is moved into the menu by
// default but stays a real tab the admin can switch back on (App
// Builder -> Bottom menu: show Call, hide Tarot). The active tab turns
// brand yellow. Hidden on >=md (desktop keeps the top nav).
const I = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

function Home(p) {
  return (
    <svg {...I} {...p}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}
function Chat(p) {
  return (
    <svg {...I} {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.8A8 8 0 1 1 21 12z" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </svg>
  );
}
function Live(p) {
  return (
    <svg {...I} {...p}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}
function Call(p) {
  return (
    <svg {...I} {...p}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5
        0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2
        1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.2a2
        2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2.1z" />
    </svg>
  );
}
function Tarot(p) {
  return (
    <svg {...I} {...p}>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M12 7v8M8.5 11h7" />
    </svg>
  );
}
function Profile(p) {
  return (
    <svg {...I} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
// Generic icon for admin-added custom tabs.
function Dot(p) {
  return (
    <svg {...I} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

// key = stable id used by the admin App Builder (order/hide/label).
const TABS = [
  { key: 'home', href: '/dashboard', label: 'Home', Ico: Home,
    match: ['/dashboard'] },
  { key: 'chat', href: '/astrologers', label: 'Chat', Ico: Chat,
    match: ['/astrologers', '/chat/[id]', '/chat-history'] },
  { key: 'live', href: '/live', label: 'Live', Ico: Live,
    match: ['/live'] },
  { key: 'tarot', href: '/tarot', label: 'Tarot', Ico: Tarot,
    match: ['/tarot'] },
  { key: 'call', href: '/astrologers?mode=call', label: 'Call',
    Ico: Call, match: ['/call/[id]', '/call-history'] },
  { key: 'profile', href: '/profile', label: 'Profile',
    Ico: Profile, match: ['/profile'] },
];
// Tabs hidden by default (admin can switch them back on in App Builder).
// Call lives in the menu by default; Tarot takes its place in the bar.
const DEFAULT_HIDDEN = { call: true };

export default function BottomNav() {
  const router = useRouter();
  const path = router.pathname;
  const query = router.asPath;
  const { features } = useSettings();

  const byKey = Object.fromEntries(TABS.map((t) => [t.key, t]));
  // Admin-added custom tabs (App Builder -> Bottom menu -> + Add tab).
  const customTabs = (Array.isArray(features.nav_custom)
    ? features.nav_custom : [])
    .filter((c) => c && c.key && c.href)
    .map((c) => ({ key: c.key, href: c.href,
      label: c.label || c.href, Ico: Dot, match: [c.href] }));
  customTabs.forEach((t) => { byKey[t.key] = t; });
  // Admin App Builder order (settings/features.nav_order); default
  // order otherwise. Then drop hidden tabs (+ legacy enable_live).
  const defKeys = [...TABS.map((t) => t.key),
    ...customTabs.map((t) => t.key)];
  const saved = Array.isArray(features.nav_order)
    ? features.nav_order.filter((k) => byKey[k]) : [];
  // Always include any default tab missing from a saved order (so new
  // tabs like Profile show even if the saved order predates them).
  const order = [...saved, ...defKeys.filter((k) => !saved.includes(k))];
  const isHidden = (key) => {
    const v = features[`nav_hidden_${key}`];
    return v === undefined ? !!DEFAULT_HIDDEN[key] : !!v;
  };
  const tabs = order
    .map((k) => byKey[k]).filter(Boolean)
    .filter((t) => !isHidden(t.key))
    .filter((t) => !(t.key === 'live' && features.enable_live === false));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200
                    bg-white safe-bottom md:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between">
        {tabs.map(({ key, href, label, Ico, match }) => {
          const shown = (features[`nav_${key}`] || '').trim() || label;
          const active = match.includes(path)
            || (label === 'Call' && query.startsWith('/astrologers?mode=call'))
            || (label === 'Chat' && path === '/astrologers'
                && !query.startsWith('/astrologers?mode=call'));
          return (
            <Link key={key} href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2
                ${active ? 'text-primary' : 'text-sub-text'}`}>
              <span className={`flex h-9 w-12 items-center justify-center
                rounded-full transition ${active ? 'bg-bg-light' : ''}`}>
                <Ico />
              </span>
              <span className={`text-[11px] ${active
                ? 'font-bold' : 'font-medium'}`}>{shown}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
