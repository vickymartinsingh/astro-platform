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
    if (session?.id && astroId && user?.uid) {
      assistantService.triggerAiAssist({
        chatId, sessionId: session.id,
        astroUid: astroId, clientUid: user.uid,
      });
    }
  }

  async function pickImage(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    setSheet(false);
    if (!f || !active || broke) return;
    setBusyImg(true);
    const ok = await chatService.sendImageMessage(chatId, user.uid, f);
    setBusyImg(false);
    if (!ok) {
      window.alert('Could not send the photo. Please check your '
        + 'connection and try again.');
    } else setAtBottom(true);
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
        <img src={astro.profileImage || '/avatar.png'}
          className="h-9 w-9 rounded-full object-cover" alt="" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 font-semibold
                          text-dark-text">
            <span className="truncate">{astro.name}</span>
            {astro.approved && <VerifiedBadge size={15} />}
          </div>
          <div className="text-xs text-sub-text">
            {otherTyping ? (
              <span className="font-semibold text-primary">typing...</span>
            ) : isView ? 'Viewing past messages'
              : waiting ? 'Connecting...'
              : active && ratePerMin > 0 ? `${clock} left`
              : active ? 'online'
              : 'Consultation ended'}
          </div>
        </div>
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
            placeholder={active ? 'Message...'
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
        <RateModal uid={user.uid} astroId={astroId}
          sessionId={session?.id}
          onDone={() => router.replace('/dashboard')} />
      )}
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
