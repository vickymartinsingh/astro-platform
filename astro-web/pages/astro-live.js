import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

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
        style={{ aspectRatio: '9 / 14', maxHeight: '70vh' }}>
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

      {live && (
        <div className="mt-4">
          <div className="mb-2 font-semibold">Live comments</div>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {comments.length === 0 ? (
              <div className="text-sm text-sub-text">No comments yet.</div>
            ) : comments.map((c) => (
              <div key={c.id} className="text-sm">
                <span className="font-semibold">{c.name}: </span>
                <span className="text-sub-text">{c.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
