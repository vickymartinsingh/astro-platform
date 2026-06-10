// Daily quote banner ("Hey, Cosmic Explorer" + a date-scheduled
// quote). Lives at settings/dailyQuotes so it shares the same
// admin-write / world-read rule as every other settings doc and pushes
// live to the customer dashboard via onSnapshot.
//
// 2026-06-08: rewritten to be DATE-SCHEDULED. Each quote is pinned to
// a specific IST calendar day (YYYY-MM-DD). The customer sees only
// the quote whose date matches "today" in IST; if nothing is scheduled
// for today the banner hides. CSV import / export uses the same
// date,quote shape so the operator can plan a quarter of greetings
// in a spreadsheet and upload it in one go.
//
// Document shape:
//   showMobile boolean
//   showDesktop boolean
//   enabled boolean        (legacy + convenience mirror)
//   title string           - guest / no-name greeting
//   titleAuthed string     - logged-in greeting; [Name] gets the
//                           viewer's first name
//   subtitle string        - optional kicker line
//   quotes [{date, text}]  - the date-scheduled pool. Sorted asc
//                           by date on every save.
//   updatedAt serverTimestamp
//
// HARD RULES (carried from the earlier version):
//   - NO HYPHENS / DASHES inside a quote (sanitised on every write)
//   - Quotes are stored sanitised; em-dashes/hyphens get stripped

import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// ===== IST helpers =================================================

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// Shift a Date by +5:30 then read the calendar day in UTC - that
// gives us the IST calendar day regardless of the device timezone.
export function istDateStr(d) {
  const t = d instanceof Date ? d : new Date(d);
  const shifted = new Date(t.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function istToday() { return istDateStr(new Date()); }

// Add `n` days to a YYYY-MM-DD string (preserving the IST notion of
// "calendar day").
export function addDaysIst(dateStr, n) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return istDateStr(new Date(t + Number(n || 0) * 86400000
    - IST_OFFSET_MS));
}

// Strict YYYY-MM-DD validator.
export function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y
    && date.getUTCMonth() + 1 === m
    && date.getUTCDate() === d;
}

// ===== Quote sanitisation =========================================

// Strip every kind of dash + hyphen and collapse the whitespace.
export function sanitiseQuote(raw) {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');
  // Enumerate dash codepoints (no regex range so the class is always
  // parseable): hyphen-minus, soft-hyphen, hyphen, non-breaking
  // hyphen, figure dash, en dash, em dash, horizontal bar, hyphen
  // bullet, minus, two-em dash, three-em dash.
  s = s.replace(/[-­‐‑‒–—―⁃−⸺⸻]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”‘’]+/, '');
  s = s.replace(/["'“”‘’]+$/, '');
  return s;
}

export function isValidQuote(raw) {
  return sanitiseQuote(raw).length > 0;
}

// ===== Defaults (seed) =============================================
//
// Seed pool used the very first time the doc is empty. Dates are
// assigned at hydrate time starting from "today" so an operator who
// has never touched the admin still sees a usable pre-populated list.
const SEED_TEXTS = [
  'The universe noticed your return.',
  'You have arrived when you needed to.',
  'Another day, another sign to grow.',
  'The stars made room for you today.',
  'Today the cosmos quietly believes in you.',
  'Something kind is on its way to you.',
  'Your timing is wiser than you know.',
  'The sky has plans for you today.',
  'Small steps, blessed by big stars.',
  'Even the moon waits patiently.',
  'The light always finds its way home.',
  'Today opens with you in mind.',
  'The stars love a slow start too.',
  'You are exactly where you are meant to be.',
  'The cosmos is rooting for you quietly.',
  'Trust the soft pull of this day.',
  'The universe speaks first in stillness.',
  'Your story is being written in stardust.',
  'Something good is choosing you today.',
  'A gentle day, by cosmic design.',
  'The stars rearranged themselves for you.',
  'Today carries a quiet kind of magic.',
  'Your path is lit, even when you cannot see it.',
  'The cosmos saved this moment for you.',
  'Breathe. The universe has time.',
  'New light arrives in old places today.',
  'The stars say take it gently.',
  'A small wonder waits in your day.',
  'The universe is rearranging things in your favour.',
  'You are right on time, by cosmic clock.',
];

export const DEFAULTS = {
  showMobile: false,
  showDesktop: false,
  enabled: false,
  title: 'Hey, Cosmic Explorer',
  titleAuthed: 'Hello, [Name]',
  subtitle: '',
  // Note: the seed entries are GENERATED in hydrate() with live dates,
  // not baked here, so the first-time pool always starts at today.
  quotes: [],
};

// Generate seed entries with sequential IST dates starting today.
function seedEntries() {
  const today = istToday();
  return SEED_TEXTS.map((text, i) => ({
    date: addDaysIst(today, i),
    text,
  }));
}

// ===== Hydrate (read) =============================================

function hydrate(d) {
  const hasNew = (d.showMobile != null || d.showDesktop != null);
  // The authoritative dated list lives at `schedule` (new code). When
  // present it ALWAYS wins. `quotes` is kept around for v1.0.102
  // back-compat: a flat string[] of texts only.
  let entries = [];
  const raw = Array.isArray(d.schedule) && d.schedule.length
    ? d.schedule
    : (Array.isArray(d.quotes) ? d.quotes : []);
  if (raw.length > 0) {
    const first = raw[0];
    if (typeof first === 'string') {
      // Legacy string[] - assign sequential IST dates starting today
      // so the customer still sees a usable rotation in memory.
      const today = istToday();
      entries = raw.map((text, i) => ({
        date: addDaysIst(today, i),
        text: sanitiseQuote(text),
      })).filter((e) => e.text);
    } else if (first && typeof first === 'object') {
      entries = raw.map((e) => ({
        date: String((e && e.date) || ''),
        text: sanitiseQuote((e && e.text) || ''),
      })).filter((e) => isValidDateStr(e.date) && e.text);
    }
  } else {
    entries = seedEntries();
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return {
    showMobile: hasNew ? !!d.showMobile : (d.enabled !== false),
    showDesktop: hasNew ? !!d.showDesktop : (d.enabled !== false),
    enabled: hasNew
      ? (!!d.showMobile || !!d.showDesktop)
      : (d.enabled !== false),
    title: d.title || DEFAULTS.title,
    titleAuthed: d.titleAuthed != null ? d.titleAuthed : '',
    subtitle: d.subtitle || DEFAULTS.subtitle,
    quotes: entries,
  };
}

// ===== Reads ======================================================

export async function getDailyQuotes() {
  try {
    const s = await getDoc(doc(db, 'settings', 'dailyQuotes'));
    if (!s.exists()) return hydrate({});
    return hydrate(s.data() || {});
  } catch (_) {
    return hydrate({});
  }
}

export function listenDailyQuotes(cb) {
  return onSnapshot(doc(db, 'settings', 'dailyQuotes'), (s) => {
    cb(hydrate(s.exists() ? (s.data() || {}) : {}));
  }, () => cb(hydrate({})));
}

// Resolve the headline for a given viewer. Substitutes [Name] with
// the viewer's first name when titleAuthed is set AND the viewer is
// logged in with a usable name.
export function resolveTitle(state, profile) {
  const t = state || {};
  const authed = (t.titleAuthed || '').trim();
  // Defensive: profile.name MUST be a string. Operator screenshot
  // 2026-06-08 showed "(object Object)" after login on some devices,
  // which happens when an upstream migration writes profile.name as
  // an object (e.g. {first, last}). String(obj) = "[object Object]"
  // which would have produced a broken greeting. Now we coerce only
  // when typeof string and bail out to the guest title otherwise.
  const rawName = profile && profile.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!authed || !name) return t.title || DEFAULTS.title;
  const first = name.split(/\s+/)[0] || name;
  return authed.replace(/\[Name\]/gi, first);
}

// Today's quote in IST. Returns '' when no entry matches - the
// customer banner hides itself in that case.
export function quoteForToday(entries, today) {
  const t = today || istToday();
  const match = (entries || []).find((e) => e && e.date === t);
  return match ? match.text : '';
}

// ===== Writes ======================================================

export async function saveDailyQuotes(state) {
  // Sanitise + dedupe by date. Two entries with the same date keep
  // the LAST one (so an operator can override an earlier one by
  // re-adding the same date).
  const byDate = new Map();
  (Array.isArray(state.quotes) ? state.quotes : []).forEach((e) => {
    if (!e || !isValidDateStr(e.date)) return;
    const text = sanitiseQuote(e.text || '');
    if (!text) return;
    byDate.set(e.date, { date: e.date, text });
  });
  const cleaned = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date));
  const showMobile = !!state.showMobile;
  const showDesktop = !!state.showDesktop;
  // 2026-06-08: legacy mirror for v1.0.102 customers.
  // The old reader treats settings/dailyQuotes.quotes as a flat
  // string[] and runs sanitiseQuote on every entry. Passing the new
  // {date,text} objects to that reader stringifies each one to
  // "[object Object]" (operator screenshot: "Hey Cosmic Explorer
  // (object Object)"). To stop that regression on already-shipped
  // apps WITHOUT a forced upgrade, we write `quotes` as a plain
  // string array of upcoming texts (today first, then chronologically
  // forward, then any past tail). Newer code reads `schedule`
  // instead (set below) so the two views never diverge.
  const today = istToday();
  const upcoming = cleaned.filter((e) => e.date >= today)
    .map((e) => e.text);
  const past = cleaned.filter((e) => e.date < today)
    .map((e) => e.text);
  const legacyQuotes = upcoming.concat(past);
  await setDoc(doc(db, 'settings', 'dailyQuotes'), {
    showMobile,
    showDesktop,
    enabled: showMobile || showDesktop,
    title: sanitiseQuote(state.title) || DEFAULTS.title,
    titleAuthed: sanitiseQuote(state.titleAuthed || ''),
    subtitle: sanitiseQuote(state.subtitle) || '',
    // Authoritative scheduled list (new code reads from `schedule`)
    schedule: cleaned,
    // Legacy back-compat for v1.0.102 readers
    quotes: legacyQuotes,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return cleaned.length;
}

// ===== CSV import / export =========================================

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')
    || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Serialise the current schedule as CSV. Header row first.
export function serializeCsv(entries) {
  const rows = [['date', 'quote']];
  (entries || []).forEach((e) => {
    if (e && isValidDateStr(e.date) && e.text) {
      rows.push([e.date, e.text]);
    }
  });
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}

// Sample CSV the operator can grab as a starting point. Three rows,
// dated today + tomorrow + day-after, so they can edit and re-upload
// without manually computing dates.
export function templateCsv() {
  const t = istToday();
  return serializeCsv([
    { date: t, text: 'The universe noticed your return.' },
    { date: addDaysIst(t, 1),
      text: 'Another day, another sign to grow.' },
    { date: addDaysIst(t, 2),
      text: 'Small steps, blessed by big stars.' },
  ]);
}

// Parse CSV into [{date, text}]. Accepts:
//   - header row "date,quote" OR "quote,date" (order auto-detected)
//   - no header (in which case we try to detect: a YYYY-MM-DD in the
//     first row's first column means date,quote; in the second column
//     means quote,date; anything else falls back to date,quote and
//     rows with invalid dates are dropped)
//   - extra columns are ignored
export function parseQuotesCsv(text) {
  if (!text) return [];
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; }
        else { inQuotes = false; }
      } else { cur += ch; }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (cur.length > 0 || row.length > 0) {
        row.push(cur); rows.push(row); row = []; cur = '';
      }
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  if (rows.length === 0) return [];

  // Detect column order from header or first row.
  let dateIdx = 0;
  let textIdx = 1;
  let startAt = 0;
  const head = rows[0].map((c) => String(c || '').trim().toLowerCase());
  const hasHeader = head.some((c) => c === 'date' || c === 'quote'
    || c === 'quotes' || c === 'text');
  if (hasHeader) {
    startAt = 1;
    const dh = head.indexOf('date');
    const qh = head.indexOf('quote') !== -1
      ? head.indexOf('quote')
      : (head.indexOf('quotes') !== -1
        ? head.indexOf('quotes') : head.indexOf('text'));
    if (dh !== -1 && qh !== -1) { dateIdx = dh; textIdx = qh; }
  } else if (rows[0].length >= 2) {
    // Auto-detect: which column looks like a date.
    if (isValidDateStr(String(rows[0][1] || '').trim())) {
      dateIdx = 1; textIdx = 0;
    }
  }

  const out = [];
  for (let r = startAt; r < rows.length; r += 1) {
    const cells = rows[r];
    const dateRaw = String(cells[dateIdx] || '').trim();
    const textRaw = String(cells[textIdx] || '').trim();
    if (!isValidDateStr(dateRaw)) continue;
    const clean = sanitiseQuote(textRaw);
    if (!clean) continue;
    out.push({ date: dateRaw, text: clean });
  }
  return out;
}
