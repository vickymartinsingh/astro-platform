// Injects the mic/camera permissions Agora calls need into the native
// projects. Capacitor regenerates android/ & ios/ from templates (and CI
// runs `cap add` fresh), so this runs AFTER cap add/sync — locally and in
// the iOS workflow — and is idempotent (safe to run repeatedly).
// Run: node scripts/patch-native.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Only the apps that make calls. Admin never needs mic/camera.
const APPS = ['client-web', 'astro-web'];
// All apps get the display-name fix (Capacitor only writes strings.xml on
// `cap add`, never on sync, so the renamed app titles must be re-applied).
const NAME_APPS = ['client-web', 'astro-web', 'admin-web'];

// Force the Android launcher label to match capacitor.config.json appName.
function patchAppName(app) {
  const cfgF = join(ROOT, app, 'capacitor.config.json');
  const strF = join(ROOT, app, 'android', 'app', 'src', 'main', 'res',
    'values', 'strings.xml');
  if (!existsSync(cfgF) || !existsSync(strF)) {
    return `name: skipped (${app})`;
  }
  const name = JSON.parse(readFileSync(cfgF, 'utf8')).appName || 'App';
  let x = readFileSync(strF, 'utf8');
  x = x.replace(/(<string name="app_name">)[^<]*(<\/string>)/,
    `$1${name}$2`);
  x = x.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/,
    `$1${name}$2`);
  writeFileSync(strF, x);
  return `name: "${name}" (${app})`;
}

const ANDROID_PERMS = `
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />`;

function patchAndroid(app) {
  const f = join(ROOT, app, 'android', 'app', 'src', 'main',
    'AndroidManifest.xml');
  if (!existsSync(f)) return `android: skipped (${app}, no project)`;
  let x = readFileSync(f, 'utf8');
  if (x.includes('android.permission.RECORD_AUDIO')) {
    return `android: already patched (${app})`;
  }
  // Add right after the INTERNET permission Capacitor ships with.
  x = x.replace(
    /(<uses-permission android:name="android\.permission\.INTERNET" \/>)/,
    `$1${ANDROID_PERMS}`);
  writeFileSync(f, x);
  return `android: patched (${app})`;
}

const IOS_KEYS = `	<key>NSCameraUsageDescription</key>
	<string>Camera is used for video consultations with astrologers.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Microphone is used for voice and video consultations.</string>
`;

function patchIos(app) {
  const f = join(ROOT, app, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(f)) return `ios: skipped (${app}, no project)`;
  let x = readFileSync(f, 'utf8');
  if (x.includes('NSMicrophoneUsageDescription')) {
    return `ios: already patched (${app})`;
  }
  // Insert the keys just before the final closing </dict>.
  const i = x.lastIndexOf('</dict>');
  if (i === -1) return `ios: no </dict> (${app})`;
  x = x.slice(0, i) + IOS_KEYS + x.slice(i);
  writeFileSync(f, x);
  return `ios: patched (${app})`;
}

// Copy the repo-root google-services.json into an app's android project
// ONLY if it contains that app's package (otherwise the Google Services
// gradle plugin fails the build / Firebase native crashes at runtime).
const PKG = {
  'client-web': 'com.astroconnect.app',
  'astro-web': 'com.astroconnect.astrologer',
};
function patchGoogleServices(app) {
  const src = join(ROOT, 'google-services.json');
  const destDir = join(ROOT, app, 'android', 'app');
  if (!existsSync(src) || !existsSync(destDir)) {
    return `gservices: skipped (${app})`;
  }
  let pkgs = [];
  try {
    const j = JSON.parse(readFileSync(src, 'utf8'));
    pkgs = (j.client || []).map((c) => c.client_info
      && c.client_info.android_client_info
      && c.client_info.android_client_info.package_name);
  } catch (_) { return `gservices: bad json (${app})`; }
  if (!pkgs.includes(PKG[app])) {
    return `gservices: ${PKG[app]} NOT in json — ${app} push stays off`;
  }
  writeFileSync(join(destDir, 'google-services.json'),
    readFileSync(src));
  return `gservices: installed for ${app} (${PKG[app]})`;
}

for (const app of APPS) {
  console.log(patchAndroid(app));
  console.log(patchIos(app));
  console.log(patchGoogleServices(app));
}
for (const app of NAME_APPS) {
  console.log(patchAppName(app));
}
console.log('patch-native done');
