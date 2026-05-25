// Skeleton placeholders, never show a blank white screen (blueprint 10.9).
//
// Anti-flash guard: a loading state that resolves in under ~400 ms (the
// common case, e.g. a cached Firestore read) flashed an ugly skeleton
// list for a few hundred ms and then snapped to the real UI. Wrapping
// the public SkeletonList in a 400 ms delay means a fast load shows
// NOTHING (clean) and only slow loads show the placeholder. SSR + the
// pre-hydration brand cover paint the on-theme background underneath
// so the "nothing" never reads as a white flash.
import { useEffect, useState } from 'react';

export function SkeletonCard() {
  return (
    <div className="card">
      <div className="flex gap-3">
        <div className="skeleton h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
          <div className="skeleton h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

// `delay` = ms to wait before rendering anything. 0 = legacy instant
// behaviour. Default 400 ms hides the flash on quick loads but still
// shows the placeholder for genuinely slow responses (network hiccup,
// cold relay).
export function SkeletonList({ count = 4, delay = 400 }) {
  const [show, setShow] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return undefined;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return <div aria-hidden="true" />;
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function ErrorState({ onRetry }) {
  return (
    <div className="card text-center">
      <p className="mb-3 text-sub-text">
        Something went wrong. Check your internet connection.
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary">Try again</button>
      )}
    </div>
  );
}

export function EmptyState({ message, actionLabel, onAction }) {
  return (
    <div className="card text-center">
      <p className="mb-3 text-sub-text">{message}</p>
      {actionLabel && (
        <button onClick={onAction} className="btn-primary">{actionLabel}</button>
      )}
    </div>
  );
}
