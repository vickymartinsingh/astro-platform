// Force-roll out a draft release on a track WITHOUT a human click.
// Tries every status transition Google's API allows for a "new app"
// in draft state.
import { existsSync } from 'fs';
import { google } from 'googleapis';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PKG = arg('package');
const VERSION_CODE = arg('versionCode');
const TRACK = arg('track', 'alpha');
const KEY_FILE = arg('keyFile',
  'C:\\Users\\Work\\Desktop\\play-service-account.json');

if (!PKG || !VERSION_CODE) {
  console.error('Need --package and --versionCode');
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

const STATUSES = ['completed', 'inProgress', 'halted'];

(async () => {
  for (const status of STATUSES) {
    try {
      console.log(`\nTrying status='${status}' on ${TRACK}…`);
      const edit = (await publisher.edits.insert({
        packageName: PKG,
      })).data;
      const editId = edit.id;
      await publisher.edits.tracks.update({
        packageName: PKG, editId, track: TRACK,
        requestBody: {
          track: TRACK,
          releases: [{
            name: `1.0.${VERSION_CODE}`,
            versionCodes: [String(VERSION_CODE)],
            status,
            userFraction: status === 'inProgress' ? 1.0 : undefined,
            releaseNotes: [{ language: 'en-US',
              text: 'Auto-promote attempt.' }],
          }],
        },
      });
      await publisher.edits.commit({ packageName: PKG, editId });
      console.log(`✓ SUCCESS with status='${status}'.`);
      return;
    } catch (e) {
      const msg = e && (e.message || e.errors) || String(e);
      console.log(`  rejected: ${typeof msg === 'string'
        ? msg : JSON.stringify(msg)}`);
    }
  }
  console.error('\nALL STATUSES REJECTED. App is in draft state and '
    + 'Google requires a Play Console "Start rollout" click before '
    + 'the first release of a new app. This is non-negotiable.');
  process.exit(1);
})();
