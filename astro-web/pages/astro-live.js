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

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  maroon:  '#7F2020',
  amber:   '#D4A12A',
  cream:   '#FFF8E7',
  bg:      '#0A0A0A',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getElapsed(ts) {
  if (!ts) return '--';
  const secs = Math.floor((Date.now() - (ts?.toMillis ? ts.toMillis() : ts)) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + 'm ' + s + 's';
}

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
function mmss(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function Tick({ green }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 3 }}>
      <path fill={green ? '#1FA855' : '#1D9BF0'} d="M12 1.5l2.2 2.06
        3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2
        2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1
        12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
      <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6
        6.4-6.4-1.3-1.3z" />
    </svg>
  );
}

function Avatar({ name, size = 32 }) {
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  const colors = [C.maroon, C.amber, '#5A6E32', '#B45309', '#1A3A2E', '#2A1408'];
  const bg = colors[(name || 'x').charCodeAt(0) % colors.length];
  return (
    <span style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%', background: bg,
      color: '#fff', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0,
    }}>{ch}</span>
  );
}

// ─── Mic / Camera / Kick / Block icons (SVG, no emoji) ───────────────────────
function IconMic({ off }) {
  return off
    ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ) : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    );
}
function IconCamera({ off }) {
  return off
    ? (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    ) : (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2">
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
}
function IconCallType({ type }) {
  return type === 'video'
    ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={C.amber} strokeWidth="2">
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={C.amber} strokeWidth="2">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.41 18a19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
}
function IconWishlist() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={C.amber}
      stroke={C.amber} strokeWidth="1">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function IconEndCall() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="#fff" strokeWidth="2.2">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.41 18a19.45 19.45 0 0 1-3.41-3.31M2 2l20 20" />
    </svg>
  );
}

// ─── Small pre-live stat tile ─────────────────────────────────────────────────
const Stat = ({ label, value }) => (
  <div style={{
    background: 'rgba(212,161,42,0.08)', borderRadius: 10, padding: '8px 4px',
    textAlign: 'center',
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: '#888', marginBottom: 2 }}>
      {label}
    </div>
    <div style={{ fontSize: 15, fontWeight: 700, color: C.cream }}>{value}</div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
export default function AstroLive() {
  const { user, loading } = useRequireAstrologer();
  const { features, cfg } = useSettings();
  const router = useRouter();

  const [astro, setAstro]     = useState(null);
  const [live, setLive]       = useState(false);
  const [starting, setStarting] = useState(false);
  const [muted, setMuted]     = useState(false);
  const [camOff, setCamOff]   = useState(false);
  const [info, setInfo]       = useState(null);
  const [comments, setComments] = useState([]);
  const [fakes, setFakes]     = useState([]);
  const [dp, setDp]           = useState('');
  const [, setVtick]          = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode]       = useState('choose');
  const [sched, setSched]     = useState(null);
  const [history, setHistory] = useState([]);
  const [liveTitle, setLiveTitle] = useState('');
  const [schedAt, setSchedAt] = useState('');
  const [schedTitle, setSchedTitle] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [sheetOpen, setSheetOpen] = useState(true);

  // Join requests
  const [joinRequests, setJoinRequests] = useState([]);
  // New states
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [blockedUsers, setBlockedUsers]     = useState([]);
  const [wishlistUsers, setWishlistUsers]   = useState([]);
  const [compStatus, setCompStatus]         = useState(null);

  // Quiz states
  const [quizActive, setQuizActive]         = useState(false);
  const [activeQuiz, setActiveQuiz]         = useState(null);
  const [quizAnswers, setQuizAnswers]       = useState([]);
  const [showQuizCreate, setShowQuizCreate] = useState(false);
  const [quizQuestion, setQuizQuestion]     = useState('');
  const [quizOptions, setQuizOptions]       = useState(['', '', '', '']);
  const [quizCorrectIdx, setQuizCorrectIdx] = useState(0);
  const [quizPoints, setQuizPoints]         = useState(10);

  const [remoteUsers, setRemoteUsers]   = useState([]);

  const localRef      = useRef(null);
  const joinedRef     = useRef(false);
  const cRef          = useRef(null);
  const seenReqIds    = useRef(new Set());
  const remoteVideoRefs = useRef({});

  // ── Ring tone helper ─────────────────────────────────────────────────────
  function playRingTone(repeat) {
    const reps = repeat || 3;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let time = ctx.currentTime;
      for (let i = 0; i < reps; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
        osc.start(time);
        osc.stop(time + 0.4);
        time += 0.6;
      }
    } catch (_) {}
  }

  // ── Firestore listeners ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return undefined;
    astrologerService.getAstrologer(user.uid).then(setAstro).catch(() => setAstro(null));

    const u1 = liveService.listenLive(user.uid, setInfo);
    const u2 = liveService.listenLiveComments(user.uid, setComments);
    const u3 = liveService.listenScheduledLive(user.uid, setSched);
    const u4 = liveService.listenLiveHistory(user.uid, setHistory);
    const u5 = liveService.listenJoinRequests(user.uid, setJoinRequests);
    const u6 = liveService.listenConnectedUsers
      ? liveService.listenConnectedUsers(user.uid, setConnectedUsers) : null;
    const u7 = liveService.listenBlockedUsers
      ? liveService.listenBlockedUsers(user.uid, setBlockedUsers) : null;
    const u8 = liveService.listenWishlist
      ? liveService.listenWishlist(user.uid, setWishlistUsers) : null;

    return () => {
      u1 && u1(); u2 && u2(); u3 && u3(); u4 && u4();
      u5 && u5(); u6 && u6(); u7 && u7(); u8 && u8();
    };
  }, [user]);

  // Read quiz points from settings/config
  useEffect(() => {
    if (cfg && cfg.live_quiz_points) {
      const pts = Number(cfg.live_quiz_points);
      if (pts > 0) setQuizPoints(pts);
    }
  }, [cfg]);

  useEffect(() => {
    if (!user) return;
    if (liveService.getComplimentaryStatus) {
      liveService.getComplimentaryStatus(user.uid).then(setCompStatus).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (!live) return;
    const pending = joinRequests.filter((r) => r.status === 'pending');
    const newOnes = pending.filter((r) => r.id && !seenReqIds.current.has(r.id));
    if (newOnes.length > 0) {
      playRingTone(3);
      newOnes.forEach((r) => seenReqIds.current.add(r.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequests, live]);

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments, fakes]);

  useEffect(() => liveService.watchComplianceDp(setDp), []);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setVtick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [live]);

  // Filler comments
  useEffect(() => {
    if (!live || !features || !features.live_fake_enabled) return undefined;
    const ms = Math.max(3, Number(features.live_fake_every_sec) || 12) * 1000;
    const t = setInterval(() => {
      setFakes((arr) => {
        if (comments.length >= 12) return arr;
        return [...arr, liveService.nextFillerComment(features)].slice(-25);
      });
    }, ms);
    return () => clearInterval(t);
  }, [live, features, comments.length]);

  useEffect(() => { if (!live) setFakes([]); }, [live]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  // Quiz listeners - active only while live
  useEffect(() => {
    if (!live || !user) return undefined;
    const u1 = liveService.listenLiveQuiz(user.uid, (quiz) => {
      setActiveQuiz(quiz);
      setQuizActive(!!(quiz && quiz.status === 'active'));
    });
    const u2 = liveService.listenLiveQuizAnswers(user.uid, (answers) => {
      // top 5 fastest correct answers (sorted by answeredAt ascending)
      const correct = (answers || [])
        .filter((a) => a.correct)
        .sort((a, b) => (a.answeredAt || 0) - (b.answeredAt || 0))
        .slice(0, 5);
      setQuizAnswers(correct);
    });
    return () => { u1 && u1(); u2 && u2(); };
  }, [live, user]);

  // Admin-driven audience bots
  useEffect(() => {
    if (!live || !user) return undefined;
    let cancelled = false;
    let joinTimer = null;
    let commentTimer = null;
    const usedQs = new Set();
    (async () => {
      const cfg2 = await liveBotService.getBotConfig();
      // eslint-disable-next-line no-console
      console.log('[liveBots] cfg=', cfg2, 'uid=', user.uid,
        'active=', liveBotService.botsActiveForAstro(cfg2, user.uid));
      if (!liveBotService.botsActiveForAstro(cfg2, user.uid)) return;
      const joinMs    = Math.max(3, Number(cfg2.live_bots_join_rate_sec) || 12) * 1000;
      const commentMs = Math.max(5, Number(cfg2.live_bots_comment_rate_sec) || 35) * 1000;
      async function joinTick() {
        if (cancelled) return;
        try {
          const bot = await liveBotService.pickRandomBot();
          if (bot) {
            await liveBotService.publishBotEvent(user.uid,
              { kind: 'join', name: bot.name, code: bot.code || bot.id });
            // eslint-disable-next-line no-console
            console.log('[liveBots] joined', bot.name);
          } else {
            // eslint-disable-next-line no-console
            console.warn('[liveBots] no bot picked - pool empty?');
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[liveBots] join failed:', (e && e.message) || e);
        }
      }
      async function commentTick() {
        if (cancelled) return;
        try {
          const bot = await liveBotService.pickRandomBot();
          const q   = await liveBotService.pickQuestion(usedQs);
          if (bot && q) {
            await liveBotService.publishBotEvent(user.uid,
              { kind: 'comment', name: bot.name,
                code: bot.code || bot.id, text: q.text });
            // eslint-disable-next-line no-console
            console.log('[liveBots] said', bot.name, '>', q.text);
          } else {
            // eslint-disable-next-line no-console
            console.warn('[liveBots] no bot/question:', { hasBot: !!bot, hasQ: !!q });
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[liveBots] comment failed:', (e && e.message) || e);
        }
      }
      joinTimer = setTimeout(function loop() {
        joinTick().then(() => { if (!cancelled) joinTimer = setTimeout(loop, joinMs); });
      }, 2000);
      commentTimer = setTimeout(function loop() {
        commentTick().then(() => { if (!cancelled) commentTimer = setTimeout(loop, commentMs); });
      }, 6000);
    })();
    return () => {
      cancelled = true;
      if (joinTimer) clearTimeout(joinTimer);
      if (commentTimer) clearTimeout(commentTimer);
    };
  }, [live, user]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function start() {
    if (!user || joinedRef.current) return;
    try {
      const a = await astrologerService.getAstrologer(user.uid);
      const onAny = a && (a.status === 'online' || a.chat_enabled
        || a.call_enabled || a.video_enabled);
      if (onAny) {
        await confirmModal({
          title: 'Go offline first',
          message: 'You are currently online for Chat / Call / Video. '
            + 'Turn those OFF on the Dashboard before starting a Live session.',
          yes: 'OK', no: 'Close',
        });
        return;
      }
    } catch (_) { /* allow if status unknown */ }
    const ok = await confirmModal({
      title: 'Go live now?',
      message: 'Your camera will start and your video will be visible '
        + 'to clients watching the Live tab.',
      yes: 'Go live', no: 'Cancel',
    });
    if (!ok) return;
    setStarting(true);
    try {
      const ch  = liveService.liveChannel(user.uid);
      const tok = await callService.fetchAgoraToken(ch, user.uid).catch(() => ({}));
      await callService.joinAgoraChannel(
        ch, user.uid, tok.appId || callService.AGORA_APP_ID, tok.token || null);
      const tracks = await callService.publishLocalTracks({ video: true });
      if (tracks.video && localRef.current) tracks.video.play(localRef.current);
      joinedRef.current = true;

      // Subscribe to co-hosts who publish video/audio (connected users)
      callService.subscribeToRemote((remoteUser, mediaType) => {
        if (mediaType === 'video') {
          setRemoteUsers((prev) => {
            const exists = prev.find((u) => u.uid === remoteUser.uid);
            if (exists) return prev;
            return [...prev, remoteUser];
          });
          // Play their video once the container div is rendered
          setTimeout(() => {
            const el = remoteVideoRefs.current[remoteUser.uid];
            if (el && remoteUser.videoTrack) remoteUser.videoTrack.play(el);
          }, 200);
        }
        if (mediaType === 'audio' && remoteUser.audioTrack) {
          remoteUser.audioTrack.play();
        }
      });
      await liveService.goLive(user.uid, {
        name:  astro?.name || 'Astrologer',
        photo: astro?.profileImage || '',
        title: (liveTitle || '').trim() || 'Live consultation',
      });
      recordService.startRecording({
        sessionId: `live_${user.uid}`, type: 'live',
        astroId: user.uid, userId: '',
      }).catch(() => {});
      setLive(true);
    } catch (_) {
      await confirmModal({
        title: 'Could not start live',
        message: 'Check camera and microphone permissions and try again.',
        yes: 'OK', no: 'Close',
      });
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
        name:  astro?.name || 'Astrologer',
        photo: astro?.profileImage || '',
        title: (schedTitle || '').trim() || 'Live consultation',
        startAt: t,
      });
      setMode('choose'); setSchedAt(''); setSchedTitle('');
      await confirmModal({ title: 'Live scheduled',
        message: 'All your followers have been notified. It now shows as Upcoming in their app.',
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
    // End any active quiz before ending the live
    if (quizActive) {
      try { await liveService.endLiveQuiz(user.uid); } catch (_) {}
    }
    try { await recordService.stopRecording(); } catch (_) {}
    try { await callService.leaveAgoraChannel(); } catch (_) {}
    try { await liveService.endLive(user.uid); } catch (_) {}
    joinedRef.current = false;
    setRemoteUsers([]);
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

  async function handleKick(uid) {
    if (!uid) return;
    const ok = await confirmModal({
      title: 'Kick this user?',
      message: 'They will be removed from the live immediately.',
      yes: 'Kick', no: 'Cancel', danger: true,
    });
    if (!ok) return;
    try {
      if (liveService.kickUserFromLive) {
        await liveService.kickUserFromLive(user.uid, uid);
      } else {
        const { doc: kDoc, updateDoc: kUpdate } = await import('firebase/firestore');
        const { db: fdb } = await import('@astro/shared');
        await kUpdate(kDoc(fdb, 'chats', 'live_' + user.uid, 'requests', uid), {
          status: 'kicked',
        });
      }
    } catch (_) {}
  }

  async function handleBlock(uid) {
    if (!liveService.blockUserFromLive) return;
    const ok = await confirmModal({
      title: 'Block this user?',
      message: 'They will be removed and cannot rejoin this live.',
      yes: 'Block', no: 'Cancel', danger: true,
    });
    if (!ok) return;
    try { await liveService.blockUserFromLive(user.uid, uid); } catch (_) {}
  }

  async function handleUnblock(uid) {
    if (!liveService.unblockUserFromLive) return;
    try { await liveService.unblockUserFromLive(user.uid, uid); } catch (_) {}
  }

  async function handleMakeComplimentary(requestId) {
    if (!liveService.recordComplimentaryCall) return;
    try { await liveService.recordComplimentaryCall(user.uid, requestId); } catch (_) {}
  }

  function sendChat() {
    const txt = chatInput.trim();
    if (!txt || !user) return;
    liveService.sendLiveComment
      ? liveService.sendLiveComment(user.uid, {
          uid: user.uid,
          name: astro?.name || 'Astrologer',
          text: txt,
          type: 'comment',
        }).catch(() => {})
      : null;
    setChatInput('');
  }

  // Quiz actions
  async function handleLaunchQuiz() {
    const q = quizQuestion.trim();
    const opts = quizOptions.map((o) => o.trim());
    if (!q) return;
    if (opts.some((o) => !o)) return;
    try {
      await liveService.createLiveQuiz(user.uid, {
        question: q,
        options: opts,
        correctAnswer: quizCorrectIdx,
        points: quizPoints,
      });
      setShowQuizCreate(false);
      setQuizQuestion('');
      setQuizOptions(['', '', '', '']);
      setQuizCorrectIdx(0);
    } catch (_) {
      await confirmModal({
        title: 'Could not launch quiz',
        message: 'Please try again.',
        yes: 'OK', no: 'Close',
      });
    }
  }

  async function handleEndQuiz() {
    try { await liveService.endLiveQuiz(user.uid); } catch (_) {}
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const feed = [
    ...comments.map((c) => ({ ...c, _t: c.createdAt?.toMillis ? c.createdAt.toMillis() : 0 })),
    ...fakes.map((f) => ({ ...f, _t: f._ts })),
  ].sort((a, b) => a._t - b._t);

  const pendingReqs  = joinRequests.filter((r) => r.status === 'pending' || r.status === 'astro_ok');
  const waitlistReqs = joinRequests.filter((r) => r.status === 'queued');

  const compUsed  = compStatus?.usedThisWeek ?? 0;
  const compLimit = compStatus?.weeklyLimit   ?? 2;

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center',
        justifyContent: 'center', background: C.bg, color: C.cream }}>
        Loading...
      </div>
    );
  }

  // ── PRE-LIVE ──────────────────────────────────────────────────────────────
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

  // ── LIVE BROADCAST UI ─────────────────────────────────────────────────────
  const viewers = liveService.liveSimViewers(info, features);

  return (
    <div style={{
      position: 'relative', width: '100vw', height: '100vh',
      overflow: 'hidden', background: C.bg, color: '#fff',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ── Top 55%: video preview ─────────────────────────────────────── */}
      <div style={{ position: 'relative', height: '55%', background: '#000', flexShrink: 0 }}>

        {/* Local video feed */}
        <div ref={localRef} style={{
          position: 'absolute', inset: 0,
          background: '#000', objectFit: 'cover',
        }} />

        {/* Remote user video tiles (connected co-hosts) */}
        {remoteUsers.length > 0 && (
          <div style={{
            position: 'absolute', left: 10, bottom: 10, zIndex: 15,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {remoteUsers.map((ru) => (
              <div key={ru.uid} style={{ position: 'relative' }}>
                <div
                  ref={(el) => { if (el) remoteVideoRefs.current[ru.uid] = el; }}
                  style={{
                    width: 90, height: 120, borderRadius: 10, background: '#111',
                    overflow: 'hidden', border: `2px solid ${C.amber}`,
                  }}
                />
                <div style={{
                  position: 'absolute', bottom: 3, left: 0, right: 0,
                  textAlign: 'center', fontSize: 9, color: C.cream,
                  background: 'rgba(0,0,0,0.55)', borderRadius: '0 0 8px 8px',
                  padding: '1px 3px',
                }}>
                  {String(ru.uid).slice(0, 8)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Top bar (absolute over video) ── */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
        }}>
          {/* Left: viewer count */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 10px',
            backdropFilter: 'blur(6px)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={C.amber} strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.cream }}>{viewers}</span>
          </div>

          {/* Center: LIVE badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 10px',
            backdropFilter: 'blur(6px)',
          }}>
            {/* Pulsing red dot */}
            <span style={{
              width: 9, height: 9, borderRadius: '50%', background: '#E53E3E',
              display: 'inline-block',
              animation: 'livePulse 1.4s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 12, fontWeight: 900, letterSpacing: '0.12em',
              color: '#fff', textTransform: 'uppercase',
            }}>LIVE</span>
          </div>

          {/* Right: elapsed timer */}
          <div style={{
            background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 10px',
            backdropFilter: 'blur(6px)',
            fontSize: 13, fontWeight: 700, color: C.amber, fontVariantNumeric: 'tabular-nums',
          }}>
            {mmss(elapsed)}
          </div>
        </div>

        {/* ── Right rail (absolute over video) ── */}
        <div style={{
          position: 'absolute', right: 12, top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 20, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <RailButton onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
            <IconMic off={muted} />
          </RailButton>
          <RailButton onClick={toggleCam} title={camOff ? 'Camera on' : 'Camera off'}>
            <IconCamera off={camOff} />
          </RailButton>
          <RailButton
            onClick={stop}
            title="End live"
            style={{ background: C.maroon }}>
            <IconEndCall />
          </RailButton>
        </div>
      </div>

      {/* ── Bottom 45%: chat + quiz controls ──────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        background: 'rgba(0,0,0,0.6)', position: 'relative', overflow: 'hidden',
      }}>

        {/* Quiz control bar (shown when live) */}
        <div style={{
          padding: '8px 12px 0',
          display: 'flex', gap: 8, alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}>
          {/* Start Quiz button - only visible when no quiz is active */}
          {!quizActive && (
            <button
              onClick={() => setShowQuizCreate(true)}
              style={{
                background: C.amber, border: 'none', borderRadius: 20,
                padding: '6px 14px', fontWeight: 700, fontSize: 12,
                color: C.maroon, cursor: 'pointer', flexShrink: 0,
              }}>
              Start Quiz
            </button>
          )}

          {/* Active quiz display */}
          {quizActive && activeQuiz && (
            <ActiveQuizPanel
              quiz={activeQuiz}
              answers={quizAnswers}
              onEnd={handleEndQuiz}
            />
          )}
        </div>

        {/* Scrollable comments */}
        <div ref={cRef} style={{
          flex: 1, overflowY: 'auto', padding: '10px 14px 6px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {feed.map((c) => (
            c.type === 'join' || c.type === 'follow'
              ? (
                <div key={c.id} style={{
                  fontSize: 12, fontStyle: 'italic',
                  color: C.cream, opacity: 0.75,
                }}>
                  {c.name}{' '}
                  {c.type === 'join' ? 'joined the live' : 'started following you'}
                </div>
              ) : (
                <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {c.team && dp ? (
                    <img src={dp} alt="Team"
                      style={{ width: 30, height: 30, borderRadius: '50%',
                        objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <Avatar name={c.name} size={30} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, lineHeight: 1.3 }}>
                      <span style={{ fontWeight: 700, color: C.amber }}>{c.name}</span>
                      {c.team && <Tick green />}
                      {(c.code || c.uid) && (
                        <span style={{ color: '#888', fontSize: 10, marginLeft: 4 }}>
                          #{(c.code || String(c.uid).slice(0, 7)).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.4 }}>
                      {c.text}
                    </div>
                  </div>
                </div>
              )
          ))}
        </div>

        {/* Chat input row */}
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
            placeholder="Say something to your viewers..."
            style={{
              flex: 1, background: 'rgba(255,255,255,0.07)', border: 'none',
              borderRadius: 20, padding: '8px 14px', color: '#fff',
              fontSize: 13, outline: 'none',
            }} />
          <button onClick={sendChat}
            disabled={!chatInput.trim()}
            style={{
              background: C.amber, border: 'none', borderRadius: 20,
              padding: '8px 16px', fontWeight: 700, fontSize: 13,
              color: C.bg, cursor: 'pointer', opacity: chatInput.trim() ? 1 : 0.45,
            }}>
            Send
          </button>
        </div>
      </div>

      {/* ── Join Requests Panel (collapsible bottom sheet) ──────────────── */}
      <JoinRequestsPanel
        open={sheetOpen}
        onToggle={() => setSheetOpen((v) => !v)}
        pendingReqs={pendingReqs}
        waitlistReqs={waitlistReqs}
        connectedUsers={connectedUsers}
        compUsed={compUsed}
        compLimit={compLimit}
        wishlistUsers={wishlistUsers}
        onAccept={(id) => liveService.astroAcceptJoin(id)}
        onDecline={(id) => liveService.astroDeclineJoin(id)}
        onPromote={(id) => liveService.astroAcceptJoin(id)}
        onKick={handleKick}
        onBlock={handleBlock}
        onMakeComp={handleMakeComplimentary}
      />

      {/* ── Quiz Creation Modal ─────────────────────────────────────────── */}
      {showQuizCreate && (
        <QuizCreateModal
          quizQuestion={quizQuestion}
          setQuizQuestion={setQuizQuestion}
          quizOptions={quizOptions}
          setQuizOptions={setQuizOptions}
          quizCorrectIdx={quizCorrectIdx}
          setQuizCorrectIdx={setQuizCorrectIdx}
          quizPoints={quizPoints}
          onLaunch={handleLaunchQuiz}
          onCancel={() => setShowQuizCreate(false)}
        />
      )}

      {/* Keyframes injected once */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes reqPulse {
          0%, 100% { border-color: #D4A12A; box-shadow: 0 0 0 0 rgba(212,161,42,0.4); }
          50%       { border-color: #7F2020; box-shadow: 0 0 0 4px rgba(212,161,42,0); }
        }
      `}</style>
    </div>
  );
}

// ─── Rail button helper ───────────────────────────────────────────────────────
function RailButton({ children, onClick, title, style: extraStyle }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 44, height: 44, borderRadius: '50%',
        background: 'rgba(255,255,255,0.15)', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', cursor: 'pointer', backdropFilter: 'blur(6px)',
        flexShrink: 0, ...extraStyle,
      }}>
      {children}
    </button>
  );
}

// ─── Active Quiz Panel ────────────────────────────────────────────────────────
function ActiveQuizPanel({ quiz, answers, onEnd }) {
  const LABELS = ['A', 'B', 'C', 'D'];
  return (
    <div style={{
      background: 'rgba(127,32,32,0.18)',
      border: `1px solid ${C.maroon}`,
      borderRadius: 12, padding: '10px 12px',
      width: '100%',
    }}>
      {/* Question row */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', gap: 10, marginBottom: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: C.amber, marginBottom: 3,
          }}>
            Quiz Active
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.cream, lineHeight: 1.4 }}>
            {quiz.question}
          </div>
          {/* Options summary */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5,
          }}>
            {(quiz.options || []).map((opt, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 8,
                background: i === quiz.correctAnswer
                  ? 'rgba(31,168,85,0.25)' : 'rgba(255,255,255,0.07)',
                color: i === quiz.correctAnswer ? '#1FA855' : '#aaa',
                border: i === quiz.correctAnswer
                  ? '1px solid #1FA855' : '1px solid transparent',
                fontWeight: i === quiz.correctAnswer ? 700 : 400,
              }}>
                {LABELS[i]}: {opt}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onEnd}
          style={{
            background: C.maroon, border: 'none', borderRadius: 12,
            padding: '6px 12px', fontSize: 11, fontWeight: 700,
            color: '#fff', cursor: 'pointer', flexShrink: 0,
          }}>
          End Quiz
        </button>
      </div>

      {/* Leaderboard */}
      {answers.length > 0 && (
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: '#888', marginBottom: 4,
          }}>
            Top Answerers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {answers.map((a, idx) => {
              const ms = a.timeTakenMs || a.answeredAt
                ? (a.timeTakenMs
                    ? a.timeTakenMs
                    : (quiz.startedAt ? a.answeredAt - quiz.startedAt : null))
                : null;
              return (
                <div key={a.uid || a.id || idx} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: idx === 0 ? C.amber : 'rgba(255,255,255,0.1)',
                    color: idx === 0 ? C.maroon : '#aaa',
                    fontSize: 10, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: 12, color: C.cream, flex: 1, minWidth: 0 }}>
                    {a.userName || a.name || 'User'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#1FA855',
                    background: 'rgba(31,168,85,0.15)',
                    borderRadius: 6, padding: '1px 6px',
                  }}>
                    Correct
                  </span>
                  {ms != null && (
                    <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>
                      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quiz Creation Modal ──────────────────────────────────────────────────────
function QuizCreateModal({
  quizQuestion, setQuizQuestion,
  quizOptions, setQuizOptions,
  quizCorrectIdx, setQuizCorrectIdx,
  quizPoints,
  onLaunch, onCancel,
}) {
  const LABELS = ['A', 'B', 'C', 'D'];
  const canLaunch = quizQuestion.trim() && quizOptions.every((o) => o.trim());

  function setOption(i, val) {
    const next = [...quizOptions];
    next[i] = val;
    setQuizOptions(next);
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 80,
      background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px 16px',
    }}>
      <div style={{
        background: '#181010',
        border: `1px solid ${C.maroon}`,
        borderRadius: 18, padding: '22px 20px',
        width: '100%', maxWidth: 420,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Title */}
        <div style={{
          fontSize: 15, fontWeight: 800, color: C.amber,
          marginBottom: 16, textAlign: 'center',
          letterSpacing: '0.01em',
        }}>
          Create a Quiz Question
        </div>

        {/* Question input */}
        <div style={{ marginBottom: 14 }}>
          <label style={{
            display: 'block', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: '#888', marginBottom: 5,
          }}>
            Question
          </label>
          <textarea
            value={quizQuestion}
            onChange={(e) => setQuizQuestion(e.target.value)}
            placeholder="Type your question here..."
            rows={3}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${C.maroon}`,
              borderRadius: 10, padding: '10px 12px',
              color: C.cream, fontSize: 14, lineHeight: 1.45,
              outline: 'none', resize: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Options */}
        <div style={{ marginBottom: 14 }}>
          <label style={{
            display: 'block', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: '#888', marginBottom: 7,
          }}>
            Options &amp; Correct Answer
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quizOptions.map((opt, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {/* Radio button */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  cursor: 'pointer', flexShrink: 0,
                }}>
                  <input
                    type="radio"
                    name="quizCorrect"
                    checked={quizCorrectIdx === i}
                    onChange={() => setQuizCorrectIdx(i)}
                    style={{ accentColor: C.amber, width: 15, height: 15 }}
                  />
                </label>
                {/* Option label badge */}
                <span style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: quizCorrectIdx === i ? C.amber : 'rgba(255,255,255,0.1)',
                  color: quizCorrectIdx === i ? C.maroon : '#aaa',
                  fontSize: 11, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {LABELS[i]}
                </span>
                {/* Option text input */}
                <input
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${LABELS[i]}`}
                  style={{
                    flex: 1,
                    background: quizCorrectIdx === i
                      ? 'rgba(212,161,42,0.08)' : 'rgba(255,255,255,0.05)',
                    border: quizCorrectIdx === i
                      ? `1px solid ${C.amber}` : '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '7px 10px',
                    color: C.cream, fontSize: 13, outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Points display */}
        <div style={{
          background: 'rgba(212,161,42,0.08)',
          border: `1px solid rgba(212,161,42,0.2)`,
          borderRadius: 8, padding: '8px 12px',
          marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={C.amber}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span style={{ fontSize: 12, color: C.cream }}>
            <b style={{ color: C.amber }}>{quizPoints} points</b> per correct answer
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: '11px 0',
              fontSize: 13, fontWeight: 700,
              color: '#aaa', cursor: 'pointer',
            }}>
            Cancel
          </button>
          <button
            onClick={onLaunch}
            disabled={!canLaunch}
            style={{
              flex: 2, background: canLaunch ? C.amber : 'rgba(212,161,42,0.3)',
              border: 'none', borderRadius: 12, padding: '11px 0',
              fontSize: 13, fontWeight: 800,
              color: canLaunch ? C.maroon : '#888',
              cursor: canLaunch ? 'pointer' : 'not-allowed',
            }}>
            Launch Quiz
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Join Requests Panel ──────────────────────────────────────────────────────
function JoinRequestsPanel({
  open, onToggle,
  pendingReqs, waitlistReqs, connectedUsers,
  compUsed, compLimit, wishlistUsers,
  onAccept, onDecline, onPromote, onKick, onBlock, onMakeComp,
}) {
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!open || connectedUsers.length === 0) return undefined;
    const t = setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [open, connectedUsers.length]);

  const hasAnything = pendingReqs.length > 0 || waitlistReqs.length > 0
    || connectedUsers.length > 0;

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: 'rgba(10,10,10,0.97)',
      borderTop: `2px solid ${C.maroon}`,
      borderRadius: '16px 16px 0 0',
      transition: 'transform 0.25s ease',
      transform: open ? 'translateY(0)' : 'translateY(calc(100% - 44px))',
    }}>
      {/* Sheet handle / toggle */}
      <button onClick={onToggle} style={{
        width: '100%', padding: '10px 0 6px', background: 'transparent',
        border: 'none', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <span style={{
          width: 36, height: 4, background: 'rgba(255,255,255,0.2)',
          borderRadius: 2, display: 'block',
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.amber,
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Join Requests
          {(pendingReqs.length > 0) && (
            <span style={{
              marginLeft: 6, background: C.maroon, color: '#fff',
              borderRadius: 8, padding: '1px 6px', fontSize: 10, fontWeight: 800,
            }}>
              {pendingReqs.length}
            </span>
          )}
        </span>
        <span style={{
          width: 36, height: 4, background: 'rgba(255,255,255,0.2)',
          borderRadius: 2, display: 'block',
        }} />
      </button>

      {open && (
        <div style={{
          maxHeight: 280, overflowY: 'auto', padding: '0 12px 16px',
        }}>
          {!hasAnything && (
            <div style={{
              textAlign: 'center', color: '#555', fontSize: 12,
              padding: '20px 0',
            }}>
              No pending join requests
            </div>
          )}

          {/* Pending requests */}
          {pendingReqs.length > 0 && (
            <SectionLabel>Pending</SectionLabel>
          )}
          {pendingReqs.map((r) => {
            const wl = wishlistUsers.find((w) => w.uid === r.userId);
            return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 8px', borderRadius: 10,
                border: r.status === 'pending'
                  ? `1.5px solid ${C.amber}`
                  : '1px solid rgba(255,255,255,0.05)',
                animation: r.status === 'pending' ? 'reqPulse 1.6s ease-in-out infinite' : 'none',
                marginBottom: 4,
              }}>
                <Avatar name={r.userName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 13, fontWeight: 700, color: C.cream,
                  }}>
                    <span className="truncate">{r.userName}</span>
                    <IconCallType type={r.callType} />
                    {wl && (
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 2,
                        fontSize: 10, color: C.amber,
                      }}>
                        <IconWishlist />{wl.count || ''}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, color: '#888',
                    display: 'flex', alignItems: 'center', gap: 6, marginTop: 1,
                  }}>
                    <span>{r.status === 'astro_ok' ? 'Waiting on user...' : 'Wants to join'}</span>
                    <span style={{ color: C.amber }}>
                      {compUsed}/{compLimit} comp used this week
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {r.status === 'pending' && (
                    <>
                      <SheetBtn onClick={() => onAccept(r.id)} color="#1A6B3C">
                        Accept
                      </SheetBtn>
                      <SheetBtn onClick={() => onDecline(r.id)} color="rgba(255,255,255,0.1)">
                        Decline
                      </SheetBtn>
                      {compUsed < compLimit && (
                        <SheetBtn onClick={() => onMakeComp(r.id)} color="rgba(212,161,42,0.18)"
                          textColor={C.amber}>
                          Comp
                        </SheetBtn>
                      )}
                    </>
                  )}
                  {r.status === 'astro_ok' && (
                    <SheetBtn onClick={() => onDecline(r.id)} color="rgba(255,255,255,0.1)">
                      Cancel
                    </SheetBtn>
                  )}
                </div>
              </div>
            );
          })}

          {/* Connected users */}
          {connectedUsers.length > 0 && (
            <SectionLabel>Connected</SectionLabel>
          )}
          <div className="space-y-2">
            {connectedUsers.map((cu) => (
              <div key={cu.uid || cu.userId || cu.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderRadius: 12, padding: '8px 10px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  marginBottom: 6,
                }}>
                <div style={{
                  display: 'flex', width: 38, height: 38, flexShrink: 0,
                  alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', fontWeight: 700, color: '#fff',
                  background: C.maroon, fontSize: 15,
                }}>
                  {(cu.name || cu.userName || cu.displayName || 'U').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 700, color: C.cream, fontSize: 13,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {cu.name || cu.userName || cu.displayName || 'Guest'}
                  </div>
                  <div style={{ fontSize: 11, color: C.amber }}>
                    Connected {cu.connectedAt ? getElapsed(cu.connectedAt) : '--'}
                  </div>
                  <div style={{ fontSize: 10, color: '#aaa' }}>
                    {cu.callType === 'video' ? 'Video' : 'Audio'} call
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <SheetBtn
                    onClick={() => onKick(cu.uid || cu.userId || cu.id)}
                    color={C.maroon}>
                    Kick
                  </SheetBtn>
                  <SheetBtn
                    onClick={() => onBlock(cu.uid || cu.userId || cu.id)}
                    color="rgba(255,255,255,0.1)">
                    Block
                  </SheetBtn>
                </div>
              </div>
            ))}
          </div>

          {/* Waitlist */}
          {waitlistReqs.length > 0 && (
            <SectionLabel>Waitlist</SectionLabel>
          )}
          {waitlistReqs.map((r) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <Avatar name={r.userName} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.cream }}>
                  {r.userName}
                </div>
                <div style={{ fontSize: 10, color: '#888' }}>In queue</div>
              </div>
              <SheetBtn onClick={() => onPromote(r.id)} color="#1A6B3C">
                Accept Now
              </SheetBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: '#555',
      padding: '10px 0 4px',
    }}>
      {children}
    </div>
  );
}

function SheetBtn({ children, onClick, color, textColor }) {
  return (
    <button onClick={onClick} style={{
      background: color || 'rgba(255,255,255,0.1)',
      border: 'none', borderRadius: 12,
      padding: '4px 10px', fontSize: 11, fontWeight: 700,
      color: textColor || '#fff', cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}

// ─── Pre-live screen ──────────────────────────────────────────────────────────
function PreLiveScreen({
  astro, sched, mode, setMode, liveTitle, setLiveTitle, schedTitle,
  setSchedTitle, schedAt, setSchedAt, starting, start, schedule,
  cancelSched, history,
}) {
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const todays = (history || [])
    .filter((h) => (h.ts || 0) >= sod.getTime())
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const done   = todays.filter((h) => h.status !== 'cancelled');
  const totSec = done.reduce((a, h) => a + (h.durationSec || 0), 0);

  return (
    <Layout>
      {/* Hero card */}
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
          <div className="text-xs font-bold uppercase tracking-wider text-sub-text">
            Go Live
          </div>
          <div className="truncate text-lg font-bold text-dark-text">
            {astro?.name || 'Astrologer'}
          </div>
          <p className="text-[12px] text-sub-text">
            Stream a live consultation to your followers. Going live
            notifies them instantly.
          </p>
        </div>
      </div>

      {/* Scheduled (if any) */}
      {sched && (
        <div className="card mt-3 border border-primary/30 bg-primary/5">
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

      {/* Tabs */}
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
              {starting ? 'Starting...' : 'Go Live Now'}
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
            <button onClick={schedule} className="btn-primary w-full">
              Schedule &amp; notify followers
            </button>
            <p className="text-[11px] text-sub-text">
              Scheduling notifies your followers and shows a countdown
              in their app.
            </p>
          </div>
        )}
      </div>

      {/* Today's activity */}
      <div className="card mt-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-dark-text">
              Today's live activity
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
                  className="rounded-card border border-gray-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-dark-text">
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
                      <>Started {fmtWhen(h.startedAtMs)} | Ended {fmtWhen(h.endedAtMs)}</>
                    )}
                  </div>
                  {!cancelled && (
                    <div className="text-[12px] text-sub-text">
                      Duration <b>{fmtDur(h.durationSec)}</b>
                      {' '}| {h.viewers || 0} viewers
                      {' '}| {h.likes || 0} likes
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
