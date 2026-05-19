import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, astrologerService, userService,
} from '@astro/shared';

const TYPE_LABEL = {
  chat: 'Incoming chat', call: 'Incoming voice call',
  video: 'Incoming video call',
};

// Full-screen, phone-style incoming call (Accept / Decline) with a
// looping "dring dring" ringtone. 60s auto-miss, one at a time.
export default function IncomingRequest({ uid, isOnCall }) {
  const router = useRouter();
  const [req, setReq] = useState(null);
  const [client, setClient] = useState(null);
  const [dp, setDp] = useState('');
  const [left, setLeft] = useState(60);
  const ringRef = useRef(null);

  useEffect(() => {
    if (!uid) return undefined;
    return sessionService.listenIncomingRequests(uid, (list) => {
      setReq(isOnCall ? null : (list[0] || null));
    });
  }, [uid, isOnCall]);

  useEffect(() => {
    if (!req) return undefined;
    userService.getUser(req.userId).then((u) => {
      setClient(u); setDp((u && u.profileImage) || '');
    });
    const start = req.createdAt?.toDate
      ? req.createdAt.toDate().getTime() : Date.now();
    const t = setInterval(() => {
      const l = 60 - Math.floor((Date.now() - start) / 1000);
      setLeft(l);
      if (l <= 0) {
        sessionService.updateSessionStatus(req.id, 'missed')
          .catch(() => {});
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [req]);

  // Looping classic phone ring (two short tones, gap, repeat).
  useEffect(() => {
    if (!req) return undefined;
    let ctx;
    let stopped = false;
    let timer;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      ringRef.current = ctx;
      const tone = (at, dur) => {
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 1400;
        o2.type = 'sine'; o2.frequency.value = 1100;
        g.gain.value = 0.0001;
        o.connect(g); o2.connect(g); g.connect(ctx.destination);
        g.gain.exponentialRampToValueAtTime(0.32, at + 0.04);
        g.gain.setValueAtTime(0.32, at + dur - 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.start(at); o2.start(at);
        o.stop(at + dur); o2.stop(at + dur);
      };
      const ring = () => {
        if (stopped) return;
        const n = ctx.currentTime;
        tone(n, 0.4);
        tone(n + 0.6, 0.4);
        timer = setTimeout(ring, 2200); // "dring dring" ... pause ...
      };
      ring();
    } catch (_) { /* audio not available */ }
    return () => {
      stopped = true;
      clearTimeout(timer);
      try { ctx && ctx.close(); } catch (_) {}
    };
  }, [req]);

  if (!req) return null;

  async function accept() {
    const sid = req.id;
    try { ringRef.current && ringRef.current.close(); } catch (_) {}
    // Mark active (critical) - but a failure here must NOT throw an
    // unhandled rejection (that pops the boot error overlay = "crash").
    try {
      await sessionService.updateSessionStatus(sid, 'active',
        { startTime: new Date() });
    } catch (_) { /* status best-effort; still open the room */ }
    // Availability is purely cosmetic for the call - never block on it.
    try {
      await astrologerService.updateAvailability(uid, { status: 'busy' });
    } catch (_) { /* ignore */ }
    setReq(null);
    try { router.push(`/astro-session/${sid}`); }
    catch (_) {
      try { window.location.assign(`/astro-session/${sid}/`); }
      catch (e) {}
    }
  }
  async function reject() {
    const sid = req.id;
    try { ringRef.current && ringRef.current.close(); } catch (_) {}
    setReq(null);
    try {
      await sessionService.updateSessionStatus(sid, 'rejected');
    } catch (_) { /* ignore */ }
  }

  const name = client?.name || 'Customer';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="fixed inset-0 z-[2147483647] flex flex-col
      items-center justify-between bg-dark-text text-white"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 48px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 48px)',
      }}>
      <div className="flex flex-1 flex-col items-center justify-center
        gap-4 px-6 text-center">
        <div className="text-sm uppercase tracking-widest opacity-70">
          {TYPE_LABEL[req.type] || 'Incoming call'}
        </div>
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-full
            bg-white/20" />
          {dp ? (
            <img src={dp} alt={name}
              className="relative h-28 w-28 rounded-full object-cover
                ring-4 ring-white/30" />
          ) : (
            <span className="relative flex h-28 w-28 items-center
              justify-center rounded-full bg-primary text-5xl
              font-bold ring-4 ring-white/30">{initial}</span>
          )}
        </div>
        <div className="text-3xl font-bold">{name}</div>
        {req.purpose ? (
          <div className="max-w-xs text-sm opacity-80">
            {req.purpose}
          </div>
        ) : (
          <div className="text-sm opacity-70">
            is calling you on AstroSeer
          </div>
        )}
        <div className="mt-2 text-xs opacity-60">
          Auto-declines in {Math.max(0, left)}s
        </div>
      </div>

      <div className="flex w-full max-w-xs items-center
        justify-between px-4">
        <button onClick={reject} aria-label="Decline"
          className="flex flex-col items-center gap-2">
          <span className="flex h-16 w-16 items-center justify-center
            rounded-full bg-danger shadow-lg">
            <svg width="28" height="28" viewBox="0 0 24 24"
              fill="none" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <g transform="rotate(135 12 12)">
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3
                  19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1
                  4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5
                  2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                  2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
              </g>
            </svg>
          </span>
          <span className="text-sm">Decline</span>
        </button>
        <button onClick={accept} aria-label="Accept"
          className="flex flex-col items-center gap-2">
          <span className="flex h-16 w-16 items-center justify-center
            rounded-full bg-success shadow-lg">
            <svg width="28" height="28" viewBox="0 0 24 24"
              fill="none" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3
                19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1
                4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5
                2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1
                2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
            </svg>
          </span>
          <span className="text-sm">Accept</span>
        </button>
      </div>
    </div>
  );
}
