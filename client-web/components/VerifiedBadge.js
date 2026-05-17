// Blue verified badge (Twitter / Instagram style): a scalloped seal with
// a white check. Use next to a verified astrologer's name.
export default function VerifiedBadge({ size = 16, title = 'Verified' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      role="img" aria-label={title}
      style={{ display: 'inline-block', verticalAlign: 'middle',
        flexShrink: 0, color: 'rgb(var(--c-verify))' }}>
      <title>{title}</title>
      <path
        fill="currentColor"
        d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z"
      />
      <path
        fill="#fff"
        d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6 6.4-6.4-1.3-1.3z"
      />
    </svg>
  );
}
