// Walk the repo and replace every em-dash ( - , U+2014) with " - "
// in source/markdown files. Skips node_modules, .git, .next, out, dist,
// build, android/.gradle, ios/Pods. Reports per-file replacement counts.
//
// Rule (from product owner, repeated multiple times): em-dashes are
// strictly prohibited platform-wide. They are also collapsed in any
// double spaces left behind ("text - text" -> "text - text", not
// "text  -  text").
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.md', '.html', '.css', '.json', '.yml', '.yaml']);
const SKIP = new Set(['node_modules', '.git', '.next', 'out', 'dist',
  'build', '.gradle', 'Pods', '_pdf-out', 'Icons', 'ios', 'android']);

let changedFiles = 0;
let totalSubs = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch (_) { return; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch (_) { continue; }
    if (s.isDirectory()) { walk(p); continue; }
    const dot = name.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = name.slice(dot).toLowerCase();
    if (!EXT.has(ext)) continue;
    let txt;
    try { txt = readFileSync(p, 'utf8'); } catch (_) { continue; }
    if (txt.indexOf(' - ') === -1) continue;
    // Replace em-dash + neighbouring spaces with a single " - ".
    // " - " -> " - ", "word - word" -> "word - word".
    const before = txt;
    const after = before
      .replace(/\s* - \s*/g, ' - ')
      // Tidy multiple spaces that may result from prior collapsing.
      .replace(/ {2,}/g, (m, _i, str) => (str.includes('\n') ? m : ' '));
    if (after !== before) {
      const count = (before.match(/ - /g) || []).length;
      writeFileSync(p, after, 'utf8');
      changedFiles += 1;
      totalSubs += count;
      console.log(`  ${count.toString().padStart(3)}  ${
        p.replace(ROOT, '').replace(/^[\\/]/, '')}`);
    }
  }
}

console.log('strip-em-dashes: walking', ROOT);
walk(ROOT);
console.log(`\ndone: ${totalSubs} em-dashes replaced in `
  + `${changedFiles} files.`);
