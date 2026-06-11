import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, sessionService, soundService, recordService,
} from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { useSettings } from '../../lib/useSettings';
import { usePendingSession } from '../../lib/pendingSession';
import useScrollLock from '../../lib/useScrollLock';
import { confirmModal } from '../../components/ConfirmModal';

export default function CallScreen() {
  const router = useRouter();
  const { id: astroId } = router.query;
  const [typeChosen, setTypeChosen] = useState(false);
  const [selectedType, setSelectedType] = useState(
    router.query.type === 'video' ? 'video' : 'call',
  );
  const callType = selectedType;
  const { user, profile, loading } = useRequireClient();
  const { astro, session, wallet, walletLoaded, countdown, end, sessionId } =
    useSession({ astroId, type: callType, uid: user?.uid,
      clientName: profile?.name });
  const { cfg } = useSettings();

  const { track } = usePendingSession();
  useScrollLock(true);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeakerOn] = useState(true);
  const [camOn, setCamOn] = useState(callType === 'video');
  const [elapsed, setElapsed] = useState(0);
  const [showRate, setShowRate] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const joinedRef = useRef(false);
  const remoteRef = useRef(null);
  const localRef = useRef(null);

  // Sync selectedType with router.query.type on first load.
  useEffect(() => {
    if (router.query.type) {
      setSelectedType(router.query.type === 'video' ? 'video' : 'call');
    }
  }, [router.query.type]);

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
      // Customer-side recording MUST start independent of Agora -
      // even if Agora's createMicrophoneAudioTrack throws (mic
      // permission denied, codec error), recordService has its own
      // getUserMedia fallback so we still capture the customer's
      // voice. The deterministic Storage path in recordService
      // means both sides writing for the same session collapse to
      // ONE file. Fire-and-forget - the call never breaks on a
      // recording failure.
      recordService.startRecording({
        sessionId,
        type: callType,                  // 'call' | 'video'
        astroId,
        userId: user.uid,
      }).catch(() => {});
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
  }, [active, sessionId, callType, user, astroId]);

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
    // CRITICAL: don't auto-hang until the wallet listener has fired
    // at least once. Otherwise the default wallet=0 racing with the
    // active-status flip kills the call (and the recording) at t=0
    // before the real wallet snapshot arrives.
    if (!walletLoaded) return;
    if (totalSecsLeft <= 0) doHangUp();
    // eslint-disable-next-line
  }, [totalSecsLeft, active, ratePerSec, walletLoaded]);

  // Low-balance threshold: 60 seconds of TOTAL remaining time (free
  // + wallet). The existing "Call will end soon, recharge now" banner
  // already fires automatically on this flag - the user sees it
  // BEFORE the auto-hangUp fires when totalSecsLeft hits 0.

  useEffect(() => {
    if (session?.status === 'ended') {
      // Finalise recording BEFORE tearing down Agora. Fire-and-forget.
      recordService.stopRecording().catch(() => {});
      callService.leaveAgoraChannel();
      setSessionEnded(true);
      // Brief pause so the ended banner is visible before rate modal.
      const t = setTimeout(() => setShowRate(true), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
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

  // doHangUp: actually ends the call. Used by the auto-hangup (wallet
  // exhausted) path which should NOT prompt for confirmation, and also
  // called by hangUp() after the user confirms.
  async function doHangUp() {
    // Finalise + upload the recording BEFORE leaving Agora so the
    // remote tracks are still in the mixer for any tail audio.
    // Fire-and-forget - the upload happens in parallel with
    // leaveAgoraChannel + end() so a slow network never holds the
    // customer on a hung-up screen.
    recordService.stopRecording().catch(() => {});
    await callService.leaveAgoraChannel();
    await end();
  }

  async function hangUp() {
    const label = callType === 'video' ? 'video call' : 'call';
    const ok = await confirmModal({
      title: 'Are you sure you want to end the consultation?',
      message: `Charges for time spent on this ${label} still apply.`,
      yes: 'Yes, End Now',
      no: 'Keep Chatting',
      danger: true,
    });
    if (!ok) return;
    await doHangUp();
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

  // TYPE PICKER: shown before a session exists and before the user has
  // confirmed their call type. Acts as a UI gate only - does not block
  // the session from being created server-side.
  if (!session && !typeChosen) {
    const an = astro.name || 'Astrologer';
    const rate = astro.ratePerMinute || astro.rate || 0;
    return (
      <div
        className="fixed inset-0 z-[70] flex flex-col items-center
          justify-center px-6"
        style={{ background: 'linear-gradient(180deg, #1A0A0A 0%, #000000 100%)' }}
      >
        {/* Astrologer identity */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img
            src={astro.profileImage || '/avatar.png'}
            alt={an}
            className="h-24 w-24 rounded-full object-cover"
            style={{ border: '3px solid #D4A12A' }}
          />
          <div
            className="text-2xl font-bold"
            style={{ color: '#FFF8E7' }}
          >
            {an}
          </div>
          {rate > 0 && (
            <div className="text-sm" style={{ color: '#D4A12A' }}>
              {`₹${rate}/min`}
            </div>
          )}
        </div>

        {/* Type cards */}
        <div className="mb-8 flex w-full max-w-sm gap-4">
          <TypeCard
            label="Voice Call"
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0
                  1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2
                  2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2
                  0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                  2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
              </svg>
            }
            selected={selectedType === 'call'}
            onSelect={() => setSelectedType('call')}
          />
          <TypeCard
            label="Video Call"
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7zM1 5h14a2 2 0 0 1 2 2v10a2
                  2 0 0 1-2 2H1z" />
              </svg>
            }
            selected={selectedType === 'video'}
            onSelect={() => setSelectedType('video')}
          />
        </div>

        {/* Start button */}
        <button
          onClick={() => {
            // Update the URL type param to match the user's choice.
            const newQuery = { ...router.query, type: selectedType === 'video' ? 'video' : 'call' };
            router.replace({ pathname: router.pathname, query: newQuery },
              undefined, { shallow: true });
            setTypeChosen(true);
          }}
          className="w-full max-w-sm rounded-2xl py-4 text-base font-bold
            tracking-wide shadow-lg transition-opacity active:opacity-80"
          style={{ background: '#D4A12A', color: '#1A0A0A' }}
        >
          Start Consultation
        </button>

        <button
          onClick={() => router.push('/astrologers')}
          className="mt-4 text-sm opacity-60"
          style={{ color: '#FFF8E7' }}
        >
          Back
        </button>
      </div>
    );
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
        justify-between text-white"
        style={{
          background: 'linear-gradient(180deg, #1A0A0A 0%, #000000 100%)',
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
              className="relative h-28 w-28 rounded-full object-cover"
              style={{ border: '4px solid rgba(212,161,42,0.4)' }} />
          </div>
          <div className="text-3xl font-bold" style={{ color: '#FFF8E7' }}>
            {an}
          </div>
          <div className="text-sm opacity-80">Ringing...</div>
          <div className="mt-1 text-xs opacity-60">
            Waiting {Math.floor(Math.max(0, countdown) / 60)}:
            {String(Math.max(0, countdown) % 60).padStart(2, '0')}
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button onClick={cancelRequest} aria-label="Cancel"
            className="flex h-16 w-16 items-center justify-center
              rounded-full shadow-lg"
            style={{ background: '#7F2020' }}>
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
    <div
      className="relative h-screen w-screen text-white"
      style={{ background: 'linear-gradient(180deg, #1A0A0A 0%, #000000 100%)' }}
    >
      {/* Remote video / voice background */}
      <div ref={remoteRef}
        className="absolute inset-0 flex items-center justify-center">
        {callType !== 'video' && (
          /* Voice call: large astrologer photo with pulsing amber ring */
          <div className="relative flex items-center justify-center">
            <span
              className="absolute rounded-full animate-ping"
              style={{
                width: '184px',
                height: '184px',
                background: 'rgba(212,161,42,0.25)',
              }}
            />
            <span
              className="absolute rounded-full"
              style={{
                width: '168px',
                height: '168px',
                boxShadow: '0 0 0 4px rgba(212,161,42,0.55)',
                borderRadius: '50%',
              }}
            />
            <img
              src={astro.profileImage || '/avatar.png'}
              className="relative h-40 w-40 rounded-full object-cover"
              style={{ border: '3px solid #D4A12A' }}
              alt=""
            />
          </div>
        )}
      </div>

      {/* Local video pip (video calls only) */}
      {callType === 'video' && (
        <div ref={localRef}
          className="absolute right-3 top-16 h-40 w-28 overflow-hidden
                     rounded-card bg-black/60" />
      )}

      {/* Top HUD: name + timer + balance */}
      <div className="absolute left-0 right-0 top-0 flex justify-center
                      bg-black/40 px-4 py-3 text-sm font-mono">
        <span style={{ color: '#FFF8E7' }}>{astro.name}</span>
        <span style={{ color: '#D4A12A' }}>{` · ${mmss}`}</span>
        {ratePerSec > 0 ? (
          <span
            className="ml-1 font-bold"
            style={{ color: totalSecsLeft <= 60 ? '#D4A12A' : 'rgba(255,248,231,0.75)' }}
          >
            {` · ${String(Math.floor(totalSecsLeft / 60)).padStart(2, '0')}:${String(totalSecsLeft % 60).padStart(2, '0')} left`}
          </span>
        ) : (
          <span className="ml-1 opacity-70" style={{ color: '#FFF8E7' }}>
            {` · ₹${wallet.toFixed(0)}`}
          </span>
        )}
      </div>

      {/* Low balance warning */}
      {lowBalance && (
        <div
          className="absolute left-0 right-0 top-12 py-1 text-center
            text-xs font-semibold"
          style={{ background: 'rgba(212,161,42,0.9)', color: '#1A0A0A' }}
        >
          Call will end soon, recharge now
        </div>
      )}

      {/* Bottom controls */}
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

        {/* End call button */}
        <button
          onClick={hangUp}
          aria-label="End call"
          className={`flex h-16 w-16 items-center justify-center
            rounded-full shadow-lg ${lowBalance
            ? 'ring-4 animate-pulse' : ''}`}
          style={{
            background: '#7F2020',
            ...(lowBalance ? { '--tw-ring-color': '#D4A12A' } : {}),
          }}
        >
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

      {/* Session ended banner */}
      {sessionEnded && !showRate && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50
          flex justify-center px-4 pt-[env(safe-area-inset-top)]">
          <div className="pointer-events-auto mt-14 w-full max-w-md
            rounded-2xl border border-[#7F2020]/40 bg-[#FFF8E7] px-4
            py-3 text-sm shadow-2xl">
            <div className="font-bold text-[#7F2020]">
              Consultation ended
            </div>
            <div className="mt-0.5 text-dark-text">
              {session?.duration
                ? `Duration: ${Math.ceil(
                    Number(session.duration) / 60)} min. ` : ''}
              {session?.cost && Number(session.cost) > 0
                ? `Cost: ₹${Number(session.cost)}.` : ''}
            </div>
          </div>
        </div>
      )}

      {showRate && (
        <RateModal uid={user.uid} astroId={astroId} sessionId={session?.id}
          reason={totalSecsLeft <= 0 && ratePerSec > 0 ? 'balance'
            : session?.endedByAstro ? 'astrologer' : 'self'}
          onDone={() => router.replace('/dashboard')} />
      )}
    </div>
  );
}

// Selectable card for the type picker overlay.
function TypeCard({ label, icon, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      className="flex flex-1 flex-col items-center gap-3 rounded-2xl
        py-6 px-4 transition-all"
      style={{
        background: selected ? 'rgba(212,161,42,0.15)' : 'rgba(255,255,255,0.06)',
        border: selected ? '2px solid #D4A12A' : '2px solid rgba(255,255,255,0.12)',
        color: selected ? '#D4A12A' : '#FFF8E7',
      }}
      aria-pressed={selected}
    >
      <span style={{ color: selected ? '#D4A12A' : 'rgba(255,248,231,0.7)' }}>
        {icon}
      </span>
      <span className="text-sm font-semibold">{label}</span>
      {selected && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full
            text-[11px] font-bold"
          style={{ background: '#D4A12A', color: '#1A0A0A' }}
        >
          {'✓'}
        </span>
      )}
    </button>
  );
}

function Overlay({ children }) {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center
                  text-center"
      style={{ background: 'linear-gradient(180deg, #1A0A0A 0%, #000000 100%)' }}
    >
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
