import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService,
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
    if (!session) return;
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
    scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' });
  }, [messages, user]);

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

  async function toggleRecord() {
    if (recording) {
      try { recRef.current && recRef.current.stop(); } catch (_) {}
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        { audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current,
          { type: 'audio/webm' });
        if (!blob.size || !chatId) return;
        setBusyAudio(true);
        const ok = await chatService.sendAudioMessage(
          chatId, user.uid, blob);
        setBusyAudio(false);
        if (!ok) window.alert('Could not send the voice note.');
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (_) {
      window.alert('Microphone permission is needed to record.');
    }
  }

  if (loading || !session) {
    return <div className="p-6 text-sub-text">Loading chat...</div>;
  }

  return (
    <div className="flex h-screen flex-col md:flex-row"
      style={{ background: '#F1FAF6' }}>
      <aside className="bg-bg-light p-4 md:w-72">
        <button onClick={() => router.push('/astro-sessions')}
          className="mb-3 text-sm font-semibold text-primary">
          ← Back to sessions
        </button>
        <div className="font-bold">{client?.name || 'Client'}</div>
        <div className="text-xs text-sub-text">Code {client?.userCode}</div>
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
          <div className="px-4 pb-1 text-xs font-semibold text-primary">
            Client is typing...
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
          <button onClick={send}
            className="btn-grad !rounded-full px-5">Send</button>
        </div>
      </main>
    </div>
  );
}
