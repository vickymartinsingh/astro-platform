// Increments APP_BUILD in shared/appVersion.js by 1. Run before every
// package/publish so each APK / IPA gets a new version. The version
// string (1.0.<build>) and Android versionCode follow automatically.
// Run: node scripts/bump-version.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = join(ROOT, 'shared', 'appVersion.js');
const src = readFileSync(f, 'utf8');
const m = src.match(/export const APP_BUILD = (\d+);/);
if (!m) {
  console.error('bump-version: APP_BUILD not found');
  process.exit(1);
}
const next = Number(m[1]) + 1;
writeFileSync(f, src.replace(
  /export const APP_BUILD = \d+;/,
  `export const APP_BUILD = ${next};`));
console.log(`bump-version: APP_BUILD ${m[1]} -> ${next} `
  + `(version 1.0.${next})`);
