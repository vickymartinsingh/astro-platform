// Admin-editable icons for the home quick actions and the "Browse by
// category" tiles. Stored in settings/content.icons as { slotKey: value }
// where value is an emoji OR an uploaded image data-URL. Live everywhere
// (onSnapshot) and cached so it never glitches/flashes on navigation.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

// slot key -> default icon (emoji). Admin overrides any of these and can
// also upload an image instead.
export const DEFAULT_ICONS = {
  'qa:tarot': '🃏',
  'qa:kundli': '📜',
  'qa:matching': '💞',
  'qa:horoscope': '🌞',
  // Categories default to the built-in monochrome SVG (NOT a colour
  // emoji). Admin can still upload an image or set an emoji per slot.
  'cat:Love': '',
  'cat:Career': '',
  'cat:Marriage': '',
  'cat:Health': '',
  'cat:Finance': '',
  'cat:Education': '',
  // Zodiac: blank by default = use the built-in single-colour emblem.
  // Upload your own Indian-style art per sign to override it.
  'zod:Aries': '', 'zod:Taurus': '', 'zod:Gemini': '',
  'zod:Cancer': '', 'zod:Leo': '', 'zod:Virgo': '',
  'zod:Libra': '', 'zod:Scorpio': '', 'zod:Sagittarius': '',
  'zod:Capricorn': '', 'zod:Aquarius': '', 'zod:Pisces': '',
};
// Internal Western key -> Rashi label, for the admin editor rows.
const ZOD_LABEL = {
  Aries: 'Mesha (Aries)', Taurus: 'Vrishabha (Taurus)',
  Gemini: 'Mithuna (Gemini)', Cancer: 'Karka (Cancer)',
  Leo: 'Simha (Leo)', Virgo: 'Kanya (Virgo)',
  Libra: 'Tula (Libra)', Scorpio: 'Vrishchika (Scorpio)',
  Sagittarius: 'Dhanu (Sagittarius)', Capricorn: 'Makara (Capricorn)',
  Aquarius: 'Kumbha (Aquarius)', Pisces: 'Meena (Pisces)',
};

// For the admin editor UI (label per slot).
export const ICON_SLOTS = [
  ['qa:tarot', 'Quick action: Tarot'],
  ['qa:kundli', 'Quick action: Kundli'],
  ['qa:matching', 'Quick action: Matching'],
  ['qa:horoscope', 'Quick action: Horoscope'],
  ['cat:Love', 'Category: Love & Relationships'],
  ['cat:Career', 'Category: Career'],
  ['cat:Marriage', 'Category: Marriage'],
  ['cat:Health', 'Category: Health'],
  ['cat:Finance', 'Category: Finance'],
  ['cat:Education', 'Category: Education'],
  ...Object.keys(ZOD_LABEL).map((z) => [
    `zod:${z}`, `Zodiac: ${ZOD_LABEL[z]}`]),
];

export function resolveIcons(content) {
  const over = (content && content.icons) || {};
  const out = { ...DEFAULT_ICONS };
  Object.keys(over).forEach((k) => {
    if (over[k]) out[k] = over[k];
  });
  return out;
}

export function isImage(v) {
  return typeof v === 'string' && v.slice(0, 5) === 'data:';
}

let CACHE;
try {
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem('iconMap');
    if (s) CACHE = JSON.parse(s);
  }
} catch (_) { /* ignore */ }

export function watchIcons(cb) {
  if (cb) cb(CACHE || resolveIcons(null));
  try {
    return onSnapshot(doc(db, 'settings', 'content'), (s) => {
      const map = resolveIcons(s.exists() ? s.data() : null);
      CACHE = map;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('iconMap', JSON.stringify(map));
        }
      } catch (_) { /* ignore */ }
      if (cb) cb(map);
    }, () => {});
  } catch (_) { return () => {}; }
}
