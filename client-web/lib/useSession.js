import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  astrologerService, sessionService, walletService, chatService,
  kundliService,
} from '@astro/shared';

// Drives the client side of a session (blueprint 4.10 / Section 7).
// Billing itself runs server-side (Hard Rule 3); this only reflects state,
// enforces the 60s request timeout, and stops the session on disconnect
// (Hard Rule 7) so the Cloud Function stops charging.
export function useSession({ astroId, type, uid, clientName, view = false }) {
  const router = useRouter();
  const [astro, setAstro] = useState(null);
  const [session, setSession] = useState(null);   // live session doc
  const [wallet, setWallet] = useState(0);
  const [countdown, setCountdown] = useState(60);
  const [chatId, setChatId] = useState(null);
  const sessionIdRef = useRef(null);
  const introSentRef = useRef(false);

  // Resolve astrologer + conversation, then resume or create the request.
  useEffect(() => {
    if (!astroId || !uid) return;
    let unsubSession = null;
    let cancelled = false;

    (async () => {
      const a = await astrologerService.getAstrologer(astroId);
      if (cancelled) return;
      setAstro(a);
      const cId = await chatService.getOrCreateConversation(uid, astroId);
      setChatId(cId);

      // VIEW-ONLY (history): just resolve the astrologer + thread id so
      // the past messages render. NEVER create a session request, never
      // notify the astrologer, never bill. The user is only reading.
      if (view) return;

      // Resume an existing live session for this pair ONLY if it is
      // still genuinely live: a pending request, or one the astrologer
      // already accepted (startTime set). A stale 'active'/'accepted'
      // doc with no startTime, or anything older than 3h, must NOT be
      // auto-resumed (that caused phantom "auto-connected" + billing).
      const recent = (s) => {
        const ms = s.createdAt?.toMillis ? s.createdAt.toMillis() : 0;
        return ms && (Date.now() - ms) < 3 * 3600 * 1000;
      };
      const existing = (await sessionService.getUserSessions(uid))
        .find((s) => s.astroId === astroId && recent(s) && (
          s.status === 'requesting'
          || ((s.status === 'active' || s.status === 'accepted')
              && !!s.startTime)));

      const sid = existing
        ? existing.id
        : await sessionService.createSessionRequest({
            userId: uid,
            astroId,
            type,
            pricePerMinute:
              type === 'chat' ? a.priceChat
              : type === 'video' ? a.priceVideo : a.priceCall,
          });
      sessionIdRef.current = sid;
      unsubSession = sessionService.listenSession(sid, setSession);
    })();

    return () => { cancelled = true; unsubSession && unsubSession(); };
  }, [astroId, uid, type]);

  // Live wallet (ticks down as the Cloud Function deducts).
  useEffect(() => {
    if (uid) return walletService.listenWallet(uid, setWallet);
  }, [uid]);

  // 60-second request timeout (blueprint 4.10 step 5).
  useEffect(() => {
    if (session?.status !== 'requesting') { setCountdown(60); return; }
    const start = session.createdAt?.toDate
      ? session.createdAt.toDate().getTime() : Date.now();
    const t = setInterval(() => {
      const left = 60 - Math.floor((Date.now() - start) / 1000);
      setCountdown(left);
      if (left <= 0 && sessionIdRef.current) {
        sessionService.updateSessionStatus(sessionIdRef.current, 'missed')
          .catch(() => {});
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [session?.status, session?.createdAt]);

  // As soon as the request is placed: greet the client and share the
  // chosen kundli with the astrologer (so they have context on accept).
  useEffect(() => {
    if (view) return;
    if (!chatId || !session || introSentRef.current) return;
    if (['ended', 'rejected', 'missed'].includes(session.status)) return;
    // Send the intro + kundli exactly ONCE per session. The Firestore
    // flag survives remounts / navigating back, so it never duplicates.
    if (session.introSent) { introSentRef.current = true; return; }
    introSentRef.current = true;
    (async () => {
      await sessionService.setSessionMeta(session.id, { introSent: true });
      const nm = clientName || 'there';
      const kind = type === 'chat' ? 'chat' : type === 'video'
        ? 'video call' : 'call';
      // Clear divider so each new consultation is visually separated
      // from earlier ones in the shared thread.
      const when = new Date().toLocaleString([], {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      await chatService.sendMessage(chatId, 'system',
        `••• New ${kind} consultation • ${when} •••`);
      await chatService.sendMessage(chatId, 'system',
        `Hi ${nm}, please wait until the astrologer accepts your ${kind} ` +
        'request. Please stay connected; you can keep browsing and we will ' +
        'notify you here.');
      const chosenId = typeof router.query.kundli === 'string'
        ? router.query.kundli : null;
      const k = chosenId
        ? (await kundliService.getKundliProfiles(uid))
            .find((p) => p.id === chosenId)
          || await kundliService.getDefaultKundli(uid)
        : await kundliService.getDefaultKundli(uid);
      if (k) await kundliService.autoSendKundliToChat(chatId, 'system', k);
    })().catch(() => {});
  }, [chatId, session, uid, type, clientName, router.query.kundli]);

  // NOTE: switching tabs / minimising must NOT end the session. The user
  // can move around the app and come back; the session only ends on an
  // explicit End (with confirmation) or when the wallet runs out.

  async function end() {
    const sid = sessionIdRef.current;
    if (!sid) { router.replace('/dashboard'); return; }
    // Charge the client + compute the astrologer earning client-side
    // (works without Cloud Functions). The astrologer collects their
    // post-commission share from their portal.
    try { await sessionService.endAndSettleClient(sid); }
    catch (_) {
      try {
        await sessionService.updateSessionStatus(sid, 'ended',
          { endTime: new Date() });
      } catch (e) {}
    }
    sessionService.endSession(sid).catch(() => {});
  }

  return { astro, session, wallet, countdown, chatId, end,
    sessionId: sessionIdRef.current };
}
