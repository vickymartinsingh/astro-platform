// Server-side AI auto-assist. Called by the customer app when it (a)
// creates a chat session and (b) sends a new chat message. The relay
// (with admin SDK) checks whether the targeted astrologer has the AI
// assistant enabled and, if so:
//   1. Auto-accepts the session (status -> active, startTime = now).
//   2. Sends a one-time greeting per SESSION (not per chat doc - so
//      every new consultation gets its own opener).
//   3. Generates an AI reply for the latest unanswered client message.
//   4. Writes the reply (as 1-3 bubbles) into chats/{chatId}/messages
//      as the astrologer.
//
// SELF-HEALING (added after deploy-breaks-AI complaints):
//   - Per-session state (aiGreetingSentForSession, aiRepliedTo,
//     aiIdleNudgeCount) is reset the instant a new sessionId is seen
//     on the chat doc, so a brand-new consultation never inherits a
//     stale "already greeted / already replied" flag from the
//     previous session.
//   - If the AI provider chain fails for ANY reason (no provider
//     configured, all providers returned error, network blip), we
//     write a safe fallback message so the client always sees activity
//     from the astrologer, never silence.
//   - Every call writes a row to aiLog/{auto} with the outcome
//     (replied / skipped / error + reason). Admin can read this to
//     diagnose silent failures.
//   - The ai_enabled master switch is treated as "on unless explicitly
//     off" so a missing field never silently disables the assistant.

const {
  admin, ensureAdmin, loadProviderCfg, generateReply, buildSystemPrompt,
  scrubReply, splitBubbles,
} = require('../lib/providers');

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  return b || {};
}

// Lightweight debug log so the admin can see WHY a particular call did
// or didn't reply. Best-effort: failures here never affect the actual
// chat write.
async function logAttempt(db, payload) {
  try {
    await db.collection('aiLog').add({
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (_) { /* ignore */ }
}

// Build a Vedic-context block from the SIGNED-IN CLIENT's default
// kundli profile.
//
// SECURITY (Hard Rule, per user requirement):
//   - The query is `kundliProfiles WHERE userId == clientUid` with
//     clientUid resolved from the chats/{chatId}.participants array
//     (the customer half of the conversation, see "resolve
//     participants" block in the main handler). Each AI reply
//     re-runs this — there is no in-memory cache — so user A's
//     chart can never bleed into user B's chat.
//   - Returns `{ text, profileId, signature }`. The caller passes
//     `profileId` and `signature` into the audit log so any future
//     mis-routing is visible in aiLog/. The signature is a short
//     digest of (clientUid, profileId, dob+tob+place) so an admin
//     can confirm at a glance that the chart used matches the right
//     person.
async function kundliContext(db, clientUid) {
  const empty = { text: '', profileId: null, signature: '' };
  try {
    const q = await db.collection('kundliProfiles')
      .where('userId', '==', clientUid).get();
    if (q.empty) return empty;
    const profiles = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    const k = profiles.find((p) => p.isDefault) || profiles[0];
    if (!k || !k.dob) return empty;

    // BELT-AND-BRACES: drop the kundli if its userId doesn't match the
    // chat's clientUid. The query above already filters by userId so
    // this should never trigger — but if a stray doc ever lands with
    // a mismatched userId (admin manual write etc), we want to NEVER
    // forward someone else's chart into the LLM context.
    if (String(k.userId || '') !== String(clientUid)) return empty;

    const r = (k.report && typeof k.report === 'object') ? k.report : null;
    const n = (r && r.narrative) || {};
    const asc = (r && ((r.ascendant && r.ascendant.sign)
      || r.zodiac)) || '';

    // Current Maha → Antar → Pratyantar (AstroSeer fills this).
    const cd = r && r.currentDasha;
    let dashaLine = '';
    if (cd && cd.planet) {
      const pieces = [`Current Maha Dasha: ${cd.planet} `
        + `(${String(cd.start || '').slice(0, 10)} to `
        + `${String(cd.end || '').slice(0, 10)})`];
      if (cd.antar && cd.antar.planet) {
        pieces.push(`Antar Dasha: ${cd.antar.planet} `
          + `(${String(cd.antar.start || '').slice(0, 10)} to `
          + `${String(cd.antar.end || '').slice(0, 10)})`);
      }
      if (cd.pratyantar && cd.pratyantar.planet) {
        pieces.push(`Pratyantar Dasha: ${cd.pratyantar.planet} `
          + `(${String(cd.pratyantar.start || '').slice(0, 10)} to `
          + `${String(cd.pratyantar.end || '').slice(0, 10)})`);
      }
      dashaLine = pieces.join('. ') + '.';
    }

    // Top 3 yogas + doshas if available (AstroSeer ships these).
    const yogas = Array.isArray(r && r.yogas) ? r.yogas
      .slice(0, 5)
      .map((y) => (typeof y === 'string' ? y : (y.name || y.title)))
      .filter(Boolean) : [];
    const doshas = r && r.doshas;
    let doshaLine = '';
    if (doshas && typeof doshas === 'object') {
      const flags = [];
      if (doshas.mangal && doshas.mangal.present) flags.push('Mangal');
      if (doshas.kalsarp && doshas.kalsarp.present) flags.push('Kalsarp');
      if (doshas.sade_sati && doshas.sade_sati.active) flags.push('Sade Sati');
      if (flags.length) doshaLine = `Doshas active: ${flags.join(', ')}.`;
    }

    const text = [
      `=== CLIENT'S OWN KUNDLI (use this and ONLY this) ===`,
      `Name: ${k.name || '(not given)'}.`,
      `Birth: DOB ${k.dob}, time ${k.tob || '?'} ${k.ampm || ''}, `
        + `place ${k.place || '?'}.`,
      asc ? `Ascendant (Lagna): ${asc}.` : '',
      r && r.chandra_rasi ? `Moon sign (Rasi): ${r.chandra_rasi}.` : '',
      r && r.soorya_rasi ? `Sun sign: ${r.soorya_rasi}.` : '',
      r && r.nakshatra ? `Birth nakshatra: ${r.nakshatra}.` : '',
      dashaLine,
      yogas.length ? `Notable yogas: ${yogas.join(', ')}.` : '',
      doshaLine,
      n.personality ? `Personality reading: ${n.personality}` : '',
      n.career ? `Career indication: ${n.career}` : '',
    ].filter(Boolean).join('\n').slice(0, 2500);

    // Short signature so the audit log can confirm at a glance that
    // we used the RIGHT person's chart. (clientUid + profileId + dob
    // + place head digest.) Not a security primitive on its own —
    // the userId match above is the actual gate — but it makes
    // cross-user leakage detectable if it ever happened.
    const sig = `${String(clientUid).slice(0, 6)}/`
      + `${String(k.id || '').slice(0, 6)}/`
      + `${String(k.dob || '').slice(0, 10)}/`
      + `${String(k.place || '').slice(0, 16)}`;

    return { text, profileId: k.id || null, signature: sig };
  } catch (_) { return empty; }
}

// Safe fallback bubbles when the AI provider chain completely fails.
// The user is being billed, so silence is the worst outcome - this at
// least confirms the astrologer is listening.
const FALLBACK_BUBBLES = [
  'I am with you, just looking at your chart now.',
  'Please share what is on your mind today.',
];

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
    clientUid: clientFromBody, force } = body;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  // -------- 1. Resolve participants ------------------------------------
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
          if (a.exists) astroUid = uid;
          else clientUid = uid;
        }
      }
    }
  } catch (_) { /* ignore */ }
  if (!astroUid || !clientUid) {
    await logAttempt(db, { chatId, sessionId,
      skipped: 'no-participants' });
    return res.status(400).json({ error: 'cannot resolve participants' });
  }

  // -------- 2. Reset per-session state if this is a new session --------
  // A single chat doc (between client X and astro Y) is reused across
  // every consultation they ever have together. Without this reset, the
  // 2nd session sees aiGreetingSent=true from the 1st and skips greeting,
  // and aiRepliedTo could point to a stale id. Reset the moment we see
  // a new sessionId.
  let chatData = {};
  try {
    const cs = await db.doc(`chats/${chatId}`).get();
    chatData = cs.exists ? (cs.data() || {}) : {};
  } catch (_) { /* ignore */ }
  if (sessionId && chatData.aiSessionId !== sessionId) {
    try {
      await db.doc(`chats/${chatId}`).set({
        aiSessionId: sessionId,
        aiGreetingSent: false,   // re-greet for the new session
        aiRepliedTo: null,
        aiIdleNudgeCount: 0,
      }, { merge: true });
      // Refresh local view so the rest of this request sees the reset.
      chatData = { ...chatData, aiSessionId: sessionId,
        aiGreetingSent: false, aiRepliedTo: null, aiIdleNudgeCount: 0 };
    } catch (_) { /* ignore */ }
  }

  // -------- 3. AI enabled check ---------------------------------------
  const [astroSnap, cfgSnap] = await Promise.all([
    db.doc(`astrologers/${astroUid}`).get(),
    db.doc('settings/config').get(),
  ]);
  const astroDoc = astroSnap.exists ? astroSnap.data() : {};
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  // Human-like delay window (defaults 3-9s).
  const lo = Math.max(0, Number(cfg.ai_delay_min) || 3);
  const hi = Math.max(lo, Number(cfg.ai_delay_max) || 9);
  const delayMs = Math.round((lo + Math.random() * (hi - lo)) * 1000);

  // Self-heal master switch: treat missing/null as ON (default true)
  // so a fresh Firestore install with no settings/config still gets
  // AI replies. Only an EXPLICIT false disables.
  const aiMasterOn = cfg.ai_enabled !== false;
  const forceAll = cfg.ai_force_all !== false;          // default true
  const astroOptedIn = forceAll || astroDoc.aiAssistant !== false;
  const inScope = !aiMasterOn ? false
    : (cfg.ai_scope === 'selected'
      ? (Array.isArray(cfg.ai_astrologers)
        && cfg.ai_astrologers.includes(astroUid))
      : true);
  if (!astroOptedIn || !inScope) {
    await logAttempt(db, { chatId, sessionId, astroUid,
      skipped: 'ai-not-enabled',
      reason: { astroOptedIn, inScope, aiMasterOn, forceAll,
        scope: cfg.ai_scope || 'all',
        astroAiAssistant: astroDoc.aiAssistant,
        astroInList: Array.isArray(cfg.ai_astrologers)
          && cfg.ai_astrologers.includes(astroUid),
        listSize: Array.isArray(cfg.ai_astrologers)
          ? cfg.ai_astrologers.length : 0 } });
    return res.status(200).json({ ok: true, skipped: 'ai not enabled',
      detail: { astroOptedIn, inScope } });
  }

  // -------- 4. Auto-accept + greeting ---------------------------------
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
        }
        // Send the per-session greeting if we haven't yet for THIS
        // session. (The reset above already cleared the flag when
        // sessionId changed, so this is safe.)
        if (s.type === 'chat' && !chatData.aiGreetingSent
          && (s.status === 'requesting' || s.status === 'active'
            || acceptedNow)) {
          try {
            const userDoc = await db.doc(`users/${clientUid}`).get();
            const cName = (userDoc.data() || {}).name || 'friend';
            const aName = astroDoc.name || astroDoc.displayName
              || 'your astrologer';
            const greeting = `Namaste ${cName}, I am ${aName}. `
              + 'I have your details with me. Please tell me what is '
              + 'on your mind today and I will guide you through your '
              + 'chart.';
            await db.collection(`chats/${chatId}/messages`).add({
              senderId: astroUid,
              text: greeting,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              aiGenerated: true,
              aiGreeting: true,
            });
            await db.doc(`chats/${chatId}`).set({
              lastMessage: greeting,
              lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
              aiGreetingSent: true,
              aiSessionId: sessionId,
            }, { merge: true });
            chatData.aiGreetingSent = true;
          } catch (_) { /* greeting is best-effort */ }
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  // -------- 5. Load recent messages -----------------------------------
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
    await logAttempt(db, { chatId, sessionId, astroUid,
      accepted: acceptedNow, skipped: 'no-recent-messages' });
    return res.status(200).json({ ok: true, accepted: acceptedNow,
      skipped: 'no recent messages' });
  }
  const last = recent[recent.length - 1];
  if (last.senderId === astroUid) {
    await logAttempt(db, { chatId, sessionId, astroUid,
      accepted: acceptedNow, skipped: 'last-is-astro' });
    return res.status(200).json({ ok: true, accepted: acceptedNow,
      skipped: 'last is astro' });
  }
  // Idempotency: skip a duplicate reply only if we replied to the
  // SAME client message id within the last 10 seconds. After 10s a
  // re-trigger means the customer didn't see our reply (network
  // dropped the message doc, fetch failed, etc) so we should send
  // again. If the customer passed `force: true` (auto-retry), bypass
  // entirely. This stops the deploy-breaks-AI symptom where a stale
  // aiRepliedTo wrongly blocked every subsequent reply.
  if (!force && chatData.aiRepliedTo === last.id) {
    const lastReplyTs = (chatData.aiLastReplyAt
      && chatData.aiLastReplyAt.toMillis
      && chatData.aiLastReplyAt.toMillis()) || 0;
    const sinceMs = Date.now() - lastReplyTs;
    if (lastReplyTs && sinceMs < 10000) {
      await logAttempt(db, { chatId, sessionId, astroUid,
        accepted: acceptedNow, skipped: 'already-replied-recent',
        lastId: last.id, sinceMs });
      return res.status(200).json({ ok: true, accepted: acceptedNow,
        skipped: 'already replied' });
    }
    // Stale flag: log it and proceed with a fresh reply.
    await logAttempt(db, { chatId, sessionId, astroUid,
      stale_idempotency_cleared: true, lastId: last.id,
      sinceMs: lastReplyTs ? sinceMs : null });
  }

  // -------- 6. Generate reply (with hard fallback) --------------------
  const providerCfg = await loadProviderCfg();
  const ordered = providerCfg.providers
    .filter((p) => providerCfg.order.includes(p.id)
      && p.enabled && p.apiKey);

  const turns = recent.map((m) => ({ text: m.text,
    fromClient: m.senderId !== astroUid }));
  const clientName = (await db.doc(`users/${clientUid}`).get())
    .data()?.name || 'the client';
  const astroName = astroDoc.name || astroDoc.displayName
    || 'your astrologer';
  // Per-user kundli context. The function returns the text block
  // plus the kundli profile id + signature so we can audit-log which
  // chart was used for THIS reply (any future cross-user leak would
  // show up as a profileId on the wrong user's chat).
  const kctx = await kundliContext(db, clientUid);
  const context = kctx.text || '';
  const systemText = buildSystemPrompt({ astrologer: astroName,
    client: clientName, context });

  // Typing indicator while we work.
  try {
    await db.doc(`chats/${chatId}`).set({
      typing: { [astroUid]: Date.now() },
    }, { merge: true });
  } catch (_) { /* non-fatal */ }

  let bubbles = [];
  let provider = null; let model = null;
  let aiError = null;

  if (ordered.length) {
    const r = await generateReply(systemText, turns, providerCfg);
    if (r.ok) {
      provider = r.provider; model = r.model;
      const cleaned = scrubReply(r.reply);
      bubbles = splitBubbles(cleaned).map(scrubReply)
        .filter((s) => s && s.trim());
      // Final safety net: scrubReply itself never returns empty now,
      // but be paranoid because losing replies is the worst bug.
      if (!bubbles.length && cleaned) bubbles = [cleaned];
      if (!bubbles.length && r.reply) bubbles = [String(r.reply).trim()];
    } else {
      aiError = r.error || 'unknown';
    }
  } else {
    aiError = 'no provider configured';
  }

  // HARD FALLBACK: never leave the client without a reply. If the AI
  // chain produced nothing usable, send a short, language-neutral
  // holding message so the customer sees the astrologer is there.
  if (!bubbles.length) bubbles = FALLBACK_BUBBLES.slice();

  // -------- 7. Human-like delay ---------------------------------------
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  // -------- 8. Write each bubble + chat metadata ----------------------
  try {
    for (let i = 0; i < bubbles.length; i += 1) {
      if (i > 0) {
        // eslint-disable-next-line no-await-in-loop
        await db.doc(`chats/${chatId}`).set({
          typing: { [astroUid]: Date.now() },
        }, { merge: true });
        const pause = Math.min(1400,
          600 + Math.round(bubbles[i].length * 20));
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
      // eslint-disable-next-line no-await-in-loop
      await db.collection(`chats/${chatId}/messages`).add({
        senderId: astroUid,
        text: bubbles[i],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        aiGenerated: true,
        aiBubbleIndex: i,
        aiBubbleTotal: bubbles.length,
        aiFallback: aiError ? true : false,
      });
    }
    await db.doc(`chats/${chatId}`).set({
      lastMessage: bubbles[bubbles.length - 1],
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      aiRepliedTo: last.id,
      aiIdleNudgeCount: 0,
      aiLastReplyAt: admin.firestore.FieldValue.serverTimestamp(),
      typing: { [astroUid]: 0 },
    }, { merge: true });
  } catch (e) {
    await logAttempt(db, { chatId, sessionId, astroUid,
      error: String((e && e.message) || e),
      stage: 'write-bubbles' });
    return res.status(500).json({
      error: String((e && e.message) || e) });
  }

  await logAttempt(db, { chatId, sessionId, astroUid,
    clientUid,
    // Audit which kundli profile (if any) was used for this reply.
    // Cross-user leakage would surface here as a profileId on the
    // wrong user's chat — easy to grep / monitor.
    kundliProfileId: kctx.profileId || null,
    kundliSignature: kctx.signature || '',
    kundliUsed: !!kctx.text,
    accepted: acceptedNow, replied: true, bubbles: bubbles.length,
    provider, model, fallback: !!aiError,
    aiError: aiError || null });

  return res.status(200).json({
    ok: true, accepted: acceptedNow, replied: true,
    provider, model, bubbles: bubbles.length,
    kundliUsed: !!kctx.text,
    fallback: !!aiError, aiError: aiError || null });
};
