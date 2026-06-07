// Daily quote banner ("Hey, Cosmic Explorer" + a rotating quote of
// the day). Lives at settings/dailyQuotes so it shares the same
// admin-write / world-read rule as every other settings doc and pushes
// live to the customer dashboard via onSnapshot.
//
// Document shape:
//   enabled    boolean        - master toggle (default false). The
//                              customer banner ONLY renders when this
//                              is true; flipping the toggle is the
//                              "show / hide" lever the operator asked
//                              for.
//   title      string         - greeting line (default
//                              "Hey, Cosmic Explorer")
//   subtitle   string         - small line above the quote (optional)
//   quotes     string[]       - the pool. One is shown per calendar
//                              day, picked deterministically by
//                              dayOfYear % quotes.length so the same
//                              quote shows the whole day across
//                              devices but the choice rolls each
//                              midnight.
//   updatedAt  serverTimestamp
//
// HARD RULE: NO HYPHENS OR DASHES inside a quote. The operator was
// explicit about this; em-dashes are also a project-wide ban. We
// sanitise on EVERY write so corrupt rows from CSV imports cannot
// sneak past the UI.

import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULTS = {
  enabled: false,
  title: 'Hey, Cosmic Explorer',
  // Subtitle is optional (operator: "no need to specify as Quote for
  // the day"). Customer banner hides the kicker line entirely when
  // empty; admin can still type one in if they want a label later.
  subtitle: '',
  // 30 seed quotes - all positive, all cosmos / astrology themed,
  // zero hyphens or dashes. Used when settings/dailyQuotes has no
  // quotes array yet OR the operator clicks "Restore seed quotes".
  quotes: [
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
  ],
};

// Strip every kind of dash + hyphen and collapse the whitespace. Used
// on EVERY save (admin + CSV import) and also at render time as a
// belt-and-braces guard.
export function sanitiseQuote(raw) {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');
  // En-dash, em-dash, minus, hyphen, soft-hyphen, non-breaking hyphen
  // and other dash-family glyphs all become a single space. The class
  // is enumerated by codepoint (no ranges) so a stray character order
  // can't make the regex unparseable.
  s = s.replace(/[-­‐‑‒–—―⁃−⸺⸻]/g, ' ');
  // Collapse runs of whitespace + trim.
  s = s.replace(/\s+/g, ' ').trim();
  // Strip wrapping quotation marks the operator might have pasted.
  s = s.replace(/^["'“”‘’]+/, '');
  s = s.replace(/["'“”‘’]+$/, '');
  return s;
}

// True when the raw input would survive the sanitiser AND be non-empty.
// Used by the admin form to disable Add until the operator has typed
// something real.
export function isValidQuote(raw) {
  return sanitiseQuote(raw).length > 0;
}

// Public read.
export async function getDailyQuotes() {
  try {
    const s = await getDoc(doc(db, 'settings', 'dailyQuotes'));
    if (!s.exists()) return { ...DEFAULTS };
    const d = s.data() || {};
    return {
      enabled: !!d.enabled,
      title: d.title || DEFAULTS.title,
      subtitle: d.subtitle || DEFAULTS.subtitle,
      quotes: Array.isArray(d.quotes) && d.quotes.length
        ? d.quotes.map(sanitiseQuote).filter(Boolean)
        : [...DEFAULTS.quotes],
    };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function listenDailyQuotes(cb) {
  return onSnapshot(doc(db, 'settings', 'dailyQuotes'), (s) => {
    const d = s.exists() ? (s.data() || {}) : {};
    cb({
      enabled: !!d.enabled,
      title: d.title || DEFAULTS.title,
      subtitle: d.subtitle || DEFAULTS.subtitle,
      quotes: Array.isArray(d.quotes) && d.quotes.length
        ? d.quotes.map(sanitiseQuote).filter(Boolean)
        : [...DEFAULTS.quotes],
    });
  }, () => cb({ ...DEFAULTS }));
}

// Admin write. Sanitises every quote, dedupes case-insensitively, and
// keeps a stable order so removing one doesn't reshuffle the day's
// pick for users who haven't refreshed yet.
export async function saveDailyQuotes(state) {
  const cleaned = [];
  const seen = new Set();
  (Array.isArray(state.quotes) ? state.quotes : []).forEach((q) => {
    const s = sanitiseQuote(q);
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push(s);
  });
  await setDoc(doc(db, 'settings', 'dailyQuotes'), {
    enabled: !!state.enabled,
    title: sanitiseQuote(state.title) || DEFAULTS.title,
    subtitle: sanitiseQuote(state.subtitle) || '',
    quotes: cleaned,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return cleaned.length;
}

// Day of the year (1..366) - stable for the user's local midnight.
export function dayOfYear(date) {
  const d = date instanceof Date ? date : new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// The quote for today, picked deterministically from the pool. Falls
// back to a constant when the pool is empty.
export function quoteForToday(quotes, when) {
  const pool = (quotes || []).filter(Boolean);
  if (pool.length === 0) return DEFAULTS.quotes[0];
  return pool[dayOfYear(when) % pool.length];
}

// CSV parser tuned for the simple cases we expect:
//   - one quote per line (the common case)
//   - one quote per row in a single-column CSV
//   - first column of a multi-column CSV
// Handles double-quote escaping per RFC 4180 (".." -> "). Lines that
// reduce to an empty / invalid quote after sanitisation are dropped.
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
      // Eat a CRLF as a single line break.
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur); rows.push(row);
  }
  const out = [];
  rows.forEach((r) => {
    const first = (r[0] || '').trim();
    if (!first) return;
    // Skip a likely header row.
    if (/^quote$/i.test(first) || /^quotes$/i.test(first)) return;
    const s = sanitiseQuote(first);
    if (s) out.push(s);
  });
  return out;
}
