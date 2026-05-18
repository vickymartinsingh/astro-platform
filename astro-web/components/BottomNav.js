import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSettings } from '../lib/useSettings';

// Astrologer fixed bottom tab bar (mobile). Monochrome icons (no
// colour). Admin-editable via settings/features.anav_* (App Builder /
// Developer Portal -> Astrologer bottom tab bar).
const I = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};
function Active(p) {
  return (
    <svg {...I} {...p}>
      <path d="M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0" />
      <path d="M12 7v5l3 2" />
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
function Earn(p) {
  return (
    <svg {...I} {...p}>
      <path d="M10 4c-1 1.5-2 2.5-2 4 0 1 1 2 4 2s4 1 4 2c0 1.5-1 2.5-2 4" />
      <path d="M7 14c-1 1-2 2.5-2 4 0 2 3 2 7 2s7 0 7-2c0-1.5-1-3-2-4
        a7 7 0 0 0-10 0z" />
      <path d="M12 11v6" />
    </svg>
  );
}
function Kundli(p) {
  return (
    <svg {...I} {...p}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12h16M12 4v16M5 5l14 14M19 5 5 19" />
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
function Dot(p) {
  return (
    <svg {...I} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

const TABS = [
  { key: 'active', href: '/astro-dashboard', label: 'Active',
    Ico: Active, match: ['/astro-dashboard'] },
  { key: 'live', href: '/astro-live', label: 'Go Live',
    Ico: Live, match: ['/astro-live'] },
  { key: 'earn', href: '/astro-earnings', label: 'Earnings',
    Ico: Earn, match: ['/astro-earnings'] },
  { key: 'kundli', href: '/astro-kundli', label: 'Kundli',
    Ico: Kundli, match: ['/astro-kundli'] },
  { key: 'profile', href: '/astro-profile', label: 'Profile',
    Ico: Profile, match: ['/astro-profile'] },
];

export default function BottomNav() {
  const router = useRouter();
  const path = router.pathname;
  const { features } = useSettings();

  const byKey = Object.fromEntries(TABS.map((t) => [t.key, t]));
  const custom = (Array.isArray(features.anav_custom)
    ? features.anav_custom : [])
    .filter((c) => c && c.key && c.href)
    .map((c) => ({ key: c.key, href: c.href,
      label: c.label || c.href, Ico: Dot, match: [c.href] }));
  custom.forEach((t) => { byKey[t.key] = t; });
  const defKeys = [...TABS.map((t) => t.key),
    ...custom.map((t) => t.key)];
  const saved = Array.isArray(features.anav_order)
    ? features.anav_order.filter((k) => byKey[k]) : [];
  const order = [...saved, ...defKeys.filter((k) => !saved.includes(k))];
  const tabs = order.map((k) => byKey[k]).filter(Boolean)
    .filter((t) => !features[`anav_hidden_${t.key}`]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t
      border-gray-200 bg-white safe-bottom md:hidden">
      <div className="mx-auto flex max-w-md items-stretch
        justify-between">
        {tabs.map(({ key, href, label, Ico, match }) => {
          const shown = (features[`anav_${key}`] || '').trim() || label;
          const active = match.includes(path);
          return (
            <Link key={key} href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2
                ${active ? 'text-primary' : 'text-sub-text'}`}>
              <span className={`flex h-9 w-12 items-center
                justify-center rounded-full transition ${
                active ? 'bg-bg-light' : ''}`}>
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
