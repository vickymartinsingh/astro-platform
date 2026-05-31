import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { callService, sessionService, soundService } from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { useSettings } from '../../lib/useSettings';
import { usePendingSession } from '../../lib/pendingSession';

export default function CallScreen() {
  const router = useRouter();
  const { id: astroId } = router.query;
  const callType = router.query.type === 'video' ? 'video' : 'call';
  const { user, profile, loading } = useRequireClient();
  const { astro, session, wallet, countdown, end, sessionId } =
    useSession({ astroId, type: callType, uid: user?.uid,
      clientName: profile?.name });
  const { cfg } = useSettings();

  const { track } = usePendingSession();
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeakerOn] = useState(true);
  const [camOn, setCamOn] = useState(callType === 'video');
  const [elapsed, setElapsed] = useState(0);
  const [showRate, setShowRate] = useState(false);
  const joinedRef = useRef(false);
  const remoteRef = useRef(null);
  const localRef = useRef(null);

  // Only "connected" (Agora join + billing) once the astrologer
  // accepted, which stamps startTime. Until then it stays a request.
  const acceptedStatus = session?.status === 'active'
    || session?.status === 'accepted';
  const active = acceptedStatus && !!session?.startTime;
  // Ringback while we are calling and not yet connected.
  const st = session?.status;
  const ringing = !!session && !active
    && st !== 'ended' && st !== 'rejected' && st !== 'cancelled'
    && st !== 'missed';
  useEffect(() => {
    if (ringing) soundService.startRing();
    else soundService.stopRing();
    return () => soundService.stopRing();
  }, [ringing]);
  const ratePerSec = session?.ratePerSecond || 0;
  // FREE SECONDS: when the session was created with freeEligible the
  // user gets cfg.free_call_seconds (default 5 min) of FREE call before
  // the wallet is touched - mirroring the end-billing logic. Before
  // this fix call/[id].js auto-hung-up the moment wallet hit 0 even
  // for free-eligible users, disconnecting every free call instantly.
  const freeSecsAllowed = (session && session.freeEligible)
    ? Number(cfg.free_call_seconds || 300) : 0;
  const startMs = session?.startTime?.toMillis
    ? session.startTime.toMillis()
    : (session?.startTime instanceof Date
      ? session.startTime.getTime() : 0);
  const freeSecsRemaining = active && startMs > 0
    ? Math.max(0, freeSecsAllowed - elapsed) : freeSecsAllowed;
  const walletSecsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor(wallet / ratePerSec))
    : Number.POSITIVE_INFINITY;
  const totalSecsLeft = freeSecsRemaining + walletSecsLeft;
  const lowBalance = active && ratePerSec > 0
    && totalSecsLeft > 0 && totalSecsLeft <= 60;

  // Join Agora once the session is live; channel = sessionId.
  useEffect(() => {
    if (!active || joinedRef.current || !sessionId) return;
    joinedRef.current = true;
    (async () => {
      try {
        const tok = await callService.fetchAgoraToken(sessionId, user.uid);
        const appId = tok.appId || callService.AGORA_APP_ID;
        await callService.joinAgoraChannel(
          sessionId, user.uid, appId, tok.token || null);
        callService.subscribeToRemote((rUser, mediaType) => {
          if (mediaType === 'video' && remoteRef.current) {
            rUser.videoTrack?.play(remoteRef.current);
          }
          if (mediaType === 'audio') rUser.audioTrack?.play();
        });
        const tracks = await callService.publishLocalTracks(
          { video: callType === 'video' });
        if (callType === 'video' && tracks.video && localRef.current) {
          tracks.video.play(localRef.current);
        }
      } catch (e) { console.error('agora join failed', e); }
    })();
  }, [active, sessionId, callType, user]);

  // Timer + auto-end when wallet hits zero (blueprint 4.9).
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  // Auto-hang only when BOTH the free-time window has elapsed AND the
  // wallet is exhausted. Free-eligible users with wallet=0 stay
  // connected for their freeSecsAllowed window first; paid users with
  // freeSecsAllowed=0 fall through to the wallet check immediately.
  useEffect(() => {
    if (!active) return;
    if (ratePerSec <= 0) return; // free chat (zero rate) never hangs
    if (totalSecsLeft <= 0) hangUp();
    // eslint-disable-next-line
  }, [totalSecsLeft, active, ratePerSec]);

  // Low-balance threshold: 60 seconds of TOTAL remaining time (free
  // + wallet). The existing "Call will end soon, recharge now" banner
  // already fires automatically on this flag - the user sees it
  // BEFORE the auto-hangUp fires when totalSecsLeft hits 0.

  useEffect(() => {
    if (session?.status === 'ended') {
      callService.leaveAgoraChannel();
      setShowRate(true);
    }
  }, [session?.status]);

  // Keep a global "active session" handle so the rejoin bar shows from
  // any screen if the user navigates away during the call/request.
  useEffect(() => {
    if (!session?.id) return;
    if (['requesting', 'accepted', 'active'].includes(session.status)) {
      track({ sessionId: session.id, astroId, astroName: astro?.name,
        type: callType });
    }
  }, [session?.id, session?.status, astroId, astro?.name, callType, track]);

  async function hangUp() {
    await callService.leaveAgoraChannel();
    await end();
  }

  // Cancelling a not-yet-accepted call must stop the astrologer ever
  // receiving / accepting it, and must never bill.
  async function cancelRequest() {
    const sid = session?.id;
    if (sid) {
      try { await sessionService.updateSessionStatus(sid, 'cancelled'); }
      catch (_) {}
    }
    router.push('/astrologers');
  }

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

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:` +
    `${String(elapsed % 60).padStart(2, '0')}`;

  if (loading || !astro) {
    return <Layout nav={false}><div className="p-6">Loading...</div></Layout>;
  }

  if (session && session.status === 'cancelled') {
    if (typeof window !== 'undefined') router.replace('/astrologers');
    return (
      <Overlay><div className="text-white">Cancelled.</div></Overlay>
    );
  }

  if (session && (session.status === 'requesting'
      || (acceptedStatus && !session.startTime))) {
    const an = astro.name || 'Astrologer';
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center
        justify-between bg-dark-text text-white"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          paddingBottom:
            'calc(env(safe-area-inset-bottom, 0px) + 48px)',
        }}>
        <div className="flex flex-1 flex-col items-center justify-center
          gap-4 px-6 text-center">
          <div className="text-sm uppercase tracking-widest opacity-70">
            {callType === 'video' ? 'Video call' : 'Voice call'}
          </div>
          <div className="relative">
            <span className="absolute inset-0 animate-ping rounded-full
              bg-white/15" />
            <img src={astro.profileImage || '/avatar.png'} alt={an}
              className="relative h-28 w-28 rounded-full object-cover
                ring-4 ring-white/25" />
          </div>
          <div className="text-3xl font-bold">{an}</div>
          <div className="text-sm opacity-80">Ringing...</div>
          <div className="mt-1 text-xs opacity-60">
            Waiting {Math.floor(Math.max(0, countdown) / 60)}:
            {String(Math.max(0, countdown) % 60).padStart(2, '0')}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button onClick={cancelRequest} aria-label="Cancel"
            className="flex h-16 w-16 items-center justify-center
              rounded-full bg-danger shadow-lg">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <g transform="rotate(135 12 12)">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3
                  19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1
                  4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5
                  2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                  2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
              </g>
            </svg>
          </button>
          <span className="text-sm">Cancel</span>
        </div>
      </div>
    );
  }
  if (session && ['rejected', 'missed'].includes(session.status)) {
    return (
      <Overlay>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6
                        text-center shadow-xl">
          <h2 className="text-lg font-bold">We are sorry</h2>
          <p className="mt-2 text-sm text-sub-text">
            {session.status === 'rejected'
              ? `${astro.name} could not take your call right now.`
              : `${astro.name} did not respond in time.`}{' '}
            You have not been charged. Please try another astrologer who is
            online.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => router.push('/astrologers')}
              className="btn-grad flex-1 justify-center">
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
    <div className="relative h-screen w-screen bg-call-bg text-white">
      <div ref={remoteRef}
        className="absolute inset-0 flex items-center justify-center">
        {callType !== 'video' && (
          <img src={astro.profileImage || '/avatar.png'}
            className="h-40 w-40 rounded-full object-cover opacity-80" alt="" />
        )}
      </div>
      {callType === 'video' && (
        <div ref={localRef}
          className="absolute right-3 top-16 h-40 w-28 overflow-hidden
                     rounded-card bg-black/60" />
      )}

      <div className="absolute left-0 right-0 top-0 flex justify-center
                      bg-black/40 px-4 py-3 text-sm">
        {astro.name} · {mmss} · ₹{wallet.toFixed(0)} remaining
      </div>

      {lowBalance && (
        <div className="absolute left-0 right-0 top-12 bg-warning/90
                        py-1 text-center text-xs">
          Call will end soon, recharge now
        </div>
      )}

      <div className="absolute inset-x-0 flex flex-col items-center
        gap-4"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
        }}>
        <div className="flex items-center justify-center gap-5">
          <Ctl on={!muted} label={muted ? 'Unmute' : 'Mute'}
            onClick={toggleMute}>
            {muted ? (
              <path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3
                3 0 0 0-5.9-.7M12 19v3M8 22h8" />
            ) : (
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0
                0-3-3zM5 11a7 7 0 0 0 14 0M12 19v3M8 22h8" />
            )}
          </Ctl>
          <Ctl on={speaker}
            label={speaker ? 'Speaker' : 'Speaker off'}
            onClick={toggleSpeaker}>
            <path d="M3 9v6h4l5 4V5L7 9H3z" />
            {speaker && <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1
              0 14" />}
          </Ctl>
          {callType === 'video' && (
            <>
              <Ctl on={camOn} label={camOn ? 'Camera' : 'Camera off'}
                onClick={toggleCam}>
                {camOn ? (
                  <path d="M23 7l-7 5 7 5V7zM1 5h14a2 2 0 0 1 2
                    2v10a2 2 0 0 1-2 2H1z" />
                ) : (
                  <path d="M1 1l22 22M16 16v1a2 2 0 0 1-2 2H3a2 2
                    0 0 1-2-2V7a2 2 0 0 1 2-2h1m5 0h5a2 2 0 0 1 2
                    2v3l4-3v9" />
                )}
              </Ctl>
              <Ctl on label="Flip" onClick={flipCam}>
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6
                  4.4A9 9 0 0 0 20.5 15" />
              </Ctl>
            </>
          )}
        </div>
        <button onClick={hangUp} aria-label="End call"
          className={`flex h-16 w-16 items-center justify-center
            rounded-full bg-danger shadow-lg ${lowBalance
            ? 'ring-4 ring-warning animate-pulse' : ''}`}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke="#fff" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round">
            <g transform="rotate(135 12 12)">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3
                19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1
                4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5
                2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
            </g>
          </svg>
        </button>
      </div>

      {showRate && (
        <RateModal uid={user.uid} astroId={astroId} sessionId={session?.id}
          reason={totalSecsLeft <= 0 && ratePerSec > 0 ? 'balance'
            : session?.endedByAstro ? 'astrologer' : 'self'}
          onDone={() => router.replace('/dashboard')} />
      )}
    </div>
  );
}

function Overlay({ children }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center
                    bg-call-bg text-center">
      {children}
    </div>
  );
}

// One round in-call control (icon + label), WhatsApp/iPhone style.
function Ctl({ on, label, onClick, children }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex flex-col items-center gap-1.5">
      <span className={`flex h-12 w-12 items-center justify-center
        rounded-full ${on ? 'bg-white/20' : 'bg-white text-dark-text'}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round">{children}</svg>
      </span>
      <span className="text-[11px] opacity-90">{label}</span>
    </button>
  );
}
