// Minimal monochrome line icons (stroke = currentColor). No colour, no
// emoji. Used for category tiles, section accents, and Learn & Earn tiles.
const base = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

export const Icon = {
  // ---- Category icons --------------------------------------------------
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
  // ---- Learn & Earn tile icons -----------------------------------------
  // Used in the engagement tile grid (dashboard) and the engage/[id] header.
  // Single-color, stroke only, same visual language as category icons.
  LearnAstrology: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      <path d="M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M17.7 6.3l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  ),
  QuizGame: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r=".5" fill="currentColor" />
    </svg>
  ),
  Manifestation: (p) => (
    <svg {...base} {...p}>
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
    </svg>
  ),
  AstroComic: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M3 17l4 4 2-4" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  ),
  TarotLearning: (p) => (
    <svg {...base} {...p}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
      <path d="M12 2v4" />
    </svg>
  ),
  NumerologyBasics: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 8v8M8 8h2M8 12h2M8 16h2" />
      <path d="M14 16c0-2.5 3-2.5 3 0s-3 2-3 4h3" />
    </svg>
  ),
  CrystalGuide: (p) => (
    <svg {...base} {...p}>
      <path d="M12 2l4 6H8l4-6z" />
      <path d="M8 8l4 14 4-14" />
      <path d="M5 8h14" />
    </svg>
  ),
  DailyRituals: (p) => (
    <svg {...base} {...p}>
      <path d="M12 2a7 7 0 0 1 0 14" />
      <path d="M12 16v6M8 22h8" />
      <path d="M9 2C9 5 7 7 7 9a5 5 0 0 0 10 0c0-2-2-4-2-7" />
    </svg>
  ),
  VedicAstrology: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
      <path d="M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8l2.8-2.8M17 7l2.8-2.8" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  PalmReading: (p) => (
    <svg {...base} {...p}>
      <path d="M8 4v11a2 2 0 0 0 4 0V9" />
      <path d="M12 4v10a2 2 0 0 0 4 0V9" />
      <path d="M16 5v8a2 2 0 0 0 4 0V9" />
      <path d="M4 9v8a2 2 0 0 0 4 0V9" />
      <path d="M4 9a2 2 0 0 1 4 0" />
      <path d="M8 4a2 2 0 0 1 4 0" />
      <path d="M12 4a2 2 0 0 1 4 0" />
      <path d="M16 5a2 2 0 0 1 4 0" />
    </svg>
  ),
  FaceReading: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="8" r="5" />
      <path d="M9 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0M13 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
      <path d="M10 11s.5 1 2 1 2-1 2-1" />
      <path d="M8.5 3C8.5 3 7 4 7 5" />
      <path d="M15.5 3C15.5 3 17 4 17 5" />
      <path d="M6 20c0-3 2.7-5.5 6-5.5S18 17 18 20" />
    </svg>
  ),
  Understanding: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 3" />
    </svg>
  ),
  Gemstone: (p) => (
    <svg {...base} {...p}>
      <path d="M12 2l4 6H8l4-6z" />
      <path d="M8 8l4 14 4-14" />
      <path d="M5 8h14" />
    </svg>
  ),
};
