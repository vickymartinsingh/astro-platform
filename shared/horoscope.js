// Built-in daily horoscope generator, deterministic per sign + date, so
// every sign always shows a Today and Tomorrow reading with no DB / Cloud
// Function needed (free, offline-capable). If the `horoscope` collection
// has an entry for the date it can still be preferred by the caller.
import { ZODIAC } from './theme.js';

const GENERAL = [
  'A steady day. Focus on one priority and progress will follow.',
  'Energy is high; channel it into something you have been postponing.',
  'Patience pays today. Avoid rushing important decisions.',
  'A small act of kindness opens an unexpected door.',
  'Clarity returns after a brief confusion. Trust your judgement.',
  'Good day for planning rather than acting. Observe before you move.',
  'Your confidence is magnetic today; use it wisely.',
  'Rest and reflection will recharge you more than effort.',
];
const LOVE = [
  'Communicate openly. A sincere word strengthens a bond.',
  'Singles may notice a meaningful new connection.',
  'Give your partner space; understanding deepens trust.',
  'An old misunderstanding can finally be healed.',
  'Romance favours the patient. Let things unfold naturally.',
];
const CAREER = [
  'A delayed opportunity resurfaces. Be ready to act.',
  'Teamwork brings recognition; share credit generously.',
  'Avoid financial risk; review the details before committing.',
  'Your discipline is noticed by someone who matters.',
  'A learning effort today compounds into future gain.',
];
const HEALTH = [
  'Hydrate and stretch; small habits protect your energy.',
  'Mind over matter. Manage stress before it builds.',
  'A short walk clears the mind and lifts the mood.',
  'Sleep is your best remedy tonight.',
  'Balance work with a calming routine.',
];
const LUCKY_COLORS = ['Saffron', 'Emerald', 'Royal Blue', 'Gold', 'Maroon',
  'Turquoise', 'Ivory', 'Violet'];

function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = (arr, s) => arr[s % arr.length];

export function getHoroscope(sign, when = 'today') {
  const d = new Date();
  if (when === 'tomorrow') d.setDate(d.getDate() + 1);
  const dateStr = d.toISOString().slice(0, 10);
  const s = seed(sign + dateStr);
  return {
    sign,
    date: dateStr,
    general: pick(GENERAL, s),
    love: pick(LOVE, s >> 3),
    career: pick(CAREER, s >> 6),
    health: pick(HEALTH, s >> 9),
    luckyNumber: (s % 9) + 1,
    luckyColor: pick(LUCKY_COLORS, s >> 12),
  };
}

export function horoscopeText(h) {
  return `${h.general} In love: ${h.love} Career: ${h.career} ` +
    `Health: ${h.health} Lucky number ${h.luckyNumber}, ` +
    `lucky colour ${h.luckyColor}.`;
}

export { ZODIAC };
