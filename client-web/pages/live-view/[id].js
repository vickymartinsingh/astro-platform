import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { callService, liveService } from '@astro/shared';
import { useOptionalClient } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';

// Client watches an astrologer's live stream + comments + likes.
export default function LiveView() {
  const router = useRouter();
  const { id: astroUid } = router.query;
  const { user, profile } = useOptionalClient();
  const { features } = useSettings();
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [fakes, setFakes] = useState([]);
  const [dp, setDp] = useState('');
  const [, setTick] = useState(0);
  const [text, setText] = useState('');
  const remoteRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight; // auto-scroll to newest
  }, [comments]);

  // Announce "<name> joined" exactly once, with the real profile name
  // (waits for the profile so it is never a stale "Guest").
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || !astroUid) return;
    if (user && !profile) return; // signed in but profile still loading
    announced.current = true;
    liveService.announceJoin(astroUid, {
      uid: user?.uid || null,
      name: profile?.name || 'Guest',
    });
  }, [astroUid, user, profile]);

  useEffect(() => {
    if (!astroUid) return undefined;
    const u1 = liveService.listenLive(astroUid, setInfo);
    const u2 = liveService.listenLiveComments(astroUid, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [astroUid]);

  useEffect(() => liveService.watchComplianceDp(setDp), []);

  // Refresh the simulated viewer count over time.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  // Filler comments when real chatter is sparse (admin-controlled).
  useEffect(() => {
    if (!features || !features.live_fake_enabled) return undefined;
    if (info && info.live === false) return undefined;
    const ms = Math.max(3,
      Number(features.live_fake_every_sec) || 12) * 1000;
    const t = setInterval(() => {
      setFakes((arr) => {
        if (comments.length >= 12) return arr;
        return [...arr, liveService.nextFillerComment(features)]
          .slice(-25);
      });
    }, ms);
    return () => clearInterval(t);
  }, [features, info, comments.length]);

  useEffect(() => {
    if (!astroUid || joinedRef.current) return undefined;
    joinedRef.current = true;
    (async () => {
      try {
        const ch = liveService.liveChannel(astroUid);
        const watcherId = `v${Math.floor(Math.random() * 1e6)}`;
        const tok = await callService.fetchAgoraToken(ch, watcherId)
          .catch(() => ({}));
        await callService.joinAgoraChannel(
          ch, watcherId, tok.appId || callService.AGORA_APP_ID,
          tok.token || null);
        callService.subscribeToRemote((rUser, mediaType) => {
          if (mediaType === 'video' && remoteRef.current) {
            rUser.videoTrack?.play(remoteRef.current);
          }
          if (mediaType === 'audio') rUser.audioTrack?.play();
        });
        liveService.bumpViewers(astroUid, 1);
      } catch (_) { /* stream may not be up yet */ }
    })();
    return () => {
      callService.leaveAgoraChannel().catch(() => {});
      liveService.bumpViewers(astroUid, -1).catch(() => {});
    };
  }, [astroUid]);

  const ended = info && info.live === false;
  const feed = [
    ...comments.map((c) => ({
      ...c, _t: c.createdAt?.toMillis ? c.createdAt.toMillis() : 0,
    })),
    ...fakes.map((f) => ({ ...f, _t: f._ts })),
  ].sort((a, b) => a._t - b._t);
  const vcount = liveService.liveSimViewers(info, features);

  async function sendComment() {
    const v = text.trim();
    if (!v || !astroUid) return;
    setText('');
    await liveService.addLiveComment(astroUid,
      { uid: user?.uid, name: profile?.name || 'Guest' }, v);
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black
                    text-white">
      <div ref={remoteRef} className="absolute inset-0" />

      <div className="absolute left-3 top-3 flex items-center gap-2">
        <button onClick={() => router.back()}
          className="rounded-full bg-black/50 px-3 py-1 text-sm">Back</button>
        <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs
          font-bold">LIVE</span>
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs">
          {info?.name || 'Astrologer'}
        </span>
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs">
          {vcount} watching
        </span>
        <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs">
          {info?.likes || 0} likes
        </span>
      </div>

      {ended && (
        <div className="absolute inset-0 flex flex-col items-center
          justify-center gap-3 bg-black/80">
          <div className="text-lg font-bold">This live has ended</div>
          <button onClick={() => router.push('/live')}
            className="rounded-full bg-white px-5 py-2 font-semibold
              text-black">Back to Live</button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-3">
        <div ref={cRef}
          className="mb-2 max-h-[45vh] space-y-1 overflow-y-auto"
          style={{
            maskImage: 'linear-gradient(to top, #000 80%, transparent)',
            WebkitMaskImage:
              'linear-gradient(to top, #000 80%, transparent)',
          }}>
          {feed.map((c) => {
            const ch = (c.name || '?').trim().charAt(0).toUpperCase();
            const cols = ['#F59E0B', '#EC4899', '#8B5CF6', '#10B981',
              '#3B82F6', '#EF4444'];
            const bg = cols[(c.name || 'x').charCodeAt(0) % cols.length];
            return (
              <div key={c.id} className="flex items-start gap-2">
                {c.team && dp ? (
                  <img src={dp} alt="Compliance Team"
                    className="h-8 w-8 shrink-0 rounded-full
                      object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center
                    justify-center rounded-full text-sm font-bold"
                    style={{ background: bg }}>{ch}</span>
                )}
                <div className="min-w-0">
                  <div className="text-[13px] leading-tight opacity-90">
                    <span className="font-semibold">{c.name}</span>
                    {c.team && (
                      <svg width="13" height="13" viewBox="0 0 24 24"
                        style={{ display: 'inline-block',
                          verticalAlign: 'middle', marginLeft: 3 }}>
                        <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36
                          1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36
                          3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3
                          .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3
                          2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
                        <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3
                          3.6 3.6 6.4-6.4-1.3-1.3z" />
                      </svg>
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
                    <div className="text-[15px] leading-snug">
                      {c.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="h-11 flex-1 rounded-full bg-white/15 px-4
              text-[15px] text-white placeholder-white/60 outline-none"
            placeholder="Say something..." value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendComment()} />
          <button onClick={sendComment}
            className="h-11 rounded-full bg-primary px-4 font-semibold">
            Send
          </button>
          <button onClick={() => liveService.likeLive(astroUid)}
            aria-label="Like"
            className="flex h-11 w-11 items-center justify-center
              rounded-full bg-white/15 text-xl">&#10084;</button>
        </div>
      </div>
    </div>
  );
}
