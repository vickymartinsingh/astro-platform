// Generate ALL app icons + splash screens + web favicons from ONE
// source logo, for all 3 apps. The logo is the transparent mandala-eye.
//
//   Put the transparent square PNG (>=1024x1024) at:  brand/logo.png
//   Then run:  node scripts/gen-assets.mjs
//
// Splash/icon background = the app's dark theme colour #0F0A23
// (styles/globals.css --c-tarot), so the gold logo sits on-theme and
// the splash matches the running app. capacitor-assets then fans the
// composed icon/splash out into Android mipmaps + iOS AppIcon/splash.
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC = join(ROOT, 'brand', 'logo.png');
const BG = '#0F0A23';                 // theme dark bg (--c-tarot)
const APPS = ['client-web', 'astro-web', 'admin-web'];
const CAP_ASSETS = join(ROOT, 'node_modules', '@capacitor', 'assets',
  'bin', 'capacitor-assets');

if (!existsSync(SRC)) {
  console.error(`\n  MISSING: ${SRC}`);
  console.error('  Save the TRANSPARENT logo PNG (>=1024x1024, square)');
  console.error('  to brand/logo.png and re-run.\n');
  process.exit(1);
}

const bgRGB = { r: 0x0f, g: 0x0a, b: 0x23, alpha: 1 };

// logo centred on a SIZE x SIZE canvas of BG, occupying `frac` of it.
async function centred(size, frac) {
  const inner = Math.round(size * frac);
  const fitted = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: bgRGB },
  }).composite([{ input: fitted, gravity: 'center' }]).png().toBuffer();
}

// transparent, trimmed-ish logo fitted into size (keeps alpha).
async function transparent(size) {
  return sharp(SRC)
    .resize(size, size, { fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

for (const app of APPS) {
  const aDir = join(ROOT, app);
  if (!existsSync(aDir)) { console.log('skip (missing app):', app); continue; }
  const assets = join(aDir, 'assets');
  const pub = join(aDir, 'public');
  mkdirSync(assets, { recursive: true });
  mkdirSync(pub, { recursive: true });

  // capacitor-assets source set (logo transparent + composed splash).
  writeFileSync(join(assets, 'logo.png'), await transparent(1024));
  writeFileSync(join(assets, 'logo-dark.png'), await transparent(1024));
  writeFileSync(join(assets, 'icon-only.png'), await transparent(1024));
  writeFileSync(join(assets, 'icon-foreground.png'), await transparent(1024));
  writeFileSync(join(assets, 'icon-background.png'),
    await sharp({ create: { width: 1024, height: 1024, channels: 4,
      background: bgRGB } }).png().toBuffer());
  writeFileSync(join(assets, 'splash.png'), await centred(2732, 0.42));
  writeFileSync(join(assets, 'splash-dark.png'), await centred(2732, 0.42));

  // Web: favicon / apple-touch / og / in-app splash logo.
  writeFileSync(join(pub, 'logo.png'), await transparent(512));
  writeFileSync(join(pub, 'favicon.png'), await centred(64, 0.82));
  writeFileSync(join(pub, 'apple-touch-icon.png'), await centred(180, 0.78));
  const og = await sharp({ create: { width: 1200, height: 630,
    channels: 4, background: bgRGB } })
    .composite([{ input: await sharp(SRC)
      .resize(420, 420, { fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer(),
      gravity: 'center' }]).png().toBuffer();
  writeFileSync(join(pub, 'og.png'), og);

  // Fan out to native (Android always; iOS only where ios/ exists - in
  // the macOS CI). --logoSplashScale keeps the mark from over-filling.
  const flags = `--iconBackgroundColor ${BG} --iconBackgroundColorDark ${BG}`
    + ` --splashBackgroundColor ${BG} --splashBackgroundColorDark ${BG}`;
  try {
    execSync(`node "${CAP_ASSETS}" generate ${flags}`,
      { cwd: aDir, stdio: 'pipe' });
    console.log(`assets: generated for ${app}`);
  } catch (e) {
    const out = (e.stdout || e.stderr || e.message || '').toString();
    console.log(`assets: capacitor-assets note for ${app}: `
      + out.split('\n').slice(-3).join(' ').trim());
  }
}

console.log('\ngen-assets done. brand/logo.png ->',
  'icons + splash + favicons for all 3 apps.');
