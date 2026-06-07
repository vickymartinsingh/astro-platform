import { useEffect, useState } from 'react';
import {
  sessionService, astrologerService, db,
} from '@astro/shared';
import {
  collection, query, where, getDocs,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import AudioPlayer from '../components/AudioPlayer';
import SupportTicketModal from '../components/SupportTicketModal';
import { useRequireClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';

// Unified consultation history. Replaces the old separate
// /chat-history + /call-history screens. One row per ended session
// regardless of channel (chat / voice / video), tagged with a small
// icon so the customer can scan their full history at a glance.
// dd-Mmm-Yyyy (e.g. "31-May-2026"). Matches the format the user
// asked for - full four-digit year, hyphen-separated, locale-stable.
function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mmm = d.toLocaleString('en-US', { month: 'short' });
    const yyyy = d.getFullYear();
    return `${dd}-${mmm}-${yyyy}`;
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

const TYPE_LABEL = { chat: 'Chat', call: 'Voice call', video: 'Video call' };

// Inline SVG icons - one per session type. Stay monochrome so they
// inherit text-primary cleanly.
function TypeIcon({ type, className = 'h-3.5 w-3.5' }) {
  if (type === 'video') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <path d="M15 10l7-4v12l-7-4M3 6h12v12H3z" />
      </svg>
    );
  }
  if (type === 'call') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07
          19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2
          h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11
          L8 10a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34
          1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }
  // Chat (default)
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function Consultations() {
  const { user, profile, loading } = useRequireClient();
  const { go } = useAstroActions();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all'); // all | chat | call | video
  // 2026-06-07: per-session Help / Support ticket popup.
  const [supportFor, setSupportFor] = useState(null); // session | null

  useEffect(() => {
    if (!user) return;
    (async () => {
      const all = await sessionService.getUserSessions(user.uid);
      const ended = all
        .filter((s) => s.status === 'ended')
        .sort((a, b) => {
          const at = a.startTime?.toMillis?.() || 0;
          const bt = b.startTime?.toMillis?.() || 0;
          return bt - at;
        });
      // Pull every recording for THIS user in ONE query. We filter by
      // userId only (single equality - no composite index needed),
      // then post-filter for isRecordingDoc in JS. The previous
      // double-equality query silently failed for any project
      // without a composite index on (userId, isRecordingDoc),
      // which is exactly why the recording player wasn't showing
      // up on call rows.
      let recsBySession = {};
      try {
        const recSnap = await getDocs(query(
          collection(db, 'chats'),
          where('userId', '==', user.uid)));
        recsBySession = recSnap.docs.reduce((acc, d) => {
          const r = d.data();
          if (r && r.isRecordingDoc && r.sessionId && r.url) {
            acc[r.sessionId] = r;
          }
          return acc;
        }, {});
      } catch (_) { /* best-effort - hide player if rules deny */ }
      const enriched = await Promise.all(ended.map(async (s) => {
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

  const shown = (rows || []).filter((s) =>
    filter === 'all' || s.type === filter);

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Consultation history</h1>
      <p className="mb-3 text-xs text-sub-text">
        Every chat, voice and video session you have had with our
        astrologers. Call recordings play back inline.
      </p>

      {/* Type filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[
          ['all', 'All'],
          ['chat', 'Chat'],
          ['call', 'Voice'],
          ['video', 'Video'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === k
                ? 'bg-primary text-white'
                : 'bg-white text-dark-text border border-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {rows == null ? (
        <SkeletonList />
      ) : shown.length === 0 ? (
        <EmptyState
          message="No consultations yet. Start your first one 🔮" />
      ) : (
        <div className="space-y-2">
          {shown.map((s) => {
            const isCall = s.type === 'call' || s.type === 'video';
            const repeatLabel = s.type === 'video' ? 'Video again'
              : s.type === 'call' ? 'Call again' : 'Chat again';
            return (
              <div key={s.id} className="card flex w-full gap-3 p-3">
                {/* Compact avatar */}
                <img src={s.astro?.profileImage || '/avatar.png'}
                  className="h-10 w-10 shrink-0 rounded-full
                    object-cover bg-bg-light" alt="" />
                {/* Centre column: name on top, then Date|Time,
                    then Duration|Amount. Player slides in below
                    when this is a call/video with a recording. */}
                <div className="min-w-0 flex-1 leading-tight">
                  {/* Name row: fully visible (no truncate). Name wraps
                      to a second line if needed; the type chip moves
                      below the name on narrow rows so it never pushes
                      the name into ellipsis. */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0
                      place-items-center rounded-full bg-bg-light
                      text-primary">
                      <TypeIcon type={s.type} />
                    </span>
                    <span className="break-words text-sm font-bold
                      leading-tight text-dark-text">
                      {s.astro?.name || 'Astrologer'}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold
                      uppercase tracking-wide text-sub-text">
                      {TYPE_LABEL[s.type] || 'Session'}
                    </span>
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
                  {/* Recording player only for calls / videos. Chat
                      has no audio - we never auto-record text chats.
                      When this is a call but no recording landed
                      (call older than the recording feature, or the
                      astrologer was on a browser that did not support
                      MediaRecorder), show a small "no recording yet"
                      hint so the user knows the row isn't bugged. */}
                  {isCall && (
                    <div className="mt-2">
                      {s.recordingUrl ? (
                        s.recordingKind === 'video' ? (
                          <video src={s.recordingUrl} controls
                            preload="none"
                            className="w-full rounded-card bg-black" />
                        ) : (
                          <AudioPlayer src={s.recordingUrl} />
                        )
                      ) : (
                        <div className="rounded-full bg-bg-light px-3
                          py-1 text-[11px] text-sub-text">
                          Recording not available for this call
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Right column: stacked compact actions. */}
                <div className="flex shrink-0 flex-col items-end
                  justify-center gap-1.5">
                  {s.type === 'chat' && (
                    <a href={`/chat/${s.astroId}?view=1`}
                      className="rounded-full border border-primary
                        px-3 py-1 text-xs font-semibold text-primary">
                      View
                    </a>
                  )}
                  {s.astro && (
                    <button onClick={() => go(s.type, s.astro)}
                      className="rounded-full bg-primary px-3 py-1
                        text-xs font-semibold text-white">
                      {repeatLabel}
                    </button>
                  )}
                  {/* Help / Support per-session. Always present so
                      the customer can raise an issue (no connect,
                      poor quality, wrong charge, refund, etc.). */}
                  <button onClick={() => setSupportFor(s)}
                    className="inline-flex items-center gap-1
                      rounded-full border border-primary/40 bg-white
                      px-2.5 py-1 text-[11px] font-semibold
                      text-primary hover:bg-primary/5">
                    <svg width="11" height="11" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor"
                      strokeWidth="2.4" strokeLinecap="round"
                      strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Get help
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <SupportTicketModal
        open={!!supportFor}
        kind="session"
        refId={supportFor ? supportFor.id : ''}
        refLabel={supportFor
          ? `${TYPE_LABEL[supportFor.type] || 'Session'} with `
            + `${supportFor.astro?.name || 'Astrologer'}`
          : ''}
        user={{ uid: user?.uid, profile }}
        onClose={() => setSupportFor(null)} />
    </Layout>
  );
}
