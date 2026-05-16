// Generates distinct branded source assets for each app, then they are
// sliced into Android densities by @capacitor/assets. Pure SVG -> PNG via
// sharp (already on disk as a @capacitor/assets dependency). No design
// tool or network needed. Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Repo root = parent of this scripts/ folder. Works on Windows and the
// macOS CI runner alike (no hardcoded drive paths).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// White glyphs authored in a 1024x1024 coordinate space, centred.
const GLYPHS = {
  // Client: sparkle star inside an orbit ring.
  client: `
    <g fill="none" stroke="#fff" stroke-width="22">
      <circle cx="512" cy="512" r="352"/>
    </g>
    <path d="M512 168 L573 451 L856 512 L573 573 L512 856
             L451 573 L168 512 L451 451 Z" fill="#fff"/>
    <circle cx="805" cy="318" r="28" fill="#fff"/>
    <circle cx="225" cy="690" r="18" fill="#fff"/>`,
  // Astrologer: crescent moon + spark (celestial guide).
  astro: `
    <defs><mask id="cresc">
      <rect width="1024" height="1024" fill="#000"/>
      <circle cx="486" cy="512" r="258" fill="#fff"/>
      <circle cx="588" cy="466" r="226" fill="#000"/>
    </mask></defs>
    <rect width="1024" height="1024" fill="#fff" mask="url(#cresc)"/>
    <path d="M742 250 l34 78 78 34 -78 34 -34 78 -34 -78 -78 -34 78 -34 Z"
          fill="#fff"/>`,
  // Admin: shield + check (control / approval).
  admin: `
    <path d="M512 176 L786 286 L786 542 C786 716 662 812 512 862
             C362 812 238 716 238 542 L238 286 Z"
          fill="none" stroke="#fff" stroke-width="42"
          stroke-linejoin="round"/>
    <path d="M416 522 L486 592 L626 446" fill="none" stroke="#fff"
          stroke-width="46" stroke-linecap="round"
          stroke-linejoin="round"/>`,
};

// appKey -> [gradientStart, gradientEnd, splashBg, splashDarkBg]
const APPS = {
  'client-web': ['#7C3AED', '#4F46E5', '#6D28D9', '#0B0A1F'],
  'astro-web':  ['#10B981', '#047857', '#059669', '#04231B'],
  'admin-web':  ['#475569', '#1E3A8A', '#334155', '#0B1020'],
};

const wrap = (px, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `
  + `viewBox="0 0 1024 1024">${inner}</svg>`;

const grad = (a, b) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
  + `<stop offset="0" stop-color="${a}"/>`
  + `<stop offset="1" stop-color="${b}"/></linearGradient></defs>`;

// Scale a glyph about the centre (512,512).
const scaled = (glyph, s) =>
  `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">`
  + `${glyph}</g>`;

async function png(svg, file) {
  await sharp(Buffer.from(svg)).png().toFile(file);
}

for (const [app, [c1, c2, sp, spDark]] of Object.entries(APPS)) {
  const g = GLYPHS[app === 'client-web' ? 'client'
    : app === 'astro-web' ? 'astro' : 'admin'];
  const dir = join(ROOT, app, 'assets');
  mkdirSync(dir, { recursive: true });

  // Adaptive-icon background (full-bleed gradient).
  await png(wrap(1024, `${grad(c1, c2)}<rect width="1024" height="1024" `
    + `fill="url(#g)"/>`), `${dir}/icon-background.png`);

  // Adaptive-icon foreground (transparent, glyph inside safe zone).
  await png(wrap(1024, scaled(g, 0.60)), `${dir}/icon-foreground.png`);

  // Legacy / round icon (rounded gradient tile + glyph).
  await png(wrap(1024, `${grad(c1, c2)}`
    + `<rect width="1024" height="1024" rx="220" fill="url(#g)"/>`
    + scaled(g, 0.74)), `${dir}/icon-only.png`);

  // Splash screens (2732 canvas, solid brand bg, centred logo).
  await png(wrap(2732, `<rect width="1024" height="1024" fill="${sp}"/>`
    + scaled(g, 0.34)), `${dir}/splash.png`);
  await png(wrap(2732, `<rect width="1024" height="1024" fill="${spDark}"/>`
    + scaled(g, 0.34)), `${dir}/splash-dark.png`);

  writeFileSync(`${dir}/.gitkeep`, '');
  console.log(`generated icons for ${app}`);
}
console.log('done');
