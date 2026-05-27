import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService,
  remedyService, astrologerService, assistantService,
} from '@astro/shared';
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
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busyAudio, setBusyAudio] = useState(false);
  const [remedyOpen, setRemedyOpen] = useState(false);
  const [myRemedies, setMyRemedies] = useState([]);
  const [aiAvailable, setAiAvailable] = useState(false); // admin-enabled
  const [aiOn, setAiOn] = useState(false);                // this astro's
  const [aiBusy, setAiBusy] = useState(false);
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
      .then((a) => setAiOn(assistantService.astroAssistantOn(a)))
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

  async function openRemedies() {
    if (!user) return;
    setMyRemedies(await remedyService.getAstrologerRemedies(user.uid));
    setRemedyOpen(true);
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

  return (
    <div className="flex h-screen flex-col md:flex-row"
      style={{ background: '#F1FAF6' }}>
      {toast && (
        <div className={`pointer-events-none fixed inset-x-0 top-2 z-50
            flex justify-center px-3`}>
          <div className={`pointer-events-auto flex items-start gap-2
              rounded-card px-3 py-2 text-sm shadow-md
              ${toast.kind === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border border-rose-200 bg-rose-50 text-rose-800'}`}>
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)}
              aria-label="Dismiss" className="opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        </div>
      )}
      <aside className="bg-bg-light p-4 md:w-72">
        <button onClick={() => router.push('/astro-sessions')}
          className="mb-3 text-sm font-semibold text-primary">
          ← Back to sessions
        </button>
        <div className="font-bold">{client?.name || 'Client'}</div>
        <div className="text-xs text-sub-text">Code {client?.userCode}</div>
        {aiAvailable && session.type === 'chat' && (
          <div className="mt-3 flex items-center justify-between
            rounded-card border border-primary/30 bg-white p-2.5">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-dark-text">
                AI Assistant
              </div>
              <div className="text-[11px] text-sub-text">
                {aiOn ? (aiBusy ? 'Replying…' : 'Auto-replying to chats')
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
        )}
        {session.purpose && (
          <p className="mt-2 text-sm">Purpose: {session.purpose}</p>
        )}
        {kundli && (
          <div className="mt-3 whitespace-pre-line rounded-card bg-white
                          p-3 text-sm">
            {[kundli.name, `DOB: ${kundli.dob}`,
              `Time of birth: ${kundli.tob || '--'} ${kundli.ampm || ''}`
                .trim(),
              `Place of birth: ${kundli.place || '--'}`,
              kundli.zodiac ? `Sign: ${kundli.zodiac}` : ''
            ].filter(Boolean).join('\n')}
          </div>
        )}
        <div className="mt-3 text-sm capitalize text-sub-text">
          Status: {session.status}
        </div>
      </aside>

      <main className="flex flex-1 flex-col bg-bg-gray">
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
        {otherTyping && (
          <div className="px-4 pb-2">
            <AstroTypingBubble who="Client" />
          </div>
        )}
        <div className="flex items-center gap-2 bg-white p-3">
          <button onClick={toggleRecord} disabled={busyAudio}
            title="Record voice note"
            className={`flex h-11 w-11 shrink-0 items-center
              justify-center rounded-full text-lg ${recording
                ? 'animate-pulse bg-danger text-white'
                : 'bg-bg-light text-primary'}`}>
            {busyAudio ? '...' : recording ? '■' : '🎤'}
          </button>
          <input className="input flex-1 !rounded-full" value={text}
            placeholder={recording ? 'Recording... tap stop to send'
              : 'Type a reply...'}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button onClick={openRemedies} title="Suggest a remedy"
            className="shrink-0 rounded-full bg-bg-light px-3 py-2
              text-sm font-semibold text-primary">Remedy</button>
          <button onClick={send}
            className="btn-grad !rounded-full px-5">Send</button>
        </div>
        {remedyOpen && (
          <div className="fixed inset-0 z-50 flex items-end
            justify-center bg-black/40"
            onClick={() => setRemedyOpen(false)}>
            <div className="m-3 w-full max-w-md rounded-2xl bg-white p-4"
              onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-bold">Suggest a remedy</span>
                <button onClick={() => setRemedyOpen(false)}
                  className="text-sm text-sub-text">Close</button>
              </div>
              {myRemedies.length === 0 ? (
                <p className="text-sm text-sub-text">
                  You have no remedies yet. Add them in My Remedies.
                </p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {myRemedies.map((r) => (
                    <button key={r.id} onClick={() => suggestRemedy(r)}
                      className="block w-full rounded-card border
                        border-gray-200 p-3 text-left hover:shadow">
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-xs font-semibold text-primary">
                        Rs {r.price}
                      </div>
                      {r.description && (
                        <div className="text-xs text-sub-text">
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
