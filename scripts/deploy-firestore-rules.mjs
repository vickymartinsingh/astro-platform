// Deploy firestore.rules via the Firebase Rules REST API. Uses the
// firebase-admin service account key so no `firebase` CLI is needed.
// Run: node scripts/deploy-firestore-rules.mjs
import { readFileSync } from 'fs';
import { google } from 'googleapis';

const KEY_FILE = 'D:/Projects/Astro/firebase-key.json';
const RULES_FILE = 'D:/Projects/Astro/firestore.rules';

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/firebase'],
});
const sa = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
const projectId = sa.project_id;

(async () => {
  const client = await auth.getClient();
  const rules = readFileSync(RULES_FILE, 'utf8');

  // 1) Create a Ruleset under firebaserules.googleapis.com that holds
  //    the new source. This compiles the rules and returns a ruleset
  //    id we can release.
  console.log(`Compiling rules for ${projectId}...`);
  const rulesetRes = await client.request({
    method: 'POST',
    url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    data: {
      source: {
        files: [{
          name: 'firestore.rules',
          content: rules,
        }],
      },
    },
  });
  const rulesetName = rulesetRes.data.name;
  console.log('Ruleset:', rulesetName);

  // 2) Release the ruleset under the `cloud.firestore` channel which
  //    is what the live Firestore instance uses for rule eval.
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  // Try update first; fall back to create if no release exists.
  try {
    const upd = await client.request({
      method: 'PATCH',
      url: `https://firebaserules.googleapis.com/v1/${releaseName}`,
      data: {
        release: { name: releaseName, rulesetName },
      },
    });
    console.log('Release updated:', upd.data.name);
  } catch (e) {
    const code = e.response && e.response.status;
    if (code === 404) {
      const cr = await client.request({
        method: 'POST',
        url: `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`,
        data: { name: releaseName, rulesetName },
      });
      console.log('Release created:', cr.data.name);
    } else { throw e; }
  }
  console.log('✓ firestore.rules is live.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  if (e.response && e.response.data) {
    console.error(JSON.stringify(e.response.data, null, 2));
  }
  process.exit(1);
});
