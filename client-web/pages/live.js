import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import AstrologerCard from '../components/AstrologerCard';
import { useOptionalClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { useSettings } from '../lib/useSettings';

// "Live" tab — astrologers who are online right now and ready to take a
// chat / call / video immediately.
export default function LivePage() {
  const { profile } = useOptionalClient();
  const { go } = useAstroActions();
  const { freeChatMin } = useSettings();
  const freeMin = profile?.freeUsed ? 0 : freeChatMin;
  const router = useRouter();
  const [list, setList] = useState(null);

  useEffect(() => {
    astrologerService.getAstrologers().then(setList).catch(() => setList([]));
  }, []);

  const online = (list || []).filter((a) => a.status === 'online');

  return (
    <Layout>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-2.5 w-2.5 animate-pulse rounded-full
                         bg-red-500" />
        <h1 className="text-lg font-bold">Live now</h1>
        <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5
                         text-xs font-semibold text-brand-dark">
          {online.length} online
        </span>
      </div>

      {list == null ? (
        <SkeletonList count={4} />
      ) : online.length === 0 ? (
        <div className="surface p-8 text-center">
          <div className="text-base font-semibold">
            No astrologers are live right now
          </div>
          <p className="mt-1 text-sm text-sub-text">
            Browse all astrologers and we will connect you the moment one
            comes online.
          </p>
          <button onClick={() => router.push('/astrologers')}
            className="btn-brand mt-4">See all astrologers</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2
                        lg:grid-cols-4">
          {online.map((a) => (
            <AstrologerCard key={a.id} a={a} freeMin={freeMin}
              onOpen={(x) => router.push(`/astrologer/${x.id}`)}
              onAction={go} />
          ))}
        </div>
      )}
    </Layout>
  );
}
