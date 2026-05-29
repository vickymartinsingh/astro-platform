// Promote an already-uploaded versionCode to another Play Store
// track WITHOUT re-uploading the AAB. Use this to ship the same
// build from internal -> closed (alpha) -> beta -> production.
//
// Usage:
//   node scripts/play-promote.mjs --package com.astroseer.mobile \
//        --versionCode 77 --track alpha --notes "..." \
//        --keyFile "..."
//
// Tracks the API understands:
//   internal     - Internal testing
//   alpha        - Closed testing (default closed track)
//   beta         - Open testing
//   production   - Production
//   <custom>     - any named closed track you created in Play Console
import { existsSync } from 'fs';
import { google } from 'googleapis';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PKG = arg('package');
const VERSION_CODE = arg('versionCode');
const TRACK = arg('track', 'alpha');
const NOTES = arg('notes', 'Promoted to a wider testing audience.')
  .slice(0, 500);
const STATUS = arg('status', 'completed');
const KEY_FILE = arg('keyFile',
  'C:\\Users\\Work\\Desktop\\play-service-account.json');
// Comma-separated ISO 3166 country codes. Empty = all countries
// (which Play Console treats as no targeting = error). We default
// to "IN" since AstroSeer is India-first.
const COUNTRIES = arg('countries', 'IN');

if (!PKG) { console.error('--package required'); process.exit(1); }
if (!VERSION_CODE) {
  console.error('--versionCode required'); process.exit(1);
}
if (!existsSync(KEY_FILE)) {
  console.error('Service account JSON not found:', KEY_FILE);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

(async () => {
  console.log(`Promoting ${PKG} v${VERSION_CODE} -> ${TRACK}…`);
  const edit = (await publisher.edits.insert({
    packageName: PKG,
  })).data;
  const editId = edit.id;
  await publisher.edits.tracks.update({
    packageName: PKG, editId, track: TRACK,
    requestBody: {
      track: TRACK,
      releases: [{
        name: `1.0.${VERSION_CODE} - promote`,
        versionCodes: [String(VERSION_CODE)],
        status: STATUS,
        releaseNotes: [{ language: 'en-US', text: NOTES }],
      }],
    },
  });
  await publisher.edits.commit({ packageName: PKG, editId });
  console.log(`✓ v${VERSION_CODE} now on '${TRACK}' (${STATUS}).`);
})().catch((e) => {
  console.error('PROMOTE FAILED:',
    e && (e.errors || e.message) || e);
  process.exit(1);
});
