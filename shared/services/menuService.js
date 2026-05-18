// Live, admin-editable menus for ALL apps. Defaults live here; the
// admin App Builder writes overrides to settings/features. Every app
// live-subscribes, so renaming / hiding / reordering a menu item in
// the Developer Portal changes the apps instantly - no code/deploy.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULT_CLIENT_MENU = [
  { href: '/dashboard', label: 'Home' },
  { href: '/astrologers', label: 'Astrologers' },
  { href: '/astrologers?mode=call', label: 'Call astrologer' },
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
  { href: '/review', label: 'Write a Review' },
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
// Saved order + label + hidden wins. Items NOT in defaults are kept as
// admin-added CUSTOM links (so you can add brand-new menu entries).
// Any default not yet saved is appended (new features never lost).
export function mergeMenu(defaults, saved) {
  const byHref = Object.fromEntries(defaults.map((d) => [d.href, d]));
  const out = [];
  // `from` = the original default href this saved item came from, so an
  // admin can change a default item's path/label without it duplicating
  // (the original default is then "claimed" and not re-appended).
  const claimed = new Set();
  (Array.isArray(saved) ? saved : []).forEach((s) => {
    if (!s || !s.href) return;
    const origin = s.from || s.href;
    const d = byHref[origin] || byHref[s.href];
    if (d) claimed.add(d.href);
    out.push({
      href: s.href,
      label: (s.label || '').trim() || (d && d.label) || s.href,
      hidden: !!s.hidden,
      notif: d ? d.notif : undefined,
      from: s.from || (d ? d.href : undefined),
      custom: !d,
    });
  });
  defaults.forEach((d) => {
    if (!claimed.has(d.href) && !out.find((o) => o.href === d.href)) {
      out.push({ ...d });
    }
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

// Last known settings/features, persisted so EVERY screen renders the
// correct menus instantly on navigation. Without this each route change
// re-subscribed and briefly emitted the hard defaults first, then the
// saved menus a moment later - the visible "blink" while switching.
let FEAT_CACHE;
try {
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem('menuFeatures');
    if (s) FEAT_CACHE = JSON.parse(s);
  }
} catch (_) { /* ignore */ }

export function watchMenus(cb) {
  // Emit the last known menus immediately (no defaults flash). Only
  // falls back to hard defaults on a truly first-ever run.
  if (cb) cb(resolveMenus(FEAT_CACHE || null));
  try {
    return onSnapshot(doc(db, 'settings', 'features'), (s) => {
      FEAT_CACHE = s.exists() ? s.data() : null;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('menuFeatures',
            JSON.stringify(FEAT_CACHE || {}));
        }
      } catch (_) { /* ignore */ }
      if (cb) cb(resolveMenus(FEAT_CACHE));
    }, () => {});
  } catch (_) { return () => {}; }
}
