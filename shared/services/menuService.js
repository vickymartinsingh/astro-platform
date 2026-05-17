// Live, admin-editable menus for ALL apps. Defaults live here; the
// admin App Builder writes overrides to settings/features. Every app
// live-subscribes, so renaming / hiding / reordering a menu item in
// the Developer Portal changes the apps instantly - no code/deploy.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULT_CLIENT_MENU = [
  { href: '/dashboard', label: 'Home' },
  { href: '/astrologers', label: 'Astrologers' },
  { href: '/horoscope', label: 'Horoscope' },
  { href: '/tarot', label: 'Tarot' },
  { href: '/kundli', label: 'Kundli' },
  { href: '/matching', label: 'Matching' },
  { href: '/remedies', label: 'Remedies' },
  { href: '/wallet', label: 'Wallet' },
];
export const DEFAULT_CLIENT_PROFILE = [
  { href: '/profile', label: 'My Profile' },
  { href: '/chat-history', label: 'Consultation history' },
  { href: '/call-history', label: 'Call history' },
  { href: '/transactions', label: 'Order history' },
  { href: '/notifications', label: 'Notifications', notif: true },
  { href: '/support', label: 'Help & Support' },
];
export const DEFAULT_ASTRO_MENU = [
  { href: '/astro-dashboard', label: 'Dashboard' },
  { href: '/astro-live', label: 'Go Live' },
  { href: '/astro-sessions', label: 'My Sessions' },
  { href: '/astro-earnings', label: 'Earnings' },
  { href: '/astro-kundli', label: 'Kundli Viewer' },
  { href: '/astro-remedies', label: 'My Remedies' },
  { href: '/astro-profile', label: 'Profile' },
  { href: '/astro-reviews', label: 'Reviews' },
  { href: '/astro-notifications', label: 'Announcements' },
  { href: '/astro-support', label: 'Help & Support' },
];

// Merge a saved override list with the defaults: keep saved order +
// label + hidden, then append any new default routes not yet saved
// (so new features always appear, never lost). Drops hidden items.
export function mergeMenu(defaults, saved) {
  const byHref = Object.fromEntries(defaults.map((d) => [d.href, d]));
  const out = [];
  (Array.isArray(saved) ? saved : []).forEach((s) => {
    const d = byHref[s.href];
    if (!d) return;
    out.push({ ...d, label: (s.label || '').trim() || d.label,
      hidden: !!s.hidden });
  });
  defaults.forEach((d) => {
    if (!out.find((o) => o.href === d.href)) out.push({ ...d });
  });
  return out;
}

export function resolveMenus(features) {
  const f = features || {};
  return {
    menu: mergeMenu(DEFAULT_CLIENT_MENU, f.menu_links)
      .filter((x) => !x.hidden),
    profile: mergeMenu(DEFAULT_CLIENT_PROFILE, f.profile_menu)
      .filter((x) => !x.hidden),
    astro: mergeMenu(DEFAULT_ASTRO_MENU, f.astro_links)
      .filter((x) => !x.hidden),
  };
}

export function watchMenus(cb) {
  // Default immediately.
  if (cb) cb(resolveMenus(null));
  try {
    return onSnapshot(doc(db, 'settings', 'features'), (s) => {
      if (cb) cb(resolveMenus(s.exists() ? s.data() : null));
    }, () => {});
  } catch (_) { return () => {}; }
}
