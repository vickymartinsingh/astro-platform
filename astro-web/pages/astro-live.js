import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, astrologerService,
} from '@astro/shared';
import { useRequireAstrologer } from '../lib/useAuth';

function Tick({ green }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24"
      style={{ display: 'inline-block', verticalAlign: 'middle',
        marginLeft: 3 }}>
      <path fill={green ? '#1FA855' : '#1D9BF0'} d="M12 1.5l2.2 2.06
        3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2
        2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1
        12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
      <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6
        6.4-6.4-1.3-1.3z" />
    </svg>
  );
}

function Avatar({ name }) {
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  const colors = ['#F59E0B', '#EC4899', '#8B5CF6', '#10B981',
    '#3B82F6', '#EF4444'];
  const c = colors[(name || 'x').charCodeAt(0) % colors.length];
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center
      rounded-full text-sm font-bold text-white"
      style={{ background: c }}>{ch}</span>
  );
}

// Astrotalk-style full-screen Go Live for the astrologer.
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
  const [elapsed, setElapsed] = useState(0);
  const localRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    astrologerService.getAstrologer(user.uid).then(setAstro);
    const u1 = liveService.listenLive(user.uid, setInfo);
    const u2 = liveService.listenLiveComments(user.uid, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [user]);

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

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

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:`
    + `${String(elapsed % 60).padStart(2, '0')}`;
  const rate = astro
    ? (astro.priceVideo || astro.priceCall || astro.priceChat || 0) : 0;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center
        bg-black text-white">Loading...</div>
    );
  }

  const RailBtn = ({ children, onClick }) => (
    <button onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full
        bg-white/15 text-white backdrop-blur">{children}</button>
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black
                    text-white">
      <div ref={localRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="absolute right-3 top-3 z-10 flex items-center
        gap-2">
        {live && (
          <span className="flex items-center gap-1 rounded-full
            bg-black/40 px-3 py-1 text-sm backdrop-blur">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7
              10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12"
              cy="12" r="3" /></svg>
            {info?.viewers || 0}
          </span>
        )}
        <button onClick={() => (live ? stop() : router.back())}
          className="flex h-9 w-9 items-center justify-center
            rounded-full bg-black/40 text-lg backdrop-blur">x</button>
      </div>

      {!live && (
        <div className="absolute inset-0 z-10 flex flex-col items-center
          justify-center gap-3 px-8 text-center">
          <p className="text-sm opacity-80">
            Start a live session. Clients can watch, comment and like in
            real time, and you keep seeing yourself full-screen.
          </p>
          <button onClick={start} disabled={starting}
            className="rounded-full bg-danger px-8 py-3 text-lg
              font-bold">
            {starting ? 'Starting...' : 'Go Live'}
          </button>
        </div>
      )}

      {/* Comments overlay - lower-left, scrolls up, on the video */}
      {live && (
        <div ref={cRef}
          className="absolute bottom-20 left-0 z-10 max-h-[46%] w-[74%]
            space-y-2 overflow-y-auto px-3"
          style={{
            maskImage: 'linear-gradient(to top, #000 75%, transparent)',
            WebkitMaskImage:
              'linear-gradient(to top, #000 75%, transparent)',
          }}>
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.name} />
              <div className="min-w-0">
                <div className="text-[13px] leading-tight">
                  <span className="font-semibold opacity-90">
                    {c.name}
                  </span>
                  {c.team && <Tick green />}
                  {(c.code || c.uid) && (
                    <span className="text-[#F59E0B]">
                      {' '}({c.code || String(c.uid).slice(0, 7)})
                    </span>
                  )}
                </div>
                {c.type === 'join' ? (
                  <div className="text-[15px] font-semibold"
                    style={{ color: 'rgb(var(--c-accent))' }}>
                    Joined
                  </div>
                ) : c.type === 'follow' ? (
                  <div className="text-[15px] font-semibold"
                    style={{ color: 'rgb(var(--c-accent))' }}>
                    started following you
                  </div>
                ) : (
                  <div className="text-[15px] leading-snug">{c.text}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Right action rail */}
      {live && (
        <div className="absolute bottom-24 right-3 z-10 flex flex-col
          gap-3">
          <RailBtn>🙏</RailBtn>
          <RailBtn>
            <span className="text-[10px] font-bold">{mmss}</span>
          </RailBtn>
          <RailBtn onClick={toggleCam}>{camOff ? '📷' : '🚫'}</RailBtn>
          <RailBtn onClick={toggleMute}>{muted ? '🔇' : '🎙️'}</RailBtn>
          <button onClick={stop}
            className="flex h-12 w-12 items-center justify-center
              rounded-full bg-danger text-xl">📞</button>
        </div>
      )}

      {/* Bottom toolbar */}
      {live && (
        <div className="absolute inset-x-0 bottom-3 z-10 flex
          items-center justify-between px-5 text-sm">
          <button onClick={toggleCam} aria-label="camera">📹</button>
          <button onClick={toggleMute} aria-label="mic">
            {muted ? '🔇' : '🎤'}
          </button>
          <span className="font-semibold">Live {mmss}</span>
          <span className="font-bold">
            ₹{rate}<span className="text-xs">/m</span>
          </span>
        </div>
      )}
    </div>
  );
}
