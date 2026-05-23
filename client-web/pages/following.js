import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { astrologerService, followService } from '@astro/shared';
import Layout from '../components/Layout';
import AstrologerCard from '../components/AstrologerCard';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { useSettings } from '../lib/useSettings';

// Astrologers the user follows. Shows their Live / Online status so the
// user can jump straight in; following also push-notifies them.
export default function Following() {
  const router = useRouter();
  const { user, profile, loading } = useRequireClient();
  const { go } = useAstroActions();
  const { freeChatMin } = useSettings();
  const freeMin = profile?.freeUsed ? 0 : freeChatMin;
  const [rows, setRows] = useState(null);

  async function load() {
    const ids = await followService.getFollowing(user.uid);
    const list = await Promise.all(
      ids.map((id) => astrologerService.getAstrologer(id)));
    setRows(list.filter(Boolean));
  }
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ },
    [user]);

  async function unfollow(id) {
    await followService.toggleFollow(user.uid, id, true);
    setRows((r) => r.filter((a) => a.id !== id));
  }

  if (loading || rows === null) {
    return <Layout><SkeletonList /></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Following</h1>
      {rows.length === 0 ? (
        <EmptyState title="You are not following anyone yet"
          subtitle="Open an astrologer and tap Follow to get notified
            when they are Live or Online." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2
          lg:grid-cols-3">
          {rows.map((a) => (
            <div key={a.id} className="relative">
              {(a.isLive || a.status === 'online') && (
                <span className={`absolute right-2 top-2 z-10 rounded-full
                  px-2 py-0.5 text-[10px] font-bold text-white ${
                  a.isLive ? 'bg-danger' : 'bg-success'}`}>
                  {a.isLive ? 'LIVE' : 'ONLINE'}
                </span>
              )}
              <AstrologerCard a={a}
                onOpen={() => router.push(a.isLive
                  ? `/live-view/${a.id}` : `/astrologer/${a.id}`)}
                onAction={go} freeMin={freeMin} />
              <button onClick={() => unfollow(a.id)}
                className="mt-1 w-full text-xs font-semibold
                  text-sub-text">
                Unfollow
              </button>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
