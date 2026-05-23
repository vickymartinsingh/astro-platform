// Chaldean numerology (the system most commonly used in India). Computes
// the core numbers from a person's full name + date of birth and returns
// the per-number meanings. All client-side, no API required.
//
// Chaldean letter -> number map (1..8, no 9 by design):
//   A I J Q Y         -> 1
//   B K R             -> 2
//   C G L S           -> 3
//   D M T             -> 4
//   E H N X           -> 5
//   U V W             -> 6
//   O Z               -> 7
//   F P               -> 8
const LETTER = {
  A: 1, I: 1, J: 1, Q: 1, Y: 1,
  B: 2, K: 2, R: 2,
  C: 3, G: 3, L: 3, S: 3,
  D: 4, M: 4, T: 4,
  E: 5, H: 5, N: 5, X: 5,
  U: 6, V: 6, W: 6,
  O: 7, Z: 7,
  F: 8, P: 8,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// Reduce to a single digit unless the running sum hits a recognised
// master number (11, 22, 33).
function reduce(n) {
  let x = Math.abs(Math.round(n));
  while (x > 9 && x !== 11 && x !== 22 && x !== 33) {
    x = String(x).split('').reduce((a, d) => a + Number(d), 0);
  }
  return x;
}

function digitsOnly(s) { return String(s || '').toUpperCase()
  .replace(/[^A-Z]/g, ''); }

function letterSum(s, filter) {
  let total = 0;
  digitsOnly(s).split('').forEach((c) => {
    if (filter && !filter(c)) return;
    total += LETTER[c] || 0;
  });
  return total;
}

// Per-number traits used by the customer-facing report. Compact + Vedic
// flavour rather than purely Western numerology so it sits well alongside
// the kundli content.
const TRAITS = {
  1: {
    keyword: 'The Leader (Sun)',
    personality: 'Independent, ambitious and original. You think for '
      + 'yourself and lead from the front.',
    career: 'Excellent for leadership, government, entrepreneurship, '
      + 'politics, the arts and any pioneering field.',
    love: 'Loyal and protective. You attract partners who admire your '
      + 'confidence; choose someone who respects your space.',
    lucky: { color: 'Golden / Orange', day: 'Sunday',
      stone: 'Ruby', planet: 'Sun', friendly: [1, 2, 4] },
  },
  2: {
    keyword: 'The Diplomat (Moon)',
    personality: 'Sensitive, intuitive and a natural peacemaker. You '
      + 'read others well and bring harmony.',
    career: 'Counselling, healthcare, design, hospitality, education '
      + 'and partnerships of every kind.',
    love: 'Romantic and devoted. Emotional bonding matters more to you '
      + 'than grand gestures.',
    lucky: { color: 'Cream / Silver', day: 'Monday',
      stone: 'Pearl', planet: 'Moon', friendly: [1, 2, 7] },
  },
  3: {
    keyword: 'The Sage (Jupiter)',
    personality: 'Wise, optimistic and expressive. Knowledge and '
      + 'teaching come naturally to you.',
    career: 'Teaching, law, finance, publishing, philosophy and '
      + 'spiritual work.',
    love: 'You value mental connection and shared growth. A partner '
      + 'who learns with you is ideal.',
    lucky: { color: 'Yellow', day: 'Thursday',
      stone: 'Yellow Sapphire', planet: 'Jupiter',
      friendly: [3, 6, 9] },
  },
  4: {
    keyword: 'The Builder (Rahu)',
    personality: 'Unconventional, hard-working and inventive. You see '
      + 'patterns others miss.',
    career: 'Technology, research, engineering, foreign trade, media '
      + 'and structural roles.',
    love: 'Loyalty matters; commit slowly, then deeply. Long, steady '
      + 'partnerships suit you best.',
    lucky: { color: 'Grey / Electric blue', day: 'Saturday',
      stone: 'Hessonite (Gomedh)', planet: 'Rahu',
      friendly: [1, 5, 8] },
  },
  5: {
    keyword: 'The Messenger (Mercury)',
    personality: 'Quick-witted, adaptable and charismatic. You shine in '
      + 'communication and variety.',
    career: 'Sales, writing, IT, brokerage, public speaking and '
      + 'anything involving travel.',
    love: 'You need freedom and stimulating conversation; a flexible, '
      + 'curious partner is the best match.',
    lucky: { color: 'Green', day: 'Wednesday',
      stone: 'Emerald', planet: 'Mercury', friendly: [1, 4, 6] },
  },
  6: {
    keyword: 'The Lover (Venus)',
    personality: 'Warm, artistic and devoted to beauty, family and '
      + 'comfort. People feel cared for around you.',
    career: 'Arts, design, fashion, hospitality, beauty, real estate '
      + 'and family business.',
    love: 'Romantic and loyal. Marriage and long-term partnership are '
      + 'central to your happiness.',
    lucky: { color: 'White / Pastel pink', day: 'Friday',
      stone: 'Diamond / White Sapphire', planet: 'Venus',
      friendly: [3, 5, 6] },
  },
  7: {
    keyword: 'The Mystic (Ketu)',
    personality: 'Reflective, intuitive and spiritually inclined. You '
      + 'seek meaning beyond the surface.',
    career: 'Research, spirituality, occult sciences, writing, '
      + 'astrology, healing and analytics.',
    love: 'You need depth and quiet understanding. Surface flings tire '
      + 'you; soulful bonds nourish you.',
    lucky: { color: 'Light blue / White', day: 'Monday',
      stone: 'Cat\'s Eye', planet: 'Ketu', friendly: [2, 4, 7] },
  },
  8: {
    keyword: 'The Achiever (Saturn)',
    personality: 'Disciplined, patient and ambitious. Success comes '
      + 'through sustained effort and karma.',
    career: 'Finance, law, real estate, judiciary, mining, government, '
      + 'long-term enterprise.',
    love: 'You take love seriously and value reliability. A patient '
      + 'partner is your strongest support.',
    lucky: { color: 'Black / Deep blue', day: 'Saturday',
      stone: 'Blue Sapphire (only after testing)', planet: 'Saturn',
      friendly: [4, 5, 8] },
  },
  9: {
    keyword: 'The Warrior (Mars)',
    personality: 'Courageous, energetic and determined. You move '
      + 'mountains when committed.',
    career: 'Defence, sports, surgery, real estate, engineering and '
      + 'any action-oriented role.',
    love: 'Passionate and protective. A confident, equally driven '
      + 'partner keeps the spark alive.',
    lucky: { color: 'Red', day: 'Tuesday',
      stone: 'Red Coral', planet: 'Mars', friendly: [3, 6, 9] },
  },
  11: {
    keyword: 'The Illuminator (Master)',
    personality: 'Highly intuitive, idealistic and inspiring. You lead '
      + 'through vision and example.',
    career: 'Teaching, healing, public speaking, ministry, the arts '
      + 'and humanitarian work.',
    love: 'Deep, soulful partnerships. You uplift the people you love.',
    lucky: { color: 'Silver', day: 'Monday', stone: 'Moonstone',
      planet: 'Moon (elevated)', friendly: [2, 7, 11] },
  },
  22: {
    keyword: 'The Master Builder',
    personality: 'A practical visionary who turns large dreams into '
      + 'lasting structures.',
    career: 'Enterprise, architecture, governance and large-scale '
      + 'projects that serve many.',
    love: 'Stable, mission-driven partnerships where you build a life '
      + 'together.',
    lucky: { color: 'Royal blue', day: 'Saturday', stone: 'Sapphire',
      planet: 'Saturn (elevated)', friendly: [4, 8, 22] },
  },
  33: {
    keyword: 'The Master Teacher',
    personality: 'A compassionate guide. You serve others through '
      + 'wisdom and care.',
    career: 'Counselling, teaching, spirituality, social impact.',
    love: 'Healing, nurturing partnerships rooted in service.',
    lucky: { color: 'Soft pink / gold', day: 'Friday', stone: 'Rose Quartz',
      planet: 'Venus (elevated)', friendly: [3, 6, 9, 33] },
  },
};

export function traitsFor(n) { return TRAITS[n] || TRAITS[reduce(n)]; }

// Life-path number from DOB (DD-MM-YYYY). Each component is reduced
// separately, then summed and reduced again - keeps master numbers.
export function lifePath(dob) {
  const m = String(dob || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  const d = reduce(Number(m[1]));
  const mo = reduce(Number(m[2]));
  const y = reduce(Number(m[3]));
  return reduce(d + mo + y);
}

// Day-of-birth (the literal day, reduced).
export function birthdayNumber(dob) {
  const m = String(dob || '').match(/^(\d{1,2})/);
  return m ? reduce(Number(m[1])) : null;
}

export function destinyNumber(fullName) {
  return reduce(letterSum(fullName));
}
export function soulUrgeNumber(fullName) {
  return reduce(letterSum(fullName, (c) => VOWELS.has(c)));
}
export function personalityNumber(fullName) {
  return reduce(letterSum(fullName, (c) => !VOWELS.has(c)));
}

// Personal year (current cycle), useful for "what's this year about".
export function personalYear(dob, year = new Date().getFullYear()) {
  const m = String(dob || '').match(/(\d{1,2})\D+(\d{1,2})\D+\d{2,4}/);
  if (!m) return null;
  const d = reduce(Number(m[1]));
  const mo = reduce(Number(m[2]));
  return reduce(d + mo + reduce(year));
}

// Full report. Pass { name, dob } -> returns every number + traits +
// derived lucky numbers and a friendly summary.
export function fullReport({ name, dob } = {}) {
  if (!name && !dob) return null;
  const destiny = destinyNumber(name);
  const soul = soulUrgeNumber(name);
  const persona = personalityNumber(name);
  const life = lifePath(dob);
  const day = birthdayNumber(dob);
  const year = personalYear(dob);
  const luckySet = Array.from(new Set([life, destiny, day]
    .filter((x) => x && x > 0))).slice(0, 5);
  return {
    name: String(name || '').trim(),
    dob: String(dob || '').trim(),
    destiny, destinyTraits: traitsFor(destiny),
    soul, soulTraits: traitsFor(soul),
    personality: persona, personalityTraits: traitsFor(persona),
    lifePath: life, lifeTraits: traitsFor(life),
    birthday: day,
    personalYear: year, yearTraits: traitsFor(year),
    luckyNumbers: luckySet,
  };
}
