import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, walletService, astrologerService,
  offerService, reviewService,
} from '@astro/shared';
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
function IconShare() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        fill="none" stroke="white" strokeWidth="2"
        strokeLinejoin="round" />
    </svg>
  );
}
function IconMic({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 14a3 3 0 003-3V7a3 3 0 00-6 0v4a3 3 0 003 3z
        M19 11a7 7 0 11-14 0M12 18v3M8 21h8" stroke="white"
        strokeWidth="2" strokeLinecap="round" fill="none" />
      {off && (
        <path d="M4 4l16 16" stroke="#FF3B5C" strokeWidth="2.5"
          strokeLinecap="round" />
      )}
    </svg>
  );
}
function IconVideo({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2
        2 0 01-2-2V7zm13 4l5-3v10l-5-3" stroke="white" strokeWidth="2"
        fill="none" strokeLinejoin="round" />
      {off && (
        <path d="M4 4l16 16" stroke="#FF3B5C" strokeWidth="2.5"
          strokeLinecap="round" />
      )}
    </svg>
  );
}
function IconEndCall() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07
        19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3
        a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09
        9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59
        2.81.72A2 2 0 0122 16.92z"
        fill="white" stroke="white" strokeWidth="1.5"
        strokeLinejoin="round" transform="rotate(135 12 12)" />
    </svg>
  );
}
function IconPhone() {
  // Live Call icon - replaces the abstract Join arrow per operator
  // screenshot ref. Phone glyph reads as "tap to call" / "tap to
  // request live call" instantly.
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07
        19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2
        2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09
        9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59
        2.81.72A2 2 0 0122 16.92z"
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
function IconGrid() {
  // 2x2 grid - taps open the "other live astrologers" sheet,
  // matching the reference screenshot's top-right button.
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" fill="white" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" fill="white" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" fill="white" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" fill="white" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2"
        strokeLinecap="round" />
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
  // Bottom sheets that overlay the live without leaving it:
  //   'profile' -> in-live astrologer profile card (ref screenshot 2)
  //   'grid'    -> other lives grid (ref screenshot 3)
  //   'estimate' -> pre-call charges + max-minutes estimator with
  //                 3-min minimum balance gate.
  const [sheet, setSheet] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [walletBal, setWalletBal] = useState(0);
  const [offer, setOffer] = useState(null);
  // Countdown ticker during a connected call. ms remaining derived
  // from wallet/rate; updated every second.
  const [callRemain, setCallRemain] = useState(0);
  // In-call control toggles. Operator 2026-06-07: "once connect both
  // should have the option like Mute, Unmute, Video on/off, Call
  // end." We track local toggle state here and surface it via the
  // CallControls bar; the Agora handlers fire on toggle.
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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

  // Live offer subscription - drives the strikethrough rate display
  // + the estimator math.
  useEffect(() => {
    if (!astroUid) return undefined;
    return offerService.listenAstroOffer(astroUid, setOffer);
  }, [astroUid]);

  // Live wallet balance - the estimator needs it to compute max
  // minutes and gate at the 3-minute minimum.
  useEffect(() => {
    if (!user?.uid) return undefined;
    return walletService.listenWallet(user.uid, setWalletBal);
  }, [user?.uid]);

  // Lazy-load the full astrologer profile only when the in-live
  // profile sheet opens. Saves a round trip for viewers who never
  // tap the astro chip.
  useEffect(() => {
    if (sheet !== 'profile' || !astroUid || profileData) return;
    astrologerService.getAstrologer(astroUid)
      .then(setProfileData).catch(() => setProfileData({}));
  }, [sheet, astroUid, profileData]);

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
  // Base rate the astrologer set for live consultations. The offer
  // can knock this down (see rate.final below) when active for the
  // 'live' scope.
  const baseLivePrice = Number(info?.livePrice
    || info?.priceCall || 30);
  const rate = offerService.computeRate(baseLivePrice, offer, 'live');
  const livePrice = rate.final;
  // Max minutes the customer can talk on their current wallet, and
  // the 3-minute minimum gate.
  const maxMins = livePrice > 0
    ? Math.floor(Number(walletBal || 0) / livePrice) : 0;
  const MIN_JOIN_MINS = 3;
  const canJoin = maxMins >= MIN_JOIN_MINS;

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
  function onRequestJoin() {
    if (!user?.uid) { router.push('/login'); return; }
    // Open the pre-call estimator instead of a plain confirm() so the
    // customer sees charges + max minutes BEFORE the request lands
    // on the astrologer overlay. The actual liveRequest doc is
    // created from inside the estimator's primary CTA.
    setSheet('estimate');
  }
  async function submitJoinRequest() {
    setSheet(null);
    await liveService.requestJoinLive({
      astroUid, user: { uid: user.uid, name: profile?.name || 'Guest' },
      astroBusy: !!info?.busy,
    });
  }

  // Countdown ticker: starts ONLY when the request is in 'connected'
  // status AND the server-stamped connectedAt is present. Operator
  // 2026-06-07: "without joining only the counter has been charged
  // only after connected the call counter should start". So we
  // refuse to tick on a pending/queued/astro_ok request and we wait
  // for the real connectedAt timestamp (no fallback to Date.now)
  // so the math is honest.
  useEffect(() => {
    const startMs = myRequest && myRequest.status === 'connected'
      && myRequest.connectedAt?.toMillis
      ? myRequest.connectedAt.toMillis() : 0;
    if (!startMs) { setCallRemain(0); return undefined; }
    const totalSec = Math.floor((Number(walletBal || 0) / livePrice) * 60);
    function tick() {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const rem = Math.max(0, totalSec - elapsed);
      setCallRemain(rem);
      if (rem === 0 && myRequest.id) {
        liveService.endJoinRequest(myRequest.id, 'user').catch(() => {});
      }
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [myRequest, walletBal, livePrice]);
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

      {/* Top bar: back + astro card (in-live profile) + Follow +
          grid (in-live other lives) + LIVE pill + viewer count.
          Royal palette only - maroon + amber accents, no purple. */}
      <div className="absolute left-3 right-3 top-3 z-30 flex
        items-center gap-2">
        <button onClick={() => router.back()}
          className="grid h-9 w-9 place-items-center rounded-full
            bg-black/40 backdrop-blur" aria-label="Back">
          <IconBack />
        </button>
        <button onClick={() => setSheet('profile')}
          className="flex items-center gap-2 rounded-full bg-black/40
            px-2 py-1 backdrop-blur">
          <Avatar name={info?.name} photo={info?.photo} size={28} />
          <div className="text-left leading-tight">
            <div className="text-[12px] font-bold">
              {info?.name || 'Astrologer'}
            </div>
            <div className="flex items-center gap-1 text-[10px]
              opacity-90">
              {rate.discounted && (
                <span className="line-through opacity-60">
                  ₹{rate.base}
                </span>
              )}
              <span className={rate.discounted
                ? 'font-bold text-amber-300' : ''}>
                ₹{livePrice}/min
              </span>
              {rate.discounted && (
                <span className="rounded bg-emerald-500/80 px-1
                  text-[9px] font-bold">
                  -{rate.percentOff}%
                </span>
              )}
            </div>
          </div>
        </button>
        <button onClick={onFollow}
          className={`rounded-full px-3 py-1 text-[11px] font-bold
            ${following
              ? 'bg-white/15 text-white'
              : 'text-white'}`}
          style={following ? undefined
            : { background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
          {following ? (
            <span className="inline-flex items-center gap-1">
              <IconCheckPill />Following
            </span>
          ) : 'Follow'}
        </button>
        <button onClick={() => setSheet('grid')}
          className="grid h-9 w-9 place-items-center rounded-full
            bg-black/40 backdrop-blur" aria-label="More live astrologers">
          <IconGrid />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px]
            font-bold">LIVE</span>
          <span className="rounded-full bg-black/50 px-2 py-0.5
            text-[10px]">{vcount}</span>
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

      {/* Right rail action stack. Operator 2026-06-07: drop the Chat
          button (the comment input below is the chat) and swap the
          abstract Join arrow for a phone glyph so viewers read it as
          "request live call" instantly. */}
      <div className="absolute bottom-32 right-2 z-20 flex flex-col
        items-center gap-3">
        <button onClick={() => liveService.likeLive(astroUid)}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Like">
          <span className="grid h-11 w-11 place-items-center rounded-full
            bg-black/40 backdrop-blur">
            <IconHeart />
          </span>
          <span className="mt-0.5">{info?.likes || 0}</span>
        </button>
        {/* Live call button morphs through 4 states:
              idle         -> gradient pill + ₹/min subtitle
              pending /
              queued       -> rose pill + "Cancel" subtitle so the
                              user can pull their own request without
                              looking for a separate kill switch
              astro_ok     -> banner above handles Accept/Decline -
                              keep the pill as a status hint
              connected    -> countdown timer (m:ss) */}
        {(() => {
          const s = myRequest?.status;
          const inQueue = s === 'pending' || s === 'queued';
          const isConnected = s === 'connected';
          const onTap = () => {
            if (inQueue || s === 'astro_ok') {
              if (myRequest?.id) liveService.endJoinRequest(
                myRequest.id, 'user').catch(() => {});
              return;
            }
            if (isConnected) return; // controls bar handles end
            onRequestJoin();
          };
          return (
            <button onClick={onTap}
              className="flex flex-col items-center text-[10px]
                font-semibold" aria-label="Live call control">
              <span className="grid h-12 w-12 place-items-center
                rounded-full shadow-lg"
                style={{ background: inQueue
                  ? '#DC2626'
                  : 'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
                <IconPhone />
              </span>
              {isConnected ? (
                <span className="mt-0.5 font-mono text-[11px]
                  text-emerald-300">
                  {fmtClock(callRemain)}
                </span>
              ) : inQueue ? (
                <>
                  <span className="mt-0.5">Cancel</span>
                  <span className="text-[9px] opacity-80">
                    {s === 'queued' ? 'waitlist' : 'waiting...'}
                  </span>
                </>
              ) : s === 'astro_ok' ? (
                <>
                  <span className="mt-0.5 text-emerald-300">
                    Tap Accept ↑
                  </span>
                </>
              ) : (
                <>
                  <span className="mt-0.5">Live call</span>
                  <span className="text-[9px] opacity-80">
                    {rate.discounted && (
                      <span className="line-through mr-0.5 opacity-60">
                        ₹{rate.base}
                      </span>
                    )}
                    ₹{livePrice}/min
                  </span>
                </>
              )}
            </button>
          );
        })()}
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

      {/* In-call control bar (operator 2026-06-07: "once connected
          both should have Mute/Unmute, Video on/off, Call end"). Sits
          just above the comment overlay and only shows while the
          request is in 'connected' status. The Recharge pill lets
          the user top up mid-call without disconnecting. */}
      {myRequest?.status === 'connected' && (
        <div className="absolute inset-x-0 bottom-[calc(28vh+72px)]
          z-30 flex items-center justify-center gap-3">
          <button onClick={() => {
            const next = !micOn; setMicOn(next);
            // callService.setMuted takes the MUTED state (inverse).
            try { callService.setMuted(!next); } catch (_) {}
          }}
            className="grid h-12 w-12 place-items-center rounded-full
              bg-white/15 backdrop-blur" aria-label="Mic">
            <IconMic off={!micOn} />
          </button>
          <button onClick={() => {
            const next = !camOn; setCamOn(next);
            try { callService.setCameraEnabled(next); } catch (_) {}
          }}
            className="grid h-12 w-12 place-items-center rounded-full
              bg-white/15 backdrop-blur" aria-label="Camera">
            <IconVideo off={!camOn} />
          </button>
          <button onClick={() => router.push(
            `/wallet?recharge=${Math.max(50, livePrice * 10)}`)}
            className="grid h-12 px-3 place-items-center rounded-full
              bg-emerald-600/90 text-[11px] font-bold backdrop-blur"
            aria-label="Recharge">
            + Recharge
          </button>
          <button onClick={() => {
            if (myRequest?.id) liveService.endJoinRequest(
              myRequest.id, 'user').catch(() => {});
          }}
            className="grid h-14 w-14 place-items-center rounded-full
              bg-red-600 shadow-lg" aria-label="End call">
            <IconEndCall />
          </button>
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

      {/* IN-LIVE OVERLAYS - all close on backdrop tap or close btn */}
      {sheet === 'profile' && (
        <ProfileSheet astroUid={astroUid} info={info}
          profile={profileData} following={following}
          onFollow={onFollow}
          onCall={onRequestJoin}
          onClose={() => setSheet(null)} />
      )}
      {sheet === 'grid' && (
        <GridSheet lives={otherLives}
          onPick={(uid) => router.replace(`/live-view/${uid}`)}
          onClose={() => setSheet(null)} />
      )}
      {sheet === 'estimate' && (
        <EstimateSheet info={info} rate={rate}
          walletBal={walletBal} maxMins={maxMins}
          canJoin={canJoin} minMins={MIN_JOIN_MINS}
          onClose={() => setSheet(null)}
          onConfirm={submitJoinRequest}
          onRecharge={(amt) => router.push(
            `/wallet?recharge=${amt}`)} />
      )}
    </div>
  );
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Pre-call estimator (operator 2026-06-07): shows rate (with
// strikethrough when an offer applies), wallet balance, computed
// max minutes, the 3-min minimum gate, and a Continue / Recharge
// CTA with SMART RECOMMENDATIONS.
//
// Recommendation logic (operator 2026-06-07: "minimum balance
// requirement should also ask when balance is not meeting...
// if the user is having half amount of the minimum balance then
// it should recommend to add more xyz amount along with the add
// wallet button"):
//   - Below half of minimum: top up to a comfortable 10-minute
//     buffer (more headroom).
//   - Between half-minimum and minimum: top up just enough to
//     clear the minimum + a small cushion so they're not gated
//     again seconds into the call.
//   - At-or-above minimum: no recommendation, show Continue.
function EstimateSheet({ info, rate, walletBal, maxMins, canJoin,
  minMins, onClose, onConfirm, onRecharge }) {
  const ratePerMin = rate.final;
  const need = ratePerMin * minMins;
  const wallet = Number(walletBal || 0);
  const shortfall = Math.max(0, need - wallet);
  const halfMin = need / 2;
  // Recommended top-up amount, rounded to nearest ₹10 for a clean
  // CTA label and an easier wallet-pad value.
  const ten = ratePerMin * 10;
  let recommended = 0;
  if (!canJoin) {
    recommended = wallet >= halfMin
      ? Math.ceil((shortfall + ratePerMin * 2) / 10) * 10
      : Math.ceil(ten / 10) * 10;
  }
  function reason() {
    if (canJoin) return '';
    if (wallet >= halfMin) {
      return `You're ₹${shortfall} short of the minimum. Add `
        + `₹${recommended} so you can talk past the first ${minMins} `
        + 'minutes comfortably.';
    }
    return `Wallet ₹${wallet} is less than half of the minimum (₹`
      + `${need}). Add ₹${recommended} for a ${Math.round(recommended
        / ratePerMin)}-minute buffer.`;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center
      bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-4
          text-dark-text shadow-2xl"
        style={{ maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-gray-200" />
        <h3 className="text-base font-bold">
          Connect with {info?.name || 'astrologer'}
        </h3>
        <p className="mt-0.5 text-[11px] text-sub-text">
          Live call rate. The timer starts only when both of you
          accept and the audio connects. You can disconnect any time -
          only minutes you attended are debited.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Tile k="Rate" v={(
            <span className="flex items-baseline gap-1">
              {rate.discounted && (
                <span className="text-[12px] text-sub-text line-through">
                  ₹{rate.base}
                </span>
              )}
              <span className="text-base font-bold">
                ₹{ratePerMin}
              </span>
              <span className="text-[11px] text-sub-text">/min</span>
              {rate.discounted && (
                <span className="rounded bg-emerald-100 px-1
                  text-[10px] font-bold text-emerald-700">
                  -{rate.percentOff}%
                </span>
              )}
            </span>
          )} />
          <Tile k="Wallet" v={(
            <span className="text-base font-bold text-emerald-700">
              ₹{Math.round(walletBal)}
            </span>
          )} />
          <Tile k="You can talk for"
            v={(
              <span className={`text-base font-bold ${canJoin
                ? 'text-dark-text' : 'text-rose-700'}`}>
                {canJoin ? `up to ${maxMins} mins`
                  : `${maxMins} mins (need ${minMins})`}
              </span>
            )} />
          <Tile k="Minimum balance"
            v={`₹${need} (${minMins} min)`} />
        </div>

        {!canJoin && (
          <div className="mt-3 rounded-card border border-rose-200
            bg-rose-50 p-3">
            <div className="text-[12px] text-rose-800">
              {reason()}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[recommended, recommended + ten,
                recommended + 2 * ten].map((amt, i) => (
                <button key={amt} onClick={() => onRecharge(amt)}
                  className={`rounded-full px-3 py-1.5 text-[11px]
                    font-bold ${i === 0
                      ? 'bg-primary text-white'
                      : 'border border-gray-300 text-sub-text'}`}>
                  + ₹{amt}
                  {i === 0 && (
                    <span className="ml-1 opacity-80">recommended</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 text-[10.5px] leading-relaxed text-sub-text">
          You will be added to the astrologer&apos;s waitlist. Once
          they accept, you have to confirm one more time before the
          call begins. The countdown timer in the call button shows
          your remaining minutes in real time. You can recharge
          mid-call without disconnecting.
        </p>

        <div className="mt-4 flex flex-wrap items-center
          justify-end gap-2">
          <button onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold
              text-sub-text hover:bg-bg-light">
            Cancel
          </button>
          {canJoin ? (
            <button onClick={onConfirm}
              className="rounded-full px-5 py-2 text-sm font-bold
                text-white"
              style={{ background:
                'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
              Continue & request
            </button>
          ) : (
            <button onClick={() => onRecharge(recommended)}
              className="rounded-full bg-primary px-5 py-2 text-sm
                font-bold text-white">
              + Wallet ₹{recommended}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ k, v }) {
  return (
    <div className="rounded-card bg-bg-light/40 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{k}</div>
      <div className="mt-0.5">{v}</div>
    </div>
  );
}

// In-live full astrologer profile (operator reference screenshot 2).
// Matches the Astrotalk-style profile card: live-now banner with
// Watch + Live Call CTAs, big avatar + verified + skills +
// languages + exp + rating + ₹/min, stats row, bio, photo gallery,
// reviews with view-all, Chat/Call action row at the bottom.
//
// Stays a bottom sheet (no router push) so the live keeps playing
// behind the dim. Profile + reviews load in parallel when the
// sheet opens.
function ProfileSheet({ astroUid, info, profile, following, onFollow,
  onCall, onClose }) {
  const p = profile || {};
  const photo = info?.photo || p.photo || p.photoUrl;
  const skills = Array.isArray(p.skills) ? p.skills
    : String(p.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  const langs = Array.isArray(p.languages) ? p.languages
    : String(p.languages || '').split(',').map((s) => s.trim()).filter(Boolean);
  const baseCall = Number(p.priceCall || info?.priceCall || 30);
  const callRate = offerService.computeRate(baseCall, p.offer, 'call');
  const baseChat = Number(p.priceChat || 20);
  const chatRate = offerService.computeRate(baseChat, p.offer, 'chat');
  const gallery = Array.isArray(p.gallery) ? p.gallery
    : (Array.isArray(p.photos) ? p.photos : []);
  const orders = Number(p.orders || p.ordersCount || 0);
  const minutes = Number(p.minutes || p.totalMinutes || 0);
  const rating = Number(p.ratingAvg || p.rating || 4.8);
  const [showFullBio, setShowFullBio] = useState(false);
  const bio = String(p.bio || '');
  const longBio = bio.length > 180;
  const [reviews, setReviews] = useState(null);
  useEffect(() => {
    if (!astroUid) return;
    reviewService.getReviews(astroUid)
      .then((r) => setReviews(r || [])).catch(() => setReviews([]));
  }, [astroUid]);
  function compact(n) {
    if (n >= 1000) return `${Math.floor(n / 1000)}k+`;
    return `${n}`;
  }
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center
      bg-black/45 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-3xl bg-white
          text-dark-text shadow-2xl"
        style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        {/* Top: live-now banner + close (sticky so it stays put
            even when scrolling the long body) */}
        <div className="sticky top-0 z-10 flex items-center
          justify-between gap-2 rounded-t-3xl bg-white/95 px-4 pt-3
          pb-2 backdrop-blur">
          <div className="flex items-center gap-1.5 text-[13px]
            text-dark-text">
            <span className="h-2 w-2 animate-pulse rounded-full
              bg-red-600" />
            <b>{info?.name || p.name || 'Astrologer'}</b>
            <span className="text-sub-text">is live now!</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onClose}
              className="rounded-full border border-gray-200 px-3 py-1
                text-[11px] font-bold text-dark-text">
              ▶ Watch
            </button>
            <button onClick={() => { onClose(); onCall(); }}
              className="flex items-center gap-1 rounded-full px-3 py-1
                text-[11px] font-bold text-white"
              style={{ background:
                'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
              <IconPhone /> Live call
            </button>
            <button onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full
                bg-black/10 text-black ml-1" aria-label="Close">
              <IconClose />
            </button>
          </div>
        </div>

        {/* Main profile card */}
        <div className="px-4 pt-2">
          <div className="rounded-2xl border border-gray-200 p-3">
            <div className="flex items-start gap-3">
              {photo ? (
                <img src={photo} alt={info?.name || ''}
                  className="h-16 w-16 shrink-0 rounded-full
                    object-cover ring-2 ring-amber-400/60" />
              ) : <Avatar name={info?.name} size={64} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-base
                  font-bold">
                  {info?.name || p.name || 'Astrologer'}
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36
                      1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36
                      3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3
                      .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3
                      2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
                    <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3
                      3.6 3.6 6.4-6.4-1.3-1.3z" />
                  </svg>
                  <button onClick={onFollow}
                    className={`ml-auto rounded-full px-3 py-0.5
                      text-[11px] font-bold ${following
                        ? 'bg-bg-light text-dark-text'
                        : 'text-white'}`}
                    style={following ? undefined : { background:
                      'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
                    {following ? 'Following' : 'Follow'}
                  </button>
                </div>
                {!!skills.length && (
                  <div className="text-[12px] text-sub-text
                    line-clamp-1">
                    {skills.join(', ')}
                  </div>
                )}
                {!!langs.length && (
                  <div className="text-[12px] text-sub-text">
                    {langs.join(', ')}
                  </div>
                )}
                {!!p.experience && (
                  <div className="text-[12px] text-sub-text">
                    Exp: {p.experience} Years
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2
                  text-[13px]">
                  <span className="text-amber-500">
                    {'★'.repeat(Math.round(rating))}
                  </span>
                  <span className="flex items-baseline gap-1">
                    {callRate.discounted && (
                      <span className="text-[12px] text-sub-text
                        line-through">₹{callRate.base}</span>
                    )}
                    <span className="font-bold">
                      ₹{callRate.final}
                    </span>
                    <span className="text-[11px] text-sub-text">
                      /min
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="mt-3 grid grid-cols-2 divide-x
              divide-gray-200 rounded-card border border-gray-200">
              <div className="flex items-center justify-center gap-1
                py-2 text-[12px]">
                <span className="text-amber-700">🧾</span>
                <b>{compact(orders)}</b>
                <span className="text-sub-text">orders</span>
              </div>
              <div className="flex items-center justify-center gap-1
                py-2 text-[12px]">
                <span className="text-amber-700">💬</span>
                <b>{compact(minutes)}</b>
                <span className="text-sub-text">mins</span>
              </div>
            </div>

            {/* Bio */}
            {bio && (
              <div className="mt-3 text-[13px] leading-relaxed">
                {longBio && !showFullBio
                  ? <>{bio.slice(0, 180)}…{' '}
                    <button onClick={() => setShowFullBio(true)}
                      className="font-bold text-primary
                        hover:underline">show more</button></>
                  : bio}
              </div>
            )}
          </div>
        </div>

        {/* Photo gallery */}
        {gallery.length > 0 && (
          <div className="mt-4 px-4">
            <div className="flex gap-2 overflow-x-auto pb-1"
              style={{ scrollbarWidth: 'none' }}>
              {gallery.slice(0, 8).map((g, i) => (
                <img key={i} src={g} alt={`gallery ${i + 1}`}
                  className="h-32 w-28 shrink-0 rounded-2xl
                    object-cover" />
              ))}
            </div>
          </div>
        )}

        {/* User reviews */}
        <div className="mt-4 px-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold">User Reviews</h4>
            {reviews && reviews.length > 0 && (
              <button onClick={onClose}
                className="text-[12px] font-bold text-primary
                  hover:underline">
                View All
              </button>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {reviews === null && (
              <div className="text-[12px] text-sub-text">Loading…</div>
            )}
            {reviews && reviews.length === 0 && (
              <div className="rounded-card bg-bg-light/40 p-3
                text-[12px] text-sub-text">
                No reviews yet.
              </div>
            )}
            {reviews && reviews.slice(0, 2).map((r, i) => (
              <div key={r.id || i}
                className="rounded-2xl border border-gray-200 p-3">
                <div className="flex items-center gap-2">
                  <Avatar name={r.userName || r.name || 'User'}
                    size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">
                      {r.userName || r.name || 'Anonymous'}
                    </div>
                    <div className="text-amber-500 text-[12px]">
                      {'★'.repeat(Math.round(r.rating || 5))}
                    </div>
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 text-[12px]
                  leading-relaxed">
                  {r.comment || r.text || ''}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky bottom action bar - Chat + Call (live-call
            opens the estimator on the live page) */}
        <div className="sticky bottom-0 z-10 mt-4 grid grid-cols-2
          gap-2 border-t border-gray-100 bg-white/95 px-4 py-3
          backdrop-blur">
          <button onClick={onClose}
            className="flex items-center justify-center gap-2
              rounded-full border border-gray-300 py-2.5 text-sm
              font-bold text-dark-text hover:bg-bg-light">
            💬 Chat
            <span className="text-[10px] text-sub-text">
              {chatRate.discounted && (
                <span className="line-through mr-0.5">
                  ₹{chatRate.base}
                </span>
              )}
              ₹{chatRate.final}/min
            </span>
          </button>
          <button onClick={() => { onClose(); onCall(); }}
            className="flex items-center justify-center gap-2
              rounded-full py-2.5 text-sm font-bold text-white"
            style={{ background:
              'linear-gradient(135deg,#D4A12A,#7F2020)' }}>
            <IconPhone /> Call
            <span className="text-[10px] opacity-90">
              ₹{callRate.final}/min
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Grid of OTHER live astrologers. Operator screenshot 3: pulled-up
// 2-col grid keyed by category (we keep it flat for now), tap
// switches the live in place.
function GridSheet({ lives, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center
      bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-[#0E0A2E] p-4
          text-white shadow-2xl"
        style={{ maxHeight: '75vh', overflowY: 'auto' }}>
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/30" />
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-bold">Live astrologers</h3>
          <button onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full
              bg-white/15" aria-label="Close">
            <IconClose />
          </button>
        </div>
        {lives.length === 0 ? (
          <div className="rounded-card bg-white/10 p-6 text-center
            text-[12px] opacity-80">
            You&apos;re watching the only live right now. Swipe down to
            close.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {lives.map((l) => (
              <button key={l.astroUid}
                onClick={() => onPick(l.astroUid)}
                className="relative overflow-hidden rounded-2xl
                  bg-black text-left" style={{ aspectRatio: '3/4' }}>
                {l.photo ? (
                  <img src={l.photo} alt={l.name}
                    className="absolute inset-0 h-full w-full
                      object-cover opacity-80" />
                ) : (
                  <div className="absolute inset-0 grid
                    place-items-center text-3xl font-bold opacity-70">
                    {(l.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full
                  bg-red-600 px-1.5 py-0.5 text-[9px] font-bold">
                  LIVE
                </span>
                <div className="absolute inset-x-0 bottom-0
                  bg-gradient-to-t from-black/80 to-transparent p-2">
                  <div className="truncate text-[12px] font-bold">
                    {l.name}
                  </div>
                </div>
              </button>
            ))}
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
