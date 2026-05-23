// AI assistant relay (legacy endpoint). The astrologer app calls this
// directly from inside the AiAutoResponder. The newer api/aiAssist.js
// endpoint - called by the customer app - replaces this for true
// hands-off operation (works even when the astrologer app is closed).
//
// Both endpoints share push-relay/lib/providers.js for provider config
// and the actual LLM calls.
const {
  loadProviderCfg, generateReply, buildSystemPrompt,
} = require('../lib/providers');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-assistant-key');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const cfg = await loadProviderCfg();
  const active = cfg.providers
    .filter((p) => cfg.order.includes(p.id) && p.enabled && p.apiKey);

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: active.length > 0,
      providers: cfg.providers.map((p) => ({
        id: p.id, enabled: p.enabled, hasKey: !!p.apiKey, model: p.model,
      })),
      order: cfg.order,
      active: active.map((p) => p.id),
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
  if (!active.length) {
    return res.status(503).json({
      error: 'No AI provider configured. Add a key in admin -> AI Assistant.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};
  const history = Array.isArray(body.messages) ? body.messages : [];
  if (!history.length) {
    return res.status(400).json({ error: 'messages required' });
  }
  const turns = history.filter((m) => m && m.text
    && String(m.text).trim());
  if (!turns.length) {
    return res.status(400).json({ error: 'no client message' });
  }
  const systemText = buildSystemPrompt({
    astrologer: String(body.astrologerName || 'the astrologer'),
    client: String(body.clientName || 'the client'),
    context: String(body.context || '').slice(0, 2000),
  });
  const r = await generateReply(systemText, turns, cfg);
  if (r.ok) {
    return res.status(200).json({
      reply: r.reply, provider: r.provider, model: r.model });
  }
  return res.status(502).json({ error: r.error || 'failed',
    tried: r.tried });
};
