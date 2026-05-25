import { useEffect, useState } from 'react';
import { reviewService, userService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

export default function AstroReviews() {
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);
  const [replies, setReplies] = useState({});

  async function load() {
    const list = await reviewService.getReviews(user.uid);
    const named = await Promise.all(list.map(async (r) => {
      if (r.userId === 'sample' || r.userId === user.uid) {
        return { ...r, reviewer: 'A client' };
      }
      try {
        const u = await userService.getUser(r.userId);
        return { ...r, reviewer: u?.name || 'A client' };
      } catch { return { ...r, reviewer: 'A client' }; }
    }));
    setRows(named);
  }
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  async function reply(id) {
    if (!replies[id]?.trim()) return;
    await reviewService.addReply(id, replies[id]);
    setReplies((p) => ({ ...p, [id]: '' }));
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Reviews</h1>
      <p className="mb-3 text-sm text-sub-text">
        You can reply to reviews but cannot delete them (admin only).
      </p>
      {rows.length === 0 ? (
        <div className="card text-sub-text">No reviews yet.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="surface p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{r.reviewer}</div>
                <div className="text-gold">
                  {(() => {
                    // Bug guard: rating can land here as undefined / a
                    // stringified number / a value outside 0..5. Bare
                    // String.repeat throws RangeError on negatives or
                    // NaN, which would crash the entire reviews list
                    // for a single malformed doc.
                    const n = Math.max(0,
                      Math.min(5, Math.round(Number(r.rating) || 0)));
                    return '★'.repeat(n) + '☆'.repeat(5 - n);
                  })()}
                </div>
              </div>
              <div className="text-xs text-sub-text">
                {r.createdAt?.toDate
                  ? r.createdAt.toDate().toLocaleDateString() : ''}
              </div>
              <p className="mt-1">{r.comment}</p>
              {r.astrologerReply ? (
                <p className="mt-2 rounded-card bg-bg-light p-2 text-sm">
                  <b>Your reply:</b> {r.astrologerReply}
                </p>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input className="input flex-1"
                    placeholder="Write a reply…"
                    value={replies[r.id] || ''}
                    onChange={(e) =>
                      setReplies((p) => ({ ...p, [r.id]: e.target.value }))} />
                  <button onClick={() => reply(r.id)}
                    className="btn-primary">Reply</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
