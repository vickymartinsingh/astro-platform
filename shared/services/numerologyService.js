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

// Compact "lucky set" for a person - the unique single digits derived
// from life path, destiny and birthday. Used by every check / suggest
// helper below as the source of truth for "what numbers favour you".
// Falls back to an empty array if neither name nor dob is provided.
export function luckyNumbersFor({ name, dob } = {}) {
  const candidates = [];
  if (dob) {
    const lp = lifePath(dob); if (lp) candidates.push(lp);
    const bd = birthdayNumber(dob); if (bd) candidates.push(bd);
  }
  if (name) {
    const d = destinyNumber(name); if (d) candidates.push(d);
  }
  // Reduce master numbers (11/22/33) to their roots for digit-level
  // checks against a phone / vehicle / name sum.
  const root = (n) => (n > 9 ? reduce(reduce(n)) : n);
  return Array.from(new Set(candidates.map(root))).slice(0, 5);
}

// Digit-sum any string of digits down to its root (e.g. mobile or
// vehicle number). Non-digits are ignored. Returns 0 for empty input.
export function digitRoot(numericLike) {
  const digits = String(numericLike || '').replace(/\D/g, '');
  if (!digits) return 0;
  let total = 0;
  for (const ch of digits) total += Number(ch);
  return reduce(total);
}

// Check whether a phone / vehicle number is "lucky" for this person.
// Returns { ok, root, luckySet, message }. ok=true means the digit
// root of `numericLike` matches one of the person's lucky numbers.
export function checkNumberLuck(numericLike, { name, dob } = {}) {
  const root = digitRoot(numericLike);
  const luckySet = luckyNumbersFor({ name, dob });
  if (!root) {
    return { ok: false, root: 0, luckySet,
      message: 'Enter at least one digit to check.' };
  }
  if (!luckySet.length) {
    return { ok: false, root, luckySet,
      message: 'Add your name and date of birth to compute lucky '
        + 'numbers first.' };
  }
  const traits = traitsFor(root);
  const friendly = (traits && traits.lucky && traits.lucky.friendly) || [];
  const luckyMatch = luckySet.includes(root);
  const friendlyMatch = luckySet.some((n) => friendly.includes(n));
  let message;
  if (luckyMatch) {
    message = `Great pick - this number reduces to ${root}, one of `
      + 'your lucky numbers.';
  } else if (friendlyMatch) {
    message = `Reasonable - it reduces to ${root} which is friendly `
      + `to your lucky numbers (${luckySet.join(', ')}).`;
  } else {
    message = `Not aligned - it reduces to ${root}; your lucky `
      + `numbers are ${luckySet.join(', ')}. Try a different number.`;
  }
  return { ok: luckyMatch, friendly: friendlyMatch,
    root, luckySet, friendlyTo: friendly, message };
}

// Generate up to N candidate "lucky" trailing digit pairs for the
// person. Used by the mobile-number / vehicle-number helpers to
// suggest replacements when the user's current number doesn't align.
// Returns an array of strings like ['11', '28', '46', ...].
export function suggestLuckyPairs({ name, dob } = {}, count = 10) {
  const luckySet = luckyNumbersFor({ name, dob });
  if (!luckySet.length) return [];
  const out = [];
  for (let n = 10; n < 100 && out.length < count; n += 1) {
    if (luckySet.includes(digitRoot(String(n)))) {
      out.push(String(n).padStart(2, '0'));
    }
  }
  return out;
}

// Name correction helper. Computes the current name's destiny number
// and, when it doesn't already match the person's life path, suggests
// small spelling tweaks (add / drop / change a vowel) that land on
// the target destiny. Returns:
//   {
//     ok,                            // already matches life path
//     current: { name, destiny },
//     target,                        // life-path number to aim for
//     suggestions: [{ name, destiny }] // up to 6 candidates
//   }
export function suggestNameCorrection(name, dob) {
  const lp = lifePath(dob);
  if (!lp) {
    return { ok: false, error: 'Enter your date of birth first.' };
  }
  const current = { name, destiny: destinyNumber(name) };
  if (!name || !current.destiny) {
    return { ok: false, error: 'Enter your full name first.' };
  }
  if (current.destiny === lp) {
    return { ok: true, current, target: lp, suggestions: [],
      message: `Your name "${name}" already aligns with your `
        + `life path ${lp}. No change needed.` };
  }
  const target = lp;
  const tweaks = new Set();
  const trimmed = name.trim();
  // Strategy 1: add a vowel at the end of the first name.
  ['A', 'I', 'E', 'Y', 'U'].forEach((v) => {
    const parts = trimmed.split(/\s+/);
    parts[0] = parts[0] + v.toLowerCase();
    tweaks.add(parts.join(' '));
  });
  // Strategy 2: double the last letter of the first word.
  const first = trimmed.split(/\s+/)[0] || '';
  if (first.length > 1) {
    tweaks.add(`${first}${first.slice(-1)}${trimmed.slice(first.length)}`);
  }
  // Strategy 3: try alternate single-letter swaps near the end.
  ['a', 'e', 'i', 'h', 'y'].forEach((c) => {
    if (first.length > 2) {
      tweaks.add(first.slice(0, -1) + c + trimmed.slice(first.length));
    }
  });
  const suggestions = Array.from(tweaks)
    .map((n) => ({ name: n, destiny: destinyNumber(n) }))
    .filter((x) => x.destiny === target)
    .slice(0, 6);
  return { ok: false, current, target, suggestions,
    message: suggestions.length
      ? `Your current name reduces to ${current.destiny}. These small `
        + `tweaks land on your life path ${target}:`
      : `Your name destiny ${current.destiny} doesn't match your life `
        + `path ${target}. No simple spelling tweak gets you to ${target}; `
        + 'consider a Vedic numerologist for a deeper rework.' };
}

// Lucky day / colour / gemstone for a person (derived from life path).
// Convenience wrapper over traitsFor so the UI can render them as
// stand-alone cards without re-computing.
export function luckyContext({ name, dob } = {}) {
  const lp = lifePath(dob);
  const traits = traitsFor(lp);
  return {
    lifePath: lp,
    color: traits?.lucky?.color || '-',
    day: traits?.lucky?.day || '-',
    stone: traits?.lucky?.stone || '-',
    planet: traits?.lucky?.planet || '-',
    luckySet: luckyNumbersFor({ name, dob }),
  };
}
