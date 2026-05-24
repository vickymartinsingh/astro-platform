import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { sessionService, userService } from '@astro/shared';
import { useAuth } from '../lib/useAuth';

// Floating "current session" bar. Appears ONLY while the signed-in
// customer has a live consultation (requesting / accepted / active) and
// they're NOT already on that session's screen - so if they accidentally
// leave a chat/call they can jump back, cancel, or end it. Sits just
// above the bottom navigation bar; hidden entirely when there's nothing
// active.
const TYPE_LABEL = { chat: 'Chat', call: 'Voice call', video: 'Video call' };
const TYPE_ICON = { chat: '💬', call: '📞', video: '📹' };

export default function ActiveSessionBar() {
  const { user } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState([]);
  const [astroName, setAstroName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setSessions([]); return undefined; }
    return sessionService.listenActiveForUser(user.uid, setSessions);
  }, [user && user.uid]);

  const s = sessions[0] || null;

  useEffect(() => {
    if (!s || !s.astroId) { setAstroName(''); return; }
    userService.getUser(s.astroId)
      .then((a) => setAstroName((a && (a.name)) || 'Astrologer'))
      .catch(() => setAstroName('Astrologer'));
  }, [s && s.astroId]);

  if (!s) return null;

  // Don't show while the user is already on this session's screen.
  const path = router.asPath || '';
  const onThisSession = (path.includes(`/call/${s.astroId}`)
    || path.includes(`/chat/${s.astroId}`));
  if (onThisSession) return null;

  const join = () => {
    // Always pass ?resume=<sid> so useSession reuses THIS live session
    // (instead of starting a fresh one + re-sending the intro/kundli).
    // The listener gives us `s.id`; `s.sessionId` is undefined here.
    const sid = s.id || s.sessionId;
    const q = sid ? `resume=${encodeURIComponent(sid)}` : '';
    const sep = q ? '?' : '';
    if (s.type === 'chat') {
      router.push(`/chat/${s.astroId}${sep}${q}`);
    } else {
      const t = s.type === 'video' ? 'video' : 'call';
      router.push(`/call/${s.astroId}?type=${t}${q ? `&${q}` : ''}`);
    }
  };
  const cancel = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Cancel this consultation request?')) return;
    setBusy(true);
    try { await sessionService.updateSessionStatus(s.id, 'cancelled'); }
    catch (_) {}
    setBusy(false);
  };
  const end = async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('End this consultation now?')) return;
    setBusy(true);
    try { await sessionService.endAndSettleClient(s.id); } catch (_) {}
    try { await sessionService.endSession(s.id); } catch (_) {}
    setBusy(false);
  };

  const isRequesting = s.status === 'requesting';

  return (
    <div
      className="fixed inset-x-0 z-40 px-2 md:px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}>
      <div className="mx-auto flex max-w-3xl items-center gap-2
        rounded-2xl border border-emerald-300 bg-white px-3 py-2
        shadow-lg">
        <span className="text-xl">{TYPE_ICON[s.type] || '✨'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-dark-text">
            {isRequesting ? 'Connecting' : 'Ongoing'} ·{' '}
            {TYPE_LABEL[s.type] || 'Session'}
          </div>
          <div className="truncate text-xs text-sub-text">
            {astroName || 'Astrologer'}
            {isRequesting ? ' - waiting to accept…' : ' - tap Join'}
          </div>
        </div>
        {!isRequesting && (
          <button onClick={join} disabled={busy}
            className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm
              font-bold text-white disabled:opacity-50">
            Join
          </button>
        )}
        {isRequesting ? (
          <button onClick={cancel} disabled={busy}
            className="rounded-full border border-danger px-3 py-1.5
              text-sm font-semibold text-danger disabled:opacity-50">
            Cancel
          </button>
        ) : (
          <button onClick={end} disabled={busy}
            className="rounded-full bg-danger px-3 py-1.5 text-sm
              font-bold text-white disabled:opacity-50">
            End
          </button>
        )}
      </div>
    </div>
  );
}
