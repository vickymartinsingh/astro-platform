// Kundli / Marriage matching, simplified Ashtakoot (Guna Milan, /36).
// A true Ashtakoot needs Moon nakshatra; the app only collects DOB, so this
// is a deterministic, sign-based approximation (clearly labelled as such).
import { ZODIAC, zodiacFromDOB } from './theme.js';

const KOOTAS = [
  ['Varna', 1, 'Spiritual compatibility & ego balance'],
  ['Vashya', 2, 'Mutual attraction & control'],
  ['Tara', 3, 'Health & well-being of the couple'],
  ['Yoni', 4, 'Physical & intimate compatibility'],
  ['Graha Maitri', 5, 'Mental connection & friendship'],
  ['Gana', 6, 'Temperament & nature'],
  ['Bhakoot', 7, 'Love, finances & family growth'],
  ['Nadi', 8, 'Health & progeny'],
];

function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i); h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function signFromDOB(dob) {
  const [d, m] = String(dob || '').split('-').map(Number);
  if (!d || !m) return '';
  return zodiacFromDOB(d, m);
}

// boy/girl: { name, sign }  -> { rows, total, max:36, percent, verdict }
export function gunaMilan(boy, girl) {
  const bi = ZODIAC.indexOf(boy.sign);
  const gi = ZODIAC.indexOf(girl.sign);
  const base = seed(`${boy.sign}|${girl.sign}|${boy.name}|${girl.name}`);
  const diff = Math.abs(bi - gi);

  const rows = KOOTAS.map(([name, max, desc], i) => {
    // Deterministic sub-score in [ceil(max*0.4), max], nudged by sign harmony.
    const harmony = [0, 4, 8].includes(diff % 12) ? 1 : 0;
    const raw = (base >> (i * 3)) % (max + 1);
    let score = Math.max(Math.ceil(max * 0.4), raw);
    if (harmony && score < max) score += 1;
    score = Math.min(score, max);
    return { name, max, desc, score };
  });

  const total = rows.reduce((a, r) => a + r.score, 0);
  const percent = Math.round((total / 36) * 100);
  let verdict;
  if (total >= 28) verdict = 'Excellent match, highly compatible.';
  else if (total >= 22) verdict = 'Good match, compatible with minor effort.';
  else if (total >= 18) verdict = 'Average match, workable with understanding.';
  else verdict = 'Challenging match, consult an astrologer for remedies.';

  return { rows, total, max: 36, percent, verdict };
}
