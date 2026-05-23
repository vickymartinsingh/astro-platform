// AI assistant for AstroSeer astrologers (server-side only).
//
// Multi-provider relay. Reads provider config + API keys live from
// Firestore (admin-managed via the admin AI page) so secrets stay
// server-side and the admin can swap providers / keys without touching
// code. Falls back to env vars when Firestore is empty or unreachable.
//
// Supported providers (try in admin-defined order until one succeeds):
//   gemini     - Google Gemini (free tier, no card needed)
//   groq       - Groq Cloud (free tier, Llama-3.x, very fast)
//   openrouter - OpenRouter (many models, free tier ones available)
//   openai     - OpenAI (paid)
//
// Bedrock was removed: AWS billing + Marketplace agreements were a poor
// fit for this use case. Gemini + Groq are free and reliable.

const admin = require('firebase-admin');
function ensureAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return;
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
    });
  } catch (_) { /* leave env-only mode */ }
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
    if (id === 'gemini') {
      return { apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || PROVIDER_DEFAULTS.gemini.model };
    }
    if (id === 'groq') {
      return { apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || PROVIDER_DEFAULTS.groq.model };
    }
    if (id === 'openrouter') {
      return { apiKey: process.env.OPENROUTER_API_KEY || '',
        model: process.env.OPENROUTER_MODEL
          || PROVIDER_DEFAULTS.openrouter.model };
    }
    if (id === 'openai') {
      return { apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || PROVIDER_DEFAULTS.openai.model };
    }
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
    .filter((id) => DEFAULT_ORDER.includes(id)); // drop legacy 'bedrock'
  const cfg = { providers, order,
    deployHookUrl: (fromDoc && fromDoc.deployHookUrl) || '' };
  cfgCache = cfg; cfgCacheAt = Date.now();
  return cfg;
}

// ---- Provider call helpers (each returns {ok, reply?, error?}) ----------

function chatLikeBody(systemText, turns, model) {
  const messages = [{ role: 'system', content: systemText }];
  turns.forEach((m) => messages.push({
    role: m.fromClient ? 'user' : 'assistant',
    content: String(m.text).slice(0, 4000),
  }));
  return { model, messages, temperature: 0.7, max_tokens: 300 };
}
async function callChatLike(url, apiKey, body, extraHeaders = {}) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false,
        error: (j && (j.error?.message || j.message)) || `HTTP ${r.status}` };
    }
    const reply = (((j.choices || [])[0] || {}).message || {}).content || '';
    if (!reply || !String(reply).trim()) {
      return { ok: false, error: 'empty reply' };
    }
    return { ok: true, reply: String(reply).trim() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Gemini's default safety filters often refuse routine astrology Qs
// (marriage timing, future predictions etc) and return an empty reply.
// Disable all four safety blocks so the AI can answer like a real
// astrologer would. This is an astrology consultation, not adult/violent
// content, so BLOCK_NONE is appropriate.
const GEMINI_SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

async function callGemini(p, systemText, turns) {
  if (!p.apiKey) return { ok: false, error: 'no key' };
  const contents = turns
    .map((m) => ({ role: m.fromClient ? 'user' : 'model',
      parts: [{ text: String(m.text).slice(0, 4000) }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length) return { ok: false, error: 'no user turn' };
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(p.model)}:generateContent?key=${p.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.8, maxOutputTokens: 350 },
          safetySettings: GEMINI_SAFETY,
        }),
      });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false,
      error: (j && j.error && j.error.message) || `HTTP ${r.status}` };
    const cand = (j.candidates || [])[0] || {};
    // If Gemini blocked / filtered the answer, surface that as an error
    // so the relay falls through to the next provider (Groq etc).
    if (cand.finishReason && cand.finishReason !== 'STOP'
      && cand.finishReason !== 'MAX_TOKENS') {
      return { ok: false,
        error: `gemini filtered (${cand.finishReason})` };
    }
    const parts = (cand.content || {}).parts || [];
    const text = parts.map((x) => x && x.text).filter(Boolean).join(' ').trim();
    if (!text) return { ok: false, error: 'empty reply' };
    return { ok: true, reply: text };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function callGroq(p, systemText, turns) {
  if (!p.apiKey) return Promise.resolve({ ok: false, error: 'no key' });
  return callChatLike('https://api.groq.com/openai/v1/chat/completions',
    p.apiKey, chatLikeBody(systemText, turns, p.model));
}
function callOpenRouter(p, systemText, turns) {
  if (!p.apiKey) return Promise.resolve({ ok: false, error: 'no key' });
  return callChatLike('https://openrouter.ai/api/v1/chat/completions',
    p.apiKey, chatLikeBody(systemText, turns, p.model),
    { 'HTTP-Referer': 'https://astroseer.in',
      'X-Title': 'AstroSeer AI Assistant' });
}
function callOpenAI(p, systemText, turns) {
  if (!p.apiKey) return Promise.resolve({ ok: false, error: 'no key' });
  return callChatLike('https://api.openai.com/v1/chat/completions',
    p.apiKey, chatLikeBody(systemText, turns, p.model));
}

const PROVIDER_FNS = {
  gemini: callGemini, groq: callGroq, openrouter: callOpenRouter,
  openai: callOpenAI,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-assistant-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const cfg = await loadProviderCfg();
  const byId = Object.fromEntries(cfg.providers.map((p) => [p.id, p]));
  const orderedActive = cfg.order
    .map((id) => byId[id])
    .filter((p) => p && p.enabled && p.apiKey);

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: orderedActive.length > 0,
      providers: cfg.providers.map((p) => ({
        id: p.id, enabled: p.enabled, hasKey: !!p.apiKey, model: p.model,
      })),
      order: cfg.order,
      active: orderedActive.map((p) => p.id),
      hasDeployHook: !!cfg.deployHookUrl,
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const guard = process.env.ASSISTANT_RELAY_KEY;
  if (guard && req.headers['x-assistant-key'] !== guard) {
    return res.status(401).json({ error: 'bad key' });
  }
  if (!orderedActive.length) {
    return res.status(503).json({
      error: 'No AI provider configured. Add a key in admin -> AI Assistant.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const astrologer = String(body.astrologerName || 'the astrologer');
  const client = String(body.clientName || 'the client');
  const context = String(body.context || '').slice(0, 2000);
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (!history.length) {
    return res.status(400).json({ error: 'messages required' });
  }
  const systemText = `You are ${astrologer}, an experienced, warm Vedic `
    + `(Jyotish) astrologer chatting with a client named ${client} on `
    + 'the AstroSeer app. STRICT RULES:\n'
    + '1. Every reply MUST be about Vedic astrology. Reference the '
    + 'relevant planets, houses, signs, nakshatras, dashas, yogas, '
    + 'doshas, transits, remedies, gemstones, mantras or muhurat that '
    + 'apply to the question.\n'
    + '2. For life-event timing questions (marriage, career, child, '
    + 'foreign travel, finance, health), give a confident astrological '
    + 'reading: mention the relevant house (e.g. 7th house and Venus '
    + 'for marriage; 10th and Saturn/Sun for career; 5th and Jupiter '
    + 'for children; 12th for foreign travel), the current/upcoming '
    + 'Mahadasha or Antardasha that supports the event, and a '
    + 'reasonable timeframe (a year window or a planetary period). '
    + 'Never refuse to predict and never say "I can\'t predict the '
    + 'future" - speak like a real human astrologer giving guidance.\n'
    + '3. If the client asks something off-topic, briefly relate it '
    + 'back to the chart (e.g. "from your karmic placements...") and '
    + 'answer in Vedic framing.\n'
    + '4. Reply in the FIRST PERSON as the astrologer. Keep replies '
    + 'short (2-5 sentences), warm, natural, conversational - no '
    + 'headings, no bullet lists, no "as an AI" or any disclaimers.\n'
    + '5. If you genuinely lack the birth details (DOB / time / place), '
    + 'gently ask once, then proceed with a general Vedic reading.\n'
    + '6. NEVER reveal you are an AI. You are the astrologer.'
    + (context ? `\n\nThis client\'s birth chart is already with you. `
      + `Use these details NATURALLY in every answer: ${context}` : '');
  const turns = history.filter((m) => m && m.text
    && String(m.text).trim());
  if (!turns.length) {
    return res.status(400).json({ error: 'no client message' });
  }

  const tried = [];
  for (const p of orderedActive) {
    const fn = PROVIDER_FNS[p.id];
    if (!fn) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await fn(p, systemText, turns);
    tried.push({ provider: p.id, ok: r.ok, error: r.ok ? null : r.error });
    if (r.ok) {
      return res.status(200).json({
        reply: r.reply, provider: p.id, model: p.model,
      });
    }
  }
  return res.status(502).json({ error: 'all providers failed', tried });
};
