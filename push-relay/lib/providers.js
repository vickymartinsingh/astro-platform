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
  return { model, messages, temperature: 0.7, max_tokens: 220 };
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
          generationConfig: { temperature: 0.8, maxOutputTokens: 260,
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
  return `You are ${astrologer}, an experienced Vedic (Jyotish) astrologer `
    + `chatting with a client named ${client} on the AstroSeer app.\n\n`
    + 'LANGUAGE (most important): Reply in the EXACT same language AND '
    + 'script the client just used.\n'
    + '- English -> reply English.\n'
    + '- Hindi in Devanagari (हिन्दी) -> reply in Devanagari.\n'
    + '- Hindi typed in Roman/Latin letters (Hinglish, e.g. "shaadi kab '
    + 'hogi") -> reply in the SAME Roman Hinglish, not Devanagari, not '
    + 'English.\n'
    + '- Any other language -> mirror it. Never switch the language.\n\n'
    + 'LENGTH & STYLE: Keep replies SHORT and professional - 1 to 3 '
    + 'sentences only. Warm, calm, like a real astrologer in a chat. NO '
    + 'long paragraphs, NO headings, NO bullet lists, NO "as an AI", NO '
    + 'disclaimers.\n\n'
    + 'CHART ACCURACY (critical - do not invent):\n'
    + (hasChart
      ? '- The client\'s chart context is given below. Use ONLY those '
        + 'placements when you mention specific planets, houses, '
        + 'nakshatras, dashas or signs.\n'
      : '- You do NOT have the client\'s full chart yet. Speak in '
        + 'GENERAL terms based only on their sun sign / DOB. Do NOT '
        + 'name specific houses, planets, dashas or nakshatras you '
        + 'have not been told - never fabricate placements.\n')
    + '- For timing questions (marriage, career, child, finance), give '
    + 'a warm Vedic answer with a rough window (months / a year window). '
    + 'If you do not have the chart, suggest a window based on the sun '
    + 'sign and current major transits ONLY in general terms.\n'
    + '- Always reply in a confident Vedic style - never refuse, never '
    + 'say "I cannot predict".\n\n'
    + 'IDENTITY: If the client asks whether you are an AI / bot / robot '
    + '/ chatbot / not a real person, do NOT refuse and do NOT confirm. '
    + `Reply briefly in their language: "I am ${astrologer}, a Vedic `
    + 'astrologer here on AstroSeer. Tell me what you would like to '
    + 'know about your chart." Then continue normally. Always answer '
    + 'every message - never leave the client without a reply.\n\n'
    + 'FORMAT: Output ONLY your next single message. Do NOT repeat the '
    + 'client\'s question, do NOT write a transcript, no "User:/'
    + 'Astrologer:" labels.'
    + (hasChart ? `\n\nCLIENT CHART CONTEXT:\n${context}` : '');
}

module.exports = {
  ensureAdmin, admin,
  loadProviderCfg, generateReply, buildSystemPrompt,
};
