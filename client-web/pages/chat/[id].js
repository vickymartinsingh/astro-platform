import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  chatService, sessionService, soundService, assistantService,
} from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import VerifiedBadge from '../../components/VerifiedBadge';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { usePendingSession } from '../../lib/pendingSession';
import { confirmModal } from '../../components/ConfirmModal';

function fmtTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

export default function ChatScreen() {
  const router = useRouter();
  const { id: astroId } = router.query;
  const isView = router.query.view === '1';
  const { user, profile, loading } = useRequireClient();
  const { astro, session, wallet, countdown, chatId, end } =
    useSession({ astroId, type: 'chat', uid: user?.uid,
      clientName: profile?.name, view: isView });

  const { track } = usePendingSession();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showRate, setShowRate] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [busyImg, setBusyImg] = useState(false);
  const [liveSecs, setLiveSecs] = useState(0);
  const [otherTyping, setOtherTyping] = useState(false);
  const scrollRef = useRef(null);
  const lastCount = useRef(0);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const typingTsRef = useRef(0);
  const typingOffRef = useRef(null);

  function goBack() {
    if (isView) { router.back(); return; }
    if (session?.id) {
      track({ sessionId: session.id, astroId, astroName: astro?.name,
        type: 'chat' });
    }
    router.push('/dashboard');
  }
  // Cancelling a not-yet-accepted request MUST stop the astrologer from
  // ever receiving / accepting it (and therefore must never bill). Mark
  // the session 'cancelled' (a terminal state the astrologer feed and
  // billing both ignore) before leaving the screen.
  async function cancelRequest() {
    const sid = session?.id;
    if (sid) {
      try {
        await sessionService.updateSessionStatus(sid, 'cancelled');
      } catch (_) {}
    }
    router.push('/astrologers');
  }
  const mmss = `${Math.floor(Math.max(0, countdown) / 60)}:` +
    `${String(Math.max(0, countdown) % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (!chatId) return;
    return chatService.listenMessages(chatId, setMessages);
  }, [chatId]);

  // "typing..." indicator (other participant is the astrologer = astroId).
  useEffect(() => {
    if (!chatId || !astroId) return undefined;
    let map = {};
    const unsub = chatService.listenChat(chatId, (c) => {
      map = (c && c.typing) || {};
    });
    const iv = setInterval(() => {
      const ts = Number(map[astroId] || 0);
      setOtherTyping(ts > 0 && Date.now() - ts < 6000);
    }, 800);
    return () => { unsub && unsub(); clearInterval(iv); };
  }, [chatId, astroId]);

  function onType(v) {
    setText(v);
    if (!chatId || !user?.uid) return;
    const now = Date.now();
    if (now - typingTsRef.current > 2500) {
      typingTsRef.current = now;
      chatService.setTyping(chatId, user.uid, true);
    }
    clearTimeout(typingOffRef.current);
    typingOffRef.current = setTimeout(() => {
      typingTsRef.current = 0;
      chatService.setTyping(chatId, user.uid, false);
    }, 3000);
  }

  function jumpToBottom(smooth = true) {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto' });
  }

  useEffect(() => {
    if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1];
      if (lastCount.current > 0 && last && last.senderId !== user?.uid
          && last.senderId !== 'system' && !isView) {
        soundService.playNotification();
      }
      lastCount.current = messages.length;
    }
    if (atBottom) jumpToBottom();
  }, [messages, user, atBottom, isView]);

  useEffect(() => {
    if (session?.status === 'ended') setShowRate(true);
  }, [session?.status]);

  // Keep a global "active session" handle so the rejoin bar shows from
  // ANY screen (even when the user leaves via the bottom tab bar, not
  // just the back button). The bar auto-hides while on this screen.
  useEffect(() => {
    if (isView || !session?.id) return;
    if (['requesting', 'accepted', 'active'].includes(session.status)) {
      track({ sessionId: session.id, astroId, astroName: astro?.name,
        type: 'chat' });
    }
  }, [isView, session?.id, session?.status, astroId, astro?.name, track]);

  // The moment a chat session enters "requesting", ping the relay to
  // auto-accept it if the astrologer has the AI assistant enabled. The
  // relay checks the flag server-side and silently no-ops if AI is off,
  // so this is safe to call for every chat session.
  useEffect(() => {
    if (isView || !session?.id || !chatId) return;
    if (session.status !== 'requesting') return;
    if (!astroId || !user?.uid) return;
    assistantService.triggerAiAssist({
      chatId, sessionId: session.id,
      astroUid: astroId, clientUid: user.uid,
    });
  }, [session?.id, session?.status, chatId, astroId, user?.uid, isView]);

  // Idle-nudge timer. Whenever the astrologer (AI) sends a message and
  // the client doesn't respond, schedule a follow-up nudge through the
  // relay. Total inactivity window = exactly 2 minutes per user spec:
  //   - 1st nudge: 45s after the astrologer's last message
  //   - 2nd nudge: +45s after the 1st nudge (90s total)
  //   - goodbye:   +30s after the 2nd (120s total). Relay ends the
  //                session AND refunds the last 2 minutes of billed
  //                time so the client is not charged for the silence.
  // The timer resets the moment the client sends ANY new message OR
  // the astrologer (AI or human) sends a NEW non-nudge reply.
  const nudgeTimerRef = useRef(null);
  useEffect(() => {
    if (isView || !chatId || !astroId || !user?.uid) return undefined;
    if (!session?.id || session.status !== 'active') return undefined;
    if (!messages.length) return undefined;
    const last = messages[messages.length - 1];
    if (!last || !last.senderId) return undefined;
    // If the client just spoke, no nudge needed - cancel any pending.
    if (last.senderId === user.uid) {
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
      return undefined;
    }
    // Last message is from the astrologer (real or AI). Pick the delay
    // based on whether this message is itself a nudge.
    let delayMs = 45000;
    const nudgeIdx = Number(last.aiNudgeIndex || 0);
    if (nudgeIdx === 1) delayMs = 45000;        // 1st nudge -> wait 45s
    else if (nudgeIdx === 2) delayMs = 30000;   // 2nd nudge -> goodbye in 30s
    else if (nudgeIdx >= 3) return undefined;   // goodbye already sent
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      // Re-check the session is still active before firing.
      if (session?.status === 'active') {
        assistantService.triggerAiNudge({
          chatId, sessionId: session.id,
          astroUid: astroId, clientUid: user.uid,
        });
      }
    }, delayMs);
    return () => {
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }
    };
  }, [messages, session?.id, session?.status, chatId, astroId,
    user?.uid, isView]);

  // Auto-retry the AI reply trigger if the client's last message has
  // been hanging unanswered for 15 seconds (i.e. the initial
  // triggerAiAssist either errored, was dropped by Vercel cold start,
  // or the relay's stale aiRepliedTo flag wrongly skipped it). This
  // is the customer-facing safety net for "I sent something and got
  // nothing back". After 30s of still no reply, we try ONE more time
  // and then stop; the idle-nudge flow takes over from there.
  const replyRetryRef = useRef({ tries: 0, lastClientId: null });
  useEffect(() => {
    if (isView || !chatId || !astroId || !user?.uid) return undefined;
    if (!session?.id || session.status !== 'active') return undefined;
    if (!messages.length) return undefined;
    const last = messages[messages.length - 1];
    if (!last || last.senderId !== user.uid) return undefined;
    // New client message? Reset the retry counter.
    if (replyRetryRef.current.lastClientId !== last.id) {
      replyRetryRef.current = { tries: 0, lastClientId: last.id };
    }
    if (replyRetryRef.current.tries >= 2) return undefined;
    const t = setTimeout(() => {
      // Re-check: still our turn? (No astro reply landed since.)
      const cur = messages[messages.length - 1];
      if (!cur || cur.senderId !== user.uid || cur.id !== last.id) return;
      replyRetryRef.current.tries += 1;
      // eslint-disable-next-line no-console
      console.log('[aiAssist] no reply in 15s, re-firing with force',
        { try: replyRetryRef.current.tries, lastId: last.id });
      // force: true tells the relay to bypass the aiRepliedTo
      // idempotency check on the retry, so even a stale flag from a
      // prior partial run can never silence the reply.
      assistantService.triggerAiAssist({
        chatId, sessionId: session.id,
        astroUid: astroId, clientUid: user.uid, force: true,
      });
    }, 15000);
    return () => clearTimeout(t);
  }, [messages, session?.id, session?.status, chatId, astroId,
    user?.uid, isView]);

  // The consultation is only "connected" (timer + billing) once the
  // astrologer has accepted, which stamps startTime. Before that it is
  // strictly a waiting state - no countdown, no charge.
  const acceptedStatus = session?.status === 'active'
    || session?.status === 'accepted';
  const active = acceptedStatus && !!session?.startTime;
  const ratePerSec = session?.ratePerSecond || 0;
  const ratePerMin = Math.round(ratePerSec * 60);
  const broke = active && wallet <= 0;
  // Seconds the wallet can still afford at this rate.
  const secsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor(wallet / ratePerSec)) : 0;

  // Smooth 1-second countdown. Re-syncs whenever the real wallet figure
  // changes (the server/end settlement deducts), then ticks down locally
  // so the client always sees a live "time remaining" clock.
  useEffect(() => { setLiveSecs(secsLeft); }, [secsLeft]);
  useEffect(() => {
    if (!active || ratePerMin <= 0 || isView) return undefined;
    const t = setInterval(
      () => setLiveSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [active, ratePerMin, isView]);

  const showSecs = ratePerMin > 0 ? liveSecs : 0;
  const clock = `${String(Math.floor(showSecs / 60)).padStart(2, '0')}:` +
    `${String(showSecs % 60).padStart(2, '0')}`;
  // Warn the client when ~3 minutes of balance is left.
  const lowBalance = active && ratePerMin > 0
    && showSecs > 0 && showSecs <= 180;

  async function send() {
    if (!text.trim() || !active || broke) return;
    const v = text;
    setText('');
    setAtBottom(true);
    await chatService.sendMessage(chatId, user.uid, v);
    // Kick the relay to auto-reply on behalf of the astrologer when
    // they have the AI assistant on. Fire-and-forget (no UI block).
    if (chatId && astroId && user?.uid) {
      // eslint-disable-next-line no-console
      console.log('[aiAssist] firing send-trigger', {
        chatId, sessionId: session?.id, astroId, uid: user.uid });
      assistantService.triggerAiAssist({
        chatId, sessionId: session?.id,
        astroUid: astroId, clientUid: user.uid,
      });
    } else {
      // eslint-disable-next-line no-console
      console.log('[aiAssist] send-trigger SKIPPED - missing ids', {
        chatId, sessionId: session?.id, astroId, uid: user?.uid });
    }
  }

  async function pickImage(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    setSheet(false);
    if (!f) return;
    if (!active) {
      window.alert('The consultation is not active yet, please wait '
        + 'until the astrologer accepts before sending photos.');
      return;
    }
    if (broke) {
      window.alert('Your wallet balance is zero. Please recharge to '
        + 'continue sending photos.');
      return;
    }
    setBusyImg(true);
    try {
      await chatService.sendImageMessage(chatId, user.uid, f);
      setAtBottom(true);
    } catch (err) {
      // sendImageMessage now throws a specific human-readable message
      // (file too large / storage rules / network timeout / not
      // signed in) so the user knows the real cause instead of the
      // misleading "check your connection".
      // eslint-disable-next-line no-console
      console.error('[chat] photo send failed:', err);
      window.alert(err && err.message
        ? err.message
        : 'Could not send the photo. Please try again.');
    } finally { setBusyImg(false); }
  }

  async function confirmEnd() {
    const ok = await confirmModal({
      title: 'End this consultation?',
      message: 'You will be disconnected from the astrologer. Charges '
        + 'for time spent so far still apply.',
      yes: 'End now',
      no: 'Keep going',
      danger: true,
    });
    if (ok) end();
  }

  if (loading || !astro) {
    return <Layout nav={false}><div className="p-6">Loading...</div></Layout>;
  }

  const waiting = !isView && session
    && (session.status === 'requesting'
      || (acceptedStatus && !session.startTime));

  if (!isView && session && session.status === 'cancelled') {
    if (typeof window !== 'undefined') router.replace('/astrologers');
    return <Layout nav={false}><div className="p-6">Cancelled.</div></Layout>;
  }

  if (!isView && session && ['rejected', 'missed'].includes(session.status)) {
    return (
      <Overlay>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6
                        text-center shadow-xl">
          <h2 className="text-lg font-bold">We are sorry</h2>
          <p className="mt-2 text-sm text-sub-text">
            {session.status === 'rejected'
              ? `${astro.name} could not take your request right now.`
              : `${astro.name} did not respond in time.`}{' '}
            You have not been charged. Please try another astrologer who is
            online.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => router.push('/astrologers')}
              className="btn-primary flex-1 justify-center">
              Choose another astrologer
            </button>
            <button onClick={() => router.push('/dashboard')}
              className="btn-ghost flex-1">Home</button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <div className="relative flex h-screen flex-col bg-[#F4F2FB]">
      {/* Header: back, avatar, name + blue tick, live countdown,
          wallet, red End */}
      <div className="flex items-center gap-2.5 border-b border-gray-200
                      bg-white px-3 py-2.5">
        <button onClick={goBack} aria-label="Back"
          className="-ml-1 p-1 text-2xl leading-none text-dark-text">
          &#8249;
        </button>
        {/* Avatar + name are clickable: tap to open the astrologer's
            full profile page (without leaving the chat). The session
            stays "active" in the background - the ActiveSessionBar +
            useSession hook bring the customer right back to this chat
            with a single tap. */}
        <button type="button"
          onClick={() => astroId && router.push(`/astrologer/${astroId}`)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <img src={astro.profileImage || '/avatar.png'}
            className="h-9 w-9 rounded-full object-cover" alt="" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 font-semibold
                            text-dark-text">
              <span className="truncate underline-offset-2
                hover:underline">{astro.name}</span>
              {astro.approved && <VerifiedBadge size={15} />}
            </div>
            <div className="text-xs text-sub-text">
              {otherTyping ? (
                <span className="font-semibold text-primary">
                  typing...
                </span>
              ) : isView ? 'Viewing past messages'
                : waiting ? 'Connecting...'
                : active && ratePerMin > 0 ? `${clock} left`
                : active ? 'online'
                : 'Consultation ended'}
            </div>
          </div>
        </button>
        {!isView && (
          <>
            <button onClick={() => router.push('/wallet')}
              aria-label="Wallet" className="p-1 text-dark-text">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.7"
                strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2.5" />
                <path d="M3 10h18M16 14h2" />
              </svg>
            </button>
            <button onClick={confirmEnd}
              className="px-1 text-base font-semibold text-danger">
              End
            </button>
          </>
        )}
      </div>

      {waiting && (
        <div className="flex items-center gap-3 bg-bg-light px-4 py-3">
          <span className="h-6 w-6 shrink-0 animate-spin rounded-full
                           border-2 border-primary border-t-transparent" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-dark-text">
              Please wait until {astro.name} accepts your chat
            </div>
            <div className="text-sub-text">
              Your details have been shared. Time left {mmss}
            </div>
          </div>
          <button onClick={goBack}
            className="shrink-0 rounded-full bg-primary px-3 py-2
                       text-xs font-semibold text-white">
            Continue browsing
          </button>
          <button onClick={cancelRequest}
            className="shrink-0 rounded-full border border-gray-300
                       px-3 py-2 text-xs">Cancel</button>
        </div>
      )}

      {lowBalance && (
        <div className="flex items-center justify-between gap-2 bg-warning
                        px-4 py-2 text-sm text-white">
          <span>Low balance, about {Math.ceil(showSecs / 60)} min left.</span>
          <button
            onClick={() => router.push(`/wallet?return=/chat/${astroId}`)}
            className="rounded-full bg-white px-3 py-1 text-xs
                       font-bold text-warning">
            Recharge now
          </button>
        </div>
      )}

      <div ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="smooth-scroll relative flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 flex justify-center">
          <span className="rounded-full bg-white px-3 py-1 text-[11px]
                           font-medium text-sub-text shadow-sm">
            {isView ? 'Conversation history' : 'Today'}
          </span>
        </div>

        {messages.map((m) => {
          const mine = m.senderId === user.uid;
          const system = m.senderId === 'system';
          const divider = system && String(m.text || '').startsWith('•••');
          const t = fmtTime(m.createdAt);

          if (divider) {
            return (
              <div key={m.id} className="my-3 flex justify-center">
                <span className="rounded-full bg-white px-3 py-1
                                 text-[11px] text-sub-text shadow-sm">
                  {String(m.text).replace(/•/g, '').trim()}
                </span>
              </div>
            );
          }
          if (system) {
            return (
              <div key={m.id} className="my-2 flex justify-center">
                <div className="max-w-[82%] whitespace-pre-line rounded-2xl
                  bg-bg-light px-3.5 py-2 text-center text-[13px]
                  text-primary shadow-sm">
                  {m.text}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id}
              className={`mb-1.5 flex ${mine ? 'justify-end'
                : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2
                text-[14px] shadow-sm ${mine
                  ? 'rounded-br-md bg-[#E7DEFF]'
                  : 'rounded-bl-md bg-white'}`}>
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="shared"
                    className="max-h-72 rounded-lg object-cover" />
                ) : m.audioUrl ? (
                  <audio controls src={m.audioUrl}
                    className="h-10 w-56 max-w-full" />
                ) : (
                  <span className="whitespace-pre-line break-words
                                   text-dark-text">{m.text}</span>
                )}
                <div className="mt-0.5 flex items-center justify-end gap-1
                                text-[10px] text-sub-text">
                  <span>{t}</span>
                  {mine && <span className="text-primary">&#10003;&#10003;</span>}
                </div>
              </div>
            </div>
          );
        })}

        {/* WhatsApp / Meta / Amazon style typing bubble - three
            bouncing dots inside a chat bubble on the astrologer's
            (left) side, prefixed with their name so the customer
            knows it isn't them. */}
        {otherTyping && !isView && (
          <TypingBubble who={astro.name || 'Astrologer'}
            avatar={astro.profileImage} />
        )}
      </div>

      {!atBottom && (
        <button onClick={() => { setAtBottom(true); jumpToBottom(); }}
          aria-label="Scroll to latest"
          className="absolute bottom-24 right-4 z-10 flex h-10 w-10
            items-center justify-center rounded-full bg-white text-primary
            shadow-lg ring-1 ring-black/5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}

      {isView ? (
        <div className="flex items-center gap-2 border-t border-gray-200
                        bg-white px-3 py-3">
          <span className="flex-1 text-center text-xs text-sub-text">
            You are viewing past messages. The astrologer is not notified.
          </span>
          <button onClick={() => router.push(`/chat/${astroId}`)}
            className="btn-primary !min-h-0 px-4 py-2 text-sm">
            Start new chat
          </button>
        </div>
      ) : broke ? (
        <div className="bg-gray-100 p-3 text-center text-sm text-sub-text">
          Your balance ended, so you cannot send new messages, but the
          astrologer can still reply here for up to 1 hour.{' '}
          <a href={`/wallet?return=/chat/${astroId}`}
            className="font-bold text-primary">
            Recharge to continue
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-gray-200
                        bg-white px-3 py-2.5">
          <button onClick={() => active && setSheet(true)}
            aria-label="Add photo" disabled={!active || busyImg}
            className="flex h-9 w-9 shrink-0 items-center justify-center
              rounded-full text-2xl leading-none text-primary
              disabled:opacity-40">
            {busyImg ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2
                               border-primary border-t-transparent" />
            ) : '+'}
          </button>
          <input
            className="h-11 flex-1 rounded-full border border-gray-200
              bg-gray-50 px-4 text-[15px] outline-none focus:border-primary"
            placeholder={
              active ? 'Message...'
                : session?.status === 'ended'
                  ? 'Consultation ended.'
                  : session?.status === 'cancelled'
                    ? 'Consultation cancelled.'
                    : isView ? 'Viewing past messages.'
                      : 'Waiting for the astrologer to accept...'}
            value={text} disabled={!active}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button onClick={send} disabled={!active || !text.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center
              rounded-full bg-primary text-white disabled:opacity-40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4
              20-7z" /></svg>
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={pickImage} />
      <input ref={camRef} type="file" accept="image/*" capture="environment"
        hidden onChange={pickImage} />

      {sheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end
                        bg-black/40" onClick={() => setSheet(false)}>
          <div className="m-2 animate-[slideUp_.18s_ease-out]"
            onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl bg-white">
              <div className="py-3 text-center text-sm font-semibold
                              text-sub-text">Choose Picture</div>
              <button onClick={() => camRef.current?.click()}
                className="block w-full border-t border-gray-200 py-4
                  text-center text-base text-primary">
                From Camera
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="block w-full border-t border-gray-200 py-4
                  text-center text-base text-primary">
                From Photos
              </button>
            </div>
            <button onClick={() => setSheet(false)}
              className="mt-2 block w-full rounded-2xl bg-white py-4
                text-center text-base font-semibold text-danger">
              Cancel
            </button>
          </div>
        </div>
      )}

      {showRate && (
        <EndReasonBanner session={session} />
      )}
      {showRate && (
        <RateModal uid={user.uid} astroId={astroId}
          sessionId={session?.id}
          onDone={() => router.replace('/dashboard')} />
      )}
    </div>
  );
}

// Sits on top of the dark backdrop just above the "Rate your
// astrologer" modal. Explains WHY the chat ended:
//   - inactivity timeout: shows the refund amount + thanks
//   - normal end (user / astrologer / wallet exhausted): a warm
//     "thank you, hope you had a good experience" line
// Reads session.endReason + session.inactivityRefund set server-side
// by aiNudge / endSession.
function EndReasonBanner({ session }) {
  if (!session || session.status !== 'ended') return null;
  const reason = String(session.endReason || '').toLowerCase();
  const refund = Number(session.inactivityRefund) || 0;
  const refundSec = Number(session.inactivityRefundSeconds) || 0;
  const isIdle = reason === 'idle-timeout';
  const isWalletOut = reason === 'wallet-exhausted'
    || reason === 'low-balance';
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60]
      flex justify-center px-3 pt-[env(safe-area-inset-top)]">
      <div className={`pointer-events-auto mt-3 w-full max-w-md
        rounded-2xl px-4 py-3 text-sm shadow-2xl ${isIdle
          ? 'bg-amber-50 text-amber-900 border border-amber-200'
          : isWalletOut
            ? 'bg-rose-50 text-rose-900 border border-rose-200'
            : 'bg-emerald-50 text-emerald-900 border border-emerald-200'}`}>
        {isIdle ? (
          <>
            <div className="font-bold">
              Chat ended because of inactivity
            </div>
            <div className="mt-0.5">
              You were away for over 2 minutes, so the chat was closed
              automatically.{refund > 0 ? (
                <> We have refunded <b>₹{refund}</b>
                {refundSec ? ` (${Math.round(refundSec / 60 * 10) / 10
                  } min)` : ''} to your wallet for the unused time.</>
              ) : null}
              {' '}Thank you, we hope to see you again.
            </div>
          </>
        ) : isWalletOut ? (
          <>
            <div className="font-bold">
              Chat ended (wallet ran out)
            </div>
            <div className="mt-0.5">
              Your balance was used up. Recharge anytime to continue
              your consultation. Thank you for using AstroSeer.
            </div>
          </>
        ) : (
          <>
            <div className="font-bold">Consultation ended</div>
            <div className="mt-0.5">
              Thank you, we hope you had a great experience. Please
              rate your astrologer below.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }) {
  return (
    <Layout nav={false}>
      <div className="flex h-screen flex-col items-center justify-center
                      text-center">
        {children}
      </div>
    </Layout>
  );
}

// WhatsApp-style typing indicator. Shown at the bottom of the message
// list when the astrologer (or AI auto-responder writing in their
// name) is currently composing. Three dots bounce out of phase via
// inline @keyframes so we don't have to touch Tailwind config.
function TypingBubble({ who, avatar }) {
  return (
    <div className="mb-1.5 flex items-end gap-2">
      {avatar && (
        <img src={avatar} alt=""
          className="h-7 w-7 rounded-full object-cover" />
      )}
      <div className="rounded-2xl rounded-bl-md bg-white px-3 py-2
        shadow-sm">
        <div className="flex items-center gap-2 text-[12px]
          text-sub-text">
          <span className="font-semibold text-dark-text">
            {who}
          </span>
          <span>is typing</span>
          <span className="ml-1 flex items-center gap-0.5">
            <span className="typing-dot" />
            <span className="typing-dot" style={{ animationDelay: '120ms' }} />
            <span className="typing-dot" style={{ animationDelay: '240ms' }} />
          </span>
        </div>
      </div>
      <style jsx>{`
        :global(.typing-dot) {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #7F2020;
          display: inline-block;
          animation: typing-bounce 1s infinite ease-in-out;
        }
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
