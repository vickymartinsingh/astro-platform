import { useEffect, useState } from 'react';
import Link from 'next/link';
import { reviewService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Moderate the home-page "What our customers say" reviews. A review is
// only public when it is BOTH approved AND featured. The author always
// sees their own review in their app regardless. Each review links to
// the author in the Users list (they are real users - they had a paid
// session - so you can open / sign into their account from there).
export default function AdminReviews() {
  const { loading } = useRequireAdmin();
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');

  async function refresh() {
    setList(await reviewService.listAllPlatformReviews());
  }
  useEffect(() => { refresh(); }, []);

  async function patch(id, p) {
    await reviewService.moderatePlatformReview(id, p);
    flash('Review updated - live on the app');
    refresh();
  }

  if (loading || list === null) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const shown = list.filter((r) => filter === 'all'
    || (filter === 'pending' && r.status !== 'approved')
    || (filter === 'approved' && r.status === 'approved')
    || (filter === 'featured' && r.status === 'approved' && r.selected));

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Customer Reviews</h1>
      <p className="mb-3 text-sm text-sub-text">
        Approve a review, then Feature it to show it on the home page.
        Only approved + featured reviews are visible to other users.
      </p>

      <div className="mb-3 flex gap-1">
        {['all', 'pending', 'approved', 'featured'].map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={filter === k ? 'pill pill-active' : 'pill'}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <div className="card text-sub-text">No reviews here.</div>
        ) : shown.map((r) => {
          const featured = r.status === 'approved' && r.selected;
          return (
            <div key={r.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {r.userName || 'User'}
                    {r.city ? (
                      <span className="text-sub-text"> - {r.city}</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gold">
                    {'★'.repeat(r.rating || 0)}
                    <span className="text-gray-300">
                      {'★'.repeat(5 - (r.rating || 0))}
                    </span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5
                  text-xs font-semibold ${featured
                    ? 'bg-success/15 text-success'
                    : r.status === 'approved'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-warning/15 text-warning'}`}>
                  {featured ? 'Featured'
                    : r.status === 'approved' ? 'Approved' : 'Pending'}
                </span>
              </div>
              <p className="text-sm text-sub-text">{r.text}</p>
              <div className="text-xs text-sub-text">
                Author UID: {r.userId}{' '}
                <Link href="/admin-users"
                  className="font-semibold text-primary">
                  (open in Users)
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.status === 'approved' ? (
                  <button onClick={() => patch(r.id,
                    { status: 'pending', selected: false })}
                    className="rounded-full border border-warning px-3
                      py-1.5 text-sm text-warning">Un-approve</button>
                ) : (
                  <button onClick={() => patch(r.id,
                    { status: 'approved' })}
                    className="rounded-full border border-primary px-3
                      py-1.5 text-sm text-primary">Approve</button>
                )}
                <button
                  disabled={r.status !== 'approved'}
                  onClick={() => patch(r.id, { selected: !r.selected })}
                  className={`rounded-full px-3 py-1.5 text-sm
                    ${r.status !== 'approved'
                      ? 'border border-gray-200 text-gray-300'
                      : featured
                        ? 'border border-danger text-danger'
                        : 'bg-primary text-white'}`}>
                  {featured ? 'Unfeature' : 'Feature on home'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
