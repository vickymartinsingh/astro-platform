// One-shot: convert the user-attached WebP/JPG icon into a 1024x1024
// PNG and drop it in brand/ + every app's assets/ as logo.png +
// icon-only.png. Capacitor-assets then takes over to generate the
// per-platform icon set.
//
// Usage: node scripts/convert-icon.mjs <source-image-path>
//        (defaults to the newest *.tmp / *.webp / *.png in the user's
//         Windows temp directory.)
import sharp from 'sharp';
import {
  readdirSync, statSync, copyFileSync, mkdirSync, existsSync,
} from 'fs';
import { join, basename } from 'path';

function newestImage(dir) {
  let best = null;
  try {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      let st; try { st = statSync(p); } catch (_) { continue; }
      if (!st.isFile()) continue;
      if (st.size < 100 * 1024) continue;       // skip tiny thumbnails
      if (!/\.(tmp|webp|png|jpe?g)$/i.test(f)
        && st.size < 500 * 1024) continue;
      if (!best || st.mtimeMs > best.mtimeMs) {
        best = { path: p, mtimeMs: st.mtimeMs, size: st.size };
      }
    }
  } catch (_) { /* ignore */ }
  return best;
}

const explicit = process.argv[2];
let src = explicit;
if (!src) {
  const tempDir = process.env.TEMP || process.env.TMP
    || 'C:/Users/Work/AppData/Local/Temp';
  const n = newestImage(tempDir);
  if (!n) { console.error('No candidate image in', tempDir); process.exit(1); }
  src = n.path;
  console.log('Picked newest:', src, '(' + Math.round(n.size / 1024) + 'KB)');
}

const brandOut = 'brand/AstroSeer_App_ICON_v2.png';
const apps = ['client-web', 'astro-web', 'admin-web'];
const targets = [brandOut, ...apps.flatMap((a) => [
  `${a}/assets/logo.png`, `${a}/assets/icon-only.png`,
])];

if (!existsSync('brand')) mkdirSync('brand', { recursive: true });

(async () => {
  // Convert once to a clean 1024x1024 PNG so every consumer reads the
  // same canonical asset.
  const buf = await sharp(src).resize(1024, 1024, { fit: 'cover' })
    .png({ compressionLevel: 9 }).toBuffer();
  for (const t of targets) {
    if (!existsSync(t.split('/').slice(0, -1).join('/'))) {
      mkdirSync(t.split('/').slice(0, -1).join('/'), { recursive: true });
    }
    await sharp(buf).toFile(t);
    console.log('wrote', t);
  }
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
