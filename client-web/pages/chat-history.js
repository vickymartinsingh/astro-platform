import { useEffect, useState } from 'react';
import Link from 'next/link';
import { chatService, astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList, EmptyState } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

export default function ChatHistory() {
  const { user, loading } = useRequireClient();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const chats = await chatService.getUserChats(user.uid);
      const enriched = await Promise.all(chats.map(async (c) => {
        const otherId = c.participants.find((p) => p !== user.uid);
        const a = await astrologerService.getAstrologer(otherId);
        const updated = c.updatedAt?.toDate ? c.updatedAt.toDate() : null;
        const weeksAgo = updated
          ? (Date.now() - updated.getTime()) / (7 * 864e5) : 0;
        return { ...c, astro: a, returning: weeksAgo >= 7 };
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
        <EmptyState message="No conversations yet. Start your first consultation 🔮" />
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <Link key={c.id} href={`/chat/${c.astro?.id}`}
              className="card flex items-center gap-3">
              <img src={c.astro?.profileImage || '/avatar.png'}
                className="h-12 w-12 rounded-full object-cover bg-bg-light"
                alt="" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {c.astro?.name || 'Astrologer'}
                  {c.returning && (
                    <span className="badge ml-2 bg-success text-white">
                      Welcome back ✅
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-sub-text">
                  {c.lastMessage}
                </div>
              </div>
              <div className="text-xs text-sub-text">
                {c.updatedAt?.toDate
                  ? c.updatedAt.toDate().toLocaleDateString() : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
