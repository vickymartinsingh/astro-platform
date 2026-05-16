import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  sessionService, astrologerService, userService,
} from '@astro/shared';

// Blueprint 5.6, incoming request popup, 60s countdown, one at a time.
export default function IncomingRequest({ uid, isOnCall }) {
  const router = useRouter();
  const [req, setReq] = useState(null);
  const [client, setClient] = useState(null);
  const [left, setLeft] = useState(60);

  useEffect(() => {
    if (!uid) return;
    return sessionService.listenIncomingRequests(uid, (list) => {
      setReq(isOnCall ? null : (list[0] || null));
    });
  }, [uid, isOnCall]);

  useEffect(() => {
    if (!req) return;
    userService.getUser(req.userId).then(setClient);
    const start = req.createdAt?.toDate
      ? req.createdAt.toDate().getTime() : Date.now();
    const t = setInterval(() => {
      const l = 60 - Math.floor((Date.now() - start) / 1000);
      setLeft(l);
      if (l <= 0) {
        sessionService.updateSessionStatus(req.id, 'missed').catch(() => {});
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [req]);

  // Ring while a request is pending (WebAudio beep, no asset needed).
  useEffect(() => {
    if (!req) return;
    let ctx; let stopped = false; let timer;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const beep = () => {
        if (stopped) return;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880; o.type = 'sine';
        g.gain.value = 0.0001;
        o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime;
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
        timer = setTimeout(beep, 1400);
      };
      beep();
    } catch (_) {}
    return () => {
      stopped = true; clearTimeout(timer);
      try { ctx && ctx.close(); } catch (_) {}
    };
  }, [req]);

  if (!req) return null;

  async function accept() {
    await sessionService.updateSessionStatus(req.id, 'active',
      { startTime: new Date() });
    await astrologerService.updateAvailability(uid, { status: 'busy' });
    router.push(`/astro-session/${req.id}`);
  }
  async function reject() {
    await sessionService.updateSessionStatus(req.id, 'rejected');
    setReq(null);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center
                    px-4" style={{ background: 'rgba(15,10,35,.85)' }}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white
                      text-center shadow-2xl">
        <div className="hero-grad p-5 text-white">
          <div className="text-xs uppercase tracking-wide opacity-80">
            Incoming {req.type} request
          </div>
          <div className="mt-2 text-2xl font-bold">
            {client?.name || 'Client'}
          </div>
          {req.purpose && (
            <div className="mt-1 text-sm opacity-90">
              Purpose: {req.purpose}
            </div>
          )}
        </div>
        <div className="p-6">
          <div className="mx-auto flex h-20 w-20 items-center justify-center
                          rounded-full border-4 border-bg-light
                          border-t-primary text-2xl font-bold text-primary">
            {Math.max(0, left)}
          </div>
          <p className="mt-2 text-xs text-sub-text">
            Auto-misses if not answered
          </p>
          <div className="mt-5 flex gap-3">
            <button onClick={reject}
              className="flex-1 rounded-full border border-danger py-3
                         font-semibold text-danger">
              Reject
            </button>
            <button onClick={accept}
              className="btn-grad flex-1 justify-center py-3">
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
