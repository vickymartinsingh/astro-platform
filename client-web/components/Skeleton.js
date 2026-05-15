// Skeleton placeholders, never show a blank white screen (blueprint 10.9).
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

export function SkeletonList({ count = 4 }) {
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
