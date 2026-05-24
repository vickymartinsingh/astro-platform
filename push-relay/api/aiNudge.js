// Idle-nudge endpoint. The customer chat page calls this when the
// client has gone silent after the astrologer's last reply. We send up
// to 3 short, distinct follow-up messages and then end the session so
// the client's wallet stops getting charged.
//
// Schedule (handled client-side via setTimeout):
//   - first call:  ~45s after the astrologer's last message
//   - second call: ~30s after the first nudge (so ~75s total idle)
//   - third call:  ~40s after the second nudge (~115s total idle)
//   - fourth call: triggers the goodbye + ends the session
//
// Server-side guards: we re-read chats/{chatId}.aiIdleNudgeCount before
// sending so duplicate triggers (network retries, dev refreshes,
// multiple tabs) don't double-post. Reset to 0 whenever the client
// sends a new message (handled by aiAssist.js's reply path) OR the
// astrologer replies for any reason.
const {
  admin, ensureAdmin, loadProviderCfg, generateReply, buildSystemPrompt,
  scrubReply,
} = require('../lib/providers');

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  return b || {};
}

// Three deliberately distinct nudges + a goodbye. We generate the
// actual text with the AI (so it follows the language-mirror rule)
// using a tightly scoped system prompt. If the AI call fails we fall
// back to safe English defaults so the flow never breaks.
const NUDGE_INTENT = [
  // index 0 -> first nudge (~45s idle)
  'Write ONE short friendly follow-up (under 18 words) asking the '
    + 'client if they are still there and to please share their '
    + 'question. Do NOT repeat any previous nudge wording. No dashes.',
  // index 1 -> second nudge (~75s idle)
  'Write ONE short reassuring message (under 18 words) reminding the '
    + 'client we are still connected and asking what they would like '
    + 'guidance on. Must use COMPLETELY different words from any '
    + 'previous nudge. No dashes.',
  // index 2 -> third nudge (~115s idle)
  'Write ONE short polite nudge (under 18 words) gently asking the '
    + 'client to type their question so we can begin. Must NOT echo '
    + 'either previous nudge. No dashes.',
];
const NUDGE_FALLBACK = [
  'Are you still there? Please share your question and I will guide you.',
  'I am still here with you. What would you like guidance on today?',
  'Just checking in once more. Please type your question so we can begin.',
];
const GOODBYE_INTENT = 'Write ONE short polite message (under 30 words) '
  + 'telling the client that since they are away, you are ending the '
  + 'chat to avoid further balance deduction from their wallet, and '
  + 'thanking them. Warm and human. No dashes.';
const GOODBYE_FALLBACK = 'Since you are away from the chat, I am '
  + 'ending the session now to avoid further balance deduction from '
  + 'your wallet. Thank you, and please come back any time.';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  ensureAdmin();
  if (!admin.apps.length) {
    return res.status(503).json({
      error: 'FIREBASE_SERVICE_ACCOUNT not set on the relay' });
  }
  const db = admin.firestore();

  const body = readBody(req);
  const { chatId, sessionId, astroUid: astroFromBody,
    clientUid: clientFromBody } = body;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  // Resolve participants if missing.
  let astroUid = astroFromBody;
  let clientUid = clientFromBody;
  try {
    const chatSnap = await db.doc(`chats/${chatId}`).get();
    if (chatSnap.exists) {
      const parts = (chatSnap.data().participants || []);
      if (!astroUid || !clientUid) {
        for (const uid of parts) {
          // eslint-disable-next-line no-await-in-loop
          const a = await db.doc(`astrologers/${uid}`).get();
          if (a.exists) astroUid = uid; else clientUid = uid;
        }
      }
    }
  } catch (_) { /* ignore */ }
  if (!astroUid || !clientUid) {
    return res.status(400).json({ error: 'cannot resolve participants' });
  }

  // Only nudge if AI is enabled for this astrologer/scope (same logic
  // as aiAssist.js so we don't surprise non-AI astrologers).
  const [astroSnap, cfgSnap] = await Promise.all([
    db.doc(`astrologers/${astroUid}`).get(),
    db.doc('settings/config').get(),
  ]);
  const astroDoc = astroSnap.exists ? astroSnap.data() : {};
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const forceAll = cfg.ai_force_all !== false;
  const astroOptedIn = forceAll || astroDoc.aiAssistant !== false;
  const inScope = !cfg.ai_enabled ? false
    : (cfg.ai_scope === 'selected'
      ? (Array.isArray(cfg.ai_astrologers)
        && cfg.ai_astrologers.includes(astroUid))
      : true);
  if (!astroOptedIn || !inScope) {
    return res.status(200).json({ ok: true, skipped: 'ai not enabled' });
  }

  // Verify session is still active. If it's already ended/cancelled,
  // skip silently.
  let session = null;
  if (sessionId) {
    try {
      const ss = await db.doc(`sessions/${sessionId}`).get();
      if (ss.exists) session = ss.data();
    } catch (_) { /* ignore */ }
    if (session && session.status !== 'active') {
      return res.status(200).json({ ok: true, skipped: 'session not active' });
    }
  }

  // Re-read the chat to find out whether the client has sent anything
  // since the astrologer's last message. If they have, reset the
  // counter and bail. If the last message is from the astrologer (or a
  // previous nudge), increment the counter and send the next one.
  const chatRef = db.doc(`chats/${chatId}`);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    return res.status(200).json({ ok: true, skipped: 'no chat' });
  }
  const chat = chatSnap.data();

  let lastClientMsg = null;
  let lastAstroMsg = null;
  try {
    const q = await db.collection(`chats/${chatId}/messages`)
      .orderBy('createdAt', 'desc').limit(8).get();
    for (const d of q.docs) {
      const m = d.data();
      if (!m.text || !String(m.text).trim()) continue;
      if (m.senderId === astroUid && !lastAstroMsg) lastAstroMsg = m;
      if (m.senderId === clientUid && !lastClientMsg) lastClientMsg = m;
      if (lastAstroMsg && lastClientMsg) break;
    }
  } catch (_) { /* ignore */ }

  const tsOf = (m) => (m && m.createdAt && m.createdAt.toMillis
    && m.createdAt.toMillis()) || 0;
  const clientLatest = lastClientMsg
    ? Math.max(tsOf(lastClientMsg), Number(chat.aiLastClientAt) || 0)
    : (Number(chat.aiLastClientAt) || 0);
  const astroLatest = lastAstroMsg ? tsOf(lastAstroMsg) : 0;
  if (clientLatest > astroLatest) {
    // Client has spoken since astrologer last did. Reset counter and bail.
    await chatRef.set({ aiIdleNudgeCount: 0 }, { merge: true });
    return res.status(200).json({ ok: true,
      skipped: 'client already replied' });
  }

  const count = Number(chat.aiIdleNudgeCount || 0);
  const nextCount = count + 1;

  // After 3 nudges (nextCount === 4) -> goodbye + end session.
  if (nextCount > 3) {
    const sysGoodbye = buildSystemPrompt({
      astrologer: astroDoc.name || astroDoc.displayName || 'your astrologer',
      client: 'the client', context: '',
    }) + `\n\nTASK NOW: ${GOODBYE_INTENT}`;
    const lastTurns = lastClientMsg
      ? [{ text: String(lastClientMsg.text || '').slice(0, 400),
        fromClient: true }]
      : [{ text: '(no recent client message)', fromClient: true }];
    let text = GOODBYE_FALLBACK;
    try {
      const providerCfg = await loadProviderCfg();
      const r = await generateReply(sysGoodbye, lastTurns, providerCfg);
      if (r.ok) text = scrubReply(r.reply).split(/\s*\|\|\|\s*/)[0]
        || GOODBYE_FALLBACK;
    } catch (_) { /* fall back */ }
    try {
      await db.collection(`chats/${chatId}/messages`).add({
        senderId: astroUid,
        text,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        aiGenerated: true,
        aiNudgeIndex: 4,
        aiGoodbye: true,
      });
      await chatRef.set({
        lastMessage: text,
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        aiIdleNudgeCount: 4,
        typing: { [astroUid]: 0 },
      }, { merge: true });
      // End the session so the client wallet stops being charged.
      if (sessionId) {
        try {
          await db.doc(`sessions/${sessionId}`).update({
            status: 'ended',
            endTime: admin.firestore.FieldValue.serverTimestamp(),
            endedByAi: true,
            endReason: 'idle-timeout',
          });
        } catch (_) { /* non-fatal */ }
      }
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
    return res.status(200).json({ ok: true, ended: true, nudge: 4 });
  }

  // Otherwise send nudge #1, #2, or #3 (whichever is next).
  const idx = nextCount - 1;
  const intent = NUDGE_INTENT[idx];
  let text = NUDGE_FALLBACK[idx];
  // Pull the recent thread so the AI can match the client's language.
  let recent = [];
  try {
    const q = await db.collection(`chats/${chatId}/messages`)
      .orderBy('createdAt', 'asc').limit(20).get();
    recent = q.docs.map((d) => d.data()).filter((m) => m.text
      && String(m.text).trim() && m.senderId
      && m.senderId !== 'system').slice(-6);
  } catch (_) { /* ignore */ }
  const turns = recent.length
    ? recent.map((m) => ({ text: m.text,
      fromClient: m.senderId !== astroUid }))
    : [{ text: '(client has gone quiet)', fromClient: true }];
  // The intent goes in as a final SYSTEM-style instruction inside the
  // prompt because some providers don't accept multiple system roles.
  const sys = buildSystemPrompt({
    astrologer: astroDoc.name || astroDoc.displayName || 'your astrologer',
    client: 'the client',
    context: '',
  }) + `\n\nTASK NOW: ${intent}`;
  try {
    const providerCfg = await loadProviderCfg();
    const r = await generateReply(sys, turns, providerCfg);
    if (r.ok) {
      const clean = scrubReply(r.reply).split(/\s*\|\|\|\s*/)[0]
        || NUDGE_FALLBACK[idx];
      // Hard length cap so nudges always feel like a short tap.
      text = clean.length > 180 ? `${clean.slice(0, 175).trim()}...` : clean;
    }
  } catch (_) { /* fall back */ }

  try {
    // Typing flash so the bubble doesn't pop in cold.
    await chatRef.set({
      typing: { [astroUid]: Date.now() },
    }, { merge: true });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await db.collection(`chats/${chatId}/messages`).add({
      senderId: astroUid,
      text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      aiGenerated: true,
      aiNudgeIndex: nextCount,
    });
    await chatRef.set({
      lastMessage: text,
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      aiIdleNudgeCount: nextCount,
      typing: { [astroUid]: 0 },
    }, { merge: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }

  return res.status(200).json({ ok: true, nudge: nextCount });
};
