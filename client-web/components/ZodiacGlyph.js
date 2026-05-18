// Single-colour Indian (Vedic) zodiac emblems. One cohesive line-art
// set in ONE colour (theme gold via currentColor) - no mixed-colour
// emoji. Vedic forms: Dhanu = bow, Makara = crocodile, Kumbha = water
// pot, Mithuna = couple. Reference: standard Rashi sign chart.
const P = {
  width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9,
  strokeLinecap: 'round', strokeLinejoin: 'round',
};

const G = {
  // Mesha - ram (curled horns + head)
  Aries: (
    <>
      <path d="M12 13c-2 0-3 2-3 4M12 13c2 0 3 2 3 4" />
      <path d="M9 9a3 3 0 1 1 6 0c0 2-1.5 4-3 4S9 11 9 9z" />
      <path d="M9 9c-1.6 0-2.5-1.2-2.5-2.6S7.4 4 8.6 4.6" />
      <path d="M15 9c1.6 0 2.5-1.2 2.5-2.6S16.6 4 15.4 4.6" />
    </>
  ),
  // Vrishabha - bull (head + horns + ring)
  Taurus: (
    <>
      <circle cx="12" cy="14" r="5" />
      <path d="M7 9C5 9 4 7 4 5M17 9c2 0 3-2 3-4" />
      <path d="M9 8C8 6 8 4 9.5 3M15 8c1-2 1-4-.5-5" />
    </>
  ),
  // Mithuna - couple (two figures)
  Gemini: (
    <>
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="6" r="2" />
      <path d="M9 8v9M15 8v9M7 11h4M13 11h4M7 20h4M13 20h4" />
    </>
  ),
  // Karka - crab
  Cancer: (
    <>
      <ellipse cx="12" cy="13" rx="5" ry="4" />
      <path d="M7 12 4 9m1 4-2 1m14-2 3-3m-1 4 2 1" />
      <path d="M9 17l-2 3m8-3 2 3M10 9 9 6m4 3 1-3" />
    </>
  ),
  // Simha - lion (mane + face + tail)
  Leo: (
    <>
      <circle cx="11" cy="11" r="6" />
      <circle cx="11" cy="11" r="3" />
      <path d="M16 14c3 1 4 4 2 6s-4-1-3-3" />
    </>
  ),
  // Kanya - maiden (figure with sheaf)
  Virgo: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v9M9 10h6M10 16l-1 4m6-4 1 4" />
      <path d="M12 7c2-1 4 0 4 2" />
    </>
  ),
  // Tula - scales / balance
  Libra: (
    <>
      <path d="M12 4v15M5 19h14M12 7 6 10m6-3 6 3" />
      <path d="M4 10a2 2 0 0 0 4 0M16 10a2 2 0 0 0 4 0" />
    </>
  ),
  // Vrishchika - scorpion (body + curled stinger)
  Scorpio: (
    <>
      <path d="M3 9v4M5 9v4M7 9v4" />
      <path d="M3 11h7a4 4 0 0 1 4 4v1a3 3 0 0 0 5 2.2" />
      <path d="M21 16.2 19 18l2 1.6" />
    </>
  ),
  // Dhanu - bow and arrow
  Sagittarius: (
    <>
      <path d="M5 19C5 12 9 6 17 5" />
      <path d="M5 19 19 5M13 5h6v6M14 14l5 5" />
    </>
  ),
  // Makara - crocodile / sea-creature
  Capricorn: (
    <>
      <path d="M4 9c2-2 5-2 7 0s4 5 7 4" />
      <path d="M4 9c-1 2 0 4 2 4h4" />
      <path d="M18 13c2 0 3 2 2 4s-4 1-4-1" />
      <path d="M7 9V6M10 9V6.5" />
    </>
  ),
  // Kumbha - water pot pouring
  Aquarius: (
    <>
      <path d="M8 4h8l-1 3H9z" />
      <path d="M9 7c-1 3-1 6 3 6s4-3 3-6" />
      <path d="M9 17c1-1 2-1 3 0s2 1 3 0M9 20c1-1 2-1 3 0s2 1 3 0" />
    </>
  ),
  // Meena - two fish
  Pisces: (
    <>
      <path d="M5 12c3-4 6-4 8 0-2 4-5 4-8 0z" />
      <path d="M19 12c-3-4-6-4-8 0 2 4 5 4 8 0z" />
      <path d="M9 12h6" />
    </>
  ),
};

export default function ZodiacGlyph({ sign, className }) {
  return (
    <svg {...P} className={className} aria-hidden="true">
      {G[sign] || <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
