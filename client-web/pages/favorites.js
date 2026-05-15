import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import AstrologerCard from '../components/AstrologerCard';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { getFavorites, toggleFavorite } from '../lib/favorites';

export default function Favorites() {
  const { user, loading } = useRequireClient();
  const { go } = useAstroActions();
  const router = useRouter();
  const [rows, setRows] = useState(null);

  async function load() {
    const ids = await getFavorites(user.uid);
    const list = await Promise.all(
      ids.map((id) => astrologerService.getAstrologer(id)));
    setRows(list.filter(Boolean));
  }

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  async function remove(id) {
    await toggleFavorite(user.uid, id, true);
    setRows((r) => r.filter((a) => a.id !== id));
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">Favorites</h1>
      {rows == null ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState message="No favourites yet. Open an astrologer to save them." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((a) => (
            <div key={a.id}>
              <AstrologerCard a={a}
                onOpen={(x) => router.push(`/astrologer/${x.id}`)}
                onChat={(x) => go('chat', x)} />
              <button onClick={() => remove(a.id)}
                className="mt-1 w-full text-center text-xs text-danger">
                Remove from favourites
              </button>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
