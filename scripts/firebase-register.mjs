// Use the Firebase Management API to:
//   1. Add the 3 SHA fingerprints to the com.astroseer.mobile Android app.
//   2. Download a fresh google-services.json with the new OAuth client.
//   3. Create a com.astroseer.mobile iOS app if it doesn't exist.
//   4. Download its GoogleService-Info.plist.
// Replaces the on-disk files used by the build.
import { readFileSync, writeFileSync } from 'fs';
import { google } from 'googleapis';

const KEY = './firebase-key.json';
const PROJECT_ID = 'astrology-2092d';
const PARENT = `projects/${PROJECT_ID}`;
const ANDROID_PKG = 'com.astroseer.mobile';
const IOS_BUNDLE = 'com.astroseer.mobile';

const SHA1_HEXES = [
  'c1ad147cfc0936129b69df459802c344681ccf3a',
  'b679b412ad6eda649976eb71fa58f136f4324137',
  'fbe29b538b9d7b8d2385e5a2bc030a10972e911e7009d67f95d9f476a9d46eb8',
];
const SHA256_HEXES = [
  '68295f5ecaadf16b5962166efd6e498f907ae3d862a146af474b01efd80136fe',
];

const auth = new google.auth.GoogleAuth({
  keyFile: KEY,
  scopes: ['https://www.googleapis.com/auth/firebase',
    'https://www.googleapis.com/auth/cloud-platform'],
});
const fb = google.firebase({ version: 'v1beta1', auth });

const dec = (b64) => Buffer.from(b64, 'base64').toString('utf8');

async function main() {
  // 1. Find Android app.
  const al = await fb.projects.androidApps.list({ parent: PARENT });
  const androidApp = (al.data.apps || []).find(
    (a) => a.packageName === ANDROID_PKG);
  if (!androidApp) {
    console.error('Android app not found:', ANDROID_PKG); process.exit(1);
  }
  console.log('Android app:', androidApp.appId);

  // 2. List existing SHAs, add only missing ones.
  const shaList = await fb.projects.androidApps.sha.list({
    parent: `${PARENT}/androidApps/${androidApp.appId.split('/').pop()
      || androidApp.name.split('/').pop()}`,
  });
  // androidApp.name is "projects/.../androidApps/X"
  const appName = androidApp.name;
  const have = new Set((shaList.data.certificates || [])
    .map((c) => (c.shaHash || '').toLowerCase()));
  const toAdd = [
    ...SHA1_HEXES.map((h) => ({ shaHash: h, certType: 'SHA_1' })),
    ...SHA256_HEXES.map((h) => ({ shaHash: h, certType: 'SHA_256' })),
  ].filter((x) => !have.has(x.shaHash.toLowerCase()));

  for (const cert of toAdd) {
    try {
      await fb.projects.androidApps.sha.create({
        parent: appName, requestBody: cert,
      });
      console.log('  + added', cert.certType, cert.shaHash.slice(0, 12), '…');
    } catch (e) {
      console.error('  ! failed', cert.certType,
        (e.errors || e.message || e));
    }
  }
  if (!toAdd.length) console.log('  (all SHAs already present)');

  // 3. Download fresh google-services.json.
  const cfg = await fb.projects.androidApps.getConfig({ name: `${
    appName}/config` });
  writeFileSync('./com.astroseer.mobile.json',
    dec(cfg.data.configFileContents));
  console.log('Wrote com.astroseer.mobile.json');

  // 4. Find or create iOS app.
  const il = await fb.projects.iosApps.list({ parent: PARENT });
  let iosApp = (il.data.apps || []).find(
    (a) => a.bundleId === IOS_BUNDLE);
  if (!iosApp) {
    console.log('Creating iOS app for', IOS_BUNDLE, '…');
    const opPromise = await fb.projects.iosApps.create({
      parent: PARENT,
      requestBody: { bundleId: IOS_BUNDLE,
        displayName: 'AstroSeer Customer iOS' },
    });
    // Poll the LRO.
    let op = opPromise.data;
    const ops = google.firebase({ version: 'v1beta1', auth }).operations;
    while (!op.done) {
      await new Promise((r) => setTimeout(r, 1200));
      op = (await ops.get({ name: op.name })).data;
    }
    if (op.error) throw new Error(JSON.stringify(op.error));
    iosApp = op.response;
    console.log('  Created iOS app:', iosApp.appId);
  } else {
    console.log('iOS app already exists:', iosApp.appId);
  }

  // 5. Download GoogleService-Info.plist.
  const plistCfg = await fb.projects.iosApps.getConfig({ name: `${
    iosApp.name}/config` });
  writeFileSync('./com.astroseer.mobile.plist',
    dec(plistCfg.data.configFileContents));
  console.log('Wrote com.astroseer.mobile.plist');

  console.log('\nDONE.');
}

main().catch((e) => {
  console.error('FAILED:', e && (e.errors || e.message) || e);
  process.exit(1);
});
