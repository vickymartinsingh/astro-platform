// Generate ALL app icons + splash + web favicons for all 3 apps from
// the brand sources in brand/. Platform-correct by design:
//
//   brand/AstroSeer_Splash Logo_Transprent_IOS&APK.png  (transparent)
//        -> splash (centred on theme bg) + in-app /logo.png + web icons
//   brand/AstroSeer_Android_Cust App_ICON.png  (transparent circular)
//        -> Android adaptive launcher (logo on #0F0A23)
//   brand/AstroSeer_IOS_Cust App_ICON.png  (OPAQUE navy square)
//        -> iOS app icon (Apple forbids alpha / rounded corners)
//
// Android icons are written straight into each app's (git-ignored)
// android/ project locally so the APK build picks them up. The
// committed <app>/assets/ set is left iOS-correct so the macOS CI
// (`capacitor-assets generate --ios`) produces the right AppIcon.
import {
  existsSync, mkdirSync, writeFileSync, rmSync, readFileSync,
} from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';

const ROOT = process.cwd();
const B = join(ROOT, 'brand');
const BG = '#0F0A23';
const bgRGB = { r: 0x0f, g: 0x0a, b: 0x23, alpha: 1 };
const APPS = ['client-web', 'astro-web', 'admin-web'];
const CAP = join(ROOT, 'node_modules', '@capacitor', 'assets', 'bin',
  'capacitor-assets');

const pick = (...names) => {
  for (const n of names) { const p = join(B, n); if (existsSync(p)) return p; }
  return null;
};
const SPLASH_SRC = pick('AstroSeer_Splash Logo_Transprent_IOS&APK.png',
  'AstroSeer_Main ICON.png', 'logo.png', 'source-logo.png');
const AND_SRC = pick('AstroSeer_Android_Cust App_ICON.png',
  'AstroSeer_Main ICON.png', 'logo.png', 'source-logo.png');
const IOS_SRC = pick('AstroSeer_IOS_Cust App_ICON.png',
  'AstroSeer_Main ICON.png', 'logo.png', 'source-logo.png');

if (!SPLASH_SRC || !AND_SRC || !IOS_SRC) {
  console.error('\n  Missing brand sources in brand/. Need at least one'
    + ' splash/icon PNG.\n');
  process.exit(1);
}
console.log('splash :', SPLASH_SRC.replace(ROOT, '.'));
console.log('android:', AND_SRC.replace(ROOT, '.'));
console.log('ios    :', IOS_SRC.replace(ROOT, '.'));

const transparent = (src, size) => sharp(src)
  .resize(size, size, { fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// logo centred on a SIZE square of BG, occupying `frac` of it.
async function onBg(src, size, frac) {
  const inner = Math.round(size * frac);
  const fitted = await sharp(src).resize(inner, inner, { fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4,
    background: bgRGB } })
    .composite([{ input: fitted, gravity: 'center' }]).png().toBuffer();
}
// opaque square (no alpha) - iOS app icon requirement.
const opaqueSquare = (src, size) => sharp(src)
  .resize(size, size, { fit: 'cover', position: 'centre' })
  .flatten({ background: bgRGB }).png().toBuffer();

const flags = `--iconBackgroundColor ${BG} --iconBackgroundColorDark ${BG}`
  + ` --splashBackgroundColor ${BG} --splashBackgroundColorDark ${BG}`;

for (const app of APPS) {
  const aDir = join(ROOT, app);
  if (!existsSync(aDir)) { console.log('skip:', app); continue; }
  const assets = join(aDir, 'assets');
  const pub = join(aDir, 'public');
  mkdirSync(assets, { recursive: true });
  mkdirSync(pub, { recursive: true });

  const splash = await onBg(SPLASH_SRC, 2732, 0.42);
  const splashFile = join(assets, 'splash.png');
  const splashDark = join(assets, 'splash-dark.png');

  // ---- Android pass: adaptive (transparent fg on #0F0A23) ----
  writeFileSync(join(assets, 'icon-foreground.png'),
    await transparent(AND_SRC, 1024));
  writeFileSync(join(assets, 'icon-background.png'),
    await sharp({ create: { width: 1024, height: 1024, channels: 4,
      background: bgRGB } }).png().toBuffer());
  writeFileSync(join(assets, 'icon-only.png'), await onBg(AND_SRC, 1024, 0.92));
  writeFileSync(join(assets, 'logo.png'), await transparent(AND_SRC, 1024));
  writeFileSync(splashFile, splash);
  writeFileSync(splashDark, splash);
  try {
    execSync(`node "${CAP}" generate --android ${flags}`,
      { cwd: aDir, stdio: 'pipe' });
    console.log(`android icons+splash: ${app}`);
  } catch (e) {
    console.log(`android note (${app}):`, String(
      e.stdout || e.stderr || e.message).split('\n').slice(-2).join(' '));
  }

  // ---- Commit set = iOS-correct (opaque icon + splash) ----
  rmSync(join(assets, 'icon-foreground.png'), { force: true });
  rmSync(join(assets, 'icon-background.png'), { force: true });
  writeFileSync(join(assets, 'icon-only.png'),
    await opaqueSquare(IOS_SRC, 1024));
  writeFileSync(join(assets, 'logo.png'), await transparent(SPLASH_SRC, 1024));
  writeFileSync(splashFile, splash);
  writeFileSync(splashDark, splash);

  // ---- Web: in-app splash logo + favicon / apple-touch / og ----
  writeFileSync(join(pub, 'logo.png'), await transparent(SPLASH_SRC, 512));
  writeFileSync(join(pub, 'favicon.png'), await onBg(SPLASH_SRC, 64, 0.84));
  writeFileSync(join(pub, 'apple-touch-icon.png'),
    await opaqueSquare(IOS_SRC, 180));
  writeFileSync(join(pub, 'og.png'), await sharp({ create: {
    width: 1200, height: 630, channels: 4, background: bgRGB } })
    .composite([{ input: await sharp(SPLASH_SRC).resize(440, 440, {
      fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer(), gravity: 'center' }]).png().toBuffer());
  console.log(`web assets: ${app}`);
}

console.log('\ngen-assets done: Android (local android/) + iOS set'
  + ' (committed assets/) + web favicons for all 3 apps.');
