import { avatarGradient, initial } from '../lib/avatar';
import VerifiedBadge from './VerifiedBadge';

// "Ask Astro" style card: centered gradient avatar, Featured badge,
// rating + experience, price/min, gradient Chat pill. Clicking the card
// body opens the quick-view modal; the Chat button starts a session.
function effPrice(base, d) {
  return Math.round((base || 0) * (1 - Number(d || 0) / 100));
}

export default function AstrologerCard({ a, onOpen, onChat, freeMin = 0 }) {
  const online = a.status === 'online';
  const price = effPrice(a.priceChat, a.discountPercent);
  const skills = (a.skills || []).join(', ');

  return (
    <div className="surface relative p-5 transition hover:shadow-md">
      {a.approved && <span className="featured-badge">★ Featured</span>}
      {freeMin > 0 && (
        <span className="absolute right-3 top-3 z-[1] rounded-full
          bg-success px-2 py-0.5 text-[11px] font-semibold text-white">
          First {freeMin} min FREE
        </span>
      )}

      <button onClick={() => onOpen?.(a)}
        className="flex w-full flex-col items-center text-center">
        <div className="relative">
          {a.profileImage ? (
            <img src={a.profileImage} alt={a.name}
              className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className={`flex h-20 w-20 items-center justify-center
              rounded-full bg-gradient-to-br ${avatarGradient(a.name)}
              text-2xl font-bold text-white`}>
              {initial(a.name)}
            </div>
          )}
          <span className={`absolute bottom-1 right-1 h-3.5 w-3.5
            rounded-full border-2 border-white ${
            online ? 'bg-green-500'
            : a.status === 'busy' ? 'bg-amber-500' : 'bg-gray-300'}`} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-1
                        text-base font-bold">
          {a.name}
          {a.approved && <VerifiedBadge size={16} />}
        </div>
        <div className="mt-0.5 line-clamp-1 text-sm text-sub-text">
          {skills || 'Astrologer'}
        </div>
        <div className="mt-1 text-sm">
          <span className="font-semibold text-amber-600">
            ★ {a.rating || 0}
          </span>{' '}
          <span className="text-sub-text">
            ({a.reviewsCount || 0})&nbsp;·&nbsp;{a.experience || 0}y
          </span>
        </div>
      </button>

      <div className="mt-4 flex items-center justify-between border-t
                      border-gray-100 pt-3">
        <div className="text-lg font-bold">
          {freeMin > 0 && (
            <span className="mr-1 text-sm font-normal text-sub-text
                             line-through">₹{price}</span>
          )}
          {freeMin > 0
            ? <span className="text-success">FREE</span>
            : <>₹{price}</>}
          <span className="text-xs font-normal text-sub-text">/min</span>
        </div>
        <button onClick={() => onChat?.(a)}
          className={`btn-grad ${online ? '' : 'opacity-60'}`}>
          ↻ {online ? 'Chat' : a.status === 'busy' ? 'Busy' : 'Offline'}
        </button>
      </div>
    </div>
  );
}
