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
      <circle cx="8" cy="6" r="2.4" />
      <circle cx="16" cy="6" r="2.4" />
      <path d="M5 21v-4a3 3 0 0 1 3-3 3 3 0 0 1 3 3v4" />
      <path d="M13 21v-4a3 3 0 0 1 3-3 3 3 0 0 1 3 3v4" />
    </svg>
  ),
  Health: (p) => (
    <svg {...base} {...p}>
      <path d="M3 12h4l2 5 4-12 2 7h6" />
    </svg>
  ),
  Finance: (p) => (
    <svg {...base} {...p}>
      <path d="M10 4c-1 1.5-2 2.5-2 4 0 1 1 2 4 2s4 1 4 2c0 1.5-1 2.5-2 4" />
      <path d="M7 14c-1 1-2 2.5-2 4 0 2 3 2 7 2s7 0 7-2c0-1.5-1-3-2-4
        a7 7 0 0 0-10 0z" />
      <path d="M12 11v6" />
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
