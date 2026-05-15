// Minimal monochrome line icons (stroke = currentColor). No colour, no
// emoji. Used for category tiles and section accents.
const base = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

export const Icon = {
  Love: (p) => (
    <svg {...base} {...p}>
      <path d="M12 21s-7-4.6-9-9a4.5 4.5 0 0 1 9-2 4.5 4.5 0 0 1 9 2c-2 4.4-9 9-9 9z" />
    </svg>
  ),
  Career: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Marriage: (p) => (
    <svg {...base} {...p}>
      <circle cx="9" cy="14" r="5" /><circle cx="15" cy="14" r="5" />
      <path d="M9 9V5M9 5l-2 1M9 5l2 1" />
    </svg>
  ),
  Health: (p) => (
    <svg {...base} {...p}>
      <path d="M3 12h4l2 5 4-12 2 7h6" />
    </svg>
  ),
  Finance: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9h4.5a2 2 0 0 1 0 4H9m0-4v8m0-4h6" />
    </svg>
  ),
  Education: (p) => (
    <svg {...base} {...p}>
      <path d="M3 9l9-4 9 4-9 4-9-4z" />
      <path d="M7 11v4c0 1.5 2.5 3 5 3s5-1.5 5-3v-4" />
    </svg>
  ),
  Star: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3l2.6 5.6 6 .8-4.3 4.2 1 6-5.3-2.9L6.7 19.6l1-6L3.4 9.4l6-.8L12 3z" />
    </svg>
  ),
};
