import {
  createContext, useContext, useEffect, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { sessionService } from '@astro/shared';

// Tracks a session the user "minimised" by pressing Continue browsing.
// A floating bar stays pinned to the bottom across every page (rendered
// in a body portal so no layout can hide it) showing the live timer /
// connected / unavailable state. Tapping it returns to the chat/call.
const Ctx = createContext({ track: () => {}, clear: () => {} });

export function PendingSessionProvider({ children }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [info, setInfo] = useState(null);   // {sessionId,astroId,astroName,type}
  const [status, setStatus] = useState('requesting');
  const [left, setLeft] = useState(60);

  useEffect(() => { setMounted(true); }, []);

  function track(i) {
    if (!i || !i.sessionId) return;
    setInfo(i); setStatus('requesting'); setLeft(60);
  }
  function clear() { setInfo(null); }

  // Live session status.
  useEffect(() => {
    if (!info?.sessionId) return;
    return sessionService.listenSession(info.sessionId, (s) => {
      if (s?.status) setStatus(s.status);
    });
  }, [info?.sessionId]);

  // Countdown while requesting; mark missed at 0 (no Cloud Function needed).
  useEffect(() => {
    if (!info || status !== 'requesting') return;
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

  function join() {
    const i = info;
    setInfo(null);
    if (!i) return;
    router.push(i.type === 'chat'
      ? `/chat/${i.astroId}`
      : `/call/${i.astroId}?type=${i.type === 'video' ? 'video' : 'call'}`);
  }

  const connected = status === 'accepted' || status === 'active';
  const overEl = status === 'rejected' || status === 'missed'
    || status === 'ended';
  const mm = `${Math.floor(left / 60)}:` +
    `${String(left % 60).padStart(2, '0')}`;
  // Hide only while actually on THIS session's own screen.
  const onOwnScreen = info &&
    new RegExp(`^/(chat|call)/${info.astroId}(\\?|$|/)`).test(router.asPath);

  const bar = (info && !onOwnScreen) ? (
    <div className="fixed inset-x-0 bottom-4 z-[2147483645] flex
                    justify-center px-3">
      <div className="surface flex w-full max-w-md items-center gap-3 p-3
                      shadow-2xl ring-1 ring-black/5">
        {!overEl && !connected && (
          <span className="h-7 w-7 shrink-0 animate-spin rounded-full
                           border-2 border-bg-light border-t-primary" />
        )}
        <button onClick={() => { if (!overEl) join(); }}
          className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-semibold">
            {info.astroName || 'Astrologer'}
          </div>
          <div className="text-xs text-sub-text">
            {connected
              ? 'Connected. Tap to join the chat.'
              : overEl
                ? 'Unavailable right now.'
                : `Waiting for the astrologer. ${mm}. Tap to return.`}
          </div>
        </button>
        {connected && (
          <button onClick={join} className="btn-grad shrink-0">Join</button>
        )}
        {overEl ? (
          <button onClick={clear}
            className="shrink-0 rounded-full border border-gray-200
                       px-3 py-2 text-sm">Close</button>
        ) : !connected && (
          <button onClick={() => {
            sessionService.updateSessionStatus(info.sessionId, 'ended')
              .catch(() => {});
            clear();
          }} className="shrink-0 rounded-full border border-gray-200
                        px-3 py-2 text-sm">Cancel</button>
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
