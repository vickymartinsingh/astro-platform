// AI assistant for AstroSeer astrologers (server-side only).
//
// The astrologer app calls this when "AI Assistant" is ON and a chat
// message arrives. We call Amazon Bedrock (Claude) using a Bedrock API
// key that lives ONLY in this relay's env - never in the app/web bundle.
//
// Env vars (set in Vercel -> push-relay project):
//   BEDROCK_API_KEY   - the AWS Bedrock long-term API key (ABSK...)
//   BEDROCK_REGION    - optional, default us-east-1
//   BEDROCK_MODEL_ID  - optional, default anthropic.claude-3-5-sonnet
//   ASSISTANT_RELAY_KEY - optional shared secret (x-assistant-key header)
const REGION = process.env.BEDROCK_REGION || 'us-east-1';
const MODEL = process.env.BEDROCK_MODEL_ID
  || 'anthropic.claude-3-5-sonnet-20240620-v1:0';

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
      configured: !!apiKey, region: REGION, model: MODEL,
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

  const url = `https://bedrock-runtime.${REGION}.amazonaws.com`
    + `/model/${encodeURIComponent(MODEL)}/converse`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system,
        messages,
        inferenceConfig: { maxTokens: 300, temperature: 0.7 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({
        error: 'bedrock error',
        status: r.status,
        detail: (j && (j.message || j.Message)) || '',
      });
    }
    const reply = (((j.output || {}).message || {}).content || [])
      .map((c) => c && c.text).filter(Boolean).join(' ').trim();
    if (!reply) return res.status(502).json({ error: 'empty reply' });
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }
};
