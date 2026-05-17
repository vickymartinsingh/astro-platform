import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { callService, sessionService } from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { usePendingSession } from '../../lib/pendingSession';

export default function CallScreen() {
  const router = useRouter();
  const { id: astroId } = router.query;
  const callType = router.query.type === 'video' ? 'video' : 'call';
  const { user, profile, loading } = useRequireClient();
  const { astro, session, wallet, countdown, end, sessionId } =
    useSession({ astroId, type: callType, uid: user?.uid,
      clientName: profile?.name });

  const { track } = usePendingSession();
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(callType === 'video');
  const [elapsed, setElapsed] = useState(0);
  const [showRate, setShowRate] = useState(false);
  const joinedRef = useRef(false);
  const remoteRef = useRef(null);
  const localRef = useRef(null);

  const active = session?.status === 'active' || session?.status === 'accepted';
  const ratePerSec = session?.ratePerSecond || 0;
  const lowBalance = active && wallet > 0 && wallet < ratePerSec * 60;

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

  useEffect(() => {
    if (active && wallet <= 0) hangUp();
    // eslint-disable-next-line
  }, [wallet, active]);

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

  if (session && session.status === 'requesting') {
    return (
      <Overlay>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6
                        text-center shadow-xl">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full
                          border-4 border-bg-light border-t-primary" />
          <p className="text-lg font-semibold">
            Please wait until {astro.name} accepts your call
          </p>
          <p className="mt-1 text-sm text-sub-text">
            Hi {profile?.name || 'there'}, your details have been shared.
            Time left {Math.floor(Math.max(0, countdown) / 60)}:
            {String(Math.max(0, countdown) % 60).padStart(2, '0')}
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={cancelRequest}
              className="btn-ghost flex-1">Cancel</button>
            <button onClick={() => {
              if (session?.id) {
                track({ sessionId: session.id, astroId,
                  astroName: astro?.name, type: callType });
              }
              router.push('/dashboard');
            }} className="btn-grad flex-1 justify-center">
              Continue browsing
            </button>
          </div>
        </div>
      </Overlay>
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

      <div className="absolute bottom-10 left-0 right-0 flex
                      items-center justify-center gap-6">
        <button onClick={toggleMute}
          className="h-12 w-12 rounded-full bg-white/20">
          {muted ? '🔇' : '🎙️'}
        </button>
        <button onClick={hangUp}
          className={`flex h-16 w-16 items-center justify-center rounded-full
                      bg-danger text-2xl ${lowBalance
            ? 'ring-4 ring-warning animate-pulse' : ''}`}>
          ✕
        </button>
        {callType === 'video' && (
          <button onClick={toggleCam}
            className="h-12 w-12 rounded-full bg-white/20">
            {camOn ? '📷' : '🚫'}
          </button>
        )}
      </div>

      {showRate && (
        <RateModal uid={user.uid} astroId={astroId} sessionId={session?.id}
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
