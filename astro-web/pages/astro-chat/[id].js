import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService,
  remedyService, astrologerService, assistantService, db,
} from '@astro/shared';
import { doc, updateDoc } from 'firebase/firestore';
import { useRequireAstrologer } from '../../lib/useAuth';
import { playPing } from '../../lib/ping';

// Full-screen chat view for the astrologer (history or after a session).
// Same look as the live chat. The astrologer can keep replying here.
export default function AstroChat() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useRequireAstrologer();
  const [session, setSession] = useState(null);
  const [client, setClient] = useState(null);
  const [kundli, setKundli] = useState(null);
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
  // Elapsed timer: counts UP from session.startTime so the astrologer
  // always sees how long the session has been running.
  const [elapsedSecs, setElapsedSecs] = useState(0);
  // Themed toast (auto-clears after 5s). Replaces the native
  // window.alert calls inside the voice-recording flow that don't fit
  // a confirm modal (informational only).
  const [toast, setToast] = useState(null);
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
  const chatId = session
    ? [session.userId, session.astroId].sort().join('_') : null;

  useEffect(() => {
    if (!id) return;
    return sessionService.listenSession(id, setSession);
  }, [id]);

  useEffect(() => {
    if (!session) return undefined;
    setMessages([]); // drop the previous thread so a new chat isn't frozen
    lastCount.current = 0;
    userService.getUser(session.userId).then(setClient);
    kundliService.getDefaultKundli(session.userId).then(setKundli)
      .catch(() => {});
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
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, user]);

  // AI assistant availability: admin config (settings/config) gated to
  // this astrologer + the astrologer's own saved preference.
  useEffect(() => {
    if (!user) return undefined;
    const unsub = assistantService.watchAiConfig((cfg) => {
      aiCfgRef.current = cfg || {};
      setAiAvailable(assistantService.aiAvailableForAstro(cfg, user.uid));
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

  return (
    <div className="flex h-screen flex-col md:flex-row"
      style={{ background: '#F1FAF6' }}>
      {endModalOpen && (
        <AstroChatEndModal
          onConfirm={doEndSession}
          onCancel={() => setEndModalOpen(false)} />
      )}

      {/* Toast notifications */}
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

      {/* Sidebar */}
      <aside className="bg-bg-light md:w-72 flex flex-col"
        style={{ borderRight: '1px solid #E8D5B0' }}>

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
          <div className="font-bold text-dark-text">
            {client?.name || 'Client'}
          </div>
          <div className="text-xs text-sub-text">
            Code {client?.userCode}
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

        {/* Client Kundli section */}
        {kundli && (
          <div className="px-4 pt-3 pb-3 border-b"
            style={{ borderColor: '#E8D5B0' }}>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: '#7F2020' }}>
              Client Kundli
            </div>
            <div className="rounded-card bg-white p-3 text-sm space-y-0.5"
              style={{ border: '1px solid #E8D5B0' }}>
              {kundli.name && (
                <div className="font-semibold text-dark-text">{kundli.name}</div>
              )}
              {kundli.dob && (
                <div className="text-sub-text text-xs">DOB: {kundli.dob}</div>
              )}
              {(kundli.tob || kundli.ampm) && (
                <div className="text-sub-text text-xs">
                  Time: {kundli.tob || '--'} {kundli.ampm || ''}
                </div>
              )}
              {kundli.place && (
                <div className="text-sub-text text-xs">
                  Place: {kundli.place}
                </div>
              )}
              {kundli.zodiac && (
                <div className="mt-1 inline-block rounded-full px-2 py-0.5
                  text-[11px] font-semibold text-white"
                  style={{ background: '#7F2020' }}>
                  {kundli.zodiac}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AI Assistant section */}
        {aiAvailable && session.type === 'chat' && (
          <div className="px-4 pt-3 pb-3 border-b"
            style={{ borderColor: '#E8D5B0' }}>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: '#7F2020' }}>
              AI Assistant
            </div>
            <div className="flex items-center justify-between rounded-card
              border bg-white p-2.5"
              style={{ borderColor: '#D4A12A30' }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-dark-text">
                  Auto-reply
                </div>
                <div className="text-[11px] text-sub-text">
                  {aiOn ? (aiBusy ? 'Replying...' : 'Auto-replying to chats')
                    : 'Off, you reply manually'}
                </div>
              </div>
              <button onClick={toggleAi}
                className={`relative h-6 w-11 shrink-0 rounded-full
                  transition ${aiOn ? 'bg-emerald-500' : 'bg-gray-300'}`}
                aria-label="Toggle AI assistant">
                <span className={`absolute top-0.5 h-5 w-5 rounded-full
                  bg-white transition-all ${aiOn ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            {(session.aiActive || session.astroTookOver) && (
              <div className="mt-2">
                {!session.astroTookOver ? (
                  <button onClick={takeOver} disabled={takeoverBusy}
                    className="w-full rounded-card px-3 py-2 text-sm
                      font-semibold text-white transition active:opacity-80
                      disabled:opacity-50"
                    style={{ background: '#D4A12A' }}>
                    {takeoverBusy ? 'Taking over...' : 'Take Over Chat'}
                  </button>
                ) : (
                  <button onClick={handBackToAi} disabled={takeoverBusy}
                    className="w-full rounded-card border px-3 py-2 text-sm
                      font-semibold transition active:opacity-80
                      disabled:opacity-50"
                    style={{ borderColor: '#7F2020', color: '#7F2020',
                      background: '#FFF8E7' }}>
                    {takeoverBusy ? 'Handing back...' : 'Hand back to AI'}
                  </button>
                )}
                <div className="mt-1 text-center text-[10px] text-sub-text">
                  {!session.astroTookOver
                    ? 'AI is currently handling this chat'
                    : 'You are handling this chat'}
                </div>
              </div>
            )}
          </div>
        )}

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
      </aside>

      {/* Main chat area */}
      <main className="flex flex-1 flex-col bg-bg-gray overflow-hidden">

        {/* Chat header */}
        <div className="flex flex-col bg-white shadow-sm"
          style={{ borderBottom: '1px solid #E8D5B0' }}>

          {/* Earnings summary banner (post-session) */}
          {sessionIsEnded && (
            <div className="px-4 py-3"
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
                    <span className="font-bold" style={{ color: '#7F2020' }}>
                      Rs {earned}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI active banner */}
          {aiHandlingChat && (
            <div className="flex items-center gap-2 px-4 py-2"
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

          {/* Client name row */}
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center
              justify-center rounded-full font-bold text-white text-sm"
              style={{ background: '#7F2020' }}>
              {(client?.name || 'C').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-dark-text leading-tight">
                {client?.name || 'Client'}
              </div>
              <div className="text-xs text-sub-text">
                {sessionIsActive
                  ? (otherTyping ? 'typing...' : 'Online')
                  : 'Session ended'}
              </div>
            </div>
            {sessionIsActive && session.status === 'active'
              && !!session.startTime && (
              <div className="ml-auto flex items-center gap-1.5 rounded-full
                px-3 py-1 text-xs font-mono font-bold"
                style={{ background: '#FFF8E7', color: '#7F2020',
                  border: '1px solid #D4A12A40' }}>
                <span className="h-2 w-2 rounded-full bg-emerald-500
                  animate-pulse" />
                {elapsedClock}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
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

        {/* Typing bubble */}
        {otherTyping && (
          <div className="px-4 pb-2">
            <AstroTypingBubble who="Client" />
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-center gap-2 bg-white px-3 py-2.5"
          style={{ borderTop: '1px solid #E8D5B0' }}>
          {/* Astrologer avatar */}
          <div className="shrink-0 flex h-9 w-9 items-center justify-center
            rounded-full overflow-hidden"
            style={{ background: '#7F2020' }}>
            {astroAvatar
              ? <img src={astroAvatar} alt="You"
                  className="h-full w-full object-cover" />
              : <span className="text-white text-sm font-bold">
                  {astroInitial}
                </span>
            }
          </div>

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

        {/* Remedies modal */}
        {remedyOpen && (
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
        )}
      </main>
    </div>
  );
}

// End Consultation modal for the astro-chat page. Requires the
// astrologer to select a reason before confirming. Saves the reason
// to session.endedByAstroReason via updateDoc.
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
      <span className="flex items-center gap-0.5">
        <span className="atb-dot" />
        <span className="atb-dot" style={{ animationDelay: '120ms' }} />
        <span className="atb-dot" style={{ animationDelay: '240ms' }} />
      </span>
      <style jsx>{`
        :global(.atb-dot) {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #7F2020;
          display: inline-block;
          animation: atb-bounce 1s infinite ease-in-out;
        }
        @keyframes atb-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
