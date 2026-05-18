// Colour system + UI constants, blueprint Section 10.2 & 14.2.
// Single source of truth, mirrored into each app's tailwind.config.js.
export const COLORS = {
  primary: '#6C2BD9',      // buttons, navbar, headings, badges, active
  bgLight: '#F3EEFF',      // card backgrounds, info boxes, hover
  accentBlue: '#EAF4FF',   // informational banners and tips
  success: '#1B6B2F',      // online status, credit, success
  danger: '#C0392B',       // offline/busy, debit, End Call, errors
  warning: '#E67E22',      // low balance warning, urgent notices
  gold: '#B8860B',         // star ratings
  darkText: '#1A1A2E',     // body text
  subText: '#555555',      // secondary labels, timestamps
  bgGray: '#F5F5F5',       // page backgrounds
  white: '#FFFFFF',        // card surfaces, inputs
  chatUserBubble: '#DCF8C6',
  chatAstroBubble: '#EEEEEE',
  callBg: '#0A0A0A',
};

// Hard business constants (overridable by settings/config in Firestore).
export const DEFAULTS = {
  commissionPercent: 30,
  minRecharge: 100,
  signupBonus: 0,
  freeChatSeconds: 0,
  freeCallSeconds: 0,
  requestTimeoutSeconds: 60,
};

export const ZODIAC = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// Indian (Vedic) Rashi: name + the VEDIC symbol icon (Dhanu = bow,
// Makara = crocodile, Kumbha = water pot, Mithuna = couple - these
// differ from the Western glyphs). Keyed by the internal Western key
// so horoscope/kundli data still resolves. Icons render monochrome.
export const ZODIAC_IN = {
  Aries: { en: 'Mesha', icon: '🐏' },
  Taurus: { en: 'Vrishabha', icon: '🐂' },
  Gemini: { en: 'Mithuna', icon: '👫' },
  Cancer: { en: 'Karka', icon: '🦀' },
  Leo: { en: 'Simha', icon: '🦁' },
  Virgo: { en: 'Kanya', icon: '👧' },
  Libra: { en: 'Tula', icon: '⚖️' },
  Scorpio: { en: 'Vrishchika', icon: '🦂' },
  Sagittarius: { en: 'Dhanu', icon: '🏹' },
  Capricorn: { en: 'Makara', icon: '🐊' },
  Aquarius: { en: 'Kumbha', icon: '🏺' },
  Pisces: { en: 'Meena', icon: '🐟' },
};
// "Mesha" (default) or "Mesha (Aries)" when full = true.
export function zodiacLabel(w, full) {
  const x = ZODIAC_IN[w];
  if (!x) return w;
  return full ? `${x.en} (${w})` : x.en;
}

// Zodiac from DOB month+day, no external API (blueprint 4.12).
export function zodiacFromDOB(day, month) {
  const d = Number(day), m = Number(month);
  const ranges = [
    [1, 20, 'Capricorn'], [2, 19, 'Aquarius'], [3, 20, 'Pisces'],
    [4, 20, 'Aries'], [5, 21, 'Taurus'], [6, 21, 'Gemini'],
    [7, 22, 'Cancer'], [8, 23, 'Leo'], [9, 23, 'Virgo'],
    [10, 23, 'Libra'], [11, 22, 'Scorpio'], [12, 22, 'Sagittarius'],
  ];
  const [, cutoff, sign] = ranges[m - 1];
  if (d <= cutoff) return sign;
  return ranges[m % 12][2];
}
