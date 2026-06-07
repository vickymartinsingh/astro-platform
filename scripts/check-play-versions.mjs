// Twice-daily Play Store scraper. For each app declared in APPS,
// fetches the public Play Store listing HTML and extracts the
// currently published version string. The build number is the
// numeric tail (1.0.99 -> 99). Writes back to settings/appLinks so
// the in-app UpdateModal across all 3 apps flips on without an ops
// step.
//
// The GitHub Actions cron (.github/workflows/play-version-check.yml)
// runs this twice a day (00:00 + 12:00 UTC). Manual: node
// scripts/check-play-versions.mjs --once
//
// Why scrape and not the Play Developer API? The API needs a service
// account that can READ the app's track metadata; ours is scoped to
// publishing only. The Play Store HTML page already exposes the
// published version inside an inline DOM string we can grep with
// zero auth. If Google ever rotates the markup the scraper falls
// back to a JSON-LD blob.

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || 'D:/Projects/Astro/firebase-key.json';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(readFileSync(KEY, 'utf8'))),
  });
}
const db = admin.firestore();

const APPS = [
  { key: 'customer',   pkg: 'com.astroseer.mobile' },
  { key: 'astrologer', pkg: 'com.astroseer.astrologer' },
  { key: 'admin',      pkg: 'com.astroseer.admin' },
  { key: 'hr',         pkg: 'com.astroseer.hr' },
  { key: 'support',    pkg: 'com.astroseer.support' },
];

async function fetchVersion(pkg) {
  const url = `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        + ' (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (r.status === 404) return { notListed: true };
  if (!r.ok) throw new Error(`Play Store HTTP ${r.status} for ${pkg}`);
  const html = await r.text();
  // 1) JSON inline blob (current Play Store markup, May 2026):
  //    ...,[["VERSION"]],"1.0.99"]...
  const m1 = html.match(/\[\["VERSION"\]\],?"([\d.]+)"/);
  if (m1) return { version: m1[1] };
  // 2) Legacy fallback - "Current Version" label.
  const m2 = html.match(/Current Version[\s\S]{0,80}?([\d]+\.[\d.]+)/);
  if (m2) return { version: m2[1] };
  // 3) JSON-LD softwareVersion (sometimes present on app pages).
  const m3 = html.match(/"softwareVersion":"([\d.]+)"/);
  if (m3) return { version: m3[1] };
  return { error: 'version not found in HTML' };
}

function buildFromVersion(v) {
  if (!v) return 0;
  const m = String(v).match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

async function run() {
  const results = [];
  for (const a of APPS) {
    try {
      const r = await fetchVersion(a.pkg);
      if (r.notListed) {
        results.push({ key: a.key, status: 'not_listed' });
        continue;
      }
      if (r.error) {
        results.push({ key: a.key, status: 'parse_error',
          error: r.error });
        continue;
      }
      const version = r.version;
      const build = buildFromVersion(version);
      // Merge into settings/appLinks - DO NOT overwrite the operator's
      // storeUrl / notes / displayName. We only touch latestBuild +
      // latestVersion + scrapedAt.
      const patch = {
        [a.key]: {
          latestBuild: build,
          latestVersion: version,
        },
        _scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection('settings').doc('appLinks')
        .set(patch, { merge: true });
      results.push({ key: a.key, status: 'updated', version, build });
    } catch (e) {
      results.push({ key: a.key, status: 'fetch_error',
        error: String(e?.message || e) });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  // Useful for the GitHub Actions step summary.
  return results;
}

run().then(() => process.exit(0)).catch((e) => {
  console.error('scrape failed:', e);
  process.exit(1);
});
