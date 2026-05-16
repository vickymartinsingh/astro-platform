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

for (const app of APPS) {
  console.log(patchAndroid(app));
  console.log(patchIos(app));
}
console.log('patch-native done');
