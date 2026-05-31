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
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="card flex w-full gap-3 p-3">
              {/* Compact avatar */}
              <img src={s.astro?.profileImage || '/avatar.png'}
                className="h-10 w-10 shrink-0 rounded-full object-cover
                  bg-bg-light" alt="" />
              {/* Centre column: Name on top, then Date | Time row,
                  then Duration | Amount row. Each label is tiny
                  uppercase + tight value below for a neat scannable
                  block - the whole metadata stack fits in ~80 px so
                  the card stays small. */}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-bold text-dark-text">
                  {s.astro?.name || 'Astrologer'}
                </div>
                <div className="mt-1.5 flex items-baseline gap-4
                  text-xs text-dark-text">
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase
                      tracking-wide text-sub-text">Date</span>
                    <span className="font-semibold">
                      {fmtDate(s.startTime || s.createdAt) || '-'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase
                      tracking-wide text-sub-text">Time</span>
                    <span className="font-semibold">
                      {fmtTime(s.startTime || s.createdAt) || '-'}
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-baseline gap-4
                  text-xs text-dark-text">
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase
                      tracking-wide text-sub-text">Duration</span>
                    <span className="font-semibold">
                      {fmtDuration(s.duration) || '-'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase
                      tracking-wide text-sub-text">Amount</span>
                    <span className="font-semibold">
                      {s.cost > 0 ? `₹${s.cost}` : 'Free'}
                    </span>
                  </div>
                </div>
                {s.recordingUrl && (
                  <div className="mt-2">
                    {s.recordingKind === 'video' ? (
                      <video src={s.recordingUrl} controls preload="none"
                        className="w-full rounded-card bg-black" />
                    ) : (
                      <audio src={s.recordingUrl} controls preload="none"
                        className="h-8 w-full" />
                    )}
                  </div>
                )}
              </div>
              {/* Right column: stacked compact actions so they never
                  squeeze the metadata grid. */}
              <div className="flex shrink-0 flex-col items-end
                justify-center gap-1.5">
                <a href={`/chat/${s.astroId}?view=1`}
                  className="rounded-full border border-primary px-3 py-1
                    text-xs font-semibold text-primary">
                  View
                </a>
                {s.astro && (
                  <button onClick={() => go('chat', s.astro)}
                    className="rounded-full bg-primary px-3 py-1
                      text-xs font-semibold text-white">
                    Chat again
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
