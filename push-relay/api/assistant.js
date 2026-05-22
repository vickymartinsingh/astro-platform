// AI assistant for AstroSeer astrologers (server-side only).
//
// The astrologer app calls this when "AI Assistant" is ON and a chat
// message arrives. We call Amazon Bedrock (Claude) using a Bedrock API
// key that lives ONLY in this relay's env - never in the app/web bundle.
//
// Env vars (set in Vercel -> push-relay project):
//   BEDROCK_API_KEY   - the AWS Bedrock long-term API key (ABSK...)
//   BEDROCK_REGION    - optional, default us-west-2
//   BEDROCK_MODEL_ID  - optional. If unset, the relay AUTO-PICKS a model:
//                       it tries the candidates below in order and uses
//                       the first your account/region has access to,
//                       caching it for later requests. So you normally
//                       don't need to set this at all.
//   ASSISTANT_RELAY_KEY - optional shared secret (x-assistant-key header)
const REGION = process.env.BEDROCK_REGION || 'us-west-2';

// Cross-region inference profiles are prefixed by region group: `us.` for
// US regions, `eu.` for Europe, `apac.` for Asia-Pacific (e.g. Sydney
// ap-southeast-2 / Mumbai ap-south-1). Pick the right prefix from REGION
// so the auto-selected model IDs are valid in this account's region.
const PFX = REGION.startsWith('ap-') ? 'apac.'
  : REGION.startsWith('eu-') ? 'eu.' : 'us.';

// Auto model selection. An explicit BEDROCK_MODEL_ID always wins; after
// that we try Claude models from strongest to cheapest and use whichever
// is enabled in this account/region (newer Opus/Sonnet 4 need the
// region-prefixed inference profile; older ones also work on-demand).
const MODEL_CANDIDATES = [
  process.env.BEDROCK_MODEL_ID,
  `${PFX}anthropic.claude-opus-4-1-20250805-v1:0`,
  `${PFX}anthropic.claude-sonnet-4-20250514-v1:0`,
  `${PFX}anthropic.claude-3-7-sonnet-20250219-v1:0`,
  `${PFX}anthropic.claude-3-5-sonnet-20241022-v2:0`,
  'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
].filter(Boolean);
// Remembered across warm invocations so we don't re-probe every request.
let resolvedModel = null;
const MODEL = process.env.BEDROCK_MODEL_ID || MODEL_CANDIDATES[0];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-assistant-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const apiKey = process.env.BEDROCK_API_KEY;
  // Probe mode: GET ?probe=1 -> report whether the key is configured.
  if (req.method === 'GET') {
    return res.status(200).json({
      configured: !!apiKey,
      region: REGION,
      model: resolvedModel || (process.env.BEDROCK_MODEL_ID
        ? MODEL : 'auto (Opus → Sonnet → Haiku)'),
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const guard = process.env.ASSISTANT_RELAY_KEY;
  if (guard && req.headers['x-assistant-key'] !== guard) {
    return res.status(401).json({ error: 'bad key' });
  }
  if (!apiKey) {
    return res.status(503).json({
      error: 'BEDROCK_API_KEY not set on the relay' });
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

  // Persona: reply AS the astrologer, warm + concise, Vedic-astrology
  // framing. Keep it human and brief (chat style).
  const system = [{
    text: `You are ${astrologer}, an experienced, warm Vedic astrologer `
      + `chatting with a client named ${client} on the AstroSeer app. `
      + 'Reply in the first person as the astrologer. Keep replies short '
      + '(1-4 sentences), natural and conversational, like a real human '
      + 'typing in a chat - no headings, no bullet lists, no "as an AI". '
      + 'Offer warm, practical astrological guidance. If the client asks '
      + 'for birth-chart specifics you do not have, ask them for their '
      + 'date, time and place of birth. Never reveal you are an AI.'
      + (context ? ` You already have this client's birth chart, use it `
        + `naturally in your guidance: ${context}` : ''),
  }];

  // Map history -> Bedrock Converse format. Client = user, astro = assistant.
  const messages = history
    .filter((m) => m && m.text && String(m.text).trim())
    .map((m) => ({
      role: m.fromClient ? 'user' : 'assistant',
      content: [{ text: String(m.text).slice(0, 4000) }],
    }));
  // Converse requires the conversation to start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) {
    return res.status(400).json({ error: 'no client message' });
  }

  const payload = JSON.stringify({
    system,
    messages,
    inferenceConfig: { maxTokens: 300, temperature: 0.7 },
  });
  const callModel = async (model) => {
    const url = `https://bedrock-runtime.${REGION}.amazonaws.com`
      + `/model/${encodeURIComponent(model)}/converse`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  };

  // Try the already-resolved model first, then the candidate chain.
  const order = resolvedModel
    ? [resolvedModel, ...MODEL_CANDIDATES.filter((m) => m !== resolvedModel)]
    : MODEL_CANDIDATES;
  let last = null;
  try {
    for (const model of order) {
      // eslint-disable-next-line no-await-in-loop
      const r = await callModel(model);
      const detail = (r.json && (r.json.message || r.json.Message)) || '';
      // Auth/key problems affect every model - stop and report immediately.
      if (r.status === 401
        || /security token|unrecognizedclient|invalid.*key|expired/i
          .test(detail)) {
        return res.status(502).json({
          error: 'bedrock auth error', status: r.status, detail });
      }
      if (r.ok) {
        const reply = (((r.json.output || {}).message || {}).content || [])
          .map((c) => c && c.text).filter(Boolean).join(' ').trim();
        if (reply) {
          resolvedModel = model; // remember the winner
          return res.status(200).json({ reply, model });
        }
        last = { status: 502, detail: 'empty reply', model };
        continue;
      }
      // Model not enabled / invalid for this account+region -> try next.
      last = { status: r.status, detail, model };
    }
    return res.status(502).json({
      error: 'no usable bedrock model',
      detail: last ? `${last.model}: ${last.detail}` : 'all candidates failed',
      hint: 'Enable a Claude model in Bedrock Model access for this region, '
        + 'or set BEDROCK_MODEL_ID to an inference-profile ID you have.',
    });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }
};
