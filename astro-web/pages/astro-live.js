import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, astrologerService, recordService,
  liveBotService,
} from '@astro/shared';
import { useRequireAstrologer } from '../lib/useAuth';
import { useSettings } from '../lib/useSettings';
import Layout from '../components/Layout';
import { confirmModal } from '../components/ConfirmModal';

function fmtWhen(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

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
  // Royal palette only - no purple/indigo. Maroon / Amber / Olive /
  // Rust / Cream-dark / Deep maroon for avatar variety.
  const colors = ['#7F2020', '#D4A12A', '#5A6E32', '#B45309',
    '#1A1A2E', '#2A1408'];
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
  const { features } = useSettings();
  const router = useRouter();
  const [astro, setAstro] = useState(null);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [fakes, setFakes] = useState([]);
  const [dp, setDp] = useState('');
  const [, setVtick] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode] = useState('choose');     // choose | sched
  const [sched, setSched] = useState(null);       // pending scheduled
  const [history, setHistory] = useState([]);     // own live history
  const [liveTitle, setLiveTitle] = useState('');
  const [schedAt, setSchedAt] = useState('');
  const [schedTitle, setSchedTitle] = useState('');
  const localRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    astrologerService.getAstrologer(user.uid).then(setAstro)
      .catch(() => setAstro(null));
    const u1 = liveService.listenLive(user.uid, setInfo);
    const u2 = liveService.listenLiveComments(user.uid, setComments);
    const u3 = liveService.listenScheduledLive(user.uid, setSched);
    const u4 = liveService.listenLiveHistory(user.uid, setHistory);
    return () => { u1 && u1(); u2 && u2(); u3 && u3(); u4 && u4(); };
  }, [user]);

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments, fakes]);

  useEffect(() => liveService.watchComplianceDp(setDp), []);

  // Refresh simulated viewer count while live.
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setVtick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [live]);

  // Filler comments while live when real chatter is sparse.
  useEffect(() => {
    if (!live || !features || !features.live_fake_enabled) {
      return undefined;
    }
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
  }, [live, features, comments.length]);

  // Reset fillers each time a live ends/starts.
  useEffect(() => { if (!live) setFakes([]); }, [live]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  // ADMIN-DRIVEN AUDIENCE BOTS: when the live_bots_* settings are
  // enabled (and this astrologer is in scope), the astrologer
  // client publishes bot viewer-joins + chat questions into the
  // SAME live messages collection real viewers write into. So
  // every viewer + the astrologer themselves sees the same bot
  // names + comments, with no separate API call needed.
  //
  // Astrologer NEVER sees a toggle for this - the master switch
  // and per-astrologer allowlist are admin-side only.
  useEffect(() => {
    if (!live || !user) return undefined;
    let cancelled = false;
    let joinTimer = null;
    let commentTimer = null;
    const usedQs = new Set();
    (async () => {
      const cfg = await liveBotService.getBotConfig();
      if (!liveBotService.botsActiveForAstro(cfg, user.uid)) return;
      const joinMs = Math.max(3,
        Number(cfg.live_bots_join_rate_sec) || 12) * 1000;
      const commentMs = Math.max(5,
        Number(cfg.live_bots_comment_rate_sec) || 35) * 1000;
      async function joinTick() {
        if (cancelled) return;
        try {
          const bot = await liveBotService.pickRandomBot();
          if (bot) {
            await liveBotService.publishBotEvent(user.uid,
              { kind: 'join', name: bot.name,
                code: bot.code || bot.id });
          }
        } catch (_) { /* swallow */ }
      }
      async function commentTick() {
        if (cancelled) return;
        try {
          const bot = await liveBotService.pickRandomBot();
          const q = await liveBotService.pickQuestion(usedQs);
          if (bot && q) {
            await liveBotService.publishBotEvent(user.uid,
              { kind: 'comment', name: bot.name,
                code: bot.code || bot.id, text: q.text });
          }
        } catch (_) { /* swallow */ }
      }
      // First join + comment after a short stagger so it doesn't all
      // fire at t=0.
      joinTimer = setTimeout(function loop() {
        joinTick().then(() => {
          if (!cancelled) joinTimer = setTimeout(loop, joinMs);
        });
      }, 2000);
      commentTimer = setTimeout(function loop() {
        commentTick().then(() => {
          if (!cancelled) commentTimer = setTimeout(loop, commentMs);
        });
      }, 6000);
    })();
    return () => {
      cancelled = true;
      if (joinTimer) clearTimeout(joinTimer);
      if (commentTimer) clearTimeout(commentTimer);
    };
  }, [live, user]);

  async function start() {
    if (!user || joinedRef.current) return;
    // Must be fully OFFLINE (no Chat/Call/Video) before going Live.
    try {
      const a = await astrologerService.getAstrologer(user.uid);
      const onAny = a && (a.status === 'online' || a.chat_enabled
        || a.call_enabled || a.video_enabled);
      if (onAny) {
        await confirmModal({
          title: 'Go offline first',
          message: 'You are currently online for Chat / Call / Video. '
            + 'Turn those OFF on the Dashboard before starting a Live '
            + 'session.',
          yes: 'OK', no: 'Close',
        });
        return;
      }
    } catch (_) { /* allow if status unknown */ }
    const ok = await confirmModal({
      title: 'Go live now?',
      message: 'Your camera will start and your video will be visible '
        + 'to clients watching the Live tab.',
      yes: 'Go live',
      no: 'Cancel',
    });
    if (!ok) return;
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
        title: (liveTitle || '').trim() || 'Live consultation',
      });
      // Record the live session for admin monitoring (best effort).
      recordService.startRecording({
        sessionId: `live_${user.uid}`, type: 'live',
        astroId: user.uid, userId: '',
      }).catch(() => {});
      setLive(true);
    } catch (e) {
      await confirmModal({ title: 'Could not start live',
        message: 'Check camera and microphone permissions and try again.',
        yes: 'OK', no: 'Close' });
    } finally { setStarting(false); }
  }

  async function schedule() {
    const t = schedAt ? new Date(schedAt).getTime() : 0;
    if (!t || t < Date.now() + 60000) {
      await confirmModal({ title: 'Pick a future time',
        message: 'Choose a date and time at least a minute from now.',
        yes: 'OK', no: 'Close' });
      return;
    }
    try {
      await liveService.scheduleLive(user.uid, {
        name: astro?.name || 'Astrologer',
        photo: astro?.profileImage || '',
        title: (schedTitle || '').trim() || 'Live consultation',
        startAt: t,
      });
      setMode('choose'); setSchedAt(''); setSchedTitle('');
      await confirmModal({ title: 'Live scheduled',
        message: 'All your followers have been notified. It now shows '
          + 'as Upcoming in their app.',
        yes: 'Done', no: 'Close' });
    } catch (_) {
      await confirmModal({ title: 'Could not schedule',
        message: 'Please try again.', yes: 'OK', no: 'Close' });
    }
  }

  async function cancelSched() {
    const ok = await confirmModal({ title: 'Cancel scheduled live?',
      message: 'Your followers will no longer see it as upcoming.',
      yes: 'Cancel live', no: 'Keep it', danger: true });
    if (!ok) return;
    try { await liveService.cancelScheduledLive(user.uid); } catch (_) {}
  }

  async function stop() {
    const ok = await confirmModal({ title: 'End the live session?',
      message: 'Your viewers will be disconnected immediately.',
      yes: 'End now', no: 'Keep going', danger: true });
    if (!ok) return;
    try { await recordService.stopRecording(); } catch (_) {}
    try { await callService.leaveAgoraChannel(); } catch (_) {}
    try { await liveService.endLive(user.uid); } catch (_) {}
    joinedRef.current = false;
    setLive(false);
    router.push('/astro-dashboard');
  }

  useEffect(() => () => {
    if (joinedRef.current && user) {
      recordService.stopRecording().catch(() => {});
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
  const feed = [
    ...comments.map((c) => ({
      ...c, _t: c.createdAt?.toMillis ? c.createdAt.toMillis() : 0,
    })),
    ...fakes.map((f) => ({ ...f, _t: f._ts })),
  ].sort((a, b) => a._t - b._t);

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

  // PRE-LIVE: themed Layout page. The black streaming wrapper is only
  // mounted once we are actually live, so the Go Live setup looks like
  // every other page in the app.
  if (!live) {
    return (
      <PreLiveScreen
        astro={astro} sched={sched} mode={mode} setMode={setMode}
        liveTitle={liveTitle} setLiveTitle={setLiveTitle}
        schedTitle={schedTitle} setSchedTitle={setSchedTitle}
        schedAt={schedAt} setSchedAt={setSchedAt}
        starting={starting} start={start} schedule={schedule}
        cancelSched={cancelSched} history={history} />
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black
                    text-white">
      <div ref={localRef} className="absolute inset-0" />

      {/* Top bar */}
      <div className="absolute right-3 top-3 z-10 flex items-center
        gap-2">
        <span className="flex items-center gap-1 rounded-full
          bg-black/40 px-3 py-1 text-sm backdrop-blur">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7
            10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12"
            cy="12" r="3" /></svg>
          {liveService.liveSimViewers(info, features)}
        </span>
        <button onClick={() => stop()}
          className="flex h-9 w-9 items-center justify-center
            rounded-full bg-black/40 text-lg backdrop-blur">x</button>
      </div>

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
          {feed.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              {c.team && dp ? (
                <img src={dp} alt="Compliance Team"
                  className="h-8 w-8 shrink-0 rounded-full
                    object-cover" />
              ) : (
                <Avatar name={c.name} />
              )}
              <div className="min-w-0">
                <div className="text-[13px] leading-tight">
                  <span className="font-semibold opacity-90">
                    {c.name}
                  </span>
                  {c.team && <Tick green />}
                  {(c.code || c.uid) && (
                    <span className="text-[#D4A12A]">
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

// Pre-live ("Go Live") screen using the standard app Layout so it matches
// the rest of the astrologer app's theme. Sections: scheduled (if any),
// the Go Live / Schedule chooser, and Today's activity. Modern, clean.
function PreLiveScreen({
  astro, sched, mode, setMode, liveTitle, setLiveTitle, schedTitle,
  setSchedTitle, schedAt, setSchedAt, starting, start, schedule,
  cancelSched, history,
}) {
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const todays = (history || [])
    .filter((h) => (h.ts || 0) >= sod.getTime())
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const done = todays.filter((h) => h.status !== 'cancelled');
  const totSec = done.reduce((a, h) => a + (h.durationSec || 0), 0);

  return (
    <Layout>
      {/* HERO */}
      <div className="card flex items-center gap-3">
        {astro?.profileImage ? (
          <img src={astro.profileImage} alt={astro.name || 'You'}
            className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center
            rounded-full bg-primary/15 text-xl font-bold text-primary">
            {(astro?.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider
            text-sub-text">Go Live</div>
          <div className="truncate text-lg font-bold text-dark-text">
            {astro?.name || 'Astrologer'}
          </div>
          <p className="text-[12px] text-sub-text">
            Stream a live consultation to your followers. Going live
            notifies them instantly.
          </p>
        </div>
      </div>

      {/* SCHEDULED (if any) */}
      {sched && (
        <div className="card mt-3 border border-primary/30
          bg-primary/5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary px-2 py-0.5
              text-[10px] font-bold uppercase tracking-wider text-white">
              Scheduled
            </span>
            <div className="ml-auto text-[11px] text-sub-text">
              {fmtWhen(sched.startAt)}
            </div>
          </div>
          <div className="mt-1 text-base font-bold text-dark-text">
            {sched.title || 'Live consultation'}
          </div>
          <p className="mt-1 text-[12px] text-sub-text">
            Followers were notified. It shows as Upcoming in their app.
          </p>
          <button onClick={cancelSched}
            className="mt-3 rounded-full border border-danger px-4
              py-1.5 text-xs font-bold text-danger hover:bg-danger/5">
            Cancel schedule
          </button>
        </div>
      )}

      {/* TABS: Go Live now / Schedule */}
      <div className="card mt-3">
        <div className="mb-3 inline-flex rounded-full bg-bg-light p-1
          text-xs font-bold">
          <button onClick={() => setMode('choose')}
            className={`rounded-full px-3 py-1.5 ${mode === 'choose'
              ? 'bg-white text-primary shadow-sm' : 'text-sub-text'}`}>
            Go live now
          </button>
          <button onClick={() => setMode('sched')}
            className={`rounded-full px-3 py-1.5 ${mode === 'sched'
              ? 'bg-white text-primary shadow-sm' : 'text-sub-text'}`}>
            Schedule for later
          </button>
        </div>

        {mode === 'choose' ? (
          <div className="space-y-3">
            <label className="block text-[11px] font-bold uppercase
              tracking-wider text-sub-text">
              Live title (optional)
              <input className="input mt-1" value={liveTitle}
                placeholder="e.g. Daily horoscope and live Q&A"
                onChange={(e) => setLiveTitle(e.target.value)} />
            </label>
            <button onClick={start} disabled={starting}
              className="w-full rounded-full bg-danger py-3 text-base
                font-bold text-white shadow-sm hover:opacity-90
                disabled:opacity-60">
              {starting ? 'Starting…' : '● Go Live Now'}
            </button>
            <p className="text-[11px] text-sub-text">
              Make sure you are offline for Chat / Call / Video before
              starting a live session.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-[11px] font-bold uppercase
              tracking-wider text-sub-text">
              Date &amp; time
              <input type="datetime-local" className="input mt-1"
                value={schedAt}
                onChange={(e) => setSchedAt(e.target.value)} />
            </label>
            <label className="block text-[11px] font-bold uppercase
              tracking-wider text-sub-text">
              Title (optional)
              <input className="input mt-1" value={schedTitle}
                placeholder="What is this live about?"
                onChange={(e) => setSchedTitle(e.target.value)} />
            </label>
            <button onClick={schedule}
              className="btn-primary w-full">
              Schedule &amp; notify followers
            </button>
            <p className="text-[11px] text-sub-text">
              Scheduling notifies your followers and shows a countdown
              in their app.
            </p>
          </div>
        )}
      </div>

      {/* TODAY'S ACTIVITY */}
      <div className="card mt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-dark-text">
              Today’s live activity
            </div>
            <div className="text-[12px] text-sub-text">
              Full history is in your Activity report.
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Done" value={done.length} />
          <Stat label="Total" value={fmtDur(totSec)} />
          <Stat label="Cancelled" value={todays.length - done.length} />
        </div>
        {todays.length === 0 ? (
          <div className="mt-3 rounded-card bg-bg-light p-4 text-center
            text-sm text-sub-text">
            No live activity today yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {todays.map((h) => {
              const cancelled = h.status === 'cancelled';
              return (
                <div key={h.id}
                  className="rounded-card border border-gray-200 p-3
                    text-sm">
                  <div className="flex items-center justify-between
                    gap-2">
                    <span className="truncate font-semibold
                      text-dark-text">
                      {h.title || 'Live consultation'}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5
                      text-[10px] font-bold ${cancelled
                        ? 'bg-danger/15 text-danger'
                        : 'bg-success/15 text-success'}`}>
                      {cancelled ? 'Cancelled' : 'Ended'}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-sub-text">
                    {cancelled ? (
                      <>Was scheduled for {fmtWhen(h.startedAtMs)}</>
                    ) : (
                      <>Started {fmtWhen(h.startedAtMs)} · Ended
                        {' '}{fmtWhen(h.endedAtMs)}</>
                    )}
                  </div>
                  {!cancelled && (
                    <div className="text-[12px] text-sub-text">
                      Duration <b>{fmtDur(h.durationSec)}</b>
                      {' '}· {h.viewers || 0} viewers
                      {' '}· {h.likes || 0} likes
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
const Stat = ({ label, value }) => (
  <div className="rounded-card bg-bg-light p-2">
    <div className="text-[10px] font-bold uppercase tracking-wider
      text-sub-text">{label}</div>
    <div className="mt-0.5 text-base font-bold text-dark-text">{value}</div>
  </div>
);
