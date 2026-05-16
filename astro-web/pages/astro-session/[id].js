import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService, callService,
} from '@astro/shared';
import { useRequireAstrologer } from '../../lib/useAuth';
import { playPing } from '../../lib/ping';

export default function ActiveSession() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useRequireAstrologer();
  const [session, setSession] = useState(null);
  const [client, setClient] = useState(null);
  const [kundli, setKundli] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const scrollRef = useRef(null);
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const joinedRef = useRef(false);
  const lastCount = useRef(0);

  function toggleMute() {
    const m = !muted; setMuted(m); callService.setMuted(m);
  }
  function toggleCam() {
    const c = !camOn; setCamOn(c); callService.setCameraEnabled(c);
  }

  useEffect(() => {
    if (!id) return;
    return sessionService.listenSession(id, setSession);
  }, [id]);

  useEffect(() => {
    if (!session) return;
    userService.getUser(session.userId).then(setClient);
    kundliService.getDefaultKundli(session.userId).then(setKundli);
    const chatId = [session.userId, session.astroId].sort().join('_');
    const unsub = chatService.listenMessages(chatId, setMessages);
    return () => unsub && unsub();
  }, [session?.userId, session?.astroId]);

  useEffect(() => {
    if (session?.status !== 'active') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [session?.status]);

  // Join Agora for call/video sessions (channel = sessionId).
  useEffect(() => {
    if (session?.status !== 'active' || session?.type === 'chat') return;
    if (joinedRef.current || !id) return;
    joinedRef.current = true;
    (async () => {
      try {
        const tok = await callService.fetchAgoraToken(id);
        await callService.joinAgoraChannel(
          id, user.uid,
          tok.appId || callService.AGORA_APP_ID,
          tok.token || null);
        callService.subscribeToRemote((u, mt) => {
          if (mt === 'video') u.videoTrack?.play(remoteRef.current);
          if (mt === 'audio') u.audioTrack?.play();
        });
        const tracks = await callService.publishLocalTracks(
          { video: session.type === 'video' });
        if (session.type === 'video' && tracks.video && localRef.current) {
          tracks.video.play(localRef.current);
        }
      } catch (e) { console.error(e); }
    })();
  }, [session?.status, session?.type, id, user]);

  useEffect(() => {
    // Ping on a genuinely new incoming (client) message, like WA/Meta.
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

  useEffect(() => {
    if (session && ['ended', 'rejected', 'missed'].includes(session.status)) {
      callService.leaveAgoraChannel();
      router.replace('/astro-dashboard');
    }
  }, [session?.status, router]);

  async function send() {
    if (!text.trim()) return;
    const chatId = [session.userId, session.astroId].sort().join('_');
    const v = text; setText('');
    await chatService.sendMessage(chatId, user.uid, v);
  }

  async function endSession() {
    if (!confirm('End this session?')) return;
    await callService.leaveAgoraChannel();
    // Charge the client, then collect this astrologer's post-commission
    // earning into their wallet (client-side; no Cloud Functions needed).
    try { await sessionService.endAndSettleClient(id); } catch (_) {}
    try { await sessionService.collectAstrologerEarnings(user.uid); }
    catch (_) {}
    sessionService.endSession(id).catch(() => {});
    router.replace('/astro-dashboard');
  }

  if (loading || !session) {
    return <div className="p-6 text-sub-text">Loading session…</div>;
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:` +
    `${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-screen flex-col md:flex-row">
      {/* Client info panel (collapsible on mobile) */}
      <aside className="bg-bg-light p-4 md:w-72">
        <div className="font-bold">{client?.name || 'Client'}</div>
        <div className="text-xs text-sub-text">Code {client?.userCode}</div>
        {session.purpose && (
          <p className="mt-2 text-sm">Purpose: {session.purpose}</p>
        )}
        {kundli && (
          <div className="mt-3 rounded-card bg-white p-3 text-sm">
            <div className="font-semibold">Kundli</div>
            <div>{kundli.dob} · {kundli.tob} {kundli.ampm}</div>
            <div>{kundli.place} · {kundli.zodiac}</div>
          </div>
        )}
        <div className="mt-3 text-sm">Elapsed: <b>{mmss}</b></div>
        <button onClick={endSession}
          className="btn-danger mt-4 w-full">End Session</button>
      </aside>

      <main className="flex flex-1 flex-col bg-bg-gray">
        {session.type !== 'chat' && (
          <div className="relative flex flex-1 flex-col bg-call-bg
                          text-white">
            <div ref={remoteRef}
              className="flex flex-1 items-center justify-center">
              {session.type === 'video'
                ? 'Connecting video…' : 'Voice call connected'}
            </div>
            {session.type === 'video' && (
              <div ref={localRef}
                className="absolute right-3 top-3 h-36 w-24 overflow-hidden
                           rounded-card bg-black/60" />
            )}
            <div className="flex items-center justify-center gap-6 py-6">
              <button onClick={toggleMute}
                className="h-12 w-12 rounded-full bg-white/20 text-xl">
                {muted ? '🔇' : '🎙️'}
              </button>
              <button onClick={endSession}
                className="flex h-16 w-16 items-center justify-center
                           rounded-full bg-danger text-2xl">✕</button>
              {session.type === 'video' && (
                <button onClick={toggleCam}
                  className="h-12 w-12 rounded-full bg-white/20 text-xl">
                  {camOn ? '📷' : '🚫'}
                </button>
              )}
            </div>
          </div>
        )}
        {session.type === 'chat' && (
          <>
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
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 bg-white p-3">
              <input className="input flex-1 !rounded-full" value={text}
                placeholder="Type a reply…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button onClick={send}
                className="btn-primary !rounded-full px-5">Send</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
