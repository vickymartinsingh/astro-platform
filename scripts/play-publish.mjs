// Automated Google Play release for AstroSeer.
//
// What it does in one run:
//   1. Authenticates via your Google service account JSON.
//   2. Uploads the signed AAB.
//   3. Sets the store-listing title + short description + full
//      description (en-US) from STORE-LISTING.txt or env vars.
//   4. Creates a release on the chosen track (internal | alpha | beta |
//      production) with your release notes.
//   5. Commits the edit -> the release goes live (or enters review).
//
// Prereqs (one-time, ONLY the user can do these in Google's console):
//   A. Play Console -> Setup -> API access -> Link a Google Cloud
//      project -> Create or select a service account.
//   B. Grant the service account "Release manager" (or "Admin") on
//      this app.
//   C. Download the service account's JSON key.
//   D. Save it as:  C:\Users\Work\Desktop\play-service-account.json
//      (or pass --keyFile <path>).
//
// One-time deps in this repo root:
//   npm i -D googleapis
//
// Usage examples:
//   node scripts/play-publish.mjs --aab "C:\Users\...\v1.0.45.aab" \
//        --track internal --notes "Permission cleanup + bug fixes"
//   node scripts/play-publish.mjs --aab "..." --track production
//
// Flags:
//   --aab <path>    REQUIRED. Signed AAB to upload.
//   --track <name>  internal | alpha | beta | production (default: internal)
//   --notes "..."   What's-new text shown to users (max 500 chars).
//   --keyFile <p>   Path to service account JSON (default: Desktop).
//   --package <id>  defaults to com.astroseer.mobile.
//   --listing       Also push store-listing text from STORE-LISTING.txt.
//   --status        draft | inProgress | completed (default: completed)
import { readFileSync, existsSync, createReadStream } from 'fs';
import { join } from 'path';
import { google } from 'googleapis';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const AAB = arg('aab');
const TRACK = arg('track', 'internal');
const NOTES = arg('notes',
  'Bug fixes and improvements.').slice(0, 500);
const KEY_FILE = arg('keyFile',
  'C:\\Users\\Work\\Desktop\\play-service-account.json');
const PKG = arg('package', 'com.astroseer.mobile');
const STATUS = arg('status', 'completed');
const PUSH_LISTING = flag('listing');

if (!AAB) {
  console.error('--aab <path-to-AAB> is required');
  process.exit(1);
}
if (!existsSync(AAB)) { console.error('AAB not found:', AAB); process.exit(1); }
if (!existsSync(KEY_FILE)) {
  console.error('Service account JSON not found:', KEY_FILE);
  console.error('Create one in Play Console -> Setup -> API access.');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

(async () => {
  console.log(`Editing ${PKG}…`);
  // 1. Open an edit.
  const edit = (await publisher.edits.insert({
    packageName: PKG,
  })).data;
  const editId = edit.id;
  console.log(`  edit id: ${editId}`);

  // 2. Upload the AAB.
  console.log(`  uploading AAB ${AAB}…`);
  const up = await publisher.edits.bundles.upload({
    packageName: PKG,
    editId,
    media: {
      mimeType: 'application/octet-stream',
      body: createReadStream(AAB),
    },
  });
  const versionCode = up.data.versionCode;
  console.log(`  uploaded versionCode ${versionCode}`);

  // 3. (Optional) listing fields - en-US.
  if (PUSH_LISTING) {
    const listingPath = join(process.cwd(), '..',
      'AstroSeer_PlayStoreListing', 'STORE-LISTING.txt');
    let title = 'AstroSeer';
    let shortDesc = 'Talk to trusted Vedic astrologers - chat, '
      + 'call & video. Kundli, horoscope.';
    let fullDesc = title;
    if (existsSync(listingPath)) {
      const txt = readFileSync(listingPath, 'utf8');
      const ms = txt.match(/Short description[^:]*:\s*([\s\S]*?)\n\n/);
      const mf = txt.match(/-{10,}\n([\s\S]*?)\n-{10,}/);
      if (ms) shortDesc = ms[1].trim().slice(0, 80);
      if (mf) fullDesc = mf[1].trim().slice(0, 4000);
    }
    await publisher.edits.listings.update({
      packageName: PKG, editId, language: 'en-US',
      requestBody: { title, shortDescription: shortDesc,
        fullDescription: fullDesc },
    });
    console.log('  listing (en-US) updated');
  }

  // 4. Create the release on the chosen track.
  await publisher.edits.tracks.update({
    packageName: PKG, editId, track: TRACK,
    requestBody: {
      track: TRACK,
      releases: [{
        name: `1.0.${versionCode} - automated`,
        versionCodes: [String(versionCode)],
        status: STATUS,
        releaseNotes: [{ language: 'en-US', text: NOTES }],
      }],
    },
  });
  console.log(`  release added to '${TRACK}' (status: ${STATUS})`);

  // 5. Commit.
  await publisher.edits.commit({ packageName: PKG, editId });
  console.log(`✓ Done. versionCode ${versionCode} is live on '${TRACK}'.`);
})().catch((e) => {
  console.error('PUBLISH FAILED:', e && (e.errors || e.message) || e);
  process.exit(1);
});
