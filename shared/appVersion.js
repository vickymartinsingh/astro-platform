// SINGLE SOURCE OF TRUTH for app version + build number.
//
// `scripts/bump-version.mjs` increments APP_BUILD on every package run,
// so each APK / IPA we produce gets a new, distinct version. Everything
// derives from this: Android versionName/versionCode (patch-native),
// the in-app "you are on an old version" check (client-web/lib/
// appUpdate.js compares APP_BUILD with settings/config.app_latest_build),
// the version shown in Profile, and the admin App Versions panel.
//
// Version string = 1.0.<build>. Per-app suffix lets support tell which
// app a user is on (customer / astrologer / admin).
export const APP_BUILD = 16;
export const APP_VERSION = `1.0.${APP_BUILD}`;

export const APP_SUFFIX = {
  'client-web': 'customer',
  'astro-web': 'astrologer',
  'admin-web': 'admin',
};

// Full version name for a given app workspace key.
export function appVersionName(appKey) {
  const sfx = APP_SUFFIX[appKey] || appKey || 'app';
  return `${APP_VERSION}-${sfx}`;
}
