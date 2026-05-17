import { useEffect, useState } from 'react';
import { reviewService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

// Write / edit your platform review. Available to every user, but only
// usable after a paid consultation of at least 10 minutes. The review is
// editable any time; every edit goes back for admin approval. You always
// see your own review and its status here; other users only see it once
// the admin has approved AND selected it for the home page.
export default function ReviewPage() {
  const { user, profile, loading } = useRequireClient();
  const [elig, setElig] = useState(null);   // { ok, reason }
  const [mine, setMine] = useState(undefined);
  const [f, setF] = useState({ name: '', city: '', rating: 5, text: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!user) return;
    reviewService.canWritePlatformReview(user.uid).then(setElig);
    reviewService.getMyPlatformReview(user.uid).then((r) => {
      setMine(r || null);
      if (r) {
        setF({ name: r.userName || '', city: r.city || '',
          rating: r.rating || 5, text: r.text || '' });
      } else {
        setF((p) => ({ ...p, name: profile?.name || '' }));
      }
    });
  }, [user, profile]);

  async function submit() {
    if (!f.text.trim()) { setMsg('Please write a few words.'); return; }
    setBusy(true); setMsg('');
    try {
      await reviewService.submitPlatformReview(user.uid, f);
      const r = await reviewService.getMyPlatformReview(user.uid);
      setMine(r);
      setMsg('Thank you! Your review was submitted for approval.');
    } catch (e) {
      setMsg('Failed: ' + (e?.message || 'error'));
    } finally { setBusy(false); }
  }

  if (loading || elig === null || mine === undefined) {
    return <Layout><SkeletonList /></Layout>;
  }

  const visible = mine && mine.status === 'approved' && mine.selected;
  const statusLabel = !mine ? '' : visible
    ? 'Live on the home page'
    : mine.status === 'approved'
      ? 'Approved - waiting to be featured by admin'
      : 'Pending admin approval';
  const statusColor = visible ? 'text-success'
    : mine?.status === 'approved' ? 'text-primary' : 'text-warning';

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">Write a Review</h1>
      <p className="mb-4 text-sm text-sub-text">
        Share your experience. Only you can see your review until an admin
        approves and features it on the home page.
      </p>

      {mine && (
        <div className="surface mb-4 p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Your review</span>
            <span className={`text-xs font-semibold ${statusColor}`}>
              {statusLabel}
            </span>
          </div>
          <div className="text-sm text-gold">
            {'★'.repeat(mine.rating)}
            <span className="text-gray-300">
              {'★'.repeat(5 - mine.rating)}
            </span>
          </div>
          <p className="mt-1 text-sm text-sub-text">{mine.text}</p>
          <p className="mt-1 text-xs text-sub-text">
            You can edit it below - edits are reviewed again.
          </p>
        </div>
      )}

      {!elig.ok && !mine ? (
        <div className="surface p-5 text-center text-sm text-sub-text">
          {elig.reason}
        </div>
      ) : (
        <div className="surface space-y-3 p-4">
          <input className="input" placeholder="Display name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="input" placeholder="City (optional)"
            value={f.city}
            onChange={(e) => setF({ ...f, city: e.target.value })} />
          <div>
            <div className="mb-1 text-sm text-sub-text">Your rating</div>
            <div className="flex gap-1 text-3xl">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button"
                  onClick={() => setF({ ...f, rating: n })}
                  className={n <= f.rating
                    ? 'text-gold' : 'text-gray-300'}>
                  ★
                </button>
              ))}
            </div>
          </div>
          <textarea className="input" rows={4}
            placeholder="Tell us about your experience"
            value={f.text}
            onChange={(e) => setF({ ...f, text: e.target.value })} />
          {msg && <div className="text-sm text-primary">{msg}</div>}
          <button onClick={submit} disabled={busy}
            className="btn-primary w-full">
            {busy ? 'Submitting...'
              : mine ? 'Update my review' : 'Submit review'}
          </button>
        </div>
      )}
    </Layout>
  );
}
