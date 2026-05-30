// Pushes Play Store listing (title, descriptions, icon, feature
// graphic, screenshots) WITHOUT uploading a new AAB. Use this when
// you have already uploaded the bundle and just want to fill the
// store-listing details to move the app out of Draft state.
//
// Usage:
//   node scripts/play-update-listing.mjs --package com.astroseer.mobile \
//        --title "AstroSeer" \
//        --short "Talk to verified Vedic astrologers - chat call video" \
//        --fullFile "path/to/full-description.txt" \
//        --icon "path/to/icon-512.png" \
//        --feature "path/to/feature-1024x500.png" \
//        --screenshots "path/to/screenshots/*.png" \
//        --keyFile "..." \
//        --homepage "https://astroseer.in" \
//        --privacy "https://astroseer.in/privacy" \
//        --email "support@astroseer.in"
//
// Only --package and --keyFile are mandatory. Skip flags for fields
// you don't want to update.

import { readFileSync, existsSync, createReadStream } from 'fs';
import { extname } from 'path';
import { google } from 'googleapis';
import { globSync } from 'glob';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PKG = arg('package');
const KEY_FILE = arg('keyFile',
  'C:\\Users\\Work\\Desktop\\play-service-account.json');
const TITLE = arg('title');
const SHORT = arg('short');
const FULL_FILE = arg('fullFile');
const ICON = arg('icon');
const FEATURE = arg('feature');
const SCREENSHOTS = arg('screenshots');
const HOMEPAGE = arg('homepage');
const PRIVACY = arg('privacy');
const EMAIL = arg('email');
const PHONE = arg('phone');

if (!PKG) { console.error('--package required'); process.exit(1); }
if (!existsSync(KEY_FILE)) {
  console.error('Service account JSON not found:', KEY_FILE);
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

function readFullDesc() {
  if (!FULL_FILE) return null;
  if (!existsSync(FULL_FILE)) {
    console.warn('Full description file missing:', FULL_FILE);
    return null;
  }
  return readFileSync(FULL_FILE, 'utf8').slice(0, 4000);
}

async function uploadImage(editId, kind, path) {
  if (!existsSync(path)) {
    console.warn(`  ${kind} skipped (file missing): ${path}`);
    return;
  }
  const ext = extname(path).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg' : 'image/png';
  await publisher.edits.images.upload({
    packageName: PKG, editId,
    language: 'en-US',
    imageType: kind,
    media: { mimeType: mime, body: createReadStream(path) },
  });
  console.log(`  uploaded ${kind}: ${path}`);
}

(async () => {
  console.log(`Editing ${PKG}…`);
  const edit = (await publisher.edits.insert({
    packageName: PKG,
  })).data;
  const editId = edit.id;
  console.log(`  edit id: ${editId}`);

  // 1. Listing text (en-US).
  if (TITLE || SHORT || FULL_FILE) {
    const requestBody = { language: 'en-US' };
    if (TITLE) requestBody.title = TITLE.slice(0, 30);
    if (SHORT) requestBody.shortDescription = SHORT.slice(0, 80);
    const full = readFullDesc();
    if (full) requestBody.fullDescription = full;
    await publisher.edits.listings.update({
      packageName: PKG, editId, language: 'en-US',
      requestBody,
    });
    console.log(`  listing text updated`);
  }

  // 2. Icon (512x512).
  if (ICON) await uploadImage(editId, 'icon', ICON);

  // 3. Feature graphic (1024x500).
  if (FEATURE) await uploadImage(editId, 'featureGraphic', FEATURE);

  // 4. Phone screenshots. Use glob if --screenshots is a wildcard.
  if (SCREENSHOTS) {
    const files = SCREENSHOTS.includes('*')
      ? globSync(SCREENSHOTS)
      : [SCREENSHOTS];
    for (const f of files) {
      // eslint-disable-next-line no-await-in-loop
      await uploadImage(editId, 'phoneScreenshots', f);
    }
  }

  // 5. Contact details (web UI calls this "store presence").
  if (HOMEPAGE || PRIVACY || EMAIL || PHONE) {
    // The androidpublisher edits API does not expose
    // privacy/homepage/email on listings.update directly; those
    // sit under a separate `Details` resource. Older API versions
    // exposed it under `edits.details.update`. Try it - if it
    // is not available the catch leaves them unset and the user
    // can fill them via web UI.
    try {
      const body = {};
      if (HOMEPAGE) body.contactWebsite = HOMEPAGE;
      if (EMAIL) body.contactEmail = EMAIL;
      if (PHONE) body.contactPhone = PHONE;
      // defaultLanguage MUST stay - Play API rejects details
      // without it.
      body.defaultLanguage = 'en-US';
      await publisher.edits.details.update({
        packageName: PKG, editId, requestBody: body,
      });
      console.log(`  contact details updated`);
    } catch (e) {
      console.warn(`  contact details skipped: `
        + `${(e && e.message) || e}`);
    }
  }

  // 6. Commit the edit.
  await publisher.edits.commit({ packageName: PKG, editId });
  console.log(`✓ Listing for ${PKG} committed.`);
})().catch((e) => {
  console.error('LISTING UPDATE FAILED:',
    e && (e.errors || e.message) || e);
  process.exit(1);
});
