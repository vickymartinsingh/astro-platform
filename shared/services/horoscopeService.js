// Admin uploads a CSV of horoscopes (every sign, every date of the
// month). Stored in settings/horoscope.entries keyed "SIGN|YYYY-MM-DD".
// The app reads today's / tomorrow's row automatically each day - so a
// single monthly upload auto-updates daily with no further action. If a
// date has no row, it falls back to the built-in generator.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getHoroscope } from '../horoscope.js';
import { ZODIAC } from '../theme.js';

export const HOROSCOPE_CSV_COLUMNS = [
  'sign', 'date', 'general', 'love', 'career', 'health',
  'luckyNumber', 'luckyColor',
];

function dateStr(when) {
  const d = new Date();
  if (when === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Resolve a reading: admin CSV row for that sign+date wins, else the
// deterministic built-in generator (so there is always a reading).
export function resolveHoroscope(sign, when, entries) {
  const date = dateStr(when);
  const row = entries && entries[`${sign}|${date}`];
  if (row && (row.general || row.love || row.career || row.health)) {
    const base = getHoroscope(sign, when);
    return {
      sign,
      date,
      general: row.general || base.general,
      love: row.love || base.love,
      career: row.career || base.career,
      health: row.health || base.health,
      luckyNumber: row.luckyNumber || base.luckyNumber,
      luckyColor: row.luckyColor || base.luckyColor,
    };
  }
  return getHoroscope(sign, when);
}

// Minimal CSV parser (handles quoted fields + commas + quotes).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; } else { q = false; }
      } else { cur += c; }
    } else if (c === '"') { q = true; }
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else { cur += c; }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// CSV text -> { entries, count, errors }.
export function parseHoroscopeCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { entries: {}, count: 0, errors: ['empty file'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  HOROSCOPE_CSV_COLUMNS.forEach((c) => { idx[c] = head.indexOf(c); });
  const errors = [];
  if (idx.sign < 0 || idx.date < 0) {
    return { entries: {}, count: 0,
      errors: ['CSV must have at least "sign" and "date" columns'] };
  }
  const entries = {};
  let count = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const cols = rows[r];
    const sign = (cols[idx.sign] || '').trim();
    const date = (cols[idx.date] || '').trim();
    if (!sign || !date) continue;
    const normSign = ZODIAC.find(
      (z) => z.toLowerCase() === sign.toLowerCase());
    if (!normSign) { errors.push(`row ${r + 1}: unknown sign "${sign}"`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`row ${r + 1}: date must be YYYY-MM-DD`); continue;
    }
    const get = (k) => (idx[k] >= 0 ? (cols[idx[k]] || '').trim() : '');
    entries[`${normSign}|${date}`] = {
      general: get('general'),
      love: get('love'),
      career: get('career'),
      health: get('health'),
      luckyNumber: get('luckyNumber'),
      luckyColor: get('luckyColor'),
    };
    count += 1;
  }
  return { entries, count, errors };
}

// Downloadable template: every sign for the next `days` days, blank
// predictions for the admin to fill in.
export function horoscopeCSVTemplate(days = 31) {
  const lines = [HOROSCOPE_CSV_COLUMNS.join(',')];
  const base = new Date();
  for (let d = 0; d < days; d += 1) {
    const dt = new Date(base);
    dt.setDate(base.getDate() + d);
    const ds = dt.toISOString().slice(0, 10);
    ZODIAC.forEach((sign) => {
      lines.push([sign, ds, '', '', '', '', '', ''].join(','));
    });
  }
  return lines.join('\n');
}

let CACHE;
try {
  if (typeof localStorage !== 'undefined') {
    const s = localStorage.getItem('horoscopeEntries');
    if (s) CACHE = JSON.parse(s);
  }
} catch (_) { /* ignore */ }

export function watchHoroscope(cb) {
  if (cb) cb(CACHE || {});
  try {
    return onSnapshot(doc(db, 'settings', 'horoscope'), (s) => {
      const e = (s.exists() && s.data().entries) || {};
      CACHE = e;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('horoscopeEntries', JSON.stringify(e));
        }
      } catch (_) { /* ignore */ }
      if (cb) cb(e);
    }, () => {});
  } catch (_) { return () => {}; }
}
