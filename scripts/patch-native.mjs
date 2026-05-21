// Injects the mic/camera permissions Agora calls need into the native
// projects. Capacitor regenerates android/ & ios/ from templates (and CI
// runs `cap add` fresh), so this runs AFTER cap add/sync - locally and in
// the iOS workflow - and is idempotent (safe to run repeatedly).
// Run: node scripts/patch-native.mjs
import {
  readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  APP_BUILD, appVersionName,
} from '../shared/appVersion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Only the apps that make calls. Admin never needs mic/camera.
const APPS = ['client-web', 'astro-web', 'admin-web'];
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
  // Required so an incoming-call FCM can ring on a locked screen
  // (WhatsApp/Skype style heads-up + lock-screen UI). Without this,
  // Android suppresses the call notification's full-screen intent.
  'android.permission.USE_FULL_SCREEN_INTENT',
  // Lets a high-priority FCM message wake the device out of Doze /
  // sleep so the ringer actually fires from a sleeping phone.
  'android.permission.WAKE_LOCK',
  // REQUEST_INSTALL_PACKAGES is intentionally NOT added. Play rejects
  // it for non-installer apps; on Play the store updates the APK so
  // we don't need it. For sideload (astro/admin) Android still asks
  // the user to enable "Install unknown apps" once - same flow.
];

// Permissions previously added that we now want stripped from the
// manifest (e.g. Play-rejected ones). Patch-native removes any line
// that uses them so an old manifest gets cleaned on the next build.
const DROP_PERMS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

function patchAndroid(app) {
  const f = join(ROOT, app, 'android', 'app', 'src', 'main',
    'AndroidManifest.xml');
  if (!existsSync(f)) return `android: skipped (${app}, no project)`;
  let x = readFileSync(f, 'utf8');
  // Strip any permission that's been moved to DROP_PERMS.
  const dropped = [];
  for (const p of DROP_PERMS) {
    const re = new RegExp(`[ \\t]*<uses-permission[^/<>]*android:name="${
      p.replace(/\./g, '\\.')}"[^/<>]*/>\\s*\\n?`, 'g');
    const before = x;
    x = x.replace(re, '');
    if (x !== before) dropped.push(p);
  }
  // Idempotent per-permission: add only the ones not already present,
  // right after the INTERNET permission Capacitor ships with.
  const missing = NEED_PERMS.filter((p) => !x.includes(p));
  if (!missing.length && !dropped.length) {
    return `android: already patched (${app})`;
  }
  if (!missing.length && dropped.length) {
    writeFileSync(f, x);
    return `android: dropped ${dropped.join(', ')} (${app})`;
  }
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

// Install the per-app google-services.json the user generated for the
// new com.astroseer.* Firebase apps (committed at repo root). Each app
// gets ONLY its own config and only if it actually contains that app's
// package (otherwise the Google Services gradle plugin fails the build
// / Firebase native crashes at runtime).
const PKG = {
  'client-web': 'com.astroseer.mobile',
  'astro-web': 'com.astroseer.astrologer',
  'admin-web': 'com.astroseer.admin',
};
const ANDROID_CFG = {
  'client-web': 'com.astroseer.mobile.json',
  'astro-web': 'com.astroseer.astrologer.json',
  'admin-web': 'com.astroseer.admin.json',
};
function pkgsOf(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return (j.client || []).map((c) => c.client_info
      && c.client_info.android_client_info
      && c.client_info.android_client_info.package_name);
  } catch (_) { return null; }
}

function patchGoogleServices(app) {
  const cfg = ANDROID_CFG[app];
  const src = cfg ? join(ROOT, cfg) : join(ROOT, 'google-services.json');
  const destDir = join(ROOT, app, 'android', 'app');
  if (!existsSync(destDir)) return `gservices: skipped (${app})`;
  const dest = join(destDir, 'google-services.json');
  const want = PKG[app];
  // A google-services.json whose package_name does NOT match this app's
  // applicationId makes the Google Services Gradle plugin FAIL the build
  // ("No matching client found"). The plugin only applies when the file
  // exists, so a stale/mismatched one must be removed (push just stays
  // off until a correct file is supplied) rather than break the build.
  const dropStale = () => {
    if (!existsSync(dest)) return false;
    const dp = pkgsOf(dest);
    if (!want || !dp || !dp.includes(want)) {
      try { rmSync(dest); } catch (_) {}
      return true;
    }
    return false;
  };
  if (!existsSync(src)) {
    return dropStale()
      ? `gservices: removed stale (${app}) - push off until new json`
      : `gservices: skipped (${app})`;
  }
  const pkgs = pkgsOf(src);
  if (pkgs === null) return `gservices: bad json (${app})`;
  if (!want || !pkgs.includes(want)) {
    return dropStale()
      ? `gservices: ${want} not in root json - removed stale, push off`
      : `gservices: ${want} NOT in json - ${app} push stays off`;
  }
  writeFileSync(dest, readFileSync(src));
  return `gservices: installed for ${app} (${want})`;
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
