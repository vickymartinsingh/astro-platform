// OTA web bundle publisher for AstroSeer's three Capacitor apps.
//
// What it does:
//   1. For each app (client-web / astro-web / admin-web): runs the
//      Next.js static export (CAPACITOR=true npm run build).
//   2. Zips the resulting `out/` folder into a single archive per app
//      named bundle-<APP_BUILD>-<UNIX_SEC>.zip.
//   3. Uploads the zip to Firebase Storage at:
//        gs://<bucket>/ota/<channel>/bundle-<APP_BUILD>-<sec>.zip
//   4. Writes/overwrites the channel manifest at:
//        gs://<bucket>/ota/<channel>/manifest.json
//      with { version, url, sessionKey, checksum }. The
//      @capgo/capacitor-updater plugin embedded in each app polls
//      this manifest on every launch + on resume, downloads the zip
//      if the version is newer than what's installed, and swaps it
//      in on next app start.
//
// IMPORTANT - what OTA can / cannot ship:
//   YES  - Next.js pages, React components, CSS, public images,
//          shared services, any web-layer change
//   NO   - Capacitor plugin upgrades, new gradle deps, AndroidManifest
//          changes, Info.plist changes, iOS native code. Those still
//          require a full APK / IPA rebuild + Play Store / App Store
//          submission.
//
// Prereqs:
//   - The capgo plugin must already be in the installed APK / IPA
//     (v79+). Older APKs (v78 and below) have no plugin so they
//     stay on whatever bundle they were built with.
//   - Firebase service account JSON at firebase-key.json (already in
//     repo root for our other tooling).
//   - The Storage bucket must allow public read on /ota/*. Set with
//     firebase storage:rules or via the Console.
//
// Usage:
//   node scripts/ota-publish.mjs                 # all three apps
//   node scripts/ota-publish.mjs --app customer  # one app only
//   node scripts/ota-publish.mjs --skip-build    # skip Next.js build
//
import {
  readFileSync, existsSync, statSync, createWriteStream,
  mkdirSync, rmSync,
} from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { createHash } from 'crypto';
import archiver from 'archiver';
import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { APP_BUILD } from '../shared/appVersion.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const ONLY_APP = arg('app');
const SKIP_BUILD = flag('skip-build');
const KEY_FILE = arg('keyFile', 'firebase-key.json');
const BUCKET = arg('bucket', 'astrology-2092d.firebasestorage.app');

const APPS = [
  { key: 'client-web', channel: 'customer' },
  { key: 'astro-web', channel: 'astrologer' },
  { key: 'admin-web', channel: 'admin' },
];

const wanted = ONLY_APP
  ? APPS.filter((a) => a.channel === ONLY_APP
    || a.key === ONLY_APP)
  : APPS;

if (!existsSync(KEY_FILE)) {
  console.error(`Firebase service account JSON not found: ${KEY_FILE}`);
  process.exit(1);
}
initializeApp({
  credential: cert(JSON.parse(readFileSync(KEY_FILE, 'utf8'))),
  storageBucket: BUCKET,
});
const bucket = getStorage().bucket();

function zipDir(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = createWriteStream(outZip);
    stream.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(stream);
    // Capacitor expects the bundle to look exactly like the web root
    // (index.html at the top, no leading folder). archiver glob does
    // exactly that when `cwd` is the source dir and pattern is **.
    archive.glob('**/*', { cwd: srcDir, dot: true });
    archive.finalize();
  });
}

async function buildOne(app) {
  if (SKIP_BUILD) {
    console.log(`[${app.key}] skip-build`);
    return;
  }
  console.log(`[${app.key}] building Next.js export...`);
  execSync(`npm run build --workspace ${app.key}`, {
    stdio: 'inherit',
    env: { ...process.env, CAPACITOR: 'true' },
  });
}

async function publishOne(app) {
  const outDir = join(app.key, 'out');
  if (!existsSync(outDir)) {
    console.error(`[${app.key}] no out/ folder - did the build fail?`);
    process.exit(1);
  }
  const stamp = Math.floor(Date.now() / 1000);
  const tmpDir = join('_pdf-out', '_ota');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const zipPath = join(tmpDir, `${app.channel}-${APP_BUILD}-${stamp}.zip`);
  console.log(`[${app.key}] zipping -> ${zipPath}`);
  await zipDir(outDir, zipPath);
  const sz = statSync(zipPath).size;
  console.log(`[${app.key}] zip size: `
    + `${Math.round(sz / 1024 / 1024 * 10) / 10} MB`);
  const buf = readFileSync(zipPath);
  const checksum = createHash('sha256').update(buf).digest('hex');
  const remoteZip = `ota/${app.channel}/`
    + `bundle-${APP_BUILD}-${stamp}.zip`;
  const manifestPath = `ota/${app.channel}/manifest.json`;
  console.log(`[${app.key}] uploading ${remoteZip}...`);
  await bucket.upload(zipPath, {
    destination: remoteZip,
    metadata: { contentType: 'application/zip',
      cacheControl: 'public, max-age=31536000, immutable' },
  });
  await bucket.file(remoteZip).makePublic();
  const publicZipUrl = `https://firebasestorage.googleapis.com/v0/b/`
    + `${BUCKET}/o/${encodeURIComponent(remoteZip)}?alt=media`;
  const manifest = {
    version: `${APP_BUILD}.${stamp}`,
    url: publicZipUrl,
    sessionKey: '',
    checksum,
    builtAt: new Date().toISOString(),
  };
  console.log(`[${app.key}] writing manifest ${manifestPath}`);
  await bucket.file(manifestPath).save(JSON.stringify(manifest, null, 2), {
    contentType: 'application/json',
    metadata: { cacheControl: 'public, max-age=60' },
  });
  await bucket.file(manifestPath).makePublic();
  rmSync(zipPath);
  console.log(`[${app.key}] DONE - version ${manifest.version}`);
  return manifest;
}

(async () => {
  for (const app of wanted) {
    await buildOne(app);
    await publishOne(app);
  }
  console.log('\nOTA publish complete. Installed apps with the capgo '
    + 'plugin (v79+) will pick this up on next launch.');
})().catch((e) => {
  console.error('OTA PUBLISH FAILED:', e && e.stack || e);
  process.exit(1);
});
