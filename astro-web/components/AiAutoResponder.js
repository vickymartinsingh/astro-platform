import { useEffect, useRef, useState } from 'react';
import {
  chatService, assistantService, astrologerService, userService,
  kundliService,
} from '@astro/shared';
import { useAuth } from '../lib/useAuth';

// App-wide AI auto-responder for astrologers. Mounted once in _app.js so
// the AI answers EVERY incoming chat for this astrologer - even when they
// are not on that chat screen (or are on the dashboard / another page).
//
// Active only when BOTH are true:
//   - admin enabled the AI feature for this astrologer (settings/config)
//   - the astrologer turned their assistant ON (astrologers/{uid}.aiAssistant)
//
// For each chat, when the newest message is a fresh text from the client,
// it generates a reply via the relay (Claude) using the client's kundli
// (DOB/time/place, Vedic style) and sends it AS the astrologer, with a
// human-like typing delay. Replies once per client message.
export default function AiAutoResponder() {
  const { user, profile } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [astro, setAstro] = useState(null);

  // Per-instance bookkeeping.
  const mountTs = useRef(Date.now());
  const msgUnsubs = useRef({});   // chatId -> unsubscribe
  const replied = useRef(new Set()); // message ids already handled
  const busy = useRef(new Set());    // chatIds currently generating
  const clientName = useRef({});     // uid -> name
  const kundliCtx = useRef({});      // uid -> context string
  const kundliDone = useRef(new Set());

  // Watch admin config + this astrologer's own doc (live).
  useEffect(() => {
    if (!user) return undefined;
    const u1 = assistantService.watchAiConfig((c) => setCfg(c || {}));
    const u2 = astrologerService.listenAstrologer(user.uid,
      (a) => setAstro(a || null));
    return () => { if (u1) u1(); if (u2) u2(); };
  }, [user && user.uid]);

  // Opt-out: AI is on by default once admin enables it for this
  // astrologer's scope. The dashboard toggle only DISABLES (sets the
  // field to explicit false). Avoids "I have to flip it off+on" UX.
  const enabled = !!(user && astro && astro.aiAssistant !== false
    && assistantService.aiAvailableForAstro(cfg, user.uid));

  // Build (and cache + persist) the client's kundli context once.
  async function ctxFor(clientUid) {
    if (kundliDone.current.has(clientUid)) {
      return kundliCtx.current[clientUid] || '';
    }
    kundliDone.current.add(clientUid);
    try {
      const k = await kundliService.getDefaultKundli(clientUid);
      if (k && k.dob) {
        const r = await kundliService.getFullKundli(k);
        const n = (r && r.narrative) || {};
        const asc = (r && ((r.ascendant && r.ascendant.sign) || r.zodiac))
          || '';
        kundliCtx.current[clientUid] = [
          `Client birth details: DOB ${k.dob}, time ${k.tob || '?'} ${
            k.ampm || ''}, place ${k.place || '?'}.`,
          asc ? `Ascendant (Lagna): ${asc}.` : '',
          r && r.chandra_rasi ? `Moon sign: ${r.chandra_rasi}.` : '',
          r && r.nakshatra ? `Nakshatra: ${r.nakshatra}.` : '',
          n.personality ? `Personality: ${n.personality}` : '',
          n.career || '',
        ].filter(Boolean).join(' ').slice(0, 1200);
      }
    } catch (_) { /* still reply without chart context */ }
    return kundliCtx.current[clientUid] || '';
  }

  async function nameFor(clientUid) {
    if (clientName.current[clientUid]) return clientName.current[clientUid];
    try {
      const u = await userService.getUser(clientUid);
      clientName.current[clientUid] = (u && u.name) || 'the client';
    } catch (_) { clientName.current[clientUid] = 'the client'; }
    return clientName.current[clientUid];
  }

  async function handle(chatId, clientUid, msgs) {
    if (busy.current.has(chatId)) return;
    const last = msgs[msgs.length - 1];
    if (!last || last.senderId === user.uid) return;        // astro's own
    if (!last.text || !String(last.text).trim()) return;    // voice/image
    if (replied.current.has(last.id)) return;
    // Freshness: answer messages that arrived after we mounted, or within
    // the last 15 min - never spam a backlog of old conversations.
    const ts = (last.createdAt && last.createdAt.toMillis
      && last.createdAt.toMillis()) || Date.now();
    if (ts < mountTs.current - 60000 && Date.now() - ts > 15 * 60000) {
      replied.current.add(last.id); // mark old msg seen, don't answer
      return;
    }
    replied.current.add(last.id);
    busy.current.add(chatId);
    try {
      const [ctx, cName] = await Promise.all([
        ctxFor(clientUid), nameFor(clientUid),
      ]);
      // Build the conversation for the AI:
      //  - Skip system messages (kundli auto-share card etc).
      //  - Attribute purely by sender uid: anything NOT from the
      //    astrologer is treated as the client (more robust than
      //    relying on clientUid lookup).
      //  - Keep only messages from the last 30 min so each new
      //    consultation feels like a fresh conversation, not a
      //    continuation of weeks-old history.
      //  - Cap at 8 turns so the AI stays focused.
      const cutoff = Date.now() - 30 * 60 * 1000;
      const hist = msgs
        .filter((m) => m && m.senderId && m.senderId !== 'system'
          && m.text && String(m.text).trim())
        .filter((m) => {
          const ts = (m.createdAt && m.createdAt.toMillis
            && m.createdAt.toMillis()) || Date.now();
          return ts >= cutoff;
        })
        .slice(-8)
        .map((m) => ({ text: m.text,
          fromClient: m.senderId !== user.uid }));
      chatService.setTyping(chatId, user.uid, true);
      let reply = '';
      try {
        reply = await assistantService.generateReply({
          messages: hist,
          astrologerName: (profile && profile.name)
            || (user && user.displayName) || 'your astrologer',
          clientName: cName,
          context: ctx,
        });
      } catch (_) { reply = ''; }
      const c = cfg || {};
      const lo = Number.isFinite(+c.ai_delay_min) ? +c.ai_delay_min : 3;
      const hi = Number.isFinite(+c.ai_delay_max) ? +c.ai_delay_max : 9;
      const min = Math.max(0, lo);
      const max = Math.max(min, hi);
      const wait = Math.round((min + Math.random() * (max - min)) * 1000);
      await new Promise((r) => setTimeout(r, wait));
      chatService.setTyping(chatId, user.uid, false);
      if (reply) {
        try { await chatService.sendMessage(chatId, user.uid, reply); }
        catch (_) {}
      }
    } finally { busy.current.delete(chatId); }
  }

  // Subscribe to all chats; attach a message listener to each.
  useEffect(() => {
    const tearDown = () => {
      Object.values(msgUnsubs.current).forEach((fn) => { try { fn(); }
        catch (_) {} });
      msgUnsubs.current = {};
    };
    if (!enabled) { tearDown(); return undefined; }

    const unsubList = chatService.listenUserChats(user.uid, (chats) => {
      const live = new Set();
      chats.forEach((chat) => {
        live.add(chat.id);
        if (msgUnsubs.current[chat.id]) return; // already listening
        const parts = Array.isArray(chat.participants) ? chat.participants
          : [];
        const clientUid = parts.find((p) => p && p !== user.uid)
          || chat.userId || '';
        if (!clientUid) return;
        msgUnsubs.current[chat.id] = chatService.listenMessages(chat.id,
          (msgs) => { handle(chat.id, clientUid, msgs); });
      });
      // Drop listeners for chats that disappeared.
      Object.keys(msgUnsubs.current).forEach((cid) => {
        if (!live.has(cid)) {
          try { msgUnsubs.current[cid](); } catch (_) {}
          delete msgUnsubs.current[cid];
        }
      });
    });
    return () => { if (unsubList) unsubList(); tearDown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user && user.uid]);

  return null; // headless
}
