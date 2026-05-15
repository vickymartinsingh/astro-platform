import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { astrologerService, reviewService } from '@astro/shared';
import Layout from '../../components/Layout';
import { SkeletonList } from '../../components/Skeleton';
import VerifiedBadge from '../../components/VerifiedBadge';
import { useOptionalClient } from '../../lib/useAuth';
import { useAstroActions } from '../../lib/useAstroActions';

function discounted(base, d) {
  return Math.round((base || 0) * (1 - Number(d || 0) / 100));
}

export default function AstrologerProfile() {
  const router = useRouter();
  const { id } = router.query;
  useOptionalClient();
  const { go } = useAstroActions();
  const [a, setA] = useState(null);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    if (!id) return;
    const unsub = astrologerService.listenAstrologer(id, setA);
    reviewService.getReviews(id).then(setReviews);
    return () => unsub && unsub();
  }, [id]);

  if (!a) return <Layout><SkeletonList /></Layout>;

  const chat = discounted(a.priceChat, a.discountPercent);
  const call = discounted(a.priceCall, a.discountPercent);
  const video = discounted(a.priceVideo, a.discountPercent);
  const online = a.status === 'online';

  return (
    <Layout>
      <div className="card">
        <div className="flex gap-4">
          <img src={a.profileImage || '/avatar.png'} alt={a.name}
            className="h-24 w-24 rounded-full object-cover bg-bg-light" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{a.name}</h1>
              {a.approved && <VerifiedBadge size={22} />}
            </div>
            <div className="mt-1 text-sub-text">
              <span className="font-semibold text-gold">
                ★ {a.rating || 0}
              </span>{' '}
              ({a.reviewsCount || 0} reviews) · {a.experience || 0} yrs ·{' '}
              {(a.languages || []).join(', ')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(a.skills || []).map((s) => (
                <span key={s} className="badge bg-bg-light text-primary">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 text-sub-text">{a.bio}</p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
          <PriceBox label="Chat" base={a.priceChat} val={chat}
            off={a.discountPercent} />
          <PriceBox label="Call" base={a.priceCall} val={call}
            off={a.discountPercent} />
          <PriceBox label="Video" base={a.priceVideo} val={video}
            off={a.discountPercent} />
        </div>

        {a.status === 'busy' && (
          <p className="mt-3 text-danger">
            Astrologer is currently in a session.
          </p>
        )}
        {a.status === 'offline' && (
          <p className="mt-3 text-sub-text">Astrologer is Offline.</p>
        )}

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <button disabled={!online} onClick={() => go('chat', a)}
            className={`btn-primary ${online ? '' : 'opacity-50'}`}>
            {online ? 'Start Chat' : 'Astrologer is Offline'}
          </button>
          <button disabled={!online} onClick={() => go('call', a)}
            className={`btn-ghost ${online ? '' : 'opacity-50'}`}>
            Start Voice Call
          </button>
          <button disabled={!online} onClick={() => go('video', a)}
            className={`btn-ghost ${online ? '' : 'opacity-50'}`}>
            Start Video Call
          </button>
        </div>
      </div>

      <h2 className="mt-6 mb-2 font-bold">Reviews</h2>
      {reviews.length === 0 ? (
        <div className="card text-sub-text">No reviews yet.</div>
      ) : (
        <div className="space-y-2">
          {reviews.map((r) => (
            <div key={r.id} className="card">
              <div className="text-gold">
                {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
              </div>
              <p className="mt-1">{r.comment}</p>
              {r.astrologerReply && (
                <p className="mt-2 rounded-card bg-bg-light p-2 text-sm">
                  <b>Reply:</b> {r.astrologerReply}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

function PriceBox({ label, base, val, off }) {
  return (
    <div className="rounded-card bg-bg-light p-3">
      <div className="text-sub-text">{label}</div>
      {Number(off) > 0 && (
        <span className="text-xs text-sub-text line-through">₹{base}</span>
      )}
      <div className="font-bold text-primary">₹{val}/min</div>
    </div>
  );
}
