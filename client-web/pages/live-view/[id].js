import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { callService, liveService } from '@astro/shared';
import { useOptionalClient } from '../../lib/useAuth';

// Client watches an astrologer's live stream + comments + likes.
export default function LiveView() {
  const router = useRouter();
  const { id: astroUid } = router.query;
  const { user, profile } = useOptionalClient();
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const remoteRef = useRef(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!astroUid) return undefined;
    const u1 = liveService.listenLive(astroUid, setInfo);
    const u2 = liveService.listenLiveComments(astroUid, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [astroUid]);

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
      } catch (_) { /* stream may not be up yet */ }
    })();
    return () => { callService.leaveAgoraChannel().catch(() => {}); };
  }, [astroUid]);

  const ended = info && info.live === false;

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
      <div className="absolute right-3 top-3 rounded-full bg-black/50
        px-2 py-0.5 text-xs">{info?.likes || 0} likes</div>

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
        <div className="mb-2 max-h-44 space-y-1 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-semibold">{c.name}: </span>
              <span className="opacity-90">{c.text}</span>
            </div>
          ))}
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
