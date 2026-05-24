// Server-side AI auto-assist. Called by the customer app when it (a)
// creates a chat session and (b) sends a new chat message. The relay
// (with admin SDK) checks whether the targeted astrologer has the AI
// assistant enabled and, if so:
//   1. Auto-accepts the session (status -> active, startTime = now).
//   2. Generates an AI reply for the latest unanswered client message.
//   3. Writes the reply into chats/{chatId}/messages as the astrologer.
//
// Result: AI works WITHOUT the astrologer app needing to be open.

const {
  admin, ensureAdmin, loadProviderCfg, generateReply, buildSystemPrompt,
} = require('../lib/providers');

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  return b || {};
}

// Build a short Vedic-context string from the client's default kundli
// profile (if any) - same shape the in-app responder built.
async function kundliContext(db, clientUid) {
  try {
    const q = await db.collection('kundliProfiles')
      .where('userId', '==', clientUid).get();
    if (q.empty) return '';
    const profiles = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    const k = profiles.find((p) => p.isDefault) || profiles[0];
    if (!k || !k.dob) return '';
    const r = (k.report && typeof k.report === 'object') ? k.report : null;
    const n = (r && r.narrative) || {};
    const asc = (r && ((r.ascendant && r.ascendant.sign)
      || r.zodiac)) || '';
    return [
      `Client birth details: DOB ${k.dob}, time ${k.tob || '?'} `
      + `${k.ampm || ''}, place ${k.place || '?'}.`,
      asc ? `Ascendant (Lagna): ${asc}.` : '',
      r && r.chandra_rasi ? `Moon sign: ${r.chandra_rasi}.` : '',
      r && r.nakshatra ? `Nakshatra: ${r.nakshatra}.` : '',
      n.personality ? `Personality: ${n.personality}` : '',
      n.career || '',
    ].filter(Boolean).join(' ').slice(0, 1200);
  } catch (_) { return ''; }
}

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

  // 1. Verify AI is enabled (admin scope + astrologer toggle).
  let astroUid = astroFromBody;
  let clientUid = clientFromBody;
  try {
    const chatSnap = await db.doc(`chats/${chatId}`).get();
    if (chatSnap.exists) {
      const parts = (chatSnap.data().participants || []);
      if (!astroUid || !clientUid) {
        // Best effort: any 2-participant chat. Determine astro by which
        // participant has an astrologers/{uid} doc.
        for (const uid of parts) {
          // eslint-disable-next-line no-await-in-loop
          const a = await db.doc(`astrologers/${uid}`).get();
          if (a.exists) astroUid = uid;
          else clientUid = uid;
        }
      }
    }
  } catch (_) { /* ignore - we'll bail if astroUid missing */ }
  if (!astroUid || !clientUid) {
    return res.status(400).json({ error: 'cannot resolve participants' });
  }

  const [astroSnap, cfgSnap] = await Promise.all([
    db.doc(`astrologers/${astroUid}`).get(),
    db.doc('settings/config').get(),
  ]);
  const astroDoc = astroSnap.exists ? astroSnap.data() : {};
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  // Human-like delay window the admin set in /admin-ai (defaults 3-9s).
  const lo = Math.max(0, Number(cfg.ai_delay_min) || 3);
  const hi = Math.max(lo, Number(cfg.ai_delay_max) || 9);
  const delayMs = Math.round((lo + Math.random() * (hi - lo)) * 1000);
  // Default-on: once admin enables AI for an astrologer's scope, the
  // assistant works automatically. The per-astrologer toggle is OPT-OUT
  // (only treated as off when explicitly set to false).
  const astroOptedIn = astroDoc.aiAssistant !== false;
  const inScope = !cfg.ai_enabled ? false
    : (cfg.ai_scope === 'selected'
      ? (Array.isArray(cfg.ai_astrologers)
        && cfg.ai_astrologers.includes(astroUid))
      : true);
  if (!astroOptedIn || !inScope) {
    return res.status(200).json({ ok: true, skipped: 'ai not enabled' });
  }

  // 2. Auto-accept the session if it's still requesting + immediately
  // send a warm greeting AS the astrologer (English by default) so the
  // client sees activity right away. The reply to actual client
  // questions still goes through the normal delay window below.
  let acceptedNow = false;
  if (sessionId) {
    try {
      const sref = db.doc(`sessions/${sessionId}`);
      const ss = await sref.get();
      if (ss.exists) {
        const s = ss.data();
        if (s.status === 'requesting' && s.type === 'chat') {
          await sref.update({
            status: 'active',
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            acceptedByAi: true,
          });
          acceptedNow = true;
          // Send one immediate English greeting on accept. Skip if
          // a greeting was already posted (idempotent).
          try {
            const chatRef = db.doc(`chats/${chatId}`);
            const chatDoc = await chatRef.get();
            const already = chatDoc.exists
              && chatDoc.data().aiGreetingSent;
            if (!already) {
              const userDoc = await db.doc(`users/${clientUid}`).get();
              const cName = (userDoc.data() || {}).name || 'friend';
              const aName = astroDoc.name || astroDoc.displayName
                || 'your astrologer';
              const greeting = `Namaste ${cName}, I am ${aName}. `
                + 'I have your details with me. Please tell me what is '
                + 'on your mind today and I will guide you through '
                + 'your chart.';
              await db.collection(`chats/${chatId}/messages`).add({
                senderId: astroUid,
                text: greeting,
                createdAt: admin.firestore
                  .FieldValue.serverTimestamp(),
                aiGenerated: true,
              });
              await chatRef.set({
                lastMessage: greeting,
                lastMessageAt: admin.firestore
                  .FieldValue.serverTimestamp(),
                aiGreetingSent: true,
              }, { merge: true });
            }
          } catch (_) { /* greeting is best-effort */ }
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  // 3. Generate + write reply for the latest unanswered client message.
  const providerCfg = await loadProviderCfg();
  const ordered = providerCfg.providers
    .filter((p) => providerCfg.order.includes(p.id)
      && p.enabled && p.apiKey);
  if (!ordered.length) {
    return res.status(200).json({ ok: true, accepted: acceptedNow,
      skipped: 'no provider' });
  }

  // Load the recent conversation (last 30 min, max 8 turns).
  const cutoffMs = Date.now() - 30 * 60 * 1000;
  let msgs = [];
  try {
    const q = await db.collection(`chats/${chatId}/messages`)
      .orderBy('createdAt', 'asc').limit(40).get();
    msgs = q.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) { /* empty */ }
  const recent = msgs.filter((m) => m.senderId && m.senderId !== 'system'
    && m.text && String(m.text).trim()).filter((m) => {
    const ts = (m.createdAt && m.createdAt.toMillis
      && m.createdAt.toMillis()) || Date.now();
    return ts >= cutoffMs;
  }).slice(-8);
  if (!recent.length) {
    return res.status(200).json({ ok: true, accepted: acceptedNow,
      skipped: 'no recent messages' });
  }
  const last = recent[recent.length - 1];
  if (last.senderId === astroUid) {
    return res.status(200).json({ ok: true, accepted: acceptedNow,
      skipped: 'last is astro' });
  }
  // Idempotency: don't reply twice to the same client message.
  try {
    const chatRef = db.doc(`chats/${chatId}`);
    const chat = await chatRef.get();
    if (chat.exists && chat.data().aiRepliedTo === last.id) {
      return res.status(200).json({ ok: true, accepted: acceptedNow,
        skipped: 'already replied' });
    }
  } catch (_) { /* ignore */ }

  const turns = recent.map((m) => ({ text: m.text,
    fromClient: m.senderId !== astroUid }));
  const clientName = (await db.doc(`users/${clientUid}`).get())
    .data()?.name || 'the client';
  const astroName = astroDoc.name || astroDoc.displayName || 'your astrologer';
  const context = await kundliContext(db, clientUid);
  const systemText = buildSystemPrompt({ astrologer: astroName,
    client: clientName, context });

  // Show "typing..." while we generate + wait the admin's delay window.
  try {
    await db.doc(`chats/${chatId}`).set({
      typing: { [astroUid]: Date.now() },
    }, { merge: true });
  } catch (_) { /* non-fatal */ }

  const r = await generateReply(systemText, turns, providerCfg);
  if (!r.ok) {
    try { await db.doc(`chats/${chatId}`)
      .set({ typing: { [astroUid]: 0 } }, { merge: true }); }
    catch (_) {}
    return res.status(502).json({ error: r.error, tried: r.tried });
  }

  // Wait the admin-configured human-like delay (1-3s, 3-9s, etc).
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  // Write the reply as the astrologer + update chat metadata + clear typing.
  try {
    await db.collection(`chats/${chatId}/messages`).add({
      senderId: astroUid,
      text: r.reply,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      aiGenerated: true,
    });
    await db.doc(`chats/${chatId}`).set({
      lastMessage: r.reply,
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      aiRepliedTo: last.id,
      typing: { [astroUid]: 0 },
    }, { merge: true });
  } catch (e) {
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }

  return res.status(200).json({
    ok: true, accepted: acceptedNow, replied: true,
    provider: r.provider, model: r.model });
};
