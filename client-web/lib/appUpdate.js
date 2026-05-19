import { APP_BUILD as BUILD, appVersionName } from '@astro/shared';
import { useSettings } from './useSettings';

// Installed build/version - single source of truth: shared/appVersion.js
// (auto-incremented by scripts/bump-version.mjs every package run). The
// app is "out of date" when settings/config.app_latest_build > APP_BUILD.
export const APP_BUILD = BUILD;
export const APP_VERSION = appVersionName('client-web');

// Reads the admin-managed update info from settings/config (cached by
// useSettings, so it is instant + live, no glitch).
export function useAppUpdate() {
  const { cfg } = useSettings();
  const latestBuild = Number(cfg.app_latest_build || 0);
  const apkUrl = (cfg.app_apk_url || '').trim();
  const storeUrl = (cfg.app_store_url || '').trim();
  // 'store' once the app is on the Play Store, else 'apk' (sideload).
  const mode = cfg.app_update_mode === 'store' ? 'store' : 'apk';
  const target = mode === 'store' ? storeUrl : apkUrl;
  const updateAvailable = latestBuild > APP_BUILD && !!target;
  return {
    updateAvailable,
    upToDate: !updateAvailable,
    currentVersion: APP_VERSION,
    latestVersion: (cfg.app_latest_version || '').trim() || APP_VERSION,
    mode,
    apkUrl,
    storeUrl,
    // What the Update button should open (store link or APK).
    updateUrl: target,
    notes: (cfg.app_update_notes || '').trim(),
    // Admin decides if the launch popup shows (default ON).
    popupEnabled: cfg.app_update_popup !== false,
  };
}

// Trigger the APK download / install. Android then shows its install
// screen (one tap). We cannot fully silent-install from a normal app
// (OS security), but REQUEST_INSTALL_PACKAGES makes it a single tap.
export function startUpdate(apkUrl) {
  if (!apkUrl) return;
  try {
    window.open(apkUrl, '_blank', 'noopener');
  } catch (_) {
    window.location.href = apkUrl;
  }
}
