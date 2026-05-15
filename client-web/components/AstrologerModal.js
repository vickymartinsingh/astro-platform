import { avatarGradient, initial } from '../lib/avatar';

// Quick-view modal (reference: gradient header + stat tiles + Chat/Call/Video).
function eff(base, d) {
  return Math.round((base || 0) * (1 - Number(d || 0) / 100));
}

export default function AstrologerModal({ a, onClose, onAction }) {
  if (!a) return null;
  const online = a.status === 'online';
  const chat = eff(a.priceChat, a.discountPercent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}>
        <div className="hero-grad relative p-5 text-white">
          <button onClick={onClose}
            className="absolute right-3 top-3 flex h-8 w-8 items-center
                       justify-center rounded-full bg-white/25">✕</button>
          <div className="flex items-center gap-4">
            {a.profileImage ? (
              <img src={a.profileImage} alt={a.name}
                className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className={`flex h-20 w-20 items-center justify-center
                rounded-full bg-gradient-to-br ${avatarGradient(a.name)}
                text-2xl font-bold`}>
                {initial(a.name)}
              </div>
            )}
            <div>
              <div className="text-2xl font-bold">{a.name}</div>
              <div className="mt-1 flex items-center gap-1 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${
                  online ? 'bg-green-400' : 'bg-gray-300'}`} />
                {online ? 'Online' : a.status || 'Offline'}
              </div>
              <div className="text-sm opacity-90">
                {(a.languages || []).join(', ')}
              </div>
              <div className="text-sm opacity-90">
                {(a.skills || []).join(', ')}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Tile big={`${a.rating || 0}★`} small={`${a.reviewsCount || 0} reviews`} />
            <Tile big={`${a.experience || 0}y`} small="experience" />
            <Tile big={`₹${chat}`} small="/min" />
          </div>
        </div>

        <div className="p-5">
          {a.bio && <p className="mb-4 text-sub-text">{a.bio}</p>}
          <div className="grid grid-cols-3 gap-2">
            <button disabled={!online}
              onClick={() => onAction('chat', a)}
              className={`btn-grad ${online ? '' : 'opacity-50'}`}>
              ↻ Chat
            </button>
            <button disabled={!online}
              onClick={() => onAction('call', a)}
              className={`btn-grad ${online ? '' : 'opacity-50'}`}>
              ☎ Call
            </button>
            <button disabled={!online}
              onClick={() => onAction('video', a)}
              className="inline-flex items-center justify-center gap-1
                         rounded-full border border-primary px-4 py-2
                         text-sm font-semibold text-primary
                         disabled:opacity-50">
              ▢ Video
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ big, small }) {
  return (
    <div className="rounded-xl bg-white/15 py-2">
      <div className="text-lg font-bold">{big}</div>
      <div className="text-[11px] uppercase tracking-wide opacity-90">
        {small}
      </div>
    </div>
  );
}
