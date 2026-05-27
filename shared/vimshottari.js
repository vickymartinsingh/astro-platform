// Vimshottari Dasha math (Vedic astrology, 120-year cycle).
//
// The AstroSeer API returns 3 levels (maha / antar / pratyantar) - anything
// deeper (sookshma, prana, deha) costs an extra round-trip. So we compute
// sub-periods purely client-side from the dates that the API DID return.
//
// One commit, one file. No external deps. Pure functions.

// Mahadasha years per lord (sums to 120).
export const YEARS = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7,
  Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17,
};
export const TOTAL_YEARS = 120;

// Canonical Vimshottari order. Any sub-period starts with the parent
// lord, then steps forward in this sequence (wrapping).
export const ORDER = [
  'Ketu', 'Venus', 'Sun', 'Moon', 'Mars',
  'Rahu', 'Jupiter', 'Saturn', 'Mercury',
];

// Short 2-letter labels (KE / VE / SU / MO / MA / RA / JU / SA / ME)
// for the breadcrumb in the drilldown stepper.
export const SHORT = {
  Ketu: 'KE', Venus: 'VE', Sun: 'SU', Moon: 'MO', Mars: 'MA',
  Rahu: 'RA', Jupiter: 'JU', Saturn: 'SA', Mercury: 'ME',
};

// Normalize whatever capitalization the API returned (lowercase,
// uppercase, abbreviated) into our canonical "Jupiter" / "Ketu" form.
const ALIASES = {
  ke: 'Ketu', ket: 'Ketu', ketu: 'Ketu',
  ve: 'Venus', ven: 'Venus', venus: 'Venus', shukra: 'Venus',
  su: 'Sun', sun: 'Sun', surya: 'Sun', sūrya: 'Sun',
  mo: 'Moon', moon: 'Moon', chandra: 'Moon',
  ma: 'Mars', mars: 'Mars', mangal: 'Mars', kuja: 'Mars',
  ra: 'Rahu', rahu: 'Rahu',
  ju: 'Jupiter', jup: 'Jupiter', jupiter: 'Jupiter', guru: 'Jupiter',
  brihaspati: 'Jupiter',
  sa: 'Saturn', sat: 'Saturn', saturn: 'Saturn', shani: 'Saturn',
  me: 'Mercury', mer: 'Mercury', mercury: 'Mercury', budha: 'Mercury',
};
export function normalizeLord(name) {
  if (!name) return null;
  const k = String(name).trim().toLowerCase().replace(/[^a-z]/g, '');
  return ALIASES[k] || null;
}

// Given a parent lord (Vimshottari sub-periods always start with the
// parent lord), return the 9 children in order, each as { lord }.
export function childOrder(parentLord) {
  const start = ORDER.indexOf(parentLord);
  if (start < 0) return ORDER.map((l) => ({ lord: l }));
  const out = [];
  for (let i = 0; i < 9; i += 1) {
    out.push({ lord: ORDER[(start + i) % 9] });
  }
  return out;
}

// Given a parent period { lord, startMs, endMs }, compute its 9
// children as [{ lord, startMs, endMs, durationMs }, ...] using
// Vimshottari proportional math:
//   childYears = parentTotalYears * childLordYears / 120
// All children sum exactly to the parent span (no rounding drift - // we cumulate from startMs).
export function subPeriods(parent) {
  if (!parent || !parent.lord) return [];
  const lord = normalizeLord(parent.lord) || parent.lord;
  const startMs = +parent.startMs;
  const endMs = +parent.endMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)
      || endMs <= startMs) return [];
  const total = endMs - startMs;
  const order = childOrder(lord);
  let cur = startMs;
  return order.map((c, i) => {
    const share = (YEARS[c.lord] || 0) / TOTAL_YEARS;
    // Last child absorbs any rounding crumb so the chain ends
    // exactly at parent.endMs.
    const next = (i === order.length - 1) ? endMs
      : Math.round(cur + total * share);
    const node = {
      lord: c.lord, startMs: cur, endMs: next,
      durationMs: next - cur,
    };
    cur = next;
    return node;
  });
}

// Format ms-since-epoch as "DD MMM YYYY" - matches the AstroTalk
// reference layout (e.g. "10 Aug 2019").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
  'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(ms) {
  if (!Number.isFinite(+ms)) return '·';
  const d = new Date(+ms);
  if (Number.isNaN(+d)) return '·';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`
    + ` ${d.getFullYear()}`;
}

// Parse "YYYY-MM-DD" / ISO / Date / number → ms since epoch.
// Returns NaN for anything unparseable.
export function toMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return +v;
  const s = String(v);
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  // Some providers return "2019-08-10 14:23:11" without timezone.
  const t2 = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t2) ? t2 : NaN;
}

// Find which child contains `nowMs`. Used to mark the "current"
// period at every level so the breadcrumb / stepper can highlight
// the running maha / antar / pratyantar / sookshma.
export function findCurrent(children, nowMs) {
  for (let i = 0; i < children.length; i += 1) {
    const c = children[i];
    if (nowMs >= c.startMs && nowMs < c.endMs) return i;
  }
  return -1;
}
