import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

function Tick() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24"
      style={{ display: 'inline-block', verticalAlign: 'middle',
        marginLeft: 3 }}>
      <path fill="#1D9BF0" d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78
        1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12
        22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3
        2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
      <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6
        6.4-6.4-1.3-1.3z" />
    </svg>
  );
}

// Astrologer goes LIVE (Instagram/YouTube style). Publishes video+audio
// to the Agora channel live_<uid>; clients watch + comment + like.
export default function AstroLive() {
  const { user, loading } = useRequireAstrologer();
  const router = useRouter();
  const [astro, setAstro] = useState(null);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const localRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight; // auto-scroll to newest
  }, [comments]);

  useEffect(() => {
    if (!user) return undefined;
    astrologerService.getAstrologer(user.uid).then(setAstro);
    const u1 = liveService.listenLive(user.uid, setInfo);
    const u2 = liveService.listenLiveComments(user.uid, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [user]);

  async function start() {
    if (!user || joinedRef.current) return;
    if (!window.confirm('Go live now? Your video will be visible to '
      + 'clients.')) return;
    setStarting(true);
    try {
      const ch = liveService.liveChannel(user.uid);
      const tok = await callService.fetchAgoraToken(ch, user.uid)
        .catch(() => ({}));
      await callService.joinAgoraChannel(
        ch, user.uid, tok.appId || callService.AGORA_APP_ID,
        tok.token || null);
      const tracks = await callService.publishLocalTracks({ video: true });
      if (tracks.video && localRef.current) {
        tracks.video.play(localRef.current);
      }
      joinedRef.current = true;
      await liveService.goLive(user.uid, {
        name: astro?.name || 'Astrologer',
        photo: astro?.profileImage || '',
      });
      setLive(true);
    } catch (e) {
      window.alert('Could not start live. Check camera/mic permission.');
    } finally { setStarting(false); }
  }

  async function stop() {
    if (!window.confirm('End the live session?')) return;
    try { await callService.leaveAgoraChannel(); } catch (_) {}
    try { await liveService.endLive(user.uid); } catch (_) {}
    joinedRef.current = false;
    setLive(false);
    router.push('/astro-dashboard');
  }

  useEffect(() => () => {
    // Safety: leaving the page ends the broadcast.
    if (joinedRef.current && user) {
      callService.leaveAgoraChannel().catch(() => {});
      liveService.endLive(user.uid).catch(() => {});
    }
  }, [user]);

  function toggleMute() {
    const m = !muted; setMuted(m); callService.setMuted(m);
  }
  function toggleCam() {
    const c = !camOff; setCamOff(c); callService.setCameraEnabled(!c);
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Go Live</h1>
      <div className="relative overflow-hidden rounded-2xl bg-black"
        style={{ height: '78vh' }}>
        <div ref={localRef} className="absolute inset-0" />
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center
            justify-center gap-3 text-center text-white">
            <p className="px-6 text-sm opacity-80">
              Start a live session. Clients will see your video and can
              comment and like in real time.
            </p>
            <button onClick={start} disabled={starting}
              className="rounded-full bg-danger px-6 py-3 font-bold">
              {starting ? 'Starting...' : 'Go Live'}
            </button>
          </div>
        )}
        {live && (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className="rounded-full bg-danger px-2 py-0.5
                text-xs font-bold text-white">LIVE</span>
              <span className="rounded-full bg-black/50 px-2 py-0.5
                text-xs text-white">
                {(info?.viewers || 0)} watching
              </span>
              <span className="rounded-full bg-black/50 px-2 py-0.5
                text-xs text-white">{(info?.likes || 0)} likes</span>
            </div>
            {/* Comments overlay: bottom HALF of the video, auto-scroll.
                Astrologer sees the name AND a short client ID. */}
            <div ref={cRef}
              className="absolute inset-x-0 bottom-16 max-h-[48%]
                overflow-y-auto px-3 pb-2"
              style={{
                maskImage:
                  'linear-gradient(to top, #000 78%, transparent)',
                WebkitMaskImage:
                  'linear-gradient(to top, #000 78%, transparent)',
              }}>
              {comments.map((c) => (
                <div key={c.id} className="mb-1 text-sm text-white">
                  <span className="font-semibold">
                    {c.name}
                    {c.team && <Tick />}
                    {!c.team && c.uid && (
                      <span className="opacity-60">
                        {' '}({String(c.uid).slice(0, 6)})
                      </span>
                    )}:
                  </span>{' '}
                  <span className="opacity-90">{c.text}</span>
                </div>
              ))}
            </div>
            <div className="absolute bottom-3 left-0 right-0 flex
              justify-center gap-4">
              <button onClick={toggleMute}
                className="h-12 w-12 rounded-full bg-white/20 text-white">
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={stop}
                className="h-12 rounded-full bg-danger px-5 font-bold
                  text-white">End</button>
              <button onClick={toggleCam}
                className="h-12 w-12 rounded-full bg-white/20 text-white">
                {camOff ? 'Cam' : 'Hide'}
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
