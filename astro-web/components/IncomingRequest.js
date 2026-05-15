import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { sessionService, astrologerService, userService } from '@astro/shared';

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

  if (!req) return null;

  async function accept() {
    await sessionService.updateSessionStatus(req.id, 'active', {
      startTime: new Date(),
    });
    await astrologerService.updateAvailability(uid, { status: 'busy' });
    router.push(`/astro-session/${req.id}`);
  }
  async function reject() {
    await sessionService.updateSessionStatus(req.id, 'rejected');
    setReq(null);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center
                    justify-center bg-primary px-6 text-center text-white">
      <div className="text-sm uppercase tracking-wide opacity-80">
        Incoming {req.type} request
      </div>
      <div className="mt-4 text-3xl font-bold">
        {client?.name || 'Client'}
      </div>
      {req.purpose && (
        <div className="mt-2 opacity-90">Purpose: {req.purpose}</div>
      )}
      <div className="mt-6 text-5xl font-bold">{Math.max(0, left)}</div>
      <div className="mt-8 flex gap-6">
        <button onClick={reject}
          className="h-16 w-16 rounded-full bg-danger text-2xl">✕</button>
        <button onClick={accept}
          className="h-16 w-16 rounded-full bg-success text-2xl">✓</button>
      </div>
    </div>
  );
}
