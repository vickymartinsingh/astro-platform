import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { liveService } from '@astro/shared';
import Layout from '../components/Layout';

// "Live" tab: ONLY astrologers who are live streaming right now.
export default function LivePage() {
  const router = useRouter();
  const [lives, setLives] = useState(null);

  useEffect(() => liveService.listenLiveAstrologers(
    (l) => setLives(l)), []);

  return (
    <Layout>
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
