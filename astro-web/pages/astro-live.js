import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  callService, liveService, astrologerService, recordService,
} from '@astro/shared';
import { useRequireAstrologer } from '../lib/useAuth';

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
    astrologerService.getAstrologer(user.uid).then(setAstro);
    const u1 = liveService.listenLive(user.uid, setInfo);
    const u2 = liveService.listenLiveComments(user.uid, setComments);
    const u3 = liveService.listenScheduledLive(user.uid, setSched);
    const u4 = liveService.listenLiveHistory(user.uid, setHistory);
    return () => { u1 && u1(); u2 && u2(); u3 && u3(); u4 && u4(); };
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
    // Must be fully OFFLINE (no Chat/Call/Video) before going Live.
    try {
      const a = await astrologerService.getAstrologer(user.uid);
      const onAny = a && (a.status === 'online' || a.chat_enabled
        || a.call_enabled || a.video_enabled);
      if (onAny) {
        window.alert('You are Online for Chat / Call / Video. Turn '
          + 'those OFF (go offline from the Dashboard Availability) '
          + 'before starting a Live session.');
        return;
      }
    } catch (_) { /* allow if status unknown */ }
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
        title: (liveTitle || '').trim() || 'Live consultation',
      });
      // Record the live session for admin monitoring (best effort).
      recordService.startRecording({
        sessionId: `live_${user.uid}`, type: 'live',
        astroId: user.uid, userId: '',
      }).catch(() => {});
      setLive(true);
    } catch (e) {
      window.alert('Could not start live. Check camera/mic permission.');
    } finally { setStarting(false); }
  }

  async function schedule() {
    const t = schedAt ? new Date(schedAt).getTime() : 0;
    if (!t || t < Date.now() + 60000) {
      window.alert('Pick a date and time at least a minute from now.');
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
      window.alert('Live scheduled. All your followers have been '
        + 'notified and it now shows in their app as Upcoming.');
    } catch (_) {
      window.alert('Could not schedule. Try again.');
    }
  }

  async function cancelSched() {
    if (!window.confirm('Cancel the scheduled live?')) return;
    try { await liveService.cancelScheduledLive(user.uid); } catch (_) {}
  }

  async function stop() {
    if (!window.confirm('End the live session?')) return;
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
        <div className="absolute inset-0 z-10 overflow-y-auto
          bg-black/85 px-5 py-8">
          <div className="mx-auto max-w-md space-y-4">
            <h1 className="text-center text-2xl font-bold">Go Live</h1>

            {sched && (
              <div className="rounded-2xl border border-white/15
                bg-white/10 p-4">
                <div className="text-xs uppercase tracking-wide
                  opacity-70">Scheduled</div>
                <div className="mt-1 font-semibold">
                  {sched.title || 'Live consultation'}
                </div>
                <div className="text-sm opacity-90">
                  {fmtWhen(sched.startAt)}
                </div>
                <p className="mt-1 text-xs opacity-70">
                  Followers were notified. It shows as Upcoming in the
                  client app.
                </p>
                <button onClick={cancelSched}
                  className="mt-2 rounded-full border border-white/30
                    px-4 py-1.5 text-sm">Cancel schedule</button>
              </div>
            )}

            {mode === 'choose' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/15
                  bg-white/5 p-4">
                  <input value={liveTitle}
                    onChange={(e) => setLiveTitle(e.target.value)}
                    placeholder="Live title (optional)"
                    className="mb-3 w-full rounded-xl bg-white/10 px-3
                      py-2.5 text-sm placeholder-white/50 outline-none" />
                  <button onClick={start} disabled={starting}
                    className="w-full rounded-full bg-danger px-8 py-3
                      text-lg font-bold">
                    {starting ? 'Starting...' : 'Go Live Now'}
                  </button>
                </div>
                <button onClick={() => setMode('sched')}
                  className="w-full rounded-full border border-white/30
                    px-8 py-3 text-base font-semibold">
                  Schedule a Live
                </button>
                <p className="text-center text-xs opacity-70">
                  Going live notifies your followers. Scheduling also
                  notifies them and shows a countdown in their app.
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border
                border-white/15 bg-white/5 p-4">
                <div className="font-semibold">Schedule a Live</div>
                <label className="block text-sm">
                  Date &amp; time
                  <input type="datetime-local" value={schedAt}
                    onChange={(e) => setSchedAt(e.target.value)}
                    className="mt-1 w-full rounded-xl bg-white/10 px-3
                      py-2.5 text-sm outline-none" />
                </label>
                <input value={schedTitle}
                  onChange={(e) => setSchedTitle(e.target.value)}
                  placeholder="Live title (optional)"
                  className="w-full rounded-xl bg-white/10 px-3 py-2.5
                    text-sm placeholder-white/50 outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => setMode('choose')}
                    className="flex-1 rounded-full border border-white/30
                      px-4 py-2.5 text-sm">Back</button>
                  <button onClick={schedule}
                    className="flex-1 rounded-full bg-primary px-4 py-2.5
                      text-sm font-bold">Schedule &amp; notify</button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/15
              bg-white/5 p-4">
              <div className="mb-1 font-semibold">
                Today&apos;s live activity
              </div>
              <p className="mb-3 text-xs opacity-60">
                Only today is shown here. Full history is in your
                Activity report and with admin.
              </p>
              {(() => {
                const sod = new Date(); sod.setHours(0, 0, 0, 0);
                const todays = history
                  .filter((h) => (h.ts || 0) >= sod.getTime())
                  .sort((a, b) => (b.ts || 0) - (a.ts || 0));
                const done = todays.filter((h) => h.status !== 'cancelled');
                const totSec = done.reduce(
                  (a, h) => a + (h.durationSec || 0), 0);
                return (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2 text-sm">
                      <span className="rounded-full bg-white/10 px-3
                        py-1">
                        Done today: <b>{done.length}</b>
                      </span>
                      <span className="rounded-full bg-white/10 px-3
                        py-1">
                        Total <b>{fmtDur(totSec)}</b>
                      </span>
                      <span className="rounded-full bg-white/10 px-3
                        py-1">
                        Cancelled: <b>
                          {todays.length - done.length}</b>
                      </span>
                    </div>
                    {todays.length === 0 ? (
                      <div className="text-sm opacity-70">
                        No live activity today yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {todays.map((h) => {
                          const cancelled = h.status === 'cancelled';
                          return (
                            <div key={h.id}
                              className="rounded-xl bg-white/5 px-3
                                py-2 text-sm">
                              <div className="flex items-center
                                justify-between gap-2">
                                <span className="truncate font-medium">
                                  {h.title || 'Live consultation'}
                                </span>
                                <span className={`shrink-0 rounded-full
                                  px-2 py-0.5 text-[11px] font-semibold
                                  ${cancelled ? 'bg-danger/30'
                                    : 'bg-success/30'}`}>
                                  {cancelled ? 'Cancelled' : 'Ended'}
                                </span>
                              </div>
                              <div className="mt-1 text-[12px]
                                opacity-75">
                                {cancelled ? (
                                  <>Was scheduled for {fmtWhen(
                                    h.startedAtMs)}</>
                                ) : (
                                  <>Started {fmtWhen(h.startedAtMs)}
                                    {' '}- Ended {fmtWhen(h.endedAtMs)}
                                  </>
                                )}
                              </div>
                              {!cancelled && (
                                <div className="text-[12px]
                                  opacity-75">
                                  Duration <b>{fmtDur(h.durationSec)}</b>
                                  {' '}- {h.viewers || 0} viewers,
                                  {' '}{h.likes || 0} likes
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <button onClick={() => router.back()}
              className="w-full py-2 text-sm opacity-70">Close</button>
          </div>
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
