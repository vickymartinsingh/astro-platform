import { useEffect, useState } from 'react';
import {
  sessionService, astrologerService, db,
} from '@astro/shared';
import {
  collection, query, where, getDocs,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleDateString([], {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch (_) { return ''; }
}
function fmtTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return ''; }
}
function fmtDuration(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export default function ChatHistory() {
  const { user, loading } = useRequireClient();
  const { go } = useAstroActions();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Session-based history (one row per completed chat). Matches
      // the structure of /call-history so dates / times / durations /
      // amounts stay consistent across both screens. Newest first.
      const all = await sessionService.getUserSessions(user.uid);
      const chats = all
        .filter((s) => s.type === 'chat' && s.status === 'ended')
        .sort((a, b) => {
          const at = a.startTime?.toMillis?.() || 0;
          const bt = b.startTime?.toMillis?.() || 0;
          return bt - at;
        });
      // Pull every recording doc owned by this user in one query, then
      // index by sessionId so each row can show its recording inline.
      let recsBySession = {};
      try {
        const recSnap = await getDocs(query(
          collection(db, 'chats'),
          where('isRecordingDoc', '==', true),
          where('userId', '==', user.uid)));
        recsBySession = recSnap.docs.reduce((acc, d) => {
          const r = d.data();
          if (r && r.sessionId && r.url) acc[r.sessionId] = r;
          return acc;
        }, {});
      } catch (_) { /* recordings are best-effort */ }
      const enriched = await Promise.all(chats.map(async (s) => {
        const rec = recsBySession[s.id];
        return {
          ...s,
          astro: await astrologerService.getAstrologer(s.astroId),
          recordingUrl: rec ? rec.url : null,
          recordingKind: rec ? rec.kind : null,
        };
      }));
      setRows(enriched);
    })();
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Chat History</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState
          message="No chats yet. Start your first consultation 🔮" />
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <div key={s.id}
              className="card flex w-full flex-wrap items-start gap-3
                text-left">
              {/* Avatar */}
              <img src={s.astro?.profileImage || '/avatar.png'}
                className="h-12 w-12 shrink-0 rounded-full object-cover
                  bg-bg-light" alt="" />
              {/* Astrologer + metadata. min-w-0 lets the parent
                  flex-wrap so the name uses the FULL width on narrow
                  viewports instead of wrapping to 2 lines next to the
                  avatar. */}
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-dark-text">
                  {s.astro?.name || 'Astrologer'}
                </div>
                <div className="mt-0.5 text-xs uppercase tracking-wide
                  text-sub-text">
                  Chat consultation
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1
                  text-sm text-dark-text sm:grid-cols-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide
                      text-sub-text">Date</div>
                    <div className="font-semibold">
                      {fmtDate(s.startTime || s.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide
                      text-sub-text">Time</div>
                    <div className="font-semibold">
                      {fmtTime(s.startTime || s.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide
                      text-sub-text">Duration</div>
                    <div className="font-semibold">
                      {fmtDuration(s.duration)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide
                      text-sub-text">Amount</div>
                    <div className="font-semibold">
                      {s.cost > 0 ? `₹${s.cost}` : 'Free'}
                    </div>
                  </div>
                </div>
              </div>
              {/* Actions: View conversation + Chat again. Wrap below
                  the metadata on narrow viewports so the buttons
                  never squeeze the name column. */}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <a href={`/chat/${s.astroId}?view=1`}
                  className="rounded-full border border-primary px-4 py-2
                    text-sm font-semibold text-primary">
                  View
                </a>
                {s.astro && (
                  <button onClick={() => go('chat', s.astro)}
                    className="rounded-full bg-primary px-4 py-2 text-sm
                      font-semibold text-white">
                    Chat again
                  </button>
                )}
              </div>
              {/* Recording playback (if captured during this chat).
                  Audio for chat sessions covers voice notes; for the
                  pure-text chat the row is hidden silently. */}
              {s.recordingUrl && (
                <div className="basis-full pt-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide
                    text-sub-text">Recording</div>
                  {s.recordingKind === 'video' ? (
                    <video src={s.recordingUrl} controls preload="none"
                      className="w-full rounded-card bg-black" />
                  ) : (
                    <audio src={s.recordingUrl} controls preload="none"
                      className="w-full" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
