import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { callService, liveService, walletService } from '@astro/shared';
import { useOptionalClient } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';

// Customer live viewer - 2026-06-07 spec rewrite. Full-bleed reels
// style with a half-screen comment overlay that auto-scrolls to
// newest but lets the user scroll back to read older messages. The
// previous version had a wide chrome bar on top + comments capped
// at 45% of the screen with a fade mask hiding the input area.
//
// New buttons stack along the right rail like Instagram Reels:
//   - Avatar -> opens the astrologer's profile.
//   - Follow / Followed toggle (broadcasts a "started following you"
//     comment to the live feed).
//   - Heart (like) with rolling counter.
//   - Comment focus (jumps to the input).
//   - Request to join (paid - opens the join-handshake flow).
//   - Share.
//   - Back / End.
//
// Reels-style swipe-up: if there's another live astrologer in the
// /astrologers feed we present a half-pill "Swipe up for next live"
// hint at the bottom edge; a swipe pages over.
//
// Join request handshake:
//   user tap Request to join -> liveRequests doc created (status
//     queued if astro is on call, else pending).
//   astro tap Accept on overlay -> doc -> astro_ok.
//   user tap Accept here -> doc -> connected -> joins the same Agora
//     channel with publishing rights.

function IconHeart({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M12 21s-7.5-4.5-9.5-9C1 8.5 3.5 5 7 5c2 0 3.5 1 5 3 1.5-2
        3-3 5-3 3.5 0 6 3.5 4.5 7-2 4.5-9.5 9-9.5 9z"
        fill={filled ? '#FF3B5C' : 'none'}
        stroke={filled ? '#FF3B5C' : 'white'} strokeWidth="2" />
    </svg>
  );
}
function IconComment() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1
        0 2-.9 2-2V6c0-1.1-.9-2-2-2z"
        fill="none" stroke="white" strokeWidth="2" />
    </svg>
  );
}
function IconShare() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        fill="none" stroke="white" strokeWidth="2"
        strokeLinejoin="round" />
    </svg>
  );
}
function IconJoin() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"
        fill="none" stroke="white" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconBack() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="white"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCheckPill() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" fill="none" stroke="white"
        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Avatar({ name, photo, size = 36 }) {
  if (photo) {
    return (
      <img src={photo} alt={name || ''}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover" />
    );
  }
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  const cols = ['#7F2020', '#D4A12A', '#5A6E32', '#B45309', '#2A1408',
    '#1A1A2E'];
  const bg = cols[(name || 'x').charCodeAt(0) % cols.length];
  return (
    <span style={{ width: size, height: size, background: bg,
      fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full
        font-bold text-white">{ch}</span>
  );
}

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
  const [following, setFollowing] = useState(false);
  const [myRequest, setMyRequest] = useState(null);
  const [otherLives, setOtherLives] = useState([]);
  const remoteRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);
  const inputRef = useRef(null);
  const announced = useRef(false);

  // Auto-scroll to newest UNLESS the viewer is scrolled up reading
  // older messages. We track that with a stick-to-bottom flag.
  const stickRef = useRef(true);
  useEffect(() => {
    const el = cRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [comments, fakes]);
  function onCommentsScroll(e) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stickRef.current = atBottom;
  }

  useEffect(() => {
    if (announced.current || !astroUid) return;
    if (user && !profile) return;
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
  useEffect(() => liveService.listenLiveAstrologers((arr) => {
    setOtherLives((arr || []).filter((a) => a.astroUid !== astroUid));
  }), [astroUid]);

  useEffect(() => {
    if (!astroUid || !user?.uid) return undefined;
    return liveService.listenIsFollowing(astroUid, user.uid, setFollowing);
  }, [astroUid, user?.uid]);
  useEffect(() => {
    if (!astroUid || !user?.uid) return undefined;
    return liveService.listenMyJoinRequest(astroUid, user.uid, setMyRequest);
  }, [astroUid, user?.uid]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  // Filler comments when chatter is sparse (admin-controlled).
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

  // Swipe-up to next live (touch + wheel). Index into otherLives.
  const touchY = useRef(null);
  function onTouchStart(e) { touchY.current = e.touches[0].clientY; }
  function onTouchEnd(e) {
    const start = touchY.current;
    if (start == null) return;
    const end = e.changedTouches[0].clientY;
    touchY.current = null;
    if (start - end > 80 && otherLives[0]) {
      router.replace(`/live-view/${otherLives[0].astroUid}`);
    }
  }

  const ended = info && info.live === false;
  const feed = [
    ...comments.map((c) => ({
      ...c, _t: c.createdAt?.toMillis ? c.createdAt.toMillis() : 0,
    })),
    ...fakes.map((f) => ({ ...f, _t: f._ts })),
  ].sort((a, b) => a._t - b._t);
  const vcount = liveService.liveSimViewers(info, features);
  const livePrice = Number(info?.livePrice
    || info?.priceCall || 30);

  async function sendComment() {
    const v = text.trim();
    if (!v || !astroUid) return;
    setText('');
    stickRef.current = true;
    await liveService.addLiveComment(astroUid,
      { uid: user?.uid, name: profile?.name || 'Guest' }, v);
  }
  async function onFollow() {
    if (!user?.uid) { router.push('/login'); return; }
    await liveService.toggleFollow(astroUid,
      { uid: user.uid, name: profile?.name || 'Guest' });
  }
  async function onRequestJoin() {
    if (!user?.uid) { router.push('/login'); return; }
    // Confirm + pricing pre-check.
    const wallet = await walletService.getWallet(user.uid)
      .catch(() => 0);
    if (Number(wallet || 0) < livePrice) {
      // Bounce to wallet recharge prefilled to the live price.
      router.push(`/wallet?recharge=${livePrice}`);
      return;
    }
    if (!window.confirm(`Request to join ${info?.name || 'this astrologer'}'`
      + `s live? ₹${livePrice}/min applies once you both connect.`)) {
      return;
    }
    await liveService.requestJoinLive({
      astroUid, user: { uid: user.uid, name: profile?.name || 'Guest' },
      astroBusy: !!info?.busy,
    });
  }
  async function onCancelJoin() {
    if (myRequest?.id) await liveService.endJoinRequest(myRequest.id, 'user');
  }
  async function onUserAccept() {
    if (myRequest?.id) await liveService.userAcceptJoin(myRequest.id);
  }

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-black
      text-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div ref={remoteRef} className="absolute inset-0" />
      {/* gradient under text so it stays readable on bright streams */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32
        bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0
        h-[55vh] bg-gradient-to-t from-black/80 to-transparent" />

      {/* Top bar: back + astro card + LIVE pill + viewers */}
      <div className="absolute left-3 right-3 top-3 flex items-center
        gap-2">
        <button onClick={() => router.back()}
          className="grid h-9 w-9 place-items-center rounded-full
            bg-black/40 backdrop-blur" aria-label="Back">
          <IconBack />
        </button>
        <Link href={`/astrologers/${astroUid}`}
          className="flex items-center gap-2 rounded-full bg-black/40
            px-2 py-1 backdrop-blur">
          <Avatar name={info?.name} photo={info?.photo} size={28} />
          <div className="leading-tight">
            <div className="text-[12px] font-bold">
              {info?.name || 'Astrologer'}
            </div>
            <div className="text-[10px] opacity-80">
              ₹{livePrice}/min
            </div>
          </div>
        </Link>
        <button onClick={onFollow}
          className={`rounded-full px-3 py-1 text-[11px] font-bold
            ${following
              ? 'bg-white/15 text-white'
              : 'bg-rose-600 text-white'}`}>
          {following ? (
            <span className="inline-flex items-center gap-1">
              <IconCheckPill />Following
            </span>
          ) : 'Follow'}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px]
            font-bold">LIVE</span>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px]">
            {vcount}
          </span>
        </div>
      </div>

      {ended && (
        <div className="absolute inset-0 z-50 flex flex-col items-center
          justify-center gap-3 bg-black/85">
          <div className="text-lg font-bold">This live has ended</div>
          <button onClick={() => router.push('/live')}
            className="rounded-full bg-white px-5 py-2 font-semibold
              text-black">Back to Live</button>
        </div>
      )}

      {/* Right rail action stack (Instagram-style) */}
      <div className="absolute bottom-32 right-2 flex flex-col items-center
        gap-3">
        <button onClick={() => liveService.likeLive(astroUid)}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Like">
          <span className="grid h-11 w-11 place-items-center rounded-full
            bg-black/40 backdrop-blur">
            <IconHeart />
          </span>
          <span className="mt-0.5">{info?.likes || 0}</span>
        </button>
        <button onClick={() => inputRef.current?.focus()}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Comment">
          <span className="grid h-11 w-11 place-items-center rounded-full
            bg-black/40 backdrop-blur">
            <IconComment />
          </span>
          <span className="mt-0.5">Chat</span>
        </button>
        <button onClick={onRequestJoin}
          disabled={!!myRequest}
          className="flex flex-col items-center text-[10px] font-semibold
            disabled:opacity-60" aria-label="Request to join">
          <span className="grid h-11 w-11 place-items-center rounded-full
            bg-rose-600 shadow-lg">
            <IconJoin />
          </span>
          <span className="mt-0.5">Join</span>
        </button>
        <button onClick={() => {
          try { navigator.share?.({
            title: `${info?.name || 'Astrologer'} is live now`,
            url: typeof window !== 'undefined' ? window.location.href : '',
          }); } catch (_) {}
        }}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Share">
          <span className="grid h-11 w-11 place-items-center rounded-full
            bg-black/40 backdrop-blur">
            <IconShare />
          </span>
          <span className="mt-0.5">Share</span>
        </button>
      </div>

      {/* Join-request handshake banner */}
      {myRequest && myRequest.status !== 'connected' && (
        <div className="absolute left-3 right-3 top-16 z-20 rounded-2xl
          bg-black/70 px-3 py-2 backdrop-blur">
          {myRequest.status === 'pending' && (
            <div className="text-[12px]">
              <b>Request sent.</b> Waiting for {info?.name || 'astrologer'}
              {' '}to accept...
              <button onClick={onCancelJoin}
                className="ml-2 underline">Cancel</button>
            </div>
          )}
          {myRequest.status === 'queued' && (
            <div className="text-[12px]">
              <b>You are on the waitlist.</b> {info?.name || 'astrologer'}
              {' '}is on a call - you'll be next.
              <button onClick={onCancelJoin}
                className="ml-2 underline">Leave queue</button>
            </div>
          )}
          {myRequest.status === 'astro_ok' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px]">
                <b>{info?.name || 'Astrologer'} accepted.</b> Connect now?
              </span>
              <div className="flex gap-1">
                <button onClick={onCancelJoin}
                  className="rounded-full bg-white/15 px-3 py-1 text-[11px]
                    font-bold">Decline</button>
                <button onClick={onUserAccept}
                  className="rounded-full bg-emerald-500 px-3 py-1
                    text-[11px] font-bold">Accept</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HALF-screen comment overlay - the key UX change */}
      <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
        <div ref={cRef} onScroll={onCommentsScroll}
          className="mb-2 max-h-[48vh] min-h-[28vh] space-y-1.5
            overflow-y-auto pr-12 pt-3"
          style={{
            maskImage: 'linear-gradient(to top, #000 85%, transparent)',
            WebkitMaskImage:
              'linear-gradient(to top, #000 85%, transparent)',
            scrollbarWidth: 'none',
          }}>
          {feed.map((c) => (
            <CommentRow key={c.id} c={c} dp={dp} />
          ))}
        </div>
        {!stickRef.current && (
          <button onClick={() => {
            stickRef.current = true;
            const el = cRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
            className="mx-auto mb-2 block rounded-full bg-white/15
              px-3 py-1 text-[11px] font-bold backdrop-blur">
            ↓ Newest
          </button>
        )}
        <div className="flex items-center gap-2">
          <input ref={inputRef}
            className="h-11 flex-1 rounded-full bg-white/15 px-4
              text-[15px] text-white placeholder-white/60 outline-none
              backdrop-blur"
            placeholder="Add comment..." value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendComment()} />
          <button onClick={sendComment}
            className="h-11 rounded-full bg-primary px-4 font-bold">
            Send
          </button>
        </div>
        {otherLives[0] && (
          <div className="mt-2 text-center text-[11px] opacity-70">
            Swipe up for {otherLives[0].name || 'next live'}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentRow({ c, dp }) {
  const isSystem = c.type === 'join' || c.type === 'follow'
    || c.type === 'join_request';
  return (
    <div className="flex items-start gap-2">
      {c.team && dp ? (
        <img src={dp} alt="Compliance Team"
          className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <Avatar name={c.name} photo={c.photo} size={28} />
      )}
      <div className="min-w-0">
        <div className="text-[12px] leading-tight opacity-90">
          <span className="font-bold">{c.name || 'Guest'}</span>
          {c.team && (
            <svg width="11" height="11" viewBox="0 0 24 24"
              style={{ display: 'inline-block',
                verticalAlign: 'middle', marginLeft: 3 }}>
              <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36 1.2
                2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78
                1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78
                -1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3
                .36L12 1.5z" />
              <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6
                6.4-6.4-1.3-1.3z" />
            </svg>
          )}
        </div>
        {c.type === 'join' ? (
          <div className="text-[13px] font-semibold"
            style={{ color: 'rgb(var(--c-accent))' }}>
            joined
          </div>
        ) : c.type === 'follow' ? (
          <div className="text-[13px] font-semibold"
            style={{ color: 'rgb(var(--c-accent))' }}>
            started following you
          </div>
        ) : c.type === 'join_request' ? (
          <div className="text-[13px] font-semibold text-rose-300">
            {c.text || 'wants to join'}
          </div>
        ) : (
          <div className={`leading-snug ${isSystem
            ? 'text-[13px] font-semibold'
            : 'text-[14px]'}`}>
            {c.text}
          </div>
        )}
      </div>
    </div>
  );
}
