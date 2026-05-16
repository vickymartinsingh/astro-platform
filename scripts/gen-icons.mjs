// Builds branded source assets for each app from ONE shared artwork
// (brand/source-logo.png), recoloured per app via a hue rotation so all
// three keep the same illustration but a distinct colour theme.
// Pure sharp (a @capacitor/assets dependency) -> PNG. No design tool /
// network. Works on Windows and the macOS CI runner (no hardcoded paths).
// Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'brand', 'source-logo.png');

if (!existsSync(SRC)) {
  console.error(
    '\nMissing artwork: ' + SRC +
    '\nSave the shared logo there (brand/source-logo.png) and re-run.\n');
  process.exit(1);
}

// appDir -> recolour + background palette.
//   hue:   degrees to rotate the artwork's colours (original art is warm
//          orange ~30 deg; these shift it to each app's theme).
//   bg:    adaptive-icon background gradient [start, end].
//   sp/spD: splash + dark-splash solid backgrounds.
// Each app keeps the SAME illustration but is recoloured cohesively with
// a luminance-preserving tint, so the whole icon (art + background) reads
// as one clean theme colour. bri lifts it slightly before tinting.
const hex = (h) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});
const APPS = {
  // Client: ORIGINAL artwork, untouched (no recolour) per request.
  'client-web': { raw: true,
                  bg: ['#15122B', '#0B0A1F'],
                  sp: '#0B0A1F', spD: '#000000' },
  'astro-web':  { tint: hex('#10B981'), bri: 1.12,
                  bg: ['#059669', '#04231B'],
                  sp: '#063D2E', spD: '#04231B' },              // emerald
  'admin-web':  { tint: hex('#3B82F6'), bri: 1.12,
                  bg: ['#2563EB', '#0B1B3F'],
                  sp: '#142C66', spD: '#0B1020' },              // blue
};

const circleMask = (d) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">`
  + `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);

const gradientSvg = (size, a, b) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
  + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
  + `<stop offset="0" stop-color="${a}"/>`
  + `<stop offset="1" stop-color="${b}"/></linearGradient></defs>`
  + `<rect width="${size}" height="${size}" fill="url(#g)"/></svg>`);

const solidSvg = (size, c) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
  + `<rect width="${size}" height="${size}" fill="${c}"/></svg>`);

// Artwork at NxN. opts.raw => ORIGINAL untouched image; otherwise a
// luminance-preserving tint for a cohesive single-theme colouring.
const square = (n, opts) => {
  let p = sharp(SRC).resize(n, n, { fit: 'cover' });
  if (!opts.raw) p = p.modulate({ brightness: opts.bri }).tint(opts.tint);
  return p.png().toBuffer();
};

// Artwork cropped to a circle at NxN (transparent corners).
async function disc(n, opts) {
  const sq = await square(n, opts);
  return sharp(sq)
    .composite([{ input: circleMask(n), blend: 'dest-in' }])
    .png().toBuffer();
}

// Place a buffer centred on a transparent / coloured canvas.
function canvas(size, bgBuf) {
  const base = bgBuf
    ? sharp(bgBuf)
    : sharp({ create: { width: size, height: size, channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base;
}

for (const [app, opts] of Object.entries(APPS)) {
  const { bg, sp, spD } = opts;
  const dir = join(ROOT, app, 'assets');
  mkdirSync(dir, { recursive: true });

  // Legacy / round icon: full artwork (1024).
  await sharp(await square(1024, opts))
    .toFile(join(dir, 'icon-only.png'));

  // Adaptive background: themed gradient.
  await sharp(gradientSvg(1024, bg[0], bg[1])).png()
    .toFile(join(dir, 'icon-background.png'));

  // Adaptive foreground: circular artwork inside the safe zone (~62%).
  const fg = await disc(Math.round(1024 * 0.62), opts);
  await canvas(1024, null)
    .composite([{ input: fg, gravity: 'centre' }])
    .png().toFile(join(dir, 'icon-foreground.png'));

  // Splash + dark splash: solid brand bg, centred circular logo.
  const logo = await disc(1100, opts);
  await sharp(solidSvg(2732, sp)).png()
    .composite([{ input: logo, gravity: 'centre' }])
    .toFile(join(dir, 'splash.png'));
  await sharp(solidSvg(2732, spD)).png()
    .composite([{ input: logo, gravity: 'centre' }])
    .toFile(join(dir, 'splash-dark.png'));

  console.log(`recoloured icons generated for ${app}`);
}
console.log('done');
