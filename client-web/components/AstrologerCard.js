import { inr } from '@astro/shared';
import { avatarGradient, initial } from '../lib/avatar';
import VerifiedBadge from './VerifiedBadge';

// "Ask Astro" style card: centered gradient avatar, Featured badge,
// rating + experience, price/min, gradient Chat pill. Clicking the card
// body opens the quick-view modal; the Chat button starts a session.
function effPrice(base, d) {
  return Math.round((base || 0) * (1 - Number(d || 0) / 100));
}

export default function AstrologerCard({
  a, onOpen, onChat, onAction, freeMin = 0,
}) {
  const online = a.status === 'online';
  const price = effPrice(a.priceChat, a.discountPercent);
  const skills = (a.skills || []).join(', ');
  const act = (type) => (onAction ? onAction(type, a) : onChat?.(a));

  // Show exactly the services the astrologer has enabled. Legacy docs
  // with no flags fall back to Chat so the card is never actionless.
  const svc = [
    a.chat_enabled && { type: 'chat', label: 'Chat',
      price: effPrice(a.priceChat, a.discountPercent) },
    a.call_enabled && { type: 'call', label: 'Call',
      price: effPrice(a.priceCall, a.discountPercent) },
    a.video_enabled && { type: 'video', label: 'Video',
      price: effPrice(a.priceVideo, a.discountPercent) },
  ].filter(Boolean);
  if (svc.length === 0) {
    svc.push({ type: 'chat', label: 'Chat', price });
  }

  return (
    <div className="surface relative p-5 transition hover:shadow-md">
      {a.approved && <span className="featured-badge">★ Featured</span>}
      {freeMin > 0 && (
        <span className="pointer-events-none absolute right-3 top-3 z-0
          rounded-full bg-success px-2 py-0.5 text-[11px]
          font-semibold text-white">
          First {freeMin} min FREE
        </span>
      )}

      <button onClick={() => onOpen?.(a)}
        className="flex w-full flex-col items-center text-center">
        <div className="relative">
          {a.profileImage ? (
            <img src={a.profileImage} alt={a.name}
              className="h-20 w-20 rounded-full object-cover" />
          ) : a.gender ? (
            // Gender-aware illustrated avatar (free DiceBear). Each
            // astrologer's uid produces a different face within the
            // gendered style, so every card looks distinct.
            <img src={`https://api.dicebear.com/9.x/${
              String(a.gender).toLowerCase() === 'female' ? 'lorelei'
              : String(a.gender).toLowerCase() === 'male' ? 'notionists'
              : 'personas'
            }/svg?seed=${encodeURIComponent(a.id || a.name || 'a')}`}
              alt={a.name}
              className="h-20 w-20 rounded-full object-cover
                bg-bg-light" />
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

      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="mb-2 text-sm">
          {freeMin > 0 ? (
            <>
              <span className="mr-1 text-sub-text line-through">
                ₹{inr(price)}
              </span>
              <span className="font-bold text-success">
                First {freeMin} min FREE
              </span>
            </>
          ) : (
            <span className="font-bold">
              from ₹{inr(Math.min(...svc.map((s) => s.price)))}
              <span className="text-xs font-normal text-sub-text">
                /min
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {svc.map((s) => (
            <button key={s.type} onClick={() => act(s.type)}
              disabled={!online}
              className={`btn-grad flex-1 justify-center !px-3 text-sm ${
                online ? '' : 'opacity-50'}`}>
              {s.label}
            </button>
          ))}
        </div>
        {!online && (
          <div className="mt-2 text-center text-xs text-sub-text">
            {a.status === 'busy' ? 'Busy right now' : 'Currently offline'}
          </div>
        )}
      </div>
    </div>
  );
}
