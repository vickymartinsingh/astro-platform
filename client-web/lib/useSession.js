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

      // EXPLICIT REJOIN: the floating "Join back" bar navigates here
      // with ?resume=<sessionId>. Only that resumes a live session.
      const resumeId = typeof router.query.resume === 'string'
        ? router.query.resume : null;
      const mine = (await sessionService.getUserSessions(uid))
        .filter((s) => s.astroId === astroId);
      const live = (s) => ['requesting', 'accepted', 'active']
        .includes(s.status);

      let sid = null;
      if (resumeId) {
        const r = mine.find((s) => s.id === resumeId && live(s));
        if (r) sid = r.id;
      }

      if (!sid) {
        // A brand-new initiation. To survive only a quick refresh while
        // still WAITING, reuse a 'requesting' session created < 90s ago.
        const freshReq = mine.find((s) => s.status === 'requesting'
          && s.createdAt?.toMillis
          && (Date.now() - s.createdAt.toMillis()) < 90 * 1000);
        if (freshReq) {
          sid = freshReq.id;
        } else {
          // Close any lingering session for this pair so the
          // astrologer's old chat ends and a clean new request is
          // sent that they must explicitly Accept.
          for (const s of mine.filter(live)) {
            try { await sessionService.endAndSettleClient(s.id); }
            catch (_) {
              try {
                await sessionService.updateSessionStatus(s.id, 'ended');
              } catch (e) {}
            }
          }
          // Apply the astrologer's discountPercent to the per-minute
          // rate before locking it onto the session. The discounted price
          // is what every UI surface shows the customer (astrologer card,
          // profile, request modal), so billing MUST charge the same.
          const dp = Math.max(0, Math.min(100,
            Number(a.discountPercent) || 0));
          const eff = (b) => Math.round((Number(b) || 0) * (1 - dp / 100));
          sid = await sessionService.createSessionRequest({
            userId: uid,
            astroId,
            type,
            pricePerMinute:
              type === 'chat' ? eff(a.priceChat)
              : type === 'video' ? eff(a.priceVideo)
              : eff(a.priceCall),
          });
        }
      }
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
