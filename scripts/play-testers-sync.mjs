// Sync the tester list from play-publisher/testers.json to Play
// Console. Lets you manage testers in VS Code instead of clicking
// through Play Console.
//
// IMPORTANT - what Google's API actually lets us do:
//   ✅ Google Groups can be added to tracks via API.
//   ❌ Individual email addresses CANNOT be added via API. The
//      Android Publisher API exposes `edits.testers.update` with a
//      `googleGroups` field only - no `emails` field exists. This
//      is by Google's design, not a limitation of this script.
//
// WORKAROUND - the script will:
//   1. Show you which individual emails are listed but unsupported.
//   2. Push the listed Google Groups to each app's track via API.
//   3. Print copy-paste-ready text you can drop into Play Console
//      UI's "Create email list" field to bulk-add the individuals
//      (the UI accepts comma- or newline-separated emails).
//
// Usage:
//   node scripts/play-testers-sync.mjs

import { readFileSync, existsSync } from 'fs';
import { google } from 'googleapis';

function flagArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}
const KEY_FILE = flagArg('keyFile',
  'D:\\Projects\\Astro\\play-publisher\\astrology-2092d-b485a2e0617a.json');
const TESTERS_FILE = flagArg('testers',
  'D:\\Projects\\Astro\\play-publisher\\testers.json');

if (!existsSync(KEY_FILE)) {
  console.error('Service account JSON not found:', KEY_FILE);
  process.exit(1);
}
if (!existsSync(TESTERS_FILE)) {
  console.error('Testers JSON not found:', TESTERS_FILE);
  process.exit(1);
}

const config = JSON.parse(readFileSync(TESTERS_FILE, 'utf8'));
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

async function syncOneTrack(packageName, track, testerSet) {
  const groups = (testerSet && testerSet.googleGroups) || [];
  const emails = (testerSet && testerSet.individualEmails) || [];
  const result = { groups, emails, ok: false, error: null };

  if (groups.length === 0) {
    result.ok = true;
    result.skipped = 'no googleGroups configured';
    return result;
  }

  try {
    const edit = (await publisher.edits.insert({
      packageName,
    })).data;
    const editId = edit.id;

    await publisher.edits.testers.update({
      packageName, editId, track,
      requestBody: { googleGroups: groups },
    });

    await publisher.edits.commit({ packageName, editId });
    result.ok = true;
  } catch (e) {
    result.error = (e && (e.message || e.errors)) || String(e);
  }
  return result;
}

(async () => {
  const apps = ['customer', 'astrologer', 'admin'];
  console.log('=== Play Console Tester Sync ===\n');

  for (const appKey of apps) {
    const app = config[appKey];
    if (!app) continue;
    console.log(`\n--- ${appKey.toUpperCase()} (${app.package}) ---`);

    for (const trackInfo of [
      { key: 'internalTesters', track: 'internal',
        label: 'Internal Testing' },
      { key: 'closedTesters', track: 'alpha',
        label: 'Closed Testing (alpha)' },
    ]) {
      const set = app[trackInfo.key];
      if (!set) continue;
      const r = await syncOneTrack(app.package, trackInfo.track, set);
      const groupsTxt = r.groups.length
        ? r.groups.join(', ') : '(none)';
      console.log(`  ${trackInfo.label}:`);
      console.log(`    googleGroups: ${groupsTxt}`);
      if (r.skipped) {
        console.log(`    status: skipped (${r.skipped})`);
      } else if (r.ok) {
        console.log(`    status: ✓ synced`);
      } else {
        console.log(`    status: ✗ ${r.error}`);
      }
      if (r.emails.length) {
        console.log(`    individualEmails (NOT pushed - API limit):`);
        r.emails.forEach((e) => console.log(`      - ${e}`));
        console.log(`    >>> COPY/PASTE INTO PLAY CONSOLE`
          + ` "Create email list":`);
        console.log(`        ${r.emails.join(',')}`);
      }
    }
  }
  console.log('\n=== Done ===');
})().catch((e) => {
  console.error('SYNC FAILED:', e && (e.errors || e.message) || e);
  process.exit(1);
});
