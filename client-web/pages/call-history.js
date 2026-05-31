import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
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

function fmt(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    return d ? d.toLocaleString() : '';
  } catch (_) { return ''; }
}
function clock(secs) {
  const s = Math.max(0, Math.round(secs || 0));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function CallHistory() {
  const { user, loading } = useRequireClient();
  const router = useRouter();
  const { go } = useAstroActions();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all = await sessionService.getUserSessions(user.uid);
      const calls = all.filter((s) =>
        ['call', 'video'].includes(s.type) && s.status === 'ended');
      // Pull recording docs for THIS user only (chats/ collection,
      // isRecordingDoc:true, userId matches) so we can show a player
      // per call. Single query - then we index by sessionId in memory.
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
      } catch (_) { /* index missing or rules deny - hide silently */ }
      const enriched = await Promise.all(calls.map(async (s) => {
        const rec = recsBySession[s.id];
        return {
          ...s,
          astro: await astrologerService.getAstrologer(s.astroId),
          recordingUrl: rec ? rec.url : null,
          recordingKind: rec ? rec.kind : null,
          recordingSize: rec ? rec.sizeKB : null,
        };
      }));
      setRows(enriched);
    })();
  }, [user]);

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Call History</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No calls yet. Start your first consultation 🔮" />
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id}
              className="card flex w-full flex-wrap items-center gap-3
                text-left">
              <button onClick={() => router.push(
                `/chat/${s.astroId}?view=1`)}
                className="flex min-w-0 flex-1 items-center gap-3
                  text-left">
                <img src={s.astro?.profileImage || '/avatar.png'}
                  className="h-12 w-12 rounded-full object-cover
                    bg-bg-light" alt="" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {s.type === 'video' ? 'Video call' : 'Voice call'}
                    {' with '}{s.astro?.name || 'Astrologer'}
                  </div>
                  <div className="text-sm text-sub-text">
                    Duration {clock(s.duration)} · ₹{s.cost || 0}
                  </div>
                  <div className="text-xs text-sub-text">
                    {s.startTime
                      ? <>From {fmt(s.startTime)}{s.endTime
                        ? ` to ${fmt(s.endTime)}` : ''}</>
                      : fmt(s.createdAt)}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold
                    text-primary">
                    Tap to view conversation
                  </div>
                </div>
              </button>
              {/* Recording playback. recordingUrl is hydrated by
                  enriching each row with the matching chats/ doc that
                  carries isRecordingDoc: true + sessionId. The audio
                  element streams directly from Firebase Storage so we
                  never download the file ahead of time. Hidden when
                  no recording exists (older sessions / failed upload). */}
              {s.recordingUrl && (
                <div className="basis-full pt-2">
                  <div className="mb-1 text-xs font-semibold text-sub-text">
                    Recording
                    {s.recordingKind === 'video' ? ' (video)' : ' (audio)'}
                  </div>
                  {s.recordingKind === 'video' ? (
                    <video src={s.recordingUrl} controls preload="none"
                      className="w-full rounded-card bg-black" />
                  ) : (
                    <audio src={s.recordingUrl} controls preload="none"
                      className="w-full" />
                  )}
                </div>
              )}
              {s.astro && (
                <button onClick={() => go(s.type, s.astro)}
                  className="shrink-0 rounded-full bg-primary px-4 py-2
                    text-sm font-semibold text-white">
                  {s.type === 'video' ? 'Video again' : 'Call again'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
