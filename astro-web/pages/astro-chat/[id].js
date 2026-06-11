import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService,
  remedyService, astrologerService, assistantService, db,
  membershipService,
} from '@astro/shared';
import { doc, updateDoc } from 'firebase/firestore';
import { useRequireAstrologer } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';
import { playPing } from '../../lib/ping';

// Full-screen chat view for the astrologer (history or after a session).
// Same look as the live chat. The astrologer can keep replying here.
export default function AstroChat() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useRequireAstrologer();
  const { cfg } = useSettings();
  const [session, setSession] = useState(null);
  const [client, setClient] = useState(null);
  // kundli: default/first profile (for backward compat)
  const [kundli, setKundli] = useState(null);
  // kundliProfiles: all profiles for the client
  const [kundliProfiles, setKundliProfiles] = useState([]);
  const [astrologer, setAstrologer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busyAudio, setBusyAudio] = useState(false);
  const [remedyOpen, setRemedyOpen] = useState(false);
  const [remedyLoading, setRemedyLoading] = useState(false);
  const [myRemedies, setMyRemedies] = useState([]);
  const [aiAvailable, setAiAvailable] = useState(false); // admin-enabled
  const [aiOn, setAiOn] = useState(false);                // this astro's
  const [aiBusy, setAiBusy] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  // Kundli modal state
  const [kundliModalOpen, setKundliModalOpen] = useState(false);
  // Which tab is active when multiple kundli profiles exist (0-indexed)
  const [kundliTabIdx, setKundliTabIdx] = useState(0);
  // Elapsed timer: counts UP from session.startTime so the astrologer
  // always sees how long the session has been running.
  const [elapsedSecs, setElapsedSecs] = useState(0);
  // Themed toast (auto-clears after 5s). Replaces the native
  // window.alert calls inside the voice-recording flow that don't fit
  // a confirm modal (informational only).
  const [toast, setToast] = useState(null);
  // FEATURE 2: membership badge
  const [memberBadge, setMemberBadge] = useState(null);
  const [memberBannerDismissed, setMemberBannerDismissed] = useState(false);
  // FEATURE 3: desktop layout
  const [isDesktop, setIsDesktop] = useState(false);

  function notify(msg, kind = 'err') {
    setToast({ msg, kind });
    setTimeout(() => setToast((t) =>
      (t && t.msg === msg ? null : t)), 5000);
  }
  const scrollRef = useRef(null);
  const lastCount = useRef(0);
  const typingTsRef = useRef(0);
  const typingOffRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const aiCfgRef = useRef({});
  // FEATURE 1: last client message timestamp ref
  const lastClientMsgRef = useRef(0);
  // track whether inactivity warning was shown (reset on new activity)
  const inactivityWarnedRef = useRef(false);

  const chatId = session
    ? [session.userId, session.astroId].sort().join('_') : null;

  // FEATURE 3: detect desktop on mount and on resize
  useEffect(() => {
    function check() {
      setIsDesktop(typeof window !== 'undefined' && window.innerWidth >= 1024);
    }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!id) return;
    return sessionService.listenSession(id, setSession);
  }, [id]);

  useEffect(() => {
    if (!session) return undefined;
    setMessages([]); // drop the previous thread so a new chat isn't frozen
    lastCount.current = 0;
    lastClientMsgRef.current = 0;
    inactivityWarnedRef.current = false;
    setMemberBadge(null);
    setMemberBannerDismissed(false);
    userService.getUser(session.userId).then(setClient);
    // Load the default kundli for backward compat
    kundliService.getDefaultKundli(session.userId).then(setKundli)
      .catch(() => {});
    // Load ALL kundli profiles for the full modal view
    kundliService.getKundliProfiles(session.userId)
      .then((profiles) => {
        setKundliProfiles(profiles || []);
        setKundliTabIdx(0);
      })
      .catch(() => { setKundliProfiles([]); });
    // FEATURE 2: load membership badge for this client
    if (session.userId) {
      membershipService.getUserMembershipBadgeStatus(session.userId)
        .then((badge) => setMemberBadge(badge || null))
        .catch(() => setMemberBadge(null));
    }
    const chatId = [session.userId, session.astroId].sort().join('_');
    return chatService.listenMessages(chatId, setMessages);
  }, [session?.userId, session?.astroId]);

  useEffect(() => {
    // Ping on a genuinely new incoming (client) message.
    if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1];
      if (lastCount.current > 0 && last && last.senderId !== user?.uid
          && last.senderId !== 'system') {
        playPing();
      }
      lastCount.current = messages.length;
    }
    // FEATURE 1: track last client message timestamp
    // The astrologer's own uid is the astrologer; the client is anyone else
    // (excluding system). Walk all messages to find the most recent client msg.
    if (session?.userId) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.senderId === session.userId) {
          const ts = m.createdAt && m.createdAt.toMillis
            ? m.createdAt.toMillis()
            : (m.createdAt instanceof Date ? m.createdAt.getTime() : 0);
          if (ts > 0) {
            lastClientMsgRef.current = ts;
            // reset the warned flag whenever we record fresh client activity
            inactivityWarnedRef.current = false;
          }
          break;
        }
      }
    }
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, user, session?.userId]);

  // FEATURE 1: inactivity auto-end interval (30-second check)
  useEffect(() => {
    if (!session || session.status !== 'active') return undefined;
    const inactivityMinutes = Number(cfg?.chat_inactivity_minutes) || 3;
    const warnThresholdMs = (inactivityMinutes - 0.5) * 60 * 1000;
    const endThresholdMs = inactivityMinutes * 60 * 1000;

    const iv = setInterval(async () => {
      // Only act when session is still active
      if (!lastClientMsgRef.current) return;
      const idleSince = Date.now() - lastClientMsgRef.current;
      if (idleSince >= endThresholdMs) {
        // Auto-end
        clearInterval(iv);
        notify('Session ended due to inactivity.', 'err');
        try {
          await updateDoc(doc(db, 'sessions', id), {
            endedByAstroReason: 'Customer became unresponsive',
          });
        } catch (_) {}
        try { await sessionService.endAndSettleClient(id); } catch (_) {}
        try { await sessionService.collectAstrologerEarnings(user.uid); } catch (_) {}
        sessionService.endSession(id).catch(() => {});
      } else if (idleSince >= warnThresholdMs && !inactivityWarnedRef.current) {
        inactivityWarnedRef.current = true;
        notify('Session will end in 30 seconds due to customer inactivity.', 'err');
      }
    }, 30000);

    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.userId, cfg?.chat_inactivity_minutes, id, user?.uid]);

  // AI assistant availability: admin config (settings/config) gated to
  // this astrologer + the astrologer's own saved preference.
  useEffect(() => {
    if (!user) return undefined;
    const unsub = assistantService.watchAiConfig((cfgAi) => {
      aiCfgRef.current = cfgAi || {};
      setAiAvailable(assistantService.aiAvailableForAstro(cfgAi, user.uid));
    });
    astrologerService.getAstrologer(user.uid)
      .then((a) => {
        setAstrologer(a);
        setAiOn(assistantService.astroAssistantOn(a));
      })
      .catch(() => {});
    return () => { if (unsub) unsub(); };
  }, [user && user.uid]);

  // NOTE: the actual AI auto-reply (and kundli generation for context) is
  // handled app-wide by <AiAutoResponder> mounted in _app.js, so chats are
  // answered even when this screen is NOT open. This page only exposes the
  // on/off toggle (mirrors the dashboard toggle - same astrologer field).
  function toggleAi() {
    const next = !aiOn;
    setAiOn(next);
    try {
      astrologerService.updateAstrologer(user.uid, { aiAssistant: next });
    } catch (_) {}
  }

  async function takeOver() {
    if (!id || takeoverBusy) return;
    setTakeoverBusy(true);
    try {
      await updateDoc(doc(db, 'sessions', id),
        { aiActive: false, astroTookOver: true });
    } catch (_) {}
    setTakeoverBusy(false);
  }

  async function handBackToAi() {
    if (!id || takeoverBusy) return;
    setTakeoverBusy(true);
    try {
      await updateDoc(doc(db, 'sessions', id),
        { aiActive: true, astroTookOver: false });
    } catch (_) {}
    setTakeoverBusy(false);
  }

  // typing indicator (other participant is the client = session.userId)
  useEffect(() => {
    if (!chatId || !session?.userId) return undefined;
    let map = {};
    const unsub = chatService.listenChat(chatId, (c) => {
      map = (c && c.typing) || {};
    });
    const iv = setInterval(() => {
      const ts = Number(map[session.userId] || 0);
      setOtherTyping(ts > 0 && Date.now() - ts < 6000);
    }, 800);
    return () => { unsub && unsub(); clearInterval(iv); };
  }, [chatId, session?.userId]);

  // Elapsed timer: starts once the session is active (startTime set),
  // ticks every second. Also used to compute customer remaining balance.
  useEffect(() => {
    const active = session?.status === 'active' && !!session?.startTime;
    if (!active) { setElapsedSecs(0); return undefined; }
    const startMs = session.startTime?.toMillis
      ? session.startTime.toMillis()
      : session.startTime instanceof Date
        ? session.startTime.getTime() : 0;
    if (!startMs) return undefined;
    function tick() {
      setElapsedSecs(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session?.status, session?.startTime]);

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

  async function send() {
    if (!text.trim() || !session || !chatId) return;
    const v = text; setText('');
    await chatService.sendMessage(chatId, user.uid, v);
  }

  // End session: open the modal exactly once per tap.
  // If user cancels, endModalOpen goes false and nothing else happens.
  // The next tap opens the modal again.
  function endSession() {
    setEndModalOpen(true);
  }

  async function doEndSession(reason) {
    setEndModalOpen(false);
    if (reason && id) {
      try {
        await updateDoc(doc(db, 'sessions', id), {
          endedByAstroReason: reason,
        });
      } catch (_) {}
    }
    try {
      await sessionService.endAndSettleClient(id);
    } catch (_) {
      notify('Settlement failed - please contact support', 'err');
    }
    try { await sessionService.collectAstrologerEarnings(user.uid); }
    catch (_) {}
    sessionService.endSession(id).catch(() => {});
    // Stay on page - astrologer can send follow-up messages.
  }

  async function openRemedies() {
    if (!user) return;
    setRemedyLoading(true);
    setRemedyOpen(true);
    try {
      const results = await remedyService.getAstrologerRemedies(user.uid);
      setMyRemedies(results);
    } catch (_) {
      setMyRemedies([]);
    } finally {
      setRemedyLoading(false);
    }
  }
  async function suggestRemedy(r) {
    setRemedyOpen(false);
    if (!chatId) return;
    await chatService.sendMessage(
      chatId, user.uid, remedyService.remedyMessageText(r));
  }

  async function toggleRecord() {
    if (recording) {
      try { recRef.current && recRef.current.stop(); } catch (_) {}
      return;
    }
    // Pick a mimeType the platform actually supports. iOS WebView only
    // does audio/mp4; Android Chrome prefers webm/opus. Default ('') let
    // the browser pick - works on every supported platform.
    let mime = '';
    try {
      if (typeof MediaRecorder !== 'undefined'
        && MediaRecorder.isTypeSupported) {
        const cands = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4;codecs=mp4a.40.2',
          'audio/mp4',
          'audio/aac',
        ];
        mime = cands.find((m) => MediaRecorder.isTypeSupported(m)) || '';
      }
    } catch (_) { mime = ''; }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      notify(e && e.name === 'NotAllowedError'
        ? 'Microphone permission is needed. Allow it in Settings.'
        : 'Cannot access the microphone.');
      return;
    }
    try {
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onerror = () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        setRecording(false);
        notify('Recording failed. Please try again.');
      };
      mr.onstop = async () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        setRecording(false);
        const realType = mr.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: realType });
        if (!blob.size || !chatId) return;
        setBusyAudio(true);
        const ok = await chatService.sendAudioMessage(
          chatId, user.uid, blob);
        setBusyAudio(false);
        if (!ok) notify('Could not send the voice note.');
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      notify('Voice recording is not supported on this device.');
    }
  }

  if (loading || !session) {
    return <div className="p-6 text-sub-text">Loading chat...</div>;
  }

  const sessionIsActive = session.status === 'active'
    || session.status === 'accepted';
  const sessionIsEnded = session.status === 'ended';
  const aiHandlingChat = aiAvailable && session.type === 'chat'
    && session.aiActive && !session.astroTookOver;

  // Earnings summary computed once session ends.
  const earned = Number(session.astroEarning || session.earned || 0);
  const sessionCost = Number(session.cost || 0);
  const sessionDurationMins = session.duration
    ? Math.ceil(Number(session.duration) / 60) : null;

  // Elapsed clock string (MM:SS)
  const elapsedClock = String(Math.floor(elapsedSecs / 60)).padStart(2, '0')
    + ':' + String(elapsedSecs % 60).padStart(2, '0');

  const ratePerSec = session.ratePerSecond || 0;
  const ratePerMin = Math.round(ratePerSec * 60);
  const walletSecsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor((session.clientWallet || 0) / ratePerSec))
    : null;

  const astroAvatar = astrologer?.photo || astrologer?.photoURL || null;
  const astroInitial = (astrologer?.name || 'A').charAt(0).toUpperCase();

  // Determine which kundli to show in the sidebar card
  const sidebarKundli = kundliProfiles.length > 0
    ? kundliProfiles[kundliTabIdx] || kundliProfiles[0]
    : kundli;

  // FEATURE 3: desktop layout setting
  const desktopLayout = cfg?.astro_chat_desktop_layout || 'sidebar';
  const useSidebarLayout = isDesktop && desktopLayout === 'sidebar';

  // FEATURE 2: membership banner (show once, dismissable)
  const showMemberBanner = memberBadge?.hasBadge
    && !memberBannerDismissed
    && sessionIsActive;

  // ---------------------------------------------------------------------------
  // Shared sub-components rendered in both layouts
  // ---------------------------------------------------------------------------

  const modalsAndToasts = (
    <>
      {endModalOpen && (
        <AstroChatEndModal
          onConfirm={doEndSession}
          onCancel={() => setEndModalOpen(false)} />
      )}

      {kundliModalOpen && (
        <KundliModal
          profiles={kundliProfiles.length > 0
            ? kundliProfiles : (kundli ? [kundli] : [])}
          initialTab={kundliTabIdx}
          onTabChange={setKundliTabIdx}
          onClose={() => setKundliModalOpen(false)} />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-50
            flex justify-center px-3">
          <div className={`pointer-events-auto flex items-start gap-2
              rounded-card px-3 py-2 text-sm shadow-md
              ${toast.kind === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border border-rose-200 bg-rose-50 text-rose-800'}`}>
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)}
              aria-label="Dismiss" className="opacity-60 hover:opacity-100">
              &#x2715;
            </button>
          </div>
        </div>
      )}
    </>
  );

  // FEATURE 2: membership banner element
  const memberBannerEl = showMemberBanner ? (
    <div className="flex items-center justify-between gap-2 px-4 py-2"
      style={{ background: '#D4A12A', borderBottom: '1px solid #B8860B' }}>
      <span className="text-sm font-semibold"
        style={{ color: '#7F2020' }}>
        This is a membership consultation. Your earnings are 30% of the normal rate.
      </span>
      <button
        onClick={() => setMemberBannerDismissed(true)}
        className="shrink-0 text-sm font-bold opacity-70 hover:opacity-100"
        style={{ color: '#7F2020' }}
        aria-label="Dismiss">
        &#x2715;
      </button>
    </div>
  ) : null;

  // Chat messages list
  const messagesList = (
    <div ref={scrollRef}
      className="smooth-scroll flex-1 space-y-2 overflow-y-auto p-4">
      {messages.map((m) => {
        const mine = m.senderId === user.uid;
        const sys = m.senderId === 'system';
        return (
          <div key={m.id}
            className={`flex ${mine ? 'justify-end'
              : sys ? 'justify-center' : 'justify-start'}`}>
            <div className={`max-w-[75%] whitespace-pre-line
              rounded-card px-3 py-2 text-sm ${
              sys ? 'bg-accent-blue text-sub-text'
              : mine ? 'bg-chat-user' : 'bg-chat-astro'}`}>
              {m.imageUrl ? (
                <img src={m.imageUrl} alt="shared"
                  className="max-h-72 rounded-lg object-cover" />
              ) : m.audioUrl ? (
                <audio controls src={m.audioUrl}
                  className="h-10 w-56 max-w-full" />
              ) : m.text}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Typing bubble
  const typingBubble = otherTyping ? (
    <div className="px-4 pb-2">
      <AstroTypingBubble who="Client" />
    </div>
  ) : null;

  // Input bar - no astrologer avatar, no session code
  const inputBar = (
    <div className="flex items-center gap-2 bg-white px-3 py-2.5"
      style={{ borderTop: '1px solid #E8D5B0' }}>

      {/* Voice record button */}
      <button onClick={toggleRecord} disabled={busyAudio}
        title="Record voice note"
        className={`flex h-9 w-9 shrink-0 items-center
          justify-center rounded-full text-base transition ${recording
            ? 'animate-pulse bg-danger text-white'
            : 'bg-bg-light text-primary'}`}>
        {busyAudio ? '...' : recording ? '&#9646;' : '&#127908;'}
      </button>

      {/* Text input */}
      <input className="input flex-1 !rounded-full !py-2 text-sm"
        value={text}
        placeholder={recording ? 'Recording... tap stop to send'
          : 'Type a reply...'}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()} />

      {/* Remedy button */}
      <button onClick={openRemedies} title="Suggest a remedy"
        className="shrink-0 rounded-full px-3 py-2 text-sm
          font-semibold transition active:opacity-80"
        style={{ background: '#FFF8E7', color: '#7F2020',
          border: '1px solid #D4A12A50' }}>
        Remedy
      </button>

      {/* Send button */}
      <button onClick={send}
        className="shrink-0 flex h-9 w-9 items-center justify-center
          rounded-full text-white shadow transition
          active:opacity-80 disabled:opacity-40"
        style={{ background: '#7F2020' }}
        disabled={!text.trim()}
        aria-label="Send message">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );

  // Remedies modal
  const remediesModal = remedyOpen ? (
    <div className="fixed inset-0 z-50 flex items-end
      justify-center bg-black/40"
      onClick={() => setRemedyOpen(false)}>
      <div className="m-3 w-full max-w-md rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-bold text-dark-text">
            Suggest a remedy
          </span>
          <button onClick={() => setRemedyOpen(false)}
            className="text-sm text-sub-text hover:text-dark-text">
            Close
          </button>
        </div>
        {remedyLoading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <span className="inline-block h-5 w-5 animate-spin
              rounded-full border-2 border-t-transparent"
              style={{ borderColor: '#7F2020',
                borderTopColor: 'transparent' }} />
            <span className="text-sm text-sub-text">
              Loading remedies...
            </span>
          </div>
        ) : myRemedies.length === 0 ? (
          <p className="text-sm text-sub-text py-4 text-center">
            You have no remedies yet. Add them in My Remedies.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {myRemedies.map((r) => (
              <button key={r.id} onClick={() => suggestRemedy(r)}
                className="block w-full rounded-card border
                  border-gray-200 p-3 text-left hover:shadow
                  transition active:opacity-80">
                <div className="font-semibold text-dark-text">
                  {r.name}
                </div>
                <div className="text-xs font-semibold"
                  style={{ color: '#7F2020' }}>
                  Rs {r.price}
                </div>
                {r.description && (
                  <div className="text-xs text-sub-text mt-0.5">
                    {r.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Inline AI toggle row (compact, used in both mobile header and desktop sidebar)
  // ---------------------------------------------------------------------------
  const inlineAiRow = aiAvailable && session.type === 'chat' ? (
    <div className="flex items-center gap-2 px-4 py-2"
      style={{ borderBottom: '1px solid #E8D5B0' }}>
      <span className="text-xs font-semibold text-dark-text flex-1">
        AI Auto-reply
      </span>
      <button onClick={toggleAi}
        className={`relative h-5 w-9 shrink-0 rounded-full
          transition ${aiOn ? 'bg-emerald-500' : 'bg-gray-300'}`}
        aria-label="Toggle AI assistant">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full
          bg-white transition-all ${aiOn ? 'left-4' : 'left-0.5'}`} />
      </button>
      {session.aiActive && !session.astroTookOver ? (
        <button onClick={takeOver} disabled={takeoverBusy}
          className="rounded-full px-2 py-1 text-[11px] font-bold
            text-white disabled:opacity-50 shrink-0"
          style={{ background: '#D4A12A' }}>
          {takeoverBusy ? '...' : 'AI handling - Take Over'}
        </button>
      ) : session.astroTookOver ? (
        <button onClick={handBackToAi} disabled={takeoverBusy}
          className="rounded-full px-2 py-1 text-[11px] font-bold
            disabled:opacity-50 shrink-0"
          style={{ color: '#7F2020', background: '#FFF8E7',
            border: '1px solid #D4A12A50' }}>
          {takeoverBusy ? '...' : 'Hand back to AI'}
        </button>
      ) : null}
    </div>
  ) : null;

  // ---------------------------------------------------------------------------
  // Left sidebar content (desktop sidebar layout)
  // ---------------------------------------------------------------------------
  const sidebarContent = (
    <>
      {/* Back button */}
      <div className="p-4 pb-0">
        <button onClick={() => router.push('/astro-sessions')}
          className="mb-3 text-sm font-semibold text-primary flex
            items-center gap-1">
          <span style={{ fontSize: '1.1em' }}>&#8592;</span>
          Back to sessions
        </button>
      </div>

      {/* Client info */}
      <div className="px-4 pb-3 border-b"
        style={{ borderColor: '#E8D5B0' }}>
        <div className="flex items-center gap-2">
          <div className="font-bold text-dark-text">
            {client?.name || 'Client'}
          </div>
          {/* FEATURE 2: member badge in sidebar */}
          {memberBadge?.hasBadge && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold
                leading-none text-white"
              style={{ background: '#6B8E23' }}>
              {memberBadge.tierName ? memberBadge.tierName.toUpperCase() : 'MEMBER'}
            </span>
          )}
        </div>
        <div className="text-xs text-sub-text">
          {client?.userCode ? `#${client.userCode}` : ''}
        </div>
      </div>

      {/* Session Info section */}
      <div className="px-4 pt-3 pb-3 border-b"
        style={{ borderColor: '#E8D5B0' }}>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: '#7F2020' }}>
          Session Info
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-sub-text">Status</span>
          <span className={`font-semibold capitalize ${
            sessionIsActive ? 'text-emerald-600'
            : sessionIsEnded ? 'text-[#7F2020]' : 'text-sub-text'
          }`}>
            {session.status}
          </span>
        </div>

        {/* Elapsed + wallet for active sessions */}
        {session.status === 'active' && !!session.startTime && (
          <div className="rounded-card border p-2.5 text-sm space-y-1.5"
            style={{ borderColor: '#D4A12A', background: '#FFFDF5' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sub-text">Elapsed</span>
              <span className="font-mono font-bold text-dark-text">
                {elapsedClock}
              </span>
            </div>
            {ratePerMin > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sub-text">Rate</span>
                <span className="font-semibold text-dark-text">
                  Rs {ratePerMin}/min
                </span>
              </div>
            )}
            {walletSecsLeft !== null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sub-text">Client balance</span>
                <span className={`font-mono font-bold ${
                  walletSecsLeft <= 60 ? 'text-[#D4A12A]' : 'text-dark-text'
                }`}>
                  {String(Math.floor(walletSecsLeft / 60)).padStart(2, '0')}
                  :{String(walletSecsLeft % 60).padStart(2, '0')} min
                </span>
              </div>
            )}
            {ratePerMin > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sub-text">Est. earned</span>
                <span className="font-semibold"
                  style={{ color: '#7F2020' }}>
                  Rs {Math.round(ratePerSec * elapsedSecs * 0.7)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Purpose */}
        {session.purpose && (
          <div className="mt-2 text-sm text-sub-text">
            <span className="font-semibold text-dark-text">Purpose:</span>{' '}
            {session.purpose}
          </div>
        )}
      </div>

      {/* CLIENT KUNDLI section */}
      {(sidebarKundli || kundliProfiles.length > 0) && (
        <div className="px-4 pt-3 pb-3 border-b"
          style={{ borderColor: '#E8D5B0' }}>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest"
            style={{ color: '#7F2020' }}>
            Client Kundli
          </div>

          {/* Tab buttons when multiple profiles exist */}
          {kundliProfiles.length > 1 && (
            <div className="flex gap-1 mb-2">
              {kundliProfiles.map((p, i) => (
                <button key={p.id || i}
                  onClick={() => setKundliTabIdx(i)}
                  className="flex-1 rounded-full py-1 text-[11px] font-bold
                    transition"
                  style={{
                    background: kundliTabIdx === i ? '#7F2020' : '#FFF8E7',
                    color: kundliTabIdx === i ? '#fff' : '#7F2020',
                    border: '1px solid #D4A12A50',
                  }}>
                  Kundli {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Kundli card */}
          {sidebarKundli && (
            <div className="rounded-card bg-white p-3 text-sm space-y-0.5"
              style={{ border: '1px solid #E8D5B0' }}>
              {sidebarKundli.name && (
                <div className="font-semibold text-dark-text">
                  {sidebarKundli.name}
                </div>
              )}
              {sidebarKundli.dob && (
                <div className="text-sub-text text-xs">
                  DOB: {sidebarKundli.dob}
                </div>
              )}
              {(sidebarKundli.tob || sidebarKundli.ampm) && (
                <div className="text-sub-text text-xs">
                  Time: {sidebarKundli.tob || '--'}{' '}
                  {sidebarKundli.ampm || ''}
                </div>
              )}
              {sidebarKundli.place && (
                <div className="text-sub-text text-xs">
                  Place: {sidebarKundli.place}
                </div>
              )}
              {sidebarKundli.zodiac && (
                <div className="mt-1 inline-block rounded-full px-2 py-0.5
                  text-[11px] font-semibold text-white"
                  style={{ background: '#7F2020' }}>
                  {sidebarKundli.zodiac}
                </div>
              )}
            </div>
          )}

          {/* Open Full Kundli button */}
          <button
            onClick={() => setKundliModalOpen(true)}
            className="mt-2 w-full rounded-card py-2 text-sm font-bold
              transition active:opacity-80"
            style={{
              background: '#FFF8E7',
              color: '#7F2020',
              border: '1px solid #D4A12A60',
            }}>
            Open Full Kundli
          </button>
        </div>
      )}

      {/* Inline AI toggle row (replaces the old standalone AI card) */}
      {inlineAiRow}

      {/* Spacer + End button */}
      <div className="flex-1" />
      {sessionIsActive && (
        <div className="p-4">
          <button onClick={endSession}
            className="w-full rounded-full py-2.5 text-sm font-bold
              text-white shadow"
            style={{ background: '#7F2020' }}>
            End Consultation
          </button>
        </div>
      )}
    </>
  );

  // ---------------------------------------------------------------------------
  // FEATURE 3: DESKTOP SIDEBAR LAYOUT
  // ---------------------------------------------------------------------------
  if (useSidebarLayout) {
    return (
      <div className="flex h-screen overflow-hidden"
        style={{ background: '#F1FAF6' }}>
        {modalsAndToasts}

        {/* Left 70%: info + controls area */}
        <div className="flex flex-col overflow-y-auto"
          style={{ width: '70%', borderRight: '1px solid #E8D5B0' }}>

          {/* Left header */}
          <div className="bg-white px-6 py-4 shadow-sm"
            style={{ borderBottom: '1px solid #E8D5B0' }}>
            <button onClick={() => router.push('/astro-sessions')}
              className="mb-3 text-sm font-semibold text-primary flex
                items-center gap-1">
              <span style={{ fontSize: '1.1em' }}>&#8592;</span>
              Back to sessions
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center
                justify-center rounded-full font-bold text-white"
                style={{ background: '#7F2020' }}>
                {(client?.name || 'C').charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-dark-text text-lg">
                    {client?.name || 'Client'}
                  </span>
                  {memberBadge?.hasBadge && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]
                        font-bold leading-none text-white"
                      style={{ background: '#6B8E23' }}>
                      {memberBadge.tierName
                        ? memberBadge.tierName.toUpperCase() : 'MEMBER'}
                    </span>
                  )}
                  {client?.userCode && (
                    <span className="text-xs text-sub-text font-normal">
                      #{client.userCode}
                    </span>
                  )}
                </div>
                <div className="text-xs text-sub-text">
                  {sessionIsActive
                    ? (otherTyping ? 'typing...' : 'Online')
                    : 'Session ended'}
                </div>
              </div>
              {session.status === 'active' && !!session.startTime && (
                <div className="ml-auto flex items-center gap-1.5
                  rounded-full px-3 py-1 text-xs font-mono font-bold"
                  style={{ background: '#FFF8E7', color: '#7F2020',
                    border: '1px solid #D4A12A40' }}>
                  <span className="h-2 w-2 rounded-full bg-emerald-500
                    animate-pulse" />
                  {elapsedClock}
                </div>
              )}
            </div>
          </div>

          {/* FEATURE 2: membership banner */}
          {memberBannerEl}

          {/* Earnings summary (post-session) */}
          {sessionIsEnded && (
            <div className="px-6 py-3"
              style={{ background: '#FFF8E7',
                borderBottom: '1px solid #E8D5B0' }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="font-bold text-sm"
                  style={{ color: '#7F2020' }}>
                  Consultation Complete
                </div>
                {sessionDurationMins !== null && (
                  <div className="text-sm text-dark-text">
                    <span className="text-sub-text">Duration:</span>{' '}
                    <span className="font-semibold">
                      {sessionDurationMins} min
                    </span>
                  </div>
                )}
                {sessionCost > 0 && (
                  <div className="text-sm text-dark-text">
                    <span className="text-sub-text">Client paid:</span>{' '}
                    <span className="font-semibold">Rs {sessionCost}</span>
                  </div>
                )}
                {earned > 0 && (
                  <div className="text-sm">
                    <span className="text-sub-text">You earned:</span>{' '}
                    <span className="font-bold"
                      style={{ color: '#7F2020' }}>
                      Rs {earned}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI active banner */}
          {aiHandlingChat && (
            <div className="flex items-center gap-2 px-6 py-2"
              style={{ background: '#FFFDF0',
                borderBottom: '1px solid #D4A12A40' }}>
              <span className="flex h-6 w-6 shrink-0 items-center
                justify-center rounded-full text-sm"
                style={{ background: '#D4A12A', color: '#fff' }}>
                AI
              </span>
              <span className="text-sm font-semibold"
                style={{ color: '#7F2020' }}>
                AI Assistant is handling this chat
              </span>
              <button onClick={takeOver} disabled={takeoverBusy}
                className="ml-auto rounded-full px-3 py-1 text-xs
                  font-bold text-white disabled:opacity-50"
                style={{ background: '#7F2020' }}>
                {takeoverBusy ? 'Taking over...' : 'Take Over'}
              </button>
            </div>
          )}

          {/* Main content panels */}
          <div className="flex flex-1 gap-6 p-6 overflow-y-auto">

            {/* Session info panel */}
            <div className="flex flex-col gap-4 min-w-[220px] max-w-xs w-full">
              {/* Session Info */}
              <div className="rounded-2xl bg-white p-4"
                style={{ border: '1px solid #E8D5B0' }}>
                <div className="mb-3 text-[11px] font-bold uppercase
                  tracking-widest" style={{ color: '#7F2020' }}>
                  Session Info
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-sub-text">Status</span>
                  <span className={`font-semibold capitalize ${
                    sessionIsActive ? 'text-emerald-600'
                    : sessionIsEnded ? 'text-[#7F2020]' : 'text-sub-text'
                  }`}>
                    {session.status}
                  </span>
                </div>
                {session.status === 'active' && !!session.startTime && (
                  <div className="rounded-card border p-2.5 text-sm space-y-1.5"
                    style={{ borderColor: '#D4A12A',
                      background: '#FFFDF5' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sub-text">Elapsed</span>
                      <span className="font-mono font-bold text-dark-text">
                        {elapsedClock}
                      </span>
                    </div>
                    {ratePerMin > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sub-text">Rate</span>
                        <span className="font-semibold text-dark-text">
                          Rs {ratePerMin}/min
                        </span>
                      </div>
                    )}
                    {walletSecsLeft !== null && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sub-text">Client balance</span>
                        <span className={`font-mono font-bold ${
                          walletSecsLeft <= 60
                            ? 'text-[#D4A12A]' : 'text-dark-text'
                        }`}>
                          {String(Math.floor(walletSecsLeft / 60)).padStart(2, '0')}
                          :{String(walletSecsLeft % 60).padStart(2, '0')} min
                        </span>
                      </div>
                    )}
                    {ratePerMin > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sub-text">Est. earned</span>
                        <span className="font-semibold"
                          style={{ color: '#7F2020' }}>
                          Rs {Math.round(ratePerSec * elapsedSecs * 0.7)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {session.purpose && (
                  <div className="mt-2 text-sm text-sub-text">
                    <span className="font-semibold text-dark-text">
                      Purpose:
                    </span>{' '}
                    {session.purpose}
                  </div>
                )}
              </div>

              {/* Kundli panel */}
              {(sidebarKundli || kundliProfiles.length > 0) && (
                <div className="rounded-2xl bg-white p-4"
                  style={{ border: '1px solid #E8D5B0' }}>
                  <div className="mb-2 text-[11px] font-bold uppercase
                    tracking-widest" style={{ color: '#7F2020' }}>
                    Client Kundli
                  </div>
                  {kundliProfiles.length > 1 && (
                    <div className="flex gap-1 mb-2">
                      {kundliProfiles.map((p, i) => (
                        <button key={p.id || i}
                          onClick={() => setKundliTabIdx(i)}
                          className="flex-1 rounded-full py-1 text-[11px]
                            font-bold transition"
                          style={{
                            background: kundliTabIdx === i
                              ? '#7F2020' : '#FFF8E7',
                            color: kundliTabIdx === i ? '#fff' : '#7F2020',
                            border: '1px solid #D4A12A50',
                          }}>
                          Kundli {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  {sidebarKundli && (
                    <div className="rounded-card bg-white p-3 text-sm
                      space-y-0.5"
                      style={{ border: '1px solid #E8D5B0' }}>
                      {sidebarKundli.name && (
                        <div className="font-semibold text-dark-text">
                          {sidebarKundli.name}
                        </div>
                      )}
                      {sidebarKundli.dob && (
                        <div className="text-sub-text text-xs">
                          DOB: {sidebarKundli.dob}
                        </div>
                      )}
                      {(sidebarKundli.tob || sidebarKundli.ampm) && (
                        <div className="text-sub-text text-xs">
                          Time: {sidebarKundli.tob || '--'}{' '}
                          {sidebarKundli.ampm || ''}
                        </div>
                      )}
                      {sidebarKundli.place && (
                        <div className="text-sub-text text-xs">
                          Place: {sidebarKundli.place}
                        </div>
                      )}
                      {sidebarKundli.zodiac && (
                        <div className="mt-1 inline-block rounded-full
                          px-2 py-0.5 text-[11px] font-semibold text-white"
                          style={{ background: '#7F2020' }}>
                          {sidebarKundli.zodiac}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setKundliModalOpen(true)}
                    className="mt-2 w-full rounded-card py-2 text-sm
                      font-bold transition active:opacity-80"
                    style={{
                      background: '#FFF8E7',
                      color: '#7F2020',
                      border: '1px solid #D4A12A60',
                    }}>
                    Open Full Kundli
                  </button>
                </div>
              )}

              {/* Inline AI toggle row (replaces old standalone AI card) */}
              {aiAvailable && session.type === 'chat' && (
                <div className="rounded-2xl bg-white p-4"
                  style={{ border: '1px solid #E8D5B0' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-dark-text flex-1">
                      AI Auto-reply
                    </span>
                    <button onClick={toggleAi}
                      className={`relative h-5 w-9 shrink-0 rounded-full
                        transition ${aiOn ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      aria-label="Toggle AI assistant">
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full
                        bg-white transition-all ${aiOn ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {(session.aiActive || session.astroTookOver) && (
                    <div className="mt-2">
                      {!session.astroTookOver ? (
                        <button onClick={takeOver} disabled={takeoverBusy}
                          className="w-full rounded-card px-3 py-1.5 text-sm
                            font-semibold text-white transition
                            active:opacity-80 disabled:opacity-50"
                          style={{ background: '#D4A12A' }}>
                          {takeoverBusy ? 'Taking over...' : 'AI handling - Take Over'}
                        </button>
                      ) : (
                        <button onClick={handBackToAi} disabled={takeoverBusy}
                          className="w-full rounded-card border px-3 py-1.5
                            text-sm font-semibold transition
                            active:opacity-80 disabled:opacity-50"
                          style={{ borderColor: '#7F2020',
                            color: '#7F2020', background: '#FFF8E7' }}>
                          {takeoverBusy ? 'Handing back...' : 'Hand back to AI'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* End button */}
              {sessionIsActive && (
                <button onClick={endSession}
                  className="w-full rounded-full py-2.5 text-sm font-bold
                    text-white shadow"
                  style={{ background: '#7F2020' }}>
                  End Consultation
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right 30%: fixed chat panel */}
        <div className="flex flex-col"
          style={{
            width: '30%',
            background: '#FFFDF8',
            borderRadius: '0 0 0 0',
            boxShadow: '-2px 0 12px rgba(0,0,0,0.07)',
          }}>
          {/* Chat panel header - client name + code */}
          <div className="flex items-center gap-3 px-4 py-3 bg-white"
            style={{ borderBottom: '1px solid #E8D5B0' }}>
            <div className="flex h-9 w-9 shrink-0 items-center
              justify-center rounded-full font-bold text-white text-sm"
              style={{ background: '#7F2020' }}>
              {(client?.name || 'C').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-dark-text leading-tight">
                  {client?.name || 'Client'}
                </span>
                {memberBadge?.hasBadge && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold
                      leading-none text-white"
                    style={{ background: '#6B8E23' }}>
                    {memberBadge.tierName
                      ? memberBadge.tierName.toUpperCase() : 'MEMBER'}
                  </span>
                )}
                {client?.userCode && (
                  <span className="text-[11px] text-sub-text">
                    #{client.userCode}
                  </span>
                )}
              </div>
              <div className="text-xs text-sub-text">
                {sessionIsActive
                  ? (otherTyping ? 'typing...' : 'Online')
                  : 'Session ended'}
              </div>
            </div>
            {session.status === 'active' && !!session.startTime && (
              <div className="ml-auto flex items-center gap-1.5 rounded-full
                px-3 py-1 text-xs font-mono font-bold shrink-0"
                style={{ background: '#FFF8E7', color: '#7F2020',
                  border: '1px solid #D4A12A40' }}>
                <span className="h-2 w-2 rounded-full bg-emerald-500
                  animate-pulse" />
                {elapsedClock}
              </div>
            )}
          </div>

          {/* Messages */}
          {messagesList}

          {/* Typing bubble */}
          {typingBubble}

          {/* Input */}
          {inputBar}
        </div>

        {/* Remedies modal (global z-index) */}
        {remediesModal}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MOBILE LAYOUT: single flex-col h-screen, compact sticky header (~20%),
  // messages take flex-1 (~80%), input fixed at bottom.
  // ---------------------------------------------------------------------------

  // Compact kundli strip for mobile header
  const mobileKundliStrip = (sidebarKundli || kundliProfiles.length > 0) ? (
    <div className="flex items-center gap-2 px-4 py-1.5"
      style={{ borderBottom: '1px solid #E8D5B0' }}>
      {sidebarKundli?.zodiac && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]
          font-bold text-white"
          style={{ background: '#7F2020' }}>
          {sidebarKundli.zodiac}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-sub-text">
        {[sidebarKundli?.name, sidebarKundli?.dob, sidebarKundli?.place]
          .filter(Boolean).join(' | ')}
      </span>
      <button
        onClick={() => setKundliModalOpen(true)}
        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold
          transition active:opacity-80"
        style={{ background: '#FFF8E7', color: '#7F2020',
          border: '1px solid #D4A12A60' }}>
        Full Kundli
      </button>
    </div>
  ) : null;

  return (
    <div className="flex h-screen flex-col"
      style={{ background: '#F1FAF6' }}>
      {modalsAndToasts}

      {/* ---- COMPACT STICKY HEADER (max ~20% of screen) ---- */}
      <div className="shrink-0 bg-white shadow-sm"
        style={{ borderBottom: '1px solid #E8D5B0' }}>

        {/* Row 1: Back + timer/status + End button */}
        <div className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid #F0E4C880' }}>
          <button onClick={() => router.push('/astro-sessions')}
            className="shrink-0 flex items-center gap-1 text-sm
              font-semibold text-primary">
            <span style={{ fontSize: '1.1em' }}>&#8592;</span>
            Back
          </button>

          <div className="flex-1" />

          {/* Session timer */}
          {session.status === 'active' && !!session.startTime && (
            <div className="flex items-center gap-1 rounded-full px-2.5
              py-0.5 text-xs font-mono font-bold"
              style={{ background: '#FFF8E7', color: '#7F2020',
                border: '1px solid #D4A12A40' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500
                animate-pulse" />
              {elapsedClock}
            </div>
          )}

          {/* Status badge when not active timer */}
          {session.status !== 'active' && (
            <span className={`text-xs font-semibold capitalize ${
              sessionIsActive ? 'text-emerald-600'
              : sessionIsEnded ? 'text-[#7F2020]' : 'text-sub-text'
            }`}>
              {session.status}
            </span>
          )}

          {/* End consultation button (small, header right) */}
          {sessionIsActive && (
            <button onClick={endSession}
              className="shrink-0 rounded-full px-3 py-1 text-xs
                font-bold text-white"
              style={{ background: '#7F2020' }}>
              End
            </button>
          )}
        </div>

        {/* Row 2: Client avatar + name + badge + code + status dot */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center
            justify-center rounded-full font-bold text-white text-sm"
            style={{ background: '#7F2020' }}>
            {(client?.name || 'C').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-dark-text text-sm leading-tight">
                {client?.name || 'Client'}
              </span>
              {memberBadge?.hasBadge && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold
                    leading-none text-white"
                  style={{ background: '#6B8E23' }}>
                  {memberBadge.tierName
                    ? memberBadge.tierName.toUpperCase() : 'MEMBER'}
                </span>
              )}
              {client?.userCode && (
                <span className="text-[11px] text-sub-text">
                  #{client.userCode}
                </span>
              )}
              <span className={`inline-block h-2 w-2 rounded-full ${
                sessionIsActive ? 'bg-emerald-500' : 'bg-gray-400'
              }`} />
            </div>
            <div className="text-[11px] text-sub-text leading-tight">
              {sessionIsActive
                ? (otherTyping ? 'typing...' : 'Online')
                : 'Session ended'}
            </div>
          </div>
        </div>

        {/* Row 3: Compact kundli strip (only if kundli exists) */}
        {mobileKundliStrip}

        {/* Row 4: Inline AI toggle (only if AI available) */}
        {inlineAiRow}

        {/* FEATURE 2: membership banner */}
        {memberBannerEl}

        {/* Earnings summary (post-session) */}
        {sessionIsEnded && (
          <div className="px-4 py-2"
            style={{ background: '#FFF8E7',
              borderTop: '1px solid #E8D5B0' }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="font-bold text-xs"
                style={{ color: '#7F2020' }}>
                Consultation Complete
              </span>
              {sessionDurationMins !== null && (
                <span className="text-xs text-sub-text">
                  {sessionDurationMins} min
                </span>
              )}
              {earned > 0 && (
                <span className="text-xs font-bold"
                  style={{ color: '#7F2020' }}>
                  Earned: Rs {earned}
                </span>
              )}
            </div>
          </div>
        )}

        {/* AI active banner */}
        {aiHandlingChat && (
          <div className="flex items-center gap-2 px-3 py-1.5"
            style={{ background: '#FFFDF0',
              borderTop: '1px solid #D4A12A40' }}>
            <span className="flex h-5 w-5 shrink-0 items-center
              justify-center rounded-full text-[10px] font-bold"
              style={{ background: '#D4A12A', color: '#fff' }}>
              AI
            </span>
            <span className="flex-1 text-xs font-semibold"
              style={{ color: '#7F2020' }}>
              AI is handling this chat
            </span>
            <button onClick={takeOver} disabled={takeoverBusy}
              className="rounded-full px-2.5 py-1 text-[11px]
                font-bold text-white disabled:opacity-50"
              style={{ background: '#7F2020' }}>
              {takeoverBusy ? '...' : 'Take Over'}
            </button>
          </div>
        )}
      </div>

      {/* ---- MESSAGES AREA (flex-1, takes ~80% of remaining space) ---- */}
      {messagesList}

      {/* Typing bubble */}
      {typingBubble}

      {/* ---- INPUT BAR (sticks to bottom) ---- */}
      {inputBar}

      {/* Remedies modal */}
      {remediesModal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KundliModal: full-screen overlay showing all kundli profiles with
// predictions. Supports 1 profile (standard) or 2 profiles (matching).
// Accepts initialTab and onTabChange to remember last active tab.
// ---------------------------------------------------------------------------

// Zodiac sign traits (personality, career, health, love) used for predictions.
const ZODIAC_PREDICTIONS = {
  Aries: {
    p: 'Bold, energetic and a natural pioneer who leads from the front.',
    c: 'Thrives in leadership, defence, sport, entrepreneurship and fast-moving fields.',
    h: 'Strong vitality; watch the head, stress and a tendency to overexert.',
    l: 'Passionate and direct in love; values honesty and excitement.',
  },
  Taurus: {
    p: 'Patient, dependable and grounded with a love of comfort and beauty.',
    c: 'Excels in finance, real estate, food, arts and steady long-term work.',
    h: 'Robust constitution; mind the throat, neck and weight balance.',
    l: 'Loyal and sensual; seeks security and lasting commitment.',
  },
  Gemini: {
    p: 'Curious, witty and adaptable with a quick, communicative mind.',
    c: 'Shines in media, writing, sales, teaching, IT and travel.',
    h: 'Generally agile; protect the lungs, nerves and sleep routine.',
    l: 'Playful and intellectual; needs mental connection and variety.',
  },
  Cancer: {
    p: 'Caring, intuitive and protective with deep emotional intelligence.',
    c: 'Does well in care-giving, hospitality, real estate and family business.',
    h: 'Sensitive digestion and emotions; nurture rest and diet.',
    l: 'Devoted and nurturing; family and emotional safety matter most.',
  },
  Leo: {
    p: 'Confident, warm and creative with natural charisma and pride.',
    c: 'Born for leadership, entertainment, politics and the limelight.',
    h: 'Strong heart energy; guard the heart, back and over-confidence.',
    l: 'Generous and loyal; loves admiration and grand romance.',
  },
  Virgo: {
    p: 'Analytical, precise and service-minded with an eye for detail.',
    c: 'Great in health, analysis, editing, accounts and quality work.',
    h: 'Careful digestion and nerves; routine and clean diet help.',
    l: 'Thoughtful and devoted; shows love through practical care.',
  },
  Libra: {
    p: 'Balanced, charming and fair with a strong sense of harmony.',
    c: 'Suited to law, design, diplomacy, partnerships and the arts.',
    h: 'Watch kidneys and lower back; balance work and rest.',
    l: 'Romantic and partnership-oriented; seeks an equal companion.',
  },
  Scorpio: {
    p: 'Intense, determined and deeply perceptive with strong willpower.',
    c: 'Powerful in research, finance, medicine, investigation and strategy.',
    h: 'Strong recovery; manage stress and reproductive health.',
    l: 'Passionate and loyal; bonds deeply and values trust.',
  },
  Sagittarius: {
    p: 'Optimistic, free-spirited and philosophical, always seeking truth.',
    c: 'Excels in teaching, law, travel, publishing and consulting.',
    h: 'Active body; mind the hips, thighs and over-indulgence.',
    l: 'Honest and adventurous; needs freedom with loyalty.',
  },
  Capricorn: {
    p: 'Disciplined, ambitious and patient, building success steadily.',
    c: 'A natural in management, government, engineering and long-term ventures.',
    h: 'Strong stamina; care for bones, knees and joints.',
    l: 'Committed and steady; shows love through reliability.',
  },
  Aquarius: {
    p: 'Original, humane and visionary with an independent mind.',
    c: 'Innovates in technology, science, social work and networks.',
    h: 'Guard circulation and ankles; avoid irregular routines.',
    l: 'Friendly and unconventional; values mental freedom.',
  },
  Pisces: {
    p: 'Compassionate, imaginative and spiritual with deep empathy.',
    c: 'Gifted in arts, healing, spirituality, music and charity.',
    h: 'Sensitive feet and immunity; needs emotional grounding.',
    l: 'Tender and selfless; seeks a soulful, understanding bond.',
  },
};

// Simple compatibility description between two zodiac signs.
// Fire: Aries, Leo, Sagittarius | Earth: Taurus, Virgo, Capricorn
// Air: Gemini, Libra, Aquarius  | Water: Cancer, Scorpio, Pisces
function getZodiacElement(sign) {
  if (['Aries', 'Leo', 'Sagittarius'].includes(sign)) return 'Fire';
  if (['Taurus', 'Virgo', 'Capricorn'].includes(sign)) return 'Earth';
  if (['Gemini', 'Libra', 'Aquarius'].includes(sign)) return 'Air';
  if (['Cancer', 'Scorpio', 'Pisces'].includes(sign)) return 'Water';
  return 'Unknown';
}

function getCompatibilityText(sign1, sign2) {
  if (!sign1 || !sign2) return 'Compatibility analysis requires both zodiac signs.';
  const el1 = getZodiacElement(sign1);
  const el2 = getZodiacElement(sign2);
  if (sign1 === sign2) {
    return `Both are ${sign1} (${el1}). They share the same elemental energy, creating deep mutual understanding. The key is to balance similar traits and avoid amplifying weaknesses together.`;
  }
  const combos = {
    'Fire-Fire': 'Two Fire signs share passion and drive -- a dynamic, exciting match with high energy. Mutual respect and space are vital to avoid power struggles.',
    'Earth-Earth': 'Two Earth signs bring stability, loyalty and practicality -- a highly grounded and lasting bond built on shared values.',
    'Air-Air': 'Two Air signs enjoy lively minds and communication -- intellectually stimulating and socially vibrant, though emotional depth may need nurturing.',
    'Water-Water': 'Two Water signs share deep emotional sensitivity and intuition -- a profoundly empathic bond with strong spiritual connection.',
    'Fire-Air': 'Fire and Air feed each other -- this is an enthusiastic, creative and mutually inspiring pairing with strong chemistry.',
    'Air-Fire': 'Fire and Air feed each other -- this is an enthusiastic, creative and mutually inspiring pairing with strong chemistry.',
    'Earth-Water': 'Earth and Water nourish one another -- a nurturing, stable partnership where emotional and material needs are both met well.',
    'Water-Earth': 'Earth and Water nourish one another -- a nurturing, stable partnership where emotional and material needs are both met well.',
    'Fire-Earth': 'Fire and Earth can balance ambition with patience, but may need effort to reconcile pace and priorities. Mutual appreciation goes a long way.',
    'Earth-Fire': 'Fire and Earth can balance ambition with patience, but may need effort to reconcile pace and priorities. Mutual appreciation goes a long way.',
    'Air-Water': 'Air and Water connect mind and emotion -- a thoughtful and sensitive pairing that grows richer with open communication and understanding.',
    'Water-Air': 'Air and Water connect mind and emotion -- a thoughtful and sensitive pairing that grows richer with open communication and understanding.',
  };
  const key = `${el1}-${el2}`;
  return combos[key] || `${sign1} (${el1}) and ${sign2} (${el2}) bring complementary qualities. A detailed chart analysis will reveal the full picture of this pairing.`;
}

// Single kundli profile card for the modal.
function KundliProfileCard({ profile, label }) {
  if (!profile) return null;
  const traits = ZODIAC_PREDICTIONS[profile.zodiac] || null;
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: '#FFF8E7', border: '1px solid #D4A12A50' }}>
      {/* Label */}
      {label && (
        <div className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: '#D4A12A' }}>
          {label}
        </div>
      )}

      {/* Identity block */}
      <div className="rounded-xl bg-white p-3"
        style={{ border: '1px solid #E8D5B0' }}>
        {profile.name && (
          <div className="font-bold text-lg leading-tight"
            style={{ color: '#1A1A2E' }}>
            {profile.name}
          </div>
        )}
        {profile.zodiac && (
          <span className="mt-1 inline-block rounded-full px-2.5 py-0.5
            text-xs font-bold text-white"
            style={{ background: '#7F2020' }}>
            {profile.zodiac}
          </span>
        )}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {profile.dob && (
            <div>
              <div className="text-[10px] uppercase tracking-wider"
                style={{ color: '#D4A12A' }}>
                Date of Birth
              </div>
              <div className="text-sm font-semibold text-dark-text">
                {profile.dob}
              </div>
            </div>
          )}
          {(profile.tob || profile.ampm) && (
            <div>
              <div className="text-[10px] uppercase tracking-wider"
                style={{ color: '#D4A12A' }}>
                Time of Birth
              </div>
              <div className="text-sm font-semibold text-dark-text">
                {profile.tob || '--'} {profile.ampm || ''}
              </div>
            </div>
          )}
          {profile.place && (
            <div className="col-span-2">
              <div className="text-[10px] uppercase tracking-wider"
                style={{ color: '#D4A12A' }}>
                Place of Birth
              </div>
              <div className="text-sm font-semibold text-dark-text">
                {profile.place}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Predictions section */}
      {traits && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase
            tracking-widest" style={{ color: '#7F2020' }}>
            Predictions
          </div>
          <div className="space-y-1.5">
            <PredRow icon="&#9733;" label="Personality" text={traits.p} />
            <PredRow icon="&#9775;" label="Career" text={traits.c} />
            <PredRow icon="&#9829;" label="Health" text={traits.h} />
            <PredRow icon="&#9834;" label="Love" text={traits.l} />
          </div>
        </div>
      )}
    </div>
  );
}

function PredRow({ icon, label, text }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2"
      style={{ border: '1px solid #E8D5B0' }}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span style={{ color: '#D4A12A', fontSize: '13px' }}>{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: '#7F2020' }}>
          {label}
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: '#444' }}>
        {text}
      </p>
    </div>
  );
}

function KundliModal({ profiles, initialTab, onTabChange, onClose }) {
  // profiles: array of kundli profile objects (1 or 2+ supported).
  // initialTab: last active tab index from parent (persisted across opens).
  const [activeTab, setActiveTab] = useState(
    typeof initialTab === 'number' ? initialTab : 0
  );

  function handleTabChange(idx) {
    setActiveTab(idx);
    if (onTabChange) onTabChange(idx);
  }

  const hasMultiple = profiles.length >= 2;
  // For single-profile view, show the activeTab profile if multiple exist
  const displayProfile = profiles[activeTab] || profiles[0] || null;
  const p1 = profiles[0] || null;
  const p2 = profiles[1] || null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center
      overflow-y-auto bg-black/60 px-2 py-4"
      onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
        style={{ border: '1px solid #E8D5B0' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid #E8D5B0',
            background: '#7F2020', borderRadius: '1rem 1rem 0 0' }}>
          <div>
            <div className="font-bold text-white text-base leading-tight">
              Client Kundli
            </div>
            <div className="text-[11px] mt-0.5"
              style={{ color: '#F5D98B' }}>
              {hasMultiple
                ? `${profiles.length} profiles - Kundli Matching`
                : 'Birth chart details and predictions'}
            </div>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center
              rounded-full text-white text-lg transition hover:bg-white/20"
            aria-label="Close kundli modal">
            &#x2715;
          </button>
        </div>

        {/* Tab buttons when multiple profiles */}
        {profiles.length > 1 && (
          <div className="flex gap-1 px-4 pt-3">
            {profiles.map((p, i) => (
              <button key={p.id || i}
                onClick={() => handleTabChange(i)}
                className="flex-1 rounded-full py-1.5 text-xs font-bold
                  transition"
                style={{
                  background: activeTab === i ? '#7F2020' : '#FFF8E7',
                  color: activeTab === i ? '#fff' : '#7F2020',
                  border: '1px solid #D4A12A50',
                }}>
                {p.name ? p.name : `Profile ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* Single profile view (or selected tab when multiple) */}
          {!hasMultiple && p1 && (
            <KundliProfileCard profile={p1} label={null} />
          )}

          {/* Multi-profile: show selected tab profile */}
          {hasMultiple && (
            <>
              <KundliProfileCard
                profile={displayProfile}
                label={profiles.length > 1
                  ? `Profile ${activeTab + 1}` : null} />

              {/* Compatibility section when we have at least 2 profiles
                  and the first two are selected */}
              {p1?.zodiac && p2?.zodiac && (
                <div className="rounded-2xl p-4"
                  style={{ background: '#FFF8E7',
                    border: '1px solid #D4A12A50' }}>
                  <div className="mb-2 text-[11px] font-bold uppercase
                    tracking-widest" style={{ color: '#7F2020' }}>
                    Compatibility
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="rounded-full px-2.5 py-1 text-xs
                      font-bold text-white"
                      style={{ background: '#7F2020' }}>
                      {p1.zodiac}
                    </span>
                    <span style={{ color: '#D4A12A', fontSize: '18px' }}>
                      &#10022;
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-xs
                      font-bold text-white"
                      style={{ background: '#7F2020' }}>
                      {p2.zodiac}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed"
                    style={{ color: '#444' }}>
                    {getCompatibilityText(p1.zodiac, p2.zodiac)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white p-2"
                      style={{ border: '1px solid #E8D5B0' }}>
                      <div className="text-[10px] uppercase tracking-wider"
                        style={{ color: '#D4A12A' }}>
                        Element 1
                      </div>
                      <div className="font-bold text-sm"
                        style={{ color: '#7F2020' }}>
                        {getZodiacElement(p1.zodiac)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-2"
                      style={{ border: '1px solid #E8D5B0' }}>
                      <div className="text-[10px] uppercase tracking-wider"
                        style={{ color: '#D4A12A' }}>
                        Element 2
                      </div>
                      <div className="font-bold text-sm"
                        style={{ color: '#7F2020' }}>
                        {getZodiacElement(p2.zodiac)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer close */}
        <div className="px-5 py-4"
          style={{ borderTop: '1px solid #E8D5B0' }}>
          <button onClick={onClose}
            className="w-full rounded-full py-2.5 text-sm font-bold
              text-white transition active:opacity-80"
            style={{ background: '#7F2020' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// End Consultation modal for the astro-chat page. Requires the
// astrologer to select a reason before confirming. Saves the reason
// to session.endedByAstroReason via updateDoc.
// ---------------------------------------------------------------------------
const CHAT_END_REASONS = [
  'Consultation completed naturally',
  'Customer became unresponsive',
  'Technical issue on my end',
  'Customer was abusive/inappropriate',
  'Other',
];

function AstroChatEndModal({ onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/60 px-4"
      onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-bold text-dark-text">
          End Consultation
        </div>
        <p className="mt-1.5 text-sm text-sub-text">
          Please select a reason. This helps us improve the platform.
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-sm font-semibold
            text-dark-text">
            Reason for ending
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white
              px-3 py-2.5 text-sm text-dark-text outline-none
              focus:border-[#7F2020]">
            <option value="">Select a reason...</option>
            {CHAT_END_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel}
            className="flex-1 rounded-full border border-gray-300
              bg-white py-2.5 text-sm font-bold text-dark-text">
            Continue
          </button>
          <button
            onClick={() => reason && onConfirm(reason)}
            disabled={!reason}
            className="flex-1 rounded-full py-2.5 text-sm font-bold
              text-white disabled:opacity-40"
            style={{ background: '#7F2020' }}>
            End Consultation
          </button>
        </div>
      </div>
    </div>
  );
}

// WhatsApp / Meta-style typing bubble. Three dots bounce out of
// phase inside a chat bubble. Used by the astrologer chat page so
// the astrologer sees the customer compose in real time.
function AstroTypingBubble({ who }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl
      rounded-bl-md bg-white px-3 py-2 shadow-sm">
      <span className="text-[12px] text-sub-text">
        <b className="text-dark-text">{who}</b> is typing
      </span>
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i}
            className="inline-block h-1.5 w-1.5 rounded-full animate-bounce"
            style={{
              background: '#7F2020',
              animationDelay: `${i * 150}ms`,
            }} />
        ))}
      </span>
    </div>
  );
}
