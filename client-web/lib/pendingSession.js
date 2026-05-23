import {
  createContext, useContext, useEffect, useState, useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { sessionService } from '@astro/shared';
import { confirmModal } from '../components/ConfirmModal';

// Tracks the user's current/active session. A floating bar stays pinned
// across every page (body portal so no layout hides it) ALWAYS while a
// session is requesting/active, showing a live timer plus Join back and
// Cancel. Tapping it rejoins the exact session (?resume=).
const Ctx = createContext({ track: () => {}, clear: () => {} });

export function PendingSessionProvider({ children }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [info, setInfo] = useState(null); // {sessionId,astroId,astroName,type}
  const [status, setStatus] = useState('requesting');
  const [left, setLeft] = useState(60);
  const [elapsed, setElapsed] = useState(0);
  const startMsRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  function track(i) {
    if (!i || !i.sessionId) return;
    setInfo((prev) => {
      if (prev && prev.sessionId === i.sessionId) return prev;
      setStatus('requesting'); setLeft(60); setElapsed(0);
      startMsRef.current = 0;
      return i;
    });
  }
  function clear() { setInfo(null); }

  // Live session status + start time.
  useEffect(() => {
    if (!info?.sessionId) return undefined;
    return sessionService.listenSession(info.sessionId, (s) => {
      if (!s) return;
      if (s.status) setStatus(s.status);
      const ms = s.startTime?.toMillis ? s.startTime.toMillis()
        : (s.startTime instanceof Date ? s.startTime.getTime() : 0);
      startMsRef.current = ms || 0;
    });
  }, [info?.sessionId]);

  // Countdown while requesting; mark missed at 0.
  useEffect(() => {
    if (!info || status !== 'requesting') return undefined;
    const t = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          sessionService.updateSessionStatus(info.sessionId, 'missed')
            .catch(() => {});
          clearInterval(t);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [info, status]);

  // Ticking elapsed timer once connected.
  const connected = status === 'accepted' || status === 'active';
  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => {
      const base = startMsRef.current;
      setElapsed(base
        ? Math.max(0, Math.floor((Date.now() - base) / 1000)) : 0);
    }, 1000);
    return () => clearInterval(t);
  }, [connected]);

  function join() {
    const i = info;
    if (!i) return;
    setInfo(null);
    const q = `resume=${i.sessionId}`;
    router.push(i.type === 'chat'
      ? `/chat/${i.astroId}?${q}`
      : `/call/${i.astroId}?type=${
        i.type === 'video' ? 'video' : 'call'}&${q}`);
  }

  async function cancelOrEnd() {
    const i = info;
    if (!i) return;
    if (connected) {
      const ok = await confirmModal({
        title: 'End this consultation?',
        message: 'You will be disconnected from the astrologer. Charges '
          + 'for time spent so far still apply.',
        yes: 'End now',
        no: 'Keep going',
        danger: true,
      });
      if (!ok) return;
      try { await sessionService.endAndSettleClient(i.sessionId); }
      catch (_) {
        try {
          await sessionService.updateSessionStatus(i.sessionId, 'ended');
        } catch (e) {}
      }
      try { await sessionService.endSession(i.sessionId); } catch (_) {}
    } else {
      sessionService.updateSessionStatus(i.sessionId, 'cancelled')
        .catch(() => {});
    }
    clear();
  }

  // Auto-dismiss the bar once the session is over.
  useEffect(() => {
    if (['ended', 'rejected', 'missed', 'cancelled'].includes(status)) {
      const t = setTimeout(() => setInfo(null), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status]);

  const overEl = status === 'rejected' || status === 'missed'
    || status === 'ended' || status === 'cancelled';
  const mm = `${Math.floor(left / 60)}:` +
    `${String(left % 60).padStart(2, '0')}`;
  const el = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:` +
    `${String(elapsed % 60).padStart(2, '0')}`;
  // Hide only while actually on THIS session's own screen.
  const onOwnScreen = info
    && new RegExp(`^/(chat|call)/${info.astroId}(\\?|$|/)`)
      .test(router.asPath);

  const bar = (info && !onOwnScreen) ? (
    <div className="fixed inset-x-0 bottom-[76px] z-[2147483645] flex
                    justify-center px-3 md:bottom-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl
        bg-primary px-3 py-2.5 text-white shadow-2xl ring-1
        ring-black/10">
        {!overEl && !connected && (
          <span className="h-7 w-7 shrink-0 animate-spin rounded-full
                           border-2 border-white/40 border-t-white" />
        )}
        {connected && (
          <span className="flex h-9 w-9 shrink-0 items-center
            justify-center rounded-full bg-white/20 text-[11px]
            font-bold">{el}</span>
        )}
        <button onClick={() => { if (!overEl) join(); }}
          className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-semibold">
            {info.astroName || 'Astrologer'}
          </div>
          <div className="text-xs text-white/85">
            {connected
              ? `In ${info.type || 'session'} - ${el} - tap to rejoin`
              : overEl
                ? 'Session ended.'
                : `Waiting for the astrologer ${mm} - tap to return`}
          </div>
        </button>
        {connected && (
          <button onClick={join}
            className="shrink-0 rounded-full bg-white px-3 py-1.5
              text-sm font-bold text-primary">Join</button>
        )}
        {overEl ? (
          <button onClick={clear}
            className="shrink-0 rounded-full border border-white/40
                       px-3 py-1.5 text-sm">Close</button>
        ) : (
          <button onClick={cancelOrEnd}
            className="shrink-0 rounded-full border border-white/50
              px-3 py-1.5 text-sm">
            {connected ? 'End' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <Ctx.Provider value={{ track, clear }}>
      {children}
      {mounted && bar ? createPortal(bar, document.body) : null}
    </Ctx.Provider>
  );
}

export function usePendingSession() { return useContext(Ctx); }
