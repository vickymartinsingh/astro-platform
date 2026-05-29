// One-shot: replace every em-dash (-, U+2014) and en-dash (-, U+2013)
// with a plain hyphen across all source/text files. Build output and
// vendored code are skipped. Run: node scripts/strip-dashes.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = process.cwd();
const SKIP_DIR = new Set([
  'node_modules', '.next', 'out', 'android', 'ios', '.git', 'build',
  '.vercel', 'platform-tools',
]);
const EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.md', '.txt', '.yml',
  '.yaml', '.html', '.mjs', '.cjs', '.example', '.env', '',
]);
const BIN = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.pdf',
  '.zip', '.jks', '.keystore', '.apk', '.lock']);

let changed = 0; let scanned = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p);
      continue;
    }
    const e = extname(name).toLowerCase();
    if (BIN.has(e)) continue;
    if (e && !EXT.has(e)) continue;
    scanned += 1;
    let txt;
    try { txt = readFileSync(p, 'utf8'); } catch (_) { continue; }
    // Detect any of: em dash (U+2014), en dash (U+2013), horizontal
    // bar (U+2015), figure dash (U+2012), minus sign (U+2212).
    if (!/[-----]/.test(txt)) continue;
    const out = txt.replace(/[-----]/g, '-');
    if (out !== txt) { writeFileSync(p, out); changed += 1;
      console.log('fixed', p.replace(ROOT, '.')); }
  }
}
walk(ROOT);
console.log(`\nscanned ${scanned} files, ${changed} cleaned`);
