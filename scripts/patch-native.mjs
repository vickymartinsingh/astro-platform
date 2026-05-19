// Injects the mic/camera permissions Agora calls need into the native
// projects. Capacitor regenerates android/ & ios/ from templates (and CI
// runs `cap add` fresh), so this runs AFTER cap add/sync - locally and in
// the iOS workflow - and is idempotent (safe to run repeatedly).
// Run: node scripts/patch-native.mjs
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  APP_BUILD, appVersionName,
} from '../shared/appVersion.js';

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

// Distinct Android versionName per app so support can tell which app a
// user is on (android/ is gitignored & regenerated, so re-apply every
// build). Single source of truth - bump here per release.
// Derived from the single source of truth (shared/appVersion.js).
// versionName = 1.0.<build>-<app>, versionCode = build (so a higher
// build always installs over the old one and the update check fires).
function patchVersion(app) {
  const f = join(ROOT, app, 'android', 'app', 'build.gradle');
  if (!existsSync(f)) return `version: skipped (${app})`;
  const v = appVersionName(app);
  let x = readFileSync(f, 'utf8');
  x = x.replace(/versionName\s+"[^"]*"/, `versionName "${v}"`);
  x = x.replace(/versionCode\s+\d+/, `versionCode ${APP_BUILD}`);
  writeFileSync(f, x);
  return `version: ${v} (code ${APP_BUILD}) (${app})`;
}

const NEED_PERMS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
  // Lets the in-app "Update" open the downloaded APK installer in one
  // tap (Android still shows its own install confirmation - a normal
  // app cannot fully silent-install, that needs system privileges).
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

function patchAndroid(app) {
  const f = join(ROOT, app, 'android', 'app', 'src', 'main',
    'AndroidManifest.xml');
  if (!existsSync(f)) return `android: skipped (${app}, no project)`;
  let x = readFileSync(f, 'utf8');
  // Idempotent per-permission: add only the ones not already present,
  // right after the INTERNET permission Capacitor ships with.
  const missing = NEED_PERMS.filter((p) => !x.includes(p));
  if (!missing.length) return `android: already patched (${app})`;
  let block = missing
    .map((p) => `\n    <uses-permission android:name="${p}" />`).join('');
  if (!x.includes('android.hardware.camera')) {
    block += '\n    <uses-feature android:name="android.hardware.camera"'
      + ' android:required="false" />';
  }
  x = x.replace(
    /(<uses-permission android:name="android\.permission\.INTERNET" \/>)/,
    `$1${block}`);
  writeFileSync(f, x);
  return `android: added ${missing.join(', ')} (${app})`;
}

// Clear FLAG_SECURE so the OS allows screenshots / screen recording in
// the app (nothing here needs to block it). Capacitor regenerates
// MainActivity on `cap add`, so this rewrites it every run. Idempotent;
// derives the package from the existing file.
function patchMainActivity(app) {
  const base = join(ROOT, app, 'android', 'app', 'src', 'main', 'java');
  if (!existsSync(base)) return `mainactivity: skipped (${app})`;
  const found = [];
  (function find(dir) {
    let entries = [];
    try { entries = readdirSync(dir); } catch (_) { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch (_) { continue; }
      if (st.isDirectory()) find(p);
      else if (e === 'MainActivity.java') found.push(p);
    }
  }(base));
  if (!found.length) return `mainactivity: not found (${app})`;
  const f = found[0];
  const cur = readFileSync(f, 'utf8');
  const pkg = (cur.match(/package\s+([\w.]+);/) || [])[1];
  if (!pkg) return `mainactivity: no package (${app})`;
  const out = `package ${pkg};

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Screenshots and screen recording are allowed (no FLAG_SECURE).
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
  }
}
`;
  if (cur === out) return `mainactivity: already patched (${app})`;
  writeFileSync(f, out);
  return `mainactivity: patched (${app}, ${pkg})`;
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

// Native Google sign-in on iOS needs the Google URL scheme
// (REVERSED_CLIENT_ID from GoogleService-Info.plist) in Info.plist.
// No-op when there is no GoogleService-Info.plist (web fallback).
function patchIosGoogle(app) {
  const dir = join(ROOT, app, 'ios', 'App', 'App');
  const gsi = join(dir, 'GoogleService-Info.plist');
  const info = join(dir, 'Info.plist');
  if (!existsSync(gsi) || !existsSync(info)) {
    return `ios-google: skipped (${app})`;
  }
  const g = readFileSync(gsi, 'utf8');
  const m = g.match(
    /<key>REVERSED_CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/);
  if (!m) return `ios-google: no REVERSED_CLIENT_ID (${app})`;
  const scheme = m[1];
  let x = readFileSync(info, 'utf8');
  if (x.includes(scheme)) return `ios-google: already (${app})`;
  if (x.includes('<key>CFBundleURLTypes</key>')) {
    x = x.replace(/(<key>CFBundleURLSchemes<\/key>\s*<array>)/,
      `$1\n\t\t\t\t<string>${scheme}</string>`);
  } else {
    const block = '\t<key>CFBundleURLTypes</key>\n\t<array>\n'
      + '\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n'
      + `\t\t\t<array>\n\t\t\t\t<string>${scheme}</string>\n`
      + '\t\t\t</array>\n\t\t</dict>\n\t</array>\n';
    const i = x.lastIndexOf('</dict>');
    if (i === -1) return `ios-google: no </dict> (${app})`;
    x = x.slice(0, i) + block + x.slice(i);
  }
  writeFileSync(info, x);
  return `ios-google: URL scheme added (${app})`;
}

// Stamp the iOS version (CFBundleShortVersionString) + build
// (CFBundleVersion) from the single source so IPAs carry the same
// version as Android. Only runs in the iOS CI (ios/ exists there).
function patchIosVersion(app) {
  const f = join(ROOT, app, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(f)) return `ios-version: skipped (${app})`;
  let x = readFileSync(f, 'utf8');
  const set = (key, val) => {
    const re = new RegExp(
      `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (re.test(x)) x = x.replace(re, `$1${val}$2`);
  };
  set('CFBundleShortVersionString', appVersionName(app));
  set('CFBundleVersion', String(APP_BUILD));
  writeFileSync(f, x);
  return `ios-version: ${appVersionName(app)} (${APP_BUILD}) (${app})`;
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
    return `gservices: ${PKG[app]} NOT in json - ${app} push stays off`;
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
  console.log(patchMainActivity(app));
  console.log(patchVersion(app));
  console.log(patchIosVersion(app));
  console.log(patchIosGoogle(app));
}
console.log('patch-native done');
