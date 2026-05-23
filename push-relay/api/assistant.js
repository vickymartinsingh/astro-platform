// AI assistant for AstroSeer astrologers (server-side only).
//
// The astrologer app calls this when "AI Assistant" is ON and a chat
// message arrives. The relay calls an LLM with the persona / kundli /
// history and returns the astrologer's reply. The provider keys NEVER
// leave this relay - they are never bundled into the app or web build.
//
// Providers (in preference order):
//   1) Google Gemini (free tier, no card needed) - if GEMINI_API_KEY is set.
//   2) Amazon Bedrock Claude - if BEDROCK_API_KEY is set.
// You only need ONE. The relay tries Gemini first (it is free) and falls
// back to Bedrock if Gemini fails or has no key.
//
// Env vars (set in Vercel -> push-relay project):
//   GEMINI_API_KEY    - free Google AI Studio key (aistudio.google.com)
//   GEMINI_MODEL      - optional, default `gemini-2.5-flash`
//   BEDROCK_API_KEY   - optional, AWS Bedrock long-term API key (ABSK...)
//   BEDROCK_REGION    - optional, default us-west-2
//   BEDROCK_MODEL_ID  - optional. If unset the relay auto-picks from a
//                       Claude candidate list (Opus -> Sonnet -> Haiku),
//                       prefixed for the region group (us./eu./apac.).
//   ASSISTANT_RELAY_KEY - optional shared secret (x-assistant-key header)

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const REGION = process.env.BEDROCK_REGION || 'us-west-2';
const PFX = REGION.startsWith('ap-') ? 'apac.'
  : REGION.startsWith('eu-') ? 'eu.' : 'us.';
const MODEL_CANDIDATES = [
  process.env.BEDROCK_MODEL_ID,
  `${PFX}anthropic.claude-opus-4-1-20250805-v1:0`,
  `${PFX}anthropic.claude-sonnet-4-20250514-v1:0`,
  `${PFX}anthropic.claude-3-7-sonnet-20250219-v1:0`,
  `${PFX}anthropic.claude-3-5-sonnet-20241022-v2:0`,
  'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
].filter(Boolean);
let resolvedModel = null;

// --- Gemini (free tier) ---------------------------------------------------
async function callGemini(systemText, turns) {
  if (!GEMINI_KEY) return { ok: false, status: 0, error: 'no GEMINI_API_KEY' };
  // Gemini expects user / model roles + a systemInstruction.
  const contents = turns.map((m) => ({
    role: m.fromClient ? 'user' : 'model',
    parts: [{ text: String(m.text).slice(0, 4000) }],
  }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length) return { ok: false, status: 400, error: 'no user turn' };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_KEY}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, status: r.status,
        error: (j && j.error && j.error.message) || 'gemini error' };
    }
    const reply = (((j.candidates || [])[0] || {}).content || {}).parts;
    const text = (Array.isArray(reply) ? reply : [])
      .map((p) => p && p.text).filter(Boolean).join(' ').trim();
    if (!text) return { ok: false, status: 502, error: 'empty reply' };
    return { ok: true, reply: text, model: `gemini:${GEMINI_MODEL}` };
  } catch (e) {
    return { ok: false, status: 500, error: String((e && e.message) || e) };
  }
}

// --- Bedrock Claude (paid) ----------------------------------------------
async function callBedrock(systemText, turns) {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (!apiKey) return { ok: false, status: 0, error: 'no BEDROCK_API_KEY' };
  const messages = turns.map((m) => ({
    role: m.fromClient ? 'user' : 'assistant',
    content: [{ text: String(m.text).slice(0, 4000) }],
  }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return { ok: false, status: 400, error: 'no user turn' };
  const payload = JSON.stringify({
    system: [{ text: systemText }],
    messages,
    inferenceConfig: { maxTokens: 300, temperature: 0.7 },
  });
  const order = resolvedModel
    ? [resolvedModel, ...MODEL_CANDIDATES.filter((m) => m !== resolvedModel)]
    : MODEL_CANDIDATES;
  let last = null;
  for (const model of order) {
    let r;
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(
        `https://bedrock-runtime.${REGION}.amazonaws.com`
        + `/model/${encodeURIComponent(model)}/converse`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: payload,
        });
      const j = await resp.json().catch(() => ({}));
      r = { ok: resp.ok, status: resp.status, json: j };
    } catch (e) {
      r = { ok: false, status: 500,
        json: { message: String((e && e.message) || e) } };
    }
    const detail = (r.json && (r.json.message || r.json.Message)) || '';
    if (r.status === 401
      || /security token|unrecognizedclient|invalid.*key|expired/i
        .test(detail)) {
      return { ok: false, status: r.status, error: detail || 'bedrock auth' };
    }
    if (r.ok) {
      const reply = (((r.json.output || {}).message || {}).content || [])
        .map((c) => c && c.text).filter(Boolean).join(' ').trim();
      if (reply) {
        resolvedModel = model;
        return { ok: true, reply, model: `bedrock:${model}` };
      }
      last = { status: 502, error: 'empty reply', model };
      continue;
    }
    last = { status: r.status, error: detail || 'bedrock error', model };
  }
  return { ok: false, status: (last && last.status) || 502,
    error: last ? `${last.model}: ${last.error}` : 'no usable bedrock model' };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-assistant-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const hasGemini = !!GEMINI_KEY;
  const hasBedrock = !!process.env.BEDROCK_API_KEY;

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: hasGemini || hasBedrock,
      providers: [
        hasGemini ? `gemini (${GEMINI_MODEL}) - free` : null,
        hasBedrock ? `bedrock (${REGION}) - paid` : null,
      ].filter(Boolean),
      preferred: hasGemini ? 'gemini' : hasBedrock ? 'bedrock' : 'none',
      resolvedModel: resolvedModel || null,
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const guard = process.env.ASSISTANT_RELAY_KEY;
  if (guard && req.headers['x-assistant-key'] !== guard) {
    return res.status(401).json({ error: 'bad key' });
  }
  if (!hasGemini && !hasBedrock) {
    return res.status(503).json({
      error: 'No AI provider configured. Set GEMINI_API_KEY (free) or '
        + 'BEDROCK_API_KEY on the relay.' });
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
    + `astrologer chatting with a client named ${client} on the AstroSeer `
    + 'app. Reply in the first person as the astrologer. Keep replies '
    + 'short (1-4 sentences), natural and conversational, like a real '
    + 'human typing in a chat - no headings, no bullet lists, no "as an '
    + 'AI". Offer warm, practical astrological guidance. If the client '
    + 'asks for birth-chart specifics you do not have, ask them for their '
    + 'date, time and place of birth. Never reveal you are an AI.'
    + (context ? ` You already have this client's birth chart, use it `
      + `naturally in your guidance: ${context}` : '');
  const turns = history.filter((m) => m && m.text
    && String(m.text).trim());
  if (!turns.length) {
    return res.status(400).json({ error: 'no client message' });
  }

  // Try the free provider first (Gemini), then Bedrock as backup.
  const tried = [];
  try {
    if (hasGemini) {
      const g = await callGemini(systemText, turns);
      tried.push({ provider: 'gemini', ok: g.ok, error: g.error });
      if (g.ok) return res.status(200).json({ reply: g.reply, model: g.model });
    }
    if (hasBedrock) {
      const b = await callBedrock(systemText, turns);
      tried.push({ provider: 'bedrock', ok: b.ok, error: b.error });
      if (b.ok) return res.status(200).json({ reply: b.reply, model: b.model });
    }
    return res.status(502).json({ error: 'all providers failed', tried });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e), tried });
  }
};
