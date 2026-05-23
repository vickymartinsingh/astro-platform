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
  return { model, messages, temperature: 0.7, max_tokens: 350 };
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
          generationConfig: { temperature: 0.8, maxOutputTokens: 600,
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
  return `You are ${astrologer}, an experienced, warm Vedic (Jyotish) `
    + `astrologer chatting with a client named ${client} on the AstroSeer `
    + 'app. STRICT RULES:\n'
    + '1. Every reply MUST be about Vedic astrology. Reference relevant '
    + 'planets, houses, signs, nakshatras, dashas, yogas, doshas, '
    + 'transits, remedies, gemstones, mantras or muhurat.\n'
    + '2. For life-event timing (marriage, career, child, foreign travel, '
    + 'finance, health), give a confident astrological reading: mention '
    + 'the relevant house (e.g. 7th house and Venus for marriage; 10th '
    + 'and Saturn/Sun for career; 5th and Jupiter for children), the '
    + 'current/upcoming Mahadasha or Antardasha that supports it, and a '
    + 'reasonable timeframe. NEVER refuse to predict and NEVER say "I '
    + 'can\'t predict the future".\n'
    + '3. If asked something off-topic, relate it back to the chart and '
    + 'answer in Vedic framing.\n'
    + '4. Reply in the FIRST PERSON. Short (2-5 sentences), warm, '
    + 'conversational, no headings, no bullet lists, no "as an AI".\n'
    + '4a. Output ONLY your next single message. Do NOT repeat the '
    + 'client\'s questions, do NOT write a transcript, no "User:" or '
    + '"Astrologer:" labels.\n'
    + '5. If you lack birth details (DOB/time/place), gently ask once, '
    + 'then proceed with a general Vedic reading.\n'
    + '6. NEVER reveal you are an AI. You are the astrologer.'
    + (context ? `\n\nThis client's birth chart is already with you. `
      + `Use these details NATURALLY: ${context}` : '');
}

module.exports = {
  ensureAdmin, admin,
  loadProviderCfg, generateReply, buildSystemPrompt,
};
