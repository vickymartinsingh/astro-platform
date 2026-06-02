// Live-stream bot audience service.
//
// Bots are stored at liveBots/{botId} where botId is a 7-digit
// numeric code, mirroring the 8-digit session id pattern - the
// number IS the doc id, no parallel mapping table.
//
// Fields per bot:
//   { code, name, type: 'full'|'single', enabled, createdAt }
//
// Questions: liveBotQuestions/{qid}
//   { text, createdAt }
//
// Config: settings/config.live_bots_* (master switch, rates, scope).
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc,
  query, where, limit, orderBy, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { FIRST_NAMES, SURNAMES, SEED_QUESTIONS } from '../liveBotNames.js';

// ====== 7-digit id mint ======
// Range 1000000-9999999 = 9 million slots. We retry up to 5 times
// on collision and fall back to a Date-derived suffix. Caller can
// pass an existingCodes Set to skip an extra getDoc on bulk seeds.
export function newBotCode(existing) {
  for (let i = 0; i < 5; i += 1) {
    const n = 1000000 + Math.floor(Math.random() * 9000000);
    const s = String(n);
    if (!existing || !existing.has(s)) return s;
  }
  return String(Date.now()).slice(-7);
}

// ====== Name generator ======
// ~70% full name (first + surname), ~30% single name. Used during
// bulk seed and as defaults when admin adds a bot without typing a
// name (just hits Generate).
export function generateBotName() {
  const first = FIRST_NAMES[Math.floor(Math.random()
    * FIRST_NAMES.length)];
  const wantFull = Math.random() < 0.7;
  if (!wantFull) return { name: first, type: 'single' };
  const last = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  return { name: `${first} ${last}`, type: 'full' };
}

// ====== CRUD ======
export async function listBots({ pageSize = 100, lastDoc = null } = {}) {
  let q = query(collection(db, 'liveBots'),
    orderBy('createdAt', 'desc'), limit(pageSize));
  // Note: pagination by lastDoc would use startAfter; client-side
  // search reads the first page and filters in memory which is
  // plenty for the ~5k pool size we target.
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function listAllBots() {
  // Bulk-read everything. Used by admin search + by the relay's
  // live tick when it needs to pick a random bot not yet in a
  // session's viewer list.
  const snap = await getDocs(collection(db, 'liveBots'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getBotsCount() {
  // Cheaper than reading every doc: use a counter doc if you ever
  // add one. For now we just read and count.
  const snap = await getDocs(collection(db, 'liveBots'));
  return snap.size;
}
export async function createBot({ name, type, enabled = true,
  code = null }) {
  const id = code || newBotCode();
  await setDoc(doc(db, 'liveBots', id), {
    code: id,
    name: String(name || '').trim() || 'Anonymous',
    type: type || (name && name.includes(' ') ? 'full' : 'single'),
    enabled: enabled !== false,
    createdAt: serverTimestamp(),
  });
  return id;
}
export async function updateBot(id, patch) {
  await updateDoc(doc(db, 'liveBots', id), patch);
}
export async function deleteBot(id) {
  await deleteDoc(doc(db, 'liveBots', id));
}

// ====== Bulk seed ======
// Generates `n` bots and writes them in batches of 400. Avoids
// collisions by pre-loading existing codes. Returns the count
// actually written.
export async function bulkSeedBots(n = 5000, onProgress = null) {
  const existingSnap = await getDocs(collection(db, 'liveBots'));
  const existing = new Set(existingSnap.docs.map((d) => d.id));
  let written = 0;
  const batchSize = 400;
  for (let i = 0; i < n; i += batchSize) {
    const batch = writeBatch(db);
    const count = Math.min(batchSize, n - i);
    for (let j = 0; j < count; j += 1) {
      const id = newBotCode(existing);
      existing.add(id);
      const { name, type } = generateBotName();
      batch.set(doc(db, 'liveBots', id), {
        code: id, name, type, enabled: true,
        createdAt: serverTimestamp(),
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    written += count;
    if (typeof onProgress === 'function') onProgress(written, n);
  }
  return written;
}

// ====== CSV import / export ======
// Template column order: code,name,type,enabled
// `code` may be blank - we mint one. `type` may be blank - we infer
// from name. `enabled` may be blank - default true.
export function csvTemplate() {
  return 'code,name,type,enabled\n'
    + ',Aarav Sharma,full,true\n'
    + ',Riya,single,true\n'
    + '1234567,Manish Verma,full,true\n';
}
export async function importCsv(csv, onProgress = null) {
  const rows = String(csv || '').split(/\r?\n/)
    .map((r) => r.trim()).filter(Boolean);
  if (rows.length === 0) return 0;
  // Skip header if present.
  const header = rows[0].toLowerCase();
  const start = header.startsWith('code,') ? 1 : 0;
  const parsed = [];
  for (let i = start; i < rows.length; i += 1) {
    const cols = rows[i].split(',').map((c) => c.trim());
    const [code, name, type, enabled] = cols;
    if (!name) continue;
    parsed.push({ code: code || null, name,
      type: type || (name.includes(' ') ? 'full' : 'single'),
      enabled: enabled == null || enabled === ''
        ? true : enabled.toLowerCase() === 'true' });
  }
  const existingSnap = await getDocs(collection(db, 'liveBots'));
  const existing = new Set(existingSnap.docs.map((d) => d.id));
  const batchSize = 400;
  let written = 0;
  for (let i = 0; i < parsed.length; i += batchSize) {
    const batch = writeBatch(db);
    const slice = parsed.slice(i, i + batchSize);
    for (const p of slice) {
      const id = p.code || newBotCode(existing);
      existing.add(id);
      batch.set(doc(db, 'liveBots', id), {
        code: id, name: p.name, type: p.type,
        enabled: p.enabled !== false,
        createdAt: serverTimestamp(),
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    written += slice.length;
    if (typeof onProgress === 'function') onProgress(written, parsed.length);
  }
  return written;
}
export function exportCsv(bots) {
  const head = 'code,name,type,enabled';
  const body = bots.map((b) =>
    `${b.code || b.id},${(b.name || '').replace(/,/g, ' ')},`
    + `${b.type || 'single'},${b.enabled === false ? 'false' : 'true'}`)
    .join('\n');
  return `${head}\n${body}\n`;
}

// ====== Question pool ======
export async function listQuestions() {
  const snap = await getDocs(query(collection(db, 'liveBotQuestions'),
    orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function createQuestion(text) {
  const t = String(text || '').trim().replace(/[‐-―-]/g, ' ');
  if (!t) return null;
  const ref = doc(collection(db, 'liveBotQuestions'));
  await setDoc(ref, { text: t, createdAt: serverTimestamp() });
  return ref.id;
}
export async function updateQuestion(id, text) {
  const t = String(text || '').trim().replace(/[‐-―-]/g, ' ');
  await updateDoc(doc(db, 'liveBotQuestions', id), { text: t });
}
export async function deleteQuestion(id) {
  await deleteDoc(doc(db, 'liveBotQuestions', id));
}
export async function bulkSeedQuestions(onProgress = null) {
  // Seeds the SEED_QUESTIONS pool, dropping duplicates that already
  // exist (matched by text). Used by /admin-live-bots quick-seed
  // button when the pool is empty.
  const existingSnap = await getDocs(collection(db, 'liveBotQuestions'));
  const existing = new Set(existingSnap.docs.map((d) =>
    (d.data().text || '').trim().toLowerCase()));
  const toAdd = SEED_QUESTIONS.filter((q) =>
    !existing.has(q.trim().toLowerCase()));
  let written = 0;
  for (let i = 0; i < toAdd.length; i += 400) {
    const batch = writeBatch(db);
    toAdd.slice(i, i + 400).forEach((q) => {
      const ref = doc(collection(db, 'liveBotQuestions'));
      batch.set(ref, { text: q, createdAt: serverTimestamp() });
    });
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    written += Math.min(400, toAdd.length - i);
    if (typeof onProgress === 'function') {
      onProgress(written, toAdd.length);
    }
  }
  return written;
}

// ====== Config ======
// settings/config keys (read only here; admin-settings or
// admin-live-bots writes).
//   live_bots_enabled          : boolean master switch
//   live_bots_join_rate_sec    : seconds between bot viewer joins
//   live_bots_comment_rate_sec : seconds between bot chat messages
//   live_bots_scope            : 'all' | 'allowlist'
//   live_bots_astro_uids       : array of uids when scope='allowlist'
export const BOT_CONFIG_KEYS = [
  'live_bots_enabled',
  'live_bots_join_rate_sec',
  'live_bots_comment_rate_sec',
  'live_bots_scope',
  'live_bots_astro_uids',
];
export const BOT_CONFIG_DEFAULTS = {
  live_bots_enabled: false,
  live_bots_join_rate_sec: 12,
  live_bots_comment_rate_sec: 35,
  live_bots_scope: 'all',
  live_bots_astro_uids: [],
};
export async function getBotConfig() {
  try {
    const s = await getDoc(doc(db, 'settings', 'config'));
    const d = s.exists() ? (s.data() || {}) : {};
    const out = { ...BOT_CONFIG_DEFAULTS };
    for (const k of BOT_CONFIG_KEYS) {
      if (d[k] != null) out[k] = d[k];
    }
    return out;
  } catch (_) { return { ...BOT_CONFIG_DEFAULTS }; }
}
// Check whether bots are enabled for a given astrologer. Honors
// master switch + scope.
export function botsActiveForAstro(cfg, astroUid) {
  if (!cfg) return false;
  if (!cfg.live_bots_enabled) return false;
  if (cfg.live_bots_scope === 'allowlist') {
    const arr = Array.isArray(cfg.live_bots_astro_uids)
      ? cfg.live_bots_astro_uids : [];
    return arr.includes(astroUid);
  }
  return true;
}

// ====== Live-stream injection ======
// Pull a small random page from /liveBots once and cache it client-
// side so we don't read the whole 5000-doc collection for every
// tick. Refreshed when 1) the page is exhausted (cycled through all
// cached bots) or 2) the cache is older than 10 minutes.
//
// NOTE: we deliberately DO NOT use a Firestore `where('enabled', '!=',
// false)` filter here. The inequality query (a) requires a composite
// index, (b) silently drops docs that have no `enabled` field at all
// (e.g. CSV-imported bots that left the column blank), and (c) makes
// rule-deny errors look like "no bots in pool". Client-side filter
// is cheaper, kinder to indexes, and surfaces every bot the rules
// let us read.
const BOT_CACHE = { items: [], used: new Set(), ts: 0 };
async function refreshCache(force = false) {
  const fresh = !force && (Date.now() - BOT_CACHE.ts < 10 * 60_000)
    && BOT_CACHE.items.length > 0;
  if (fresh) return;
  try {
    const snap = await getDocs(query(collection(db, 'liveBots'),
      limit(500)));
    BOT_CACHE.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => b.enabled !== false);
    BOT_CACHE.used = new Set();
    BOT_CACHE.ts = Date.now();
    // eslint-disable-next-line no-console
    console.log('[liveBots] loaded', BOT_CACHE.items.length, 'bots');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[liveBots] read failed:',
      (e && e.message) || e);
    throw e;
  }
}

// Same caching pattern for questions, 5-min TTL.
const QCACHE = { items: [], ts: 0 };
async function refreshQuestions() {
  if (Date.now() - QCACHE.ts < 5 * 60_000 && QCACHE.items.length > 0) {
    return;
  }
  try {
    const snap = await getDocs(query(collection(db, 'liveBotQuestions'),
      limit(500)));
    QCACHE.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.text);
    QCACHE.ts = Date.now();
    // eslint-disable-next-line no-console
    console.log('[liveBots] loaded', QCACHE.items.length, 'questions');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[liveBots] questions read failed:',
      (e && e.message) || e);
    throw e;
  }
}

// Pick a random bot that hasn't been picked YET (per the current
// cache cycle). Returns null if no bots exist.
export async function pickRandomBot() {
  await refreshCache();
  if (BOT_CACHE.items.length === 0) return null;
  // If everyone was already picked, reset the used set (cycle).
  if (BOT_CACHE.used.size >= BOT_CACHE.items.length) {
    BOT_CACHE.used = new Set();
  }
  let safety = 25;
  while (safety-- > 0) {
    const cand = BOT_CACHE.items[Math.floor(Math.random()
      * BOT_CACHE.items.length)];
    const id = cand.code || cand.id;
    if (!BOT_CACHE.used.has(id)) {
      BOT_CACHE.used.add(id);
      return cand;
    }
  }
  return BOT_CACHE.items[Math.floor(Math.random()
    * BOT_CACHE.items.length)];
}

// Pick a question that has NOT been asked yet within the current
// usedQuestionIds set (per-session uniqueness, passed by caller).
export async function pickQuestion(usedQuestionIds) {
  await refreshQuestions();
  if (QCACHE.items.length === 0) return null;
  let safety = 25;
  const used = usedQuestionIds instanceof Set
    ? usedQuestionIds : new Set();
  while (safety-- > 0) {
    const q = QCACHE.items[Math.floor(Math.random()
      * QCACHE.items.length)];
    if (!used.has(q.id)) { used.add(q.id); return q; }
  }
  // Pool exhausted within this session; reuse the freshest one.
  return QCACHE.items[Math.floor(Math.random() * QCACHE.items.length)];
}

// Publish a bot event into the SAME live chat messages collection
// the astrologer + viewers already subscribe to. `kind` is either
// 'join' (viewer joined - just the name on screen) or 'comment'
// (name + question). Marked _bot:true so the live UI can style
// them subtly if wanted; otherwise they look like real messages.
export async function publishBotEvent(astroUid, { kind, name,
  code, text }) {
  if (!astroUid || !name) return;
  const ref = doc(collection(db, 'chats',
    `live_${astroUid}`, 'messages'));
  await setDoc(ref, {
    type: kind === 'comment' ? 'comment' : 'join',
    name,
    code: code || '',
    text: text || '',
    _bot: true,
    senderId: `bot_${code || ''}`,
    createdAt: serverTimestamp(),
  });
}

// Admin diagnostic: fires a burst of N bot events into one
// astrologer's live chat right now. Used by the "Fire 5 events"
// button on /admin-live-bots Settings tab so the operator can
// prove the pipeline works without waiting for the astrologer
// to go live + a fresh deploy.
//
// Returns { joins, comments, errors[] } so the UI can report what
// got through and what bounced.
export async function fireDiagnosticBurst(astroUid,
  { joins = 3, comments = 2 } = {}) {
  const out = { joins: 0, comments: 0, errors: [] };
  if (!astroUid) { out.errors.push('no astroUid'); return out; }
  const usedQs = new Set();
  for (let i = 0; i < joins; i += 1) {
    try {
      const b = await pickRandomBot();
      if (!b) { out.errors.push('no bot in pool'); continue; }
      // eslint-disable-next-line no-await-in-loop
      await publishBotEvent(astroUid, { kind: 'join',
        name: b.name, code: b.code || b.id });
      out.joins += 1;
    } catch (e) {
      out.errors.push(`join: ${(e && e.message) || e}`);
    }
  }
  for (let i = 0; i < comments; i += 1) {
    try {
      const b = await pickRandomBot();
      // eslint-disable-next-line no-await-in-loop
      const q = await pickQuestion(usedQs);
      if (!b || !q) {
        out.errors.push(`comment ${i}: bot=${!!b} q=${!!q}`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await publishBotEvent(astroUid, { kind: 'comment',
        name: b.name, code: b.code || b.id, text: q.text });
      out.comments += 1;
    } catch (e) {
      out.errors.push(`comment: ${(e && e.message) || e}`);
    }
  }
  return out;
}
