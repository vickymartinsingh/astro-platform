import { useEffect, useState } from 'react';
import { APP_BUILD as BUILD, appVersionName, db } from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';

// Installed build/version - single source of truth: shared/appVersion.js
// (auto-incremented by scripts/bump-version.mjs every package run). The
// app is "out of date" when settings/appLinks.{app}.latestBuild > APP_BUILD.
//
// 2026-06-07 spec rewrite: multi-app. The settings/appLinks doc holds
// one block per app key (customer / astrologer / admin / hr / support /
// etc.) so the operator can configure Play Store URL + latest build
// independently. The active app is read from NEXT_PUBLIC_APP (set in
// each workspace's next.config.js), with a 'customer' fallback for
// safety.
export const APP_BUILD = BUILD;
export const APP_VERSION = appVersionName('client-web');
const APP_KEY = (typeof process !== 'undefined' && process.env
  && process.env.NEXT_PUBLIC_APP) || 'customer';

export function useAppUpdate() {
  const [block, setBlock] = useState(null);
  useEffect(() => {
    const ref = doc(db, 'settings', 'appLinks');
    return onSnapshot(ref, (s) => {
      const d = s.exists() ? s.data() : {};
      const entry = d[APP_KEY] || d.customer || {};
      setBlock(entry);
    }, () => setBlock({}));
  }, []);
  const cur = block || {};
  const latestBuild = Number(cur.latestBuild || 0);
  const storeUrl = String(cur.storeUrl || '').trim();
  const latestVersion = String(cur.latestVersion || '').trim()
    || (latestBuild ? `1.0.${latestBuild}` : APP_VERSION);
  const notes = String(cur.notes || '').trim();
  const appName = String(cur.displayName || '').trim()
    || displayNameFor(APP_KEY);
  const sizeMb = String(cur.sizeMb || '').trim();
  const rating = String(cur.rating || '').trim();
  // Per spec: "must show only when the new update is available."
  // Both a higher build AND a configured store URL are required so
  // the Update button has a target.
  const updateAvailable = latestBuild > APP_BUILD && !!storeUrl;
  // Admin can hard-force a build the user MUST take. Soft-update
  // otherwise (the Close X dismisses).
  const minRequiredBuild = Number(cur.minRequiredBuild || 0);
  const requiredUpdate = updateAvailable
    && minRequiredBuild > APP_BUILD;
  return {
    updateAvailable, requiredUpdate, upToDate: !updateAvailable,
    currentBuild: APP_BUILD, currentVersion: APP_VERSION,
    latestBuild, latestVersion,
    storeUrl, updateUrl: storeUrl,
    notes, appName, sizeMb, rating, appKey: APP_KEY,
    popupEnabled: cur.popupEnabled !== false,
  };
}

function displayNameFor(key) {
  return ({
    customer: 'AstroSeer',
    astrologer: 'AstroSeer Astrologer',
    admin: 'AstroSeer Admin',
    hr: 'AstroSeer HR',
    support: 'AstroSeer Support',
  })[key] || 'AstroSeer';
}

// Trigger the Play Store deep-link. Android opens the install dialog
// in-place via the market:// scheme on devices that have Play Store
// installed (no browser detour) - falls back to https for desktop /
// Capacitor previews.
export function startUpdate(storeUrl) {
  if (!storeUrl) return;
  try {
    const m = storeUrl.match(/[?&]id=([\w.]+)/);
    if (m && typeof window !== 'undefined' && window.Capacitor
        && window.Capacitor.isNativePlatform()) {
      window.location.href = `market://details?id=${m[1]}`;
      return;
    }
    window.open(storeUrl, '_blank', 'noopener');
  } catch (_) {
    window.location.href = storeUrl;
  }
}

// Local-storage gate so a soft-update popup doesn't re-open every
// minute. Once the user dismisses for a given latestBuild we suppress
// until a new build appears.
export function shouldShowPopup(latestBuild) {
  if (typeof window === 'undefined') return false;
  try {
    const k = `as_upd_dismiss_${APP_KEY}`;
    const dismissed = Number(window.localStorage.getItem(k) || 0);
    return latestBuild > dismissed;
  } catch (_) { return true; }
}

export function dismissPopup(latestBuild) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`as_upd_dismiss_${APP_KEY}`,
      String(latestBuild));
  } catch (_) {}
}
