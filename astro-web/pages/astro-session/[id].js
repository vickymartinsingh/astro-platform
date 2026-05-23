import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService, callService,
  recordService,
} from '@astro/shared';
import { useRequireAstrologer } from '../../lib/useAuth';
import { playPing } from '../../lib/ping';
import { confirmModal } from '../../components/ConfirmModal';

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
  const [speaker, setSpeakerOn] = useState(true);
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
  function toggleSpeaker() {
    const s = !speaker; setSpeakerOn(s);
    try { callService.setSpeaker(s); } catch (_) {}
  }
  function flipCam() {
    try { callService.switchCamera(); } catch (_) {}
  }

  useEffect(() => {
    if (!id) return;
    return sessionService.listenSession(id, setSession);
  }, [id]);

  useEffect(() => {
    if (!session) return undefined;
    // Clear the previous conversation immediately so a newly accepted
    // chat never "freezes" showing the old client's thread.
    setMessages([]);
    lastCount.current = 0;
    // NEVER let a rejected lookup bubble to window.unhandledrejection
    // (the boot error overlay treats that as a crash). All best-effort.
    userService.getUser(session.userId).then(setClient).catch(() => {});
    kundliService.getDefaultKundli(session.userId)
      .then(setKundli).catch(() => {});
    let unsub;
    try {
      const chatId = [session.userId, session.astroId].sort().join('_');
      unsub = chatService.listenMessages(chatId, setMessages);
    } catch (_) { /* chat is non-fatal for a call/video session */ }
    return () => { try { unsub && unsub(); } catch (_) {} };
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
        const tok = await callService.fetchAgoraToken(id, user.uid);
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
        // Record the call/video for admin monitoring (best effort).
        recordService.startRecording({
          sessionId: id, type: session.type,
          astroId: user.uid, userId: session.userId,
        }).catch(() => {});
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
    // Always jump to the newest message (bottom). Run after paint so the
    // newly rendered messages are measured; older messages are above and
    // reachable by scrolling up.
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, user]);

  useEffect(() => {
    if (session && ['ended', 'rejected', 'missed'].includes(session.status)) {
      recordService.stopRecording().catch(() => {});
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
    const t = session && session.type;
    const label = t === 'chat' ? 'chat'
      : t === 'video' ? 'video call' : 'call';
    const ok = await confirmModal({
      title: `End this ${label}?`,
      message: 'The client will be disconnected and billed for the time '
        + 'spent. This cannot be undone.',
      yes: 'End now',
      no: 'Keep going',
      danger: true,
    });
    if (!ok) return;
    try { await recordService.stopRecording(); } catch (_) {}
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
    <div className="flex h-screen flex-col">
      {/* Always-visible top bar with a prominent End button */}
      <div className="flex items-center justify-between gap-2 bg-primary
                      px-4 py-2 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {client?.name || 'Client'}
          </div>
          <div className="text-[11px] capitalize opacity-90">
            {session.type} · {mmss}
          </div>
        </div>
        <button onClick={endSession}
          className="shrink-0 rounded-full bg-danger px-5 py-2 text-sm
                     font-bold shadow">
          End
        </button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
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
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="flex items-center justify-center gap-5">
                <SCtl on={!muted} label={muted ? 'Unmute' : 'Mute'}
                  onClick={toggleMute}>
                  {muted ? (
                    <path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.1 2.1M15
                      9.3V5a3 3 0 0 0-5.9-.7M12 19v3M8 22h8" />
                  ) : (
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3
                      3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 19v3M8
                      22h8" />
                  )}
                </SCtl>
                <SCtl on={speaker}
                  label={speaker ? 'Speaker' : 'Speaker off'}
                  onClick={toggleSpeaker}>
                  <path d="M3 9v6h4l5 4V5L7 9H3z" />
                  {speaker && <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9
                    0 0 1 0 14" />}
                </SCtl>
                {session.type === 'video' && (
                  <>
                    <SCtl on={camOn}
                      label={camOn ? 'Camera' : 'Camera off'}
                      onClick={toggleCam}>
                      {camOn ? (
                        <path d="M23 7l-7 5 7 5V7zM1 5h14a2 2 0 0 1
                          2 2v10a2 2 0 0 1-2 2H1z" />
                      ) : (
                        <path d="M1 1l22 22M16 16v1a2 2 0 0 1-2
                          2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1m5
                          0h5a2 2 0 0 1 2 2v3l4-3v9" />
                      )}
                    </SCtl>
                    <SCtl on label="Flip" onClick={flipCam}>
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1
                        14l4.6 4.4A9 9 0 0 0 20.5 15" />
                    </SCtl>
                  </>
                )}
              </div>
              <button onClick={endSession} aria-label="End call"
                className="flex h-16 w-16 items-center justify-center
                  rounded-full bg-danger shadow-lg">
                <svg width="28" height="28" viewBox="0 0 24 24"
                  fill="none" stroke="#fff" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <g transform="rotate(135 12 12)">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8
                      0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0
                      1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3
                      1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6
                      6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2
                      0 0 1 1.7 2z" />
                  </g>
                </svg>
              </button>
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
    </div>
  );
}

// Round in-call control (icon + label), WhatsApp/iPhone style.
function SCtl({ on, label, onClick, children }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex flex-col items-center gap-1.5">
      <span className={`flex h-12 w-12 items-center justify-center
        rounded-full ${on ? 'bg-white/20'
          : 'bg-white text-dark-text'}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">{children}</svg>
      </span>
      <span className="text-[11px] text-white opacity-90">{label}</span>
    </button>
  );
}
