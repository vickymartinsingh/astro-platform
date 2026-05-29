// Promote an EXISTING uploaded versionCode to another track.
// Useful when an AAB is already on (e.g.) 'internal' and you want
// to push the same build to 'beta' or 'alpha' without re-uploading.
//
//   node scripts/_promote-to-track.mjs \
//     --package com.astroseer.mobile \
//     --versionCode 79 \
//     --track beta \
//     --notes "..." \
//     --keyFile play-publisher/astrology-2092d-b485a2e0617a.json
import { existsSync } from 'fs';
import { google } from 'googleapis';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PKG = arg('package');
const VERSION_CODE = arg('versionCode');
const TRACK = arg('track');
const STATUS = arg('status', 'completed');
const NOTES = arg('notes', 'Promoted from internal.').slice(0, 500);
const KEY_FILE = arg('keyFile');

if (!PKG || !VERSION_CODE || !TRACK || !KEY_FILE) {
  console.error('Need --package, --versionCode, --track, --keyFile');
  process.exit(1);
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
  console.log(`Promoting ${PKG} versionCode ${VERSION_CODE} to ${TRACK}...`);
  const edit = (await publisher.edits.insert({
    packageName: PKG,
  })).data;
  const editId = edit.id;
  const release = {
    name: `1.0.${VERSION_CODE}`,
    versionCodes: [String(VERSION_CODE)],
    status: STATUS,
    releaseNotes: [{ language: 'en-US', text: NOTES }],
  };
  await publisher.edits.tracks.update({
    packageName: PKG, editId, track: TRACK,
    requestBody: { track: TRACK, releases: [release] },
  });
  await publisher.edits.commit({ packageName: PKG, editId });
  console.log(`Done. versionCode ${VERSION_CODE} now on '${TRACK}'.`);
})().catch((e) => {
  console.error('PROMOTE FAILED:', (e && (e.errors || e.message)) || e);
  process.exit(1);
});
