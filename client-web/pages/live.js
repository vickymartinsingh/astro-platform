import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { liveService } from '@astro/shared';
import Layout from '../components/Layout';

function countdown(ms) {
  const d = Math.max(0, ms - Date.now());
  const s = Math.floor(d / 1000);
  const dd = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (dd > 0) return `${dd}d ${hh}h ${mm}m`;
  if (hh > 0) return `${hh}h ${mm}m ${ss}s`;
  return `${mm}m ${ss}s`;
}
function whenStr(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

// "Live" tab: astrologers live right now, plus upcoming scheduled lives.
export default function LivePage() {
  const router = useRouter();
  const [lives, setLives] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [, setTick] = useState(0);

  useEffect(() => liveService.listenLiveAstrologers(
    (l) => setLives(l)), []);
  useEffect(() => liveService.listenScheduledLives(
    (l) => setUpcoming(l)), []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <Layout>
      {upcoming.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 text-lg font-bold">Upcoming lives</h2>
          <div className="space-y-2">
            {upcoming.map((u) => (
              <div key={u.id}
                className="surface flex items-center gap-3 p-3">
                {u.photo ? (
                  <img src={u.photo} alt={u.name}
                    className="h-12 w-12 shrink-0 rounded-full
                      object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center
                    justify-center rounded-full bg-primary/15
                    font-bold text-primary">
                    {(u.name || 'A').charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{u.name}</div>
                  <div className="line-clamp-1 text-xs text-sub-text">
                    {u.title || 'Live consultation'}
                  </div>
                  <div className="text-xs text-sub-text">
                    {whenStr(u.startAt)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-primary/15
                  px-3 py-1 text-xs font-bold text-primary">
                  in {countdown(u.startAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-2.5 w-2.5 animate-pulse rounded-full
                         bg-red-500" />
        <h1 className="text-lg font-bold">Live now</h1>
      </div>

      {lives == null ? (
        <div className="surface p-8 text-center text-sub-text">
          Loading...
        </div>
      ) : lives.length === 0 ? (
        <div className="surface p-8 text-center">
          <div className="text-base font-semibold">
            No astrologers are live right now
          </div>
          <p className="mt-1 text-sm text-sub-text">
            Please check back later, or talk to an astrologer directly.
          </p>
          <button onClick={() => router.push('/astrologers')}
            className="btn-primary mt-4">Browse astrologers</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {lives.map((l) => (
            <button key={l.id}
              onClick={() => router.push(`/live-view/${l.astroUid}`)}
              className="relative overflow-hidden rounded-2xl bg-black
                text-left text-white" style={{ aspectRatio: '3 / 4' }}>
              {l.photo ? (
                <img src={l.photo} alt={l.name}
                  className="absolute inset-0 h-full w-full object-cover
                             opacity-70" />
              ) : null}
              <span className="absolute left-2 top-2 rounded-full
                bg-red-600 px-2 py-0.5 text-[11px] font-bold">LIVE</span>
              <span className="absolute right-2 top-2 rounded-full
                bg-black/50 px-2 py-0.5 text-[11px]">
                {l.viewers || 0} watching
              </span>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t
                from-black/80 to-transparent p-3">
                <div className="font-bold">{l.name}</div>
                <div className="line-clamp-1 text-xs opacity-90">
                  {l.title || 'Live consultation'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Layout>
  );
}
