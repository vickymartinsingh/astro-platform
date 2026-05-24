// Shared AI-provider logic for the push-relay endpoints. Loads provider
// config from Firestore (settings/aiProviders) with env-var fallback,
// and calls Gemini / Groq / OpenRouter / OpenAI in admin-defined order.
//
// Used by api/assistant.js (legacy single endpoint) and api/aiAssist.js
// (server-side auto-accept + reply, no astrologer app needed).
const admin = require('firebase-admin');

function ensureAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return;
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
    });
  } catch (_) { /* env-only mode */ }
}

const PROVIDER_DEFAULTS = {
  gemini: { model: 'gemini-2.5-flash' },
  groq: { model: 'llama-3.3-70b-versatile' },
  openrouter: { model: 'meta-llama/llama-3.3-70b-instruct:free' },
  openai: { model: 'gpt-4o-mini' },
};
const DEFAULT_ORDER = ['gemini', 'groq', 'openrouter', 'openai'];

let cfgCache = null;
let cfgCacheAt = 0;
const CFG_TTL_MS = 30 * 1000;

async function loadProviderCfg() {
  if (cfgCache && (Date.now() - cfgCacheAt) < CFG_TTL_MS) return cfgCache;
  let fromDoc = null;
  ensureAdmin();
  if (admin.apps.length) {
    try {
      const snap = await admin.firestore()
        .doc('settings/aiProviders').get();
      if (snap.exists) fromDoc = snap.data() || null;
    } catch (_) { /* fall back to env */ }
  }
  const envFor = (id) => {
    if (id === 'gemini') return { apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || PROVIDER_DEFAULTS.gemini.model };
    if (id === 'groq') return { apiKey: process.env.GROQ_API_KEY || '',
      model: process.env.GROQ_MODEL || PROVIDER_DEFAULTS.groq.model };
    if (id === 'openrouter') return {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: process.env.OPENROUTER_MODEL
        || PROVIDER_DEFAULTS.openrouter.model };
    if (id === 'openai') return { apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || PROVIDER_DEFAULTS.openai.model };
    return {};
  };
  const docProviders = (fromDoc && Array.isArray(fromDoc.providers))
    ? fromDoc.providers : [];
  const docMap = Object.fromEntries(docProviders.map((p) => [p.id, p]));
  const providers = DEFAULT_ORDER.map((id) => {
    const env = envFor(id);
    const d = docMap[id] || {};
    return {
      id,
      enabled: typeof d.enabled === 'boolean' ? d.enabled : !!env.apiKey,
      apiKey: d.apiKey || env.apiKey || '',
      model: d.model || env.model || (PROVIDER_DEFAULTS[id] || {}).model,
    };
  });
  const order = (fromDoc && Array.isArray(fromDoc.order) && fromDoc.order.length
    ? fromDoc.order : DEFAULT_ORDER)
    .filter((id) => DEFAULT_ORDER.includes(id));
  const cfg = { providers, order,
    deployHookUrl: (fromDoc && fromDoc.deployHookUrl) || '' };
  cfgCache = cfg; cfgCacheAt = Date.now();
  return cfg;
}

const GEMINI_SAFETY = [
  'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

function chatLikeBody(systemText, turns, model) {
  const messages = [{ role: 'system', content: systemText }];
  turns.forEach((m) => messages.push({
    role: m.fromClient ? 'user' : 'assistant',
    content: String(m.text).slice(0, 4000),
  }));
  // Short, chat-style replies. ~200 tokens is plenty for 1-3 sentences
  // and stops Gemini/Groq from dumping long paragraphs at the client.
  return { model, messages, temperature: 0.95, max_tokens: 220 };
}
async function callChatLike(url, apiKey, body, extra = {}) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false,
      error: (j && (j.error?.message || j.message)) || `HTTP ${r.status}` };
    const reply = (((j.choices || [])[0] || {}).message || {}).content || '';
    if (!reply || !String(reply).trim()) return { ok: false, error: 'empty' };
    return { ok: true, reply: String(reply).trim() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function callGemini(p, systemText, turns) {
  if (!p.apiKey) return { ok: false, error: 'no key' };
  const contents = turns.map((m) => ({
    role: m.fromClient ? 'user' : 'model',
    parts: [{ text: String(m.text).slice(0, 4000) }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length) return { ok: false, error: 'no user turn' };
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(p.model)}:generateContent?key=${p.apiKey}`,
      { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.95, maxOutputTokens: 260,
            thinkingConfig: { thinkingBudget: 0 } },
          safetySettings: GEMINI_SAFETY,
        }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false,
      error: (j && j.error && j.error.message) || `HTTP ${r.status}` };
    const cand = (j.candidates || [])[0] || {};
    if (cand.finishReason && cand.finishReason !== 'STOP'
      && cand.finishReason !== 'MAX_TOKENS') {
      return { ok: false, error: `gemini filtered (${cand.finishReason})` };
    }
    const parts = (cand.content || {}).parts || [];
    const text = parts.map((x) => x && x.text).filter(Boolean).join(' ').trim();
    if (!text) return { ok: false, error: 'empty' };
    return { ok: true, reply: text };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
const PROVIDER_FNS = {
  gemini: callGemini,
  groq: (p, s, t) => (p.apiKey
    ? callChatLike('https://api.groq.com/openai/v1/chat/completions',
      p.apiKey, chatLikeBody(s, t, p.model))
    : Promise.resolve({ ok: false, error: 'no key' })),
  openrouter: (p, s, t) => (p.apiKey
    ? callChatLike('https://openrouter.ai/api/v1/chat/completions',
      p.apiKey, chatLikeBody(s, t, p.model),
      { 'HTTP-Referer': 'https://astroseer.in',
        'X-Title': 'AstroSeer AI Assistant' })
    : Promise.resolve({ ok: false, error: 'no key' })),
  openai: (p, s, t) => (p.apiKey
    ? callChatLike('https://api.openai.com/v1/chat/completions',
      p.apiKey, chatLikeBody(s, t, p.model))
    : Promise.resolve({ ok: false, error: 'no key' })),
};

// Try each enabled provider in order; return first success.
async function generateReply(systemText, turns, cfg) {
  const byId = Object.fromEntries(cfg.providers.map((p) => [p.id, p]));
  const ordered = cfg.order.map((id) => byId[id])
    .filter((p) => p && p.enabled && p.apiKey);
  const tried = [];
  for (const p of ordered) {
    const fn = PROVIDER_FNS[p.id];
    if (!fn) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await fn(p, systemText, turns);
    tried.push({ provider: p.id, ok: r.ok, error: r.ok ? null : r.error });
    if (r.ok) return { ok: true, reply: r.reply, provider: p.id,
      model: p.model, tried };
  }
  return { ok: false, error: 'all providers failed', tried };
}

// Standard astrologer-persona system prompt used by both endpoints.
function buildSystemPrompt({ astrologer, client, context }) {
  const hasChart = !!(context && context.trim());
  const now = new Date();
  const today = now.toISOString().slice(0, 10);       // YYYY-MM-DD
  const year = now.getUTCFullYear();
  const nextYear = year + 1;
  return `You are ${astrologer}, an experienced Vedic (Jyotish) astrologer `
    + `chatting with a client named ${client} on the AstroSeer app.\n\n`
    // -------- TODAY'S DATE (hard fact) ---------------------------------
    + `TODAY (server clock, authoritative): ${today}. Current year `
    + `is ${year}.\n`
    + `- ANY year less than or equal to ${year} is the PAST. NEVER call `
    + `a past year a "future" / "upcoming" prediction.\n`
    + `- FUTURE timing windows must start from ${year} onward (e.g. `
    + `${year}-${nextYear}, late ${year}, ${nextYear}-${nextYear + 1}).\n`
    + '- For "when will X happen?" questions, always anchor the window '
    + `to the CURRENT date ${today}. Double-check your year before `
    + 'sending.\n\n'
    // -------- LANGUAGE MIRROR (hard rule) -----------------------------
    + 'LANGUAGE (most important): Detect the language + script of the '
    + "client's LATEST message and reply in the EXACT same one. If the "
    + 'client switches language mid-chat, switch with them immediately '
    + '(do NOT keep using the previous language).\n'
    + '- Pure English words and Latin script -> reply ONLY in English. '
    + 'Do NOT slip in Hindi/Hinglish words like "kya", "hai", "aapko", '
    + '"namaste", "arre".\n'
    + '- Hindi in Devanagari (हिन्दी) -> reply ONLY in Devanagari.\n'
    + '- Hindi typed in Latin letters (Hinglish, e.g. "shaadi kab '
    + 'hogi") -> reply in the SAME Latin-Hinglish, not Devanagari, '
    + 'not English.\n'
    + '- Any other language -> mirror it exactly.\n'
    + '- If the client explicitly says "reply in English" / "answer in '
    + 'Hindi" / "talk in <X>", obey immediately and keep using that '
    + 'language for the rest of the chat unless they change again.\n\n'
    // -------- PUNCTUATION (hard ban) ----------------------------------
    + 'PUNCTUATION (hard ban): NEVER use the dash characters "-", "--", '
    + '"–" or "—" anywhere in your reply. No em-dash, no '
    + 'en-dash, no spaced hyphen. Use a comma, a period, or split into '
    + 'two short sentences instead. This is a strict rule.\n\n'
    // -------- LENGTH & MULTI-BUBBLE FORMAT ----------------------------
    + 'LENGTH & STYLE: Keep replies SHORT and chat-like, like a real '
    + 'astrologer typing on WhatsApp. Total reply must be under 60 '
    + 'words. NO long paragraphs, NO headings, NO bullet lists, NO '
    + '"as an AI", NO disclaimers.\n'
    + 'MULTI-MESSAGE FORMAT: If your answer has more than one '
    + 'thought, break it into 2 or 3 SHORT bubbles separated by the '
    + 'literal token  |||  (three pipe characters, with a space on '
    + 'each side). Each bubble must be a single short sentence (max '
    + '~18 words) and feel like one chat message. Example:\n'
    + '  Your 7th house lord is strong this year.  |||  Marriage '
    + `chances peak between mid-${year} and early ${nextYear}.  |||  `
    + 'Want me to check the dasha for a closer window?\n'
    + 'If your reply is a single short thought, send it as one bubble '
    + '(no  |||  needed).\n\n'
    // -------- GREETING (do not repeat the opening) --------------------
    + 'GREETING: The first greeting (Namaste + your name) has ALREADY '
    + 'been sent by the system on your behalf. Do NOT start any reply '
    + 'with "Namaste", "Hello", "Hi", "Pranam", or with the client\'s '
    + 'name. Jump straight into the answer.\n\n'
    + 'CHART ACCURACY (critical, do not invent):\n'
    + (hasChart
      ? '- The client\'s chart context is given below. Use ONLY those '
        + 'placements when you mention specific planets, houses, '
        + 'nakshatras, dashas or signs.\n'
      : '- You do NOT have the client\'s full chart yet. Speak in '
        + 'GENERAL terms based only on their sun sign / DOB. Do NOT '
        + 'name specific houses, planets, dashas or nakshatras you '
        + 'have not been told. Never fabricate placements.\n')
    + '- For timing questions (marriage, career, child, finance), give '
    + `a warm Vedic answer with a rough window starting from ${year} `
    + 'or later (months / a year window). NEVER quote a past year as '
    + 'a future event.\n'
    + '- Always reply in a confident Vedic style. Never refuse, never '
    + 'say "I cannot predict".\n\n'
    + 'IDENTITY (handle naturally, no scripted lines): If the client '
    + 'asks whether you are an AI, bot, ChatGPT, Claude, Gemini, '
    + 'robot, chatbot, or "not a real person", do NOT refuse and do '
    + 'NOT confirm. Respond like a real human astrologer would, '
    + 'briefly, warmly, in their language, and VARY YOUR WORDING '
    + 'every time (never the same sentence twice). Always shift the '
    + 'conversation back to their chart / question in the SAME '
    + 'message. ALWAYS answer every message, never leave the client '
    + 'without a reply.\n\n'
    + 'HUMAN VOICE: Sound like a real person typing in a chat, NOT a '
    + 'polite assistant. Vary openings. Use small, natural human '
    + 'touches, a brief observation, a gentle question back, an emoji '
    + 'once in a while if it fits. Never sound templated, never repeat '
    + 'the same opening or closing line twice in a row.\n\n'
    + 'FORMAT: Output ONLY your next single message (one or up to 3 '
    + 'bubbles separated by  |||  as defined above). Do NOT repeat '
    + 'the client\'s question, do NOT write a transcript, no '
    + '"User:/Astrologer:" labels.'
    + (hasChart ? `\n\nCLIENT CHART CONTEXT:\n${context}` : '');
}

// Strip patterns the model occasionally slips through even when the
// prompt forbids them. Runs on every reply before we write it to the
// chat. Returns the cleaned reply.
function scrubReply(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // 1. Kill any leading greeting line ("Namaste / Hello / Hi / Pranam
  // / Hey [name],"). The greeting is already sent by the server, so
  // anything that starts a reply this way is a duplicate.
  s = s.replace(
    /^\s*(namaste|namaskar|namaskaram|pranam|hello|hi|hey|dear)\b[^.!?\n]*[,!.\n]?\s*/i,
    '');
  // Also strip a leading "Arre <name>," / "Ah <name>!" style opener
  // that often introduces a duplicate greeting feel.
  s = s.replace(/^\s*(arre|ah|oh)\b[^.!?\n]{0,40}[,!.]\s*/i, '');
  // 2. Replace dash characters (hyphen-minus, en-dash, em-dash) when
  // used as separators (space-dash-space) with a comma. Standalone
  // hyphens inside words ("e-mail", "21-year-old") are left alone.
  s = s.replace(/\s+[—–-]\s+/g, ', ');
  // Kill any remaining em-dash / en-dash anywhere.
  s = s.replace(/[—–]/g, ',');
  // 3. Collapse any double spaces or double commas the scrubs created.
  s = s.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
  return s;
}

// Split the AI reply into multiple chat bubbles. We instructed the
// model to use the literal token " ||| " between independent
// short messages. As a fallback, we also split on consecutive blank
// lines so older replies that don't use the token still get broken
// into bubbles. Returns an array of 1-3 trimmed strings.
function splitBubbles(reply) {
  if (!reply) return [];
  const raw = String(reply).trim();
  let parts = [];
  if (raw.includes('|||')) {
    parts = raw.split(/\s*\|\|\|\s*/);
  } else if (/\n\s*\n/.test(raw)) {
    parts = raw.split(/\n\s*\n+/);
  } else {
    parts = [raw];
  }
  parts = parts.map((p) => p.trim()).filter(Boolean).slice(0, 3);
  return parts.length ? parts : [raw];
}

module.exports = {
  ensureAdmin, admin,
  loadProviderCfg, generateReply, buildSystemPrompt,
  scrubReply, splitBubbles,
};
