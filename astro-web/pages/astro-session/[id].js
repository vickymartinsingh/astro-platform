import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, chatService, userService, kundliService, callService,
  recordService, db,
} from '@astro/shared';
import { doc, updateDoc } from 'firebase/firestore';
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
  const [speaker, setSpeakerOn] = useState(true);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  // IMPROVEMENT 1: Agora connection error state
  const [agoraErr, setAgoraErr] = useState(null);
  // IMPROVEMENT 4: Closeable ended banner
  const [endedBannerVisible, setEndedBannerVisible] = useState(true);
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

  // IMPROVEMENT 1: Join Agora with full try/catch - show error banner on failure
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
        // Clear any previous error on successful join
        setAgoraErr(null);
        // Record the call/video for admin monitoring (best effort).
        recordService.startRecording({
          sessionId: id, type: session.type,
          astroId: user.uid, userId: session.userId,
        }).catch(() => {});
      } catch (e) {
        console.error(e);
        joinedRef.current = false; // allow retry
        setAgoraErr('Could not connect to call. Check camera/microphone permissions.');
      }
    })();
  }, [session?.status, session?.type, id, user]);

  function retryAgoraJoin() {
    setAgoraErr(null);
    // Reset join guard so the effect can fire again
    joinedRef.current = false;
    // Re-trigger by toggling a dummy state that causes the effect to re-run
    // We do this by invoking the join logic directly
    if (!session || !id || !user) return;
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
        setAgoraErr(null);
        joinedRef.current = true;
        recordService.startRecording({
          sessionId: id, type: session.type,
          astroId: user.uid, userId: session.userId,
        }).catch(() => {});
      } catch (e) {
        console.error(e);
        setAgoraErr('Could not connect to call. Check camera/microphone permissions.');
      }
    })();
  }

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
      setSessionEnded(true);
      setEndedBannerVisible(true);
    }
  }, [session?.status]);

  async function send() {
    if (!text.trim()) return;
    const chatId = [session.userId, session.astroId].sort().join('_');
    const v = text; setText('');
    await chatService.sendMessage(chatId, user.uid, v);
  }

  function endSession() {
    setEndModalOpen(true);
  }

  async function doEndSession(reason) {
    setEndModalOpen(false);
    // Save the reason the astrologer gave for ending.
    if (reason && id) {
      try {
        await updateDoc(doc(db, 'sessions', id), {
          endedByAstroReason: reason,
        });
      } catch (_) {}
    }
    try { await recordService.stopRecording(); } catch (_) {}
    await callService.leaveAgoraChannel();
    // Charge the client, then collect this astrologer's post-commission
    // earning into their wallet (client-side; no Cloud Functions needed).
    try { await sessionService.endAndSettleClient(id); } catch (_) {}
    try { await sessionService.collectAstrologerEarnings(user.uid); }
    catch (_) {}
    // Referral bonus check - if this astrologer was referred by
    // another astrologer at signup, and this session was their
    // first paid 30-minute (admin-configurable) session, credit
    // the referrer's wallet now. Idempotent server-side: the
    // pending row flips to "paid" inside a transaction, so a
    // duplicate end-session can't double-pay.
    try {
      const { referralService } = await import('@astro/shared');
      const cost = Number((session && session.cost) || 0);
      const dur = Number((session && session.duration) || 0);
      // Only count genuine paid sessions (cost > 0).
      if (cost > 0 && dur > 0) {
        await referralService.maybeCreditAstroReferral(
          user.uid, dur / 60);
      }
    } catch (_) { /* never block the end-call UX on this */ }
    sessionService.endSession(id).catch(() => {});
    // Stay on page - sessionEnded effect will set sessionEnded:true.
  }

  if (loading || !session) {
    return <div className="p-6 text-sub-text">Loading session...</div>;
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:` +
    `${String(elapsed % 60).padStart(2, '0')}`;
  // Customer remaining balance: derived from session.ratePerSecond and
  // session.clientWallet (server-synced snapshot). Shown in the top bar
  // and sidebar so the astrologer knows when to prompt a recharge.
  const ratePerSec = session.ratePerSecond || 0;
  const ratePerMin = Math.round(ratePerSec * 60);
  const walletSecsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor((session.clientWallet || 0) / ratePerSec))
    : null;
  const custRemainClock = walletSecsLeft !== null
    ? String(Math.floor(walletSecsLeft / 60)).padStart(2, '0') + ':'
      + String(walletSecsLeft % 60).padStart(2, '0')
    : null;
  const lowBalance = walletSecsLeft !== null && walletSecsLeft <= 60
    && walletSecsLeft > 0;

  // IMPROVEMENT 5: Earnings summary data
  const dur = Number(session.duration) || 0;
  const cost = Number(session.cost) || 0;
  const earned = Number(session.astroEarning || session.earned) || 0;
  const durMin = dur > 0 ? Math.ceil(dur / 60) : null;

  return (
    <div className="flex h-screen flex-col">
      {endModalOpen && (
        <EndConsultationModal
          onConfirm={doEndSession}
          onCancel={() => setEndModalOpen(false)} />
      )}
      {/* IMPROVEMENT 1: Agora error banner */}
      {agoraErr && (
        <div className="fixed inset-x-0 top-0 z-[70] flex items-center
          justify-between gap-3 bg-[#7F2020] px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="#FFF8E7" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-sm font-semibold text-[#FFF8E7] truncate">
              {agoraErr}
            </span>
          </div>
          <button
            onClick={retryAgoraJoin}
            className="shrink-0 rounded-full border border-[#FFF8E7]/60
              px-4 py-1.5 text-xs font-bold text-[#FFF8E7]
              hover:bg-[#FFF8E7]/10 active:bg-[#FFF8E7]/20">
            Retry
          </button>
        </div>
      )}
      {/* IMPROVEMENT 4: Closeable session ended banner */}
      {sessionEnded && endedBannerVisible && (
        <AstroSessionEndedBanner
          session={session}
          onClose={() => setEndedBannerVisible(false)} />
      )}
      {/* IMPROVEMENT 6: Always-visible top bar with active blinking dot */}
      <div className="flex items-center justify-between gap-2 bg-primary
                      px-4 py-2 text-white"
        style={{ paddingTop: agoraErr ? '3.5rem' : undefined }}>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {client?.name || 'Client'}
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            {/* Blinking dot when session is active */}
            {session.status === 'active' && !sessionEnded && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full
                  animate-ping rounded-full bg-[#D4A12A] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full
                  bg-[#D4A12A]" />
              </span>
            )}
            <span className="capitalize opacity-90">
              {session.type}
            </span>
            <span className="opacity-60">|</span>
            <span className="font-mono font-semibold tracking-wide">
              {mmss}
            </span>
            {custRemainClock && (
              <span className={'ml-0.5 ' + (lowBalance
                ? 'font-bold text-[#D4A12A]'
                : 'opacity-75')}>
                | Client {custRemainClock} left
              </span>
            )}
          </div>
        </div>
        {!sessionEnded && (
          <button onClick={endSession}
            className="shrink-0 rounded-full bg-danger px-5 py-2 text-sm
                       font-bold shadow">
            End
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
      {/* Client info panel (collapsible on mobile) */}
      <aside className="bg-bg-light p-4 md:w-72 overflow-y-auto">
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
        {custRemainClock && (
          <div className={'mt-1 rounded-card border p-2 text-sm ' + (lowBalance
            ? 'border-[#D4A12A]/40 bg-[#FFF8E7]'
            : 'border-gray-200 bg-white')}>
            <div className="text-[11px] text-sub-text">Customer has</div>
            <div className={'font-mono font-bold ' + (lowBalance
              ? 'text-[#D4A12A]' : 'text-dark-text')}>
              {custRemainClock} remaining
            </div>
            {lowBalance && (
              <div className="mt-0.5 text-[10px] font-semibold text-[#D4A12A]">
                Low balance
              </div>
            )}
          </div>
        )}
        {/* IMPROVEMENT 5: Earnings summary card shown when session ended */}
        {sessionEnded && (
          <div className="mt-4 rounded-2xl border border-[#D4A12A]/30
            bg-[#FFF8E7] px-4 py-3 text-sm shadow-sm">
            <div className="mb-2 flex items-center gap-1.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="#7F2020" strokeWidth="2" strokeLinecap="round"
                strokeLinejoin="round" className="shrink-0">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5
                  0 0 1 0 7H6" />
              </svg>
              <span className="font-bold text-[#7F2020]">
                Session Summary
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sub-text text-[12px]">Duration</span>
                <span className="font-semibold text-dark-text">
                  {durMin ? `${durMin} min` : `${Math.ceil(elapsed / 60)} min`}
                </span>
              </div>
              {cost > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sub-text text-[12px]">Client paid</span>
                  <span className="font-semibold text-dark-text">
                    Rs. {cost}
                  </span>
                </div>
              )}
              {earned > 0 && (
                <div className="flex items-center justify-between border-t
                  border-[#D4A12A]/20 pt-1.5 mt-1.5">
                  <span className="text-[12px] font-semibold text-[#7F2020]">
                    You earned
                  </span>
                  <span className="font-bold text-[#7F2020]">
                    Rs. {earned}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        {!sessionEnded && (
          <button onClick={endSession}
            className="btn-danger mt-4 w-full">End Session</button>
        )}
        {sessionEnded && (
          <button onClick={() => router.replace('/astro-dashboard')}
            className="btn-primary mt-4 w-full">Back to Dashboard</button>
        )}
      </aside>

      <main className="flex flex-1 flex-col bg-bg-gray">
        {session.type !== 'chat' && (
          <div className="relative flex flex-1 flex-col bg-call-bg
                          text-white">
            {/* IMPROVEMENT 2: Professional video connecting card */}
            <div ref={remoteRef}
              className="flex flex-1 items-center justify-center">
              {session.type === 'video' && !agoraErr && (
                <div className="flex flex-col items-center gap-4 rounded-2xl
                  border border-white/10 bg-black/40 px-8 py-6 backdrop-blur-sm">
                  {/* Spinning indicator */}
                  <div className="relative h-16 w-16">
                    <div className="absolute inset-0 rounded-full border-4
                      border-white/10" />
                    <div className="absolute inset-0 animate-spin rounded-full
                      border-4 border-transparent border-t-[#D4A12A]" />
                    {/* Client initials in centre */}
                    <div className="absolute inset-0 flex items-center
                      justify-center text-lg font-bold text-white/80">
                      {(client?.name || 'C').charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-semibold text-white">
                      {client?.name || 'Client'}
                    </div>
                    <div className="mt-0.5 text-sm text-white/60">
                      Connecting video...
                    </div>
                  </div>
                </div>
              )}
              {session.type === 'audio' && !agoraErr && (
                <div className="flex flex-col items-center gap-4 rounded-2xl
                  border border-white/10 bg-black/40 px-8 py-6 backdrop-blur-sm">
                  <div className="relative h-16 w-16">
                    <div className="absolute inset-0 rounded-full border-4
                      border-white/10" />
                    <div className="absolute inset-0 animate-spin rounded-full
                      border-4 border-transparent border-t-[#D4A12A]" />
                    <div className="absolute inset-0 flex items-center
                      justify-center">
                      <svg width="26" height="26" viewBox="0 0 24 24"
                        fill="none" stroke="rgba(255,255,255,0.8)"
                        strokeWidth="2" strokeLinecap="round"
                        strokeLinejoin="round">
                        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0
                          0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0
                          1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2
                          1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8
                          9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                          2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-base font-semibold text-white">
                      {client?.name || 'Client'}
                    </div>
                    <div className="mt-0.5 text-sm text-white/60">
                      Voice call connecting...
                    </div>
                  </div>
                </div>
              )}
            </div>
            {session.type === 'video' && (
              <div ref={localRef}
                className="absolute right-3 top-3 h-36 w-24 overflow-hidden
                           rounded-card bg-black/60" />
            )}
            {/* IMPROVEMENT 3: Larger, labelled call controls */}
            <div className="flex flex-col items-center gap-5 py-7">
              <div className="flex items-center justify-center gap-6">
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
              {!sessionEnded && (
              <button onClick={endSession} aria-label="End call"
                className="flex h-[72px] w-[72px] items-center justify-center
                  rounded-full bg-danger shadow-xl transition-transform
                  active:scale-95">
                <svg width="32" height="32" viewBox="0 0 24 24"
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
              )}
              {!sessionEnded && (
                <span className="text-[11px] font-semibold text-white/60
                  tracking-wide uppercase">
                  End Call
                </span>
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
            <div className="flex flex-col gap-0 bg-white">
              {sessionEnded && (
                <div className="px-3 pt-2 text-center text-xs
                  text-sub-text">
                  Consultation ended - you can still send follow-up
                  messages
                </div>
              )}
              <div className="flex gap-2 p-3">
                <input className="input flex-1 !rounded-full" value={text}
                  placeholder={sessionEnded
                    ? 'Send a follow-up message...'
                    : 'Type a reply...'}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()} />
                <button onClick={send}
                  className="btn-primary !rounded-full px-5">Send</button>
              </div>
            </div>
          </>
        )}
      </main>
      </div>
    </div>
  );
}

// Modal for ending a consultation - requires the astrologer to select
// a reason before the "End Consultation" button becomes enabled.
// Reason is saved to session.endedByAstroReason via updateDoc.
const END_REASONS = [
  'Consultation completed naturally',
  'Customer became unresponsive',
  'Technical issue on my end',
  'Customer was abusive/inappropriate',
  'Other',
];

function EndConsultationModal({ onConfirm, onCancel }) {
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
            {END_REASONS.map((r) => (
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

// IMPROVEMENT 4: Banner shown to the astrologer after the session ends.
// Now closeable with an X button. Displays duration, client cost, and
// the astrologer's earned amount.
function AstroSessionEndedBanner({ session, onClose }) {
  if (!session) return null;
  const dur = Number(session.duration) || 0;
  const cost = Number(session.cost) || 0;
  const earned = Number(session.astroEarning || session.earned) || 0;
  const durMin = dur > 0 ? Math.ceil(dur / 60) : null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60]
      flex justify-center px-3 pt-[env(safe-area-inset-top)]">
      <div className="pointer-events-auto mt-3 w-full max-w-md rounded-2xl
        border border-[#7F2020]/30 bg-[#FFF8E7] px-4 py-3 text-sm
        shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="font-bold text-[#7F2020]">Consultation ended</div>
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="flex h-6 w-6 shrink-0 items-center justify-center
              rounded-full text-[#7F2020]/60 transition-colors
              hover:bg-[#7F2020]/10 hover:text-[#7F2020]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="mt-0.5 text-dark-text">
          {durMin ? `Duration: ${durMin} min. ` : ''}
          {cost > 0 ? `Cost: Rs.${cost}. ` : ''}
          {earned > 0 ? `Earned: Rs.${earned}.` : ''}
        </div>
      </div>
    </div>
  );
}

// IMPROVEMENT 3: Round in-call control (icon + label), larger and more
// visible with bold label. WhatsApp/iPhone style.
function SCtl({ on, label, onClick, children }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex flex-col items-center gap-2">
      <span className={`flex h-14 w-14 items-center justify-center
        rounded-full shadow-md transition-colors ${on
          ? 'bg-white/20 hover:bg-white/30'
          : 'bg-white text-dark-text hover:bg-white/90'}`}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">{children}</svg>
      </span>
      <span className="text-[12px] font-semibold text-white/90 tracking-wide">
        {label}
      </span>
    </button>
  );
}
