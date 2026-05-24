// App release registry.
//
// Every published app build (61, 62, 63, ...) is stored as a doc at
// `appReleases/{build}` with:
//   { build:int, version:'1.0.62', apkUrl, storeUrl, notes,
//     releasedAt, releasedBy, channel:'apk'|'store' }
//
// The admin /admin-appupdate page lists these in a dropdown (latest
// first) so the operator no longer has to remember + type the build
// number. Selecting a release immediately writes the chosen build /
// version / URL / notes back to `settings/config`, which is what the
// customer + astrologer apps actually read to decide whether to show
// the "update available" banner + popup.
//
// "Auto-detect": when the admin opens the page we call
// seedFromAppVersion() which ensures appReleases/<APP_BUILD> exists
// (APP_BUILD is the value baked into the running admin app's bundle
// via shared/appVersion.js). So the dropdown always knows about at
// least the build of the codebase the admin is currently using.
import {
  doc, getDoc, setDoc, getDocs, collection, query, orderBy,
  serverTimestamp, deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { APP_BUILD, APP_VERSION } from '../appVersion.js';

// Coerce anything the admin types into a clean whole integer. Stops the
// classic "I typed 1.062 in a number field" bug where the saved value
// was a decimal smaller than the installed build, so no banner ever
// showed.
export function asBuild(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function listReleases() {
  try {
    const snap = await getDocs(query(collection(db, 'appReleases'),
      orderBy('build', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // Fallback if index missing: read all, sort client-side.
    try {
      const snap = await getDocs(collection(db, 'appReleases'));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (Number(b.build) || 0) - (Number(a.build) || 0));
    } catch (_2) { return []; }
  }
}

export async function getRelease(build) {
  const b = asBuild(build);
  if (!b) return null;
  const s = await getDoc(doc(db, 'appReleases', String(b)));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Idempotent. If the build already exists, merges in the new fields
// (so the operator can update an existing release's APK link or
// notes). Otherwise creates a fresh release entry.
export async function registerRelease({
  build, version, apkUrl, storeUrl, notes, channel, releasedBy,
}) {
  const b = asBuild(build);
  if (!b) throw new Error('build must be a positive integer');
  const ref = doc(db, 'appReleases', String(b));
  const existing = await getDoc(ref);
  await setDoc(ref, {
    build: b,
    version: String(version || `1.0.${b}`),
    apkUrl: String(apkUrl || '').trim(),
    storeUrl: String(storeUrl || '').trim(),
    notes: String(notes || ''),
    channel: channel === 'store' ? 'store' : 'apk',
    releasedBy: releasedBy || '',
    releasedAt: existing.exists() && existing.data().releasedAt
      ? existing.data().releasedAt
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { success: true, build: b };
}

export async function deleteRelease(build) {
  const b = asBuild(build);
  if (!b) return false;
  try { await deleteDoc(doc(db, 'appReleases', String(b))); return true; }
  catch (_) { return false; }
}

// Make sure the build the admin app itself was compiled against is in
// the registry. Also one-shot migrate any legacy settings/config.
// app_latest_build value (the operator typed it manually before this
// page existed) so the dropdown isn't empty on first open. Run on
// page mount.
export async function seedFromAppVersion() {
  // 1. Seed the admin-app build.
  if (APP_BUILD) {
    const existing = await getRelease(APP_BUILD);
    if (!existing) {
      await registerRelease({
        build: APP_BUILD, version: APP_VERSION,
        notes: 'Auto-detected from admin app bundle.',
        channel: 'apk',
      });
    }
  }
  // 2. Migrate any legacy manually-typed published value.
  try {
    const s = await getDoc(doc(db, 'settings', 'config'));
    if (s.exists()) {
      const cfg = s.data();
      const legacyBuild = asBuild(cfg.app_latest_build);
      if (legacyBuild && !(await getRelease(legacyBuild))) {
        await registerRelease({
          build: legacyBuild,
          version: cfg.app_latest_version || `1.0.${legacyBuild}`,
          apkUrl: cfg.app_apk_url || '',
          storeUrl: cfg.app_store_url || '',
          notes: cfg.app_update_notes || '',
          channel: cfg.app_update_mode === 'store' ? 'store' : 'apk',
        });
      }
    }
  } catch (_) { /* ignore */ }
  return getRelease(APP_BUILD);
}

// "Publish" the picked release: copy its details into settings/config
// so every installed app (with a lower build) starts showing the
// "update available" banner + popup. Stays a thin wrapper so the admin
// page can just do `await publishRelease(release)`.
export async function publishRelease({
  build, version, apkUrl, storeUrl, notes, channel, popup = true,
} = {}) {
  const b = asBuild(build);
  if (!b) throw new Error('build required');
  // setDoc is already imported at the top of this module.
  await setDoc(doc(db, 'settings', 'config'), {
    app_latest_build: b,
    app_latest_version: String(version || `1.0.${b}`),
    app_update_mode: channel === 'store' ? 'store' : 'apk',
    app_apk_url: String(apkUrl || '').trim(),
    app_store_url: String(storeUrl || '').trim(),
    app_update_notes: String(notes || ''),
    app_update_popup: popup !== false,
    app_published_at: serverTimestamp(),
  }, { merge: true });
  return { success: true, build: b, popup };
}

// Reads what's CURRENTLY published in settings/config (what end-user
// apps actually compare against). Convenience for the admin page so
// it can show a "Published: build X" badge.
export async function getPublished() {
  try {
    const s = await getDoc(doc(db, 'settings', 'config'));
    if (!s.exists()) return { build: 0 };
    const c = s.data();
    return {
      build: asBuild(c.app_latest_build),
      version: c.app_latest_version || '',
      channel: c.app_update_mode === 'store' ? 'store' : 'apk',
      apkUrl: c.app_apk_url || '',
      storeUrl: c.app_store_url || '',
      notes: c.app_update_notes || '',
      popup: c.app_update_popup !== false,
      publishedAt: c.app_published_at || null,
    };
  } catch (_) { return { build: 0 }; }
}
