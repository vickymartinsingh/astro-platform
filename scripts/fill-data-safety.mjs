// Fill Google Play's Data Safety CSV template for AstroSeer.
// Reads C:\Users\Work\Downloads\data_safety_sample.csv, sets every
// 'Response value' that matches our actual data collection profile,
// writes the filled CSV to the Desktop.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SRC = 'C:\\Users\\Work\\Downloads\\data_safety_sample.csv';
const OUT_DIR = 'C:\\Users\\Work\\Desktop\\AstroSeer_PlayStoreListing';
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, 'data_safety_AstroSeer.csv');

// ---- AstroSeer data profile ----------------------------------
// What we DO collect (each maps to a PSL data item).
const COLLECTED = new Set([
  // Personal info
  'PSL_NAME',
  'PSL_EMAIL',
  'PSL_USER_ACCOUNT',     // Firebase uid
  'PSL_PHONE',
  'PSL_OTHER_PERSONAL',   // birth date / time / place for kundli
  // Financial
  'PSL_USER_PAYMENT_INFO',
  'PSL_PURCHASE_HISTORY',
  // Photos / Videos
  'PSL_PHOTOS',           // profile photos
  'PSL_VIDEOS',           // video call (recorded for quality/dispute)
  // Audio
  'PSL_VOICE_OR_SOUND_RECORDINGS',  // voice notes + voice calls
  // Messages
  'PSL_OTHER_IN_APP_MESSAGES',
  // App activity
  'PSL_APP_INTERACTIONS',
  'PSL_OTHER_USER_GENERATED_CONTENT', // chat/reviews
  // App info & performance
  'PSL_CRASH_LOGS',
  'PSL_DIAGNOSTICS',
  // Device IDs (FCM token, installation id)
  'PSL_DEVICE_OR_OTHER_IDS',
]);

// We don't SHARE any data with third parties for their own purposes.
// (Payment processor / cloud / push are service providers, which per
// Play guidance is NOT "sharing".)
const SHARED = new Set();

// Per-item collection purposes (subset of Play's standard purposes).
const PURPOSES = {
  PSL_NAME:                ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT'],
  PSL_EMAIL:               ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT',
                            'PSL_DEVELOPER_COMMUNICATIONS'],
  PSL_USER_ACCOUNT:        ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT',
                            'PSL_FRAUD_PREVENTION_SECURITY'],
  PSL_PHONE:               ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT'],
  PSL_OTHER_PERSONAL:      ['PSL_APP_FUNCTIONALITY'],
  PSL_USER_PAYMENT_INFO:   ['PSL_APP_FUNCTIONALITY'],
  PSL_PURCHASE_HISTORY:    ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT'],
  PSL_PHOTOS:              ['PSL_APP_FUNCTIONALITY'],
  PSL_VIDEOS:              ['PSL_APP_FUNCTIONALITY',
                            'PSL_FRAUD_PREVENTION_SECURITY'],
  PSL_VOICE_OR_SOUND_RECORDINGS: ['PSL_APP_FUNCTIONALITY',
                            'PSL_FRAUD_PREVENTION_SECURITY'],
  PSL_OTHER_IN_APP_MESSAGES: ['PSL_APP_FUNCTIONALITY'],
  PSL_APP_INTERACTIONS:    ['PSL_APP_FUNCTIONALITY', 'PSL_ANALYTICS'],
  PSL_OTHER_USER_GENERATED_CONTENT: ['PSL_APP_FUNCTIONALITY'],
  PSL_CRASH_LOGS:          ['PSL_ANALYTICS'],
  PSL_DIAGNOSTICS:         ['PSL_ANALYTICS'],
  PSL_DEVICE_OR_OTHER_IDS: ['PSL_APP_FUNCTIONALITY',
                            'PSL_FRAUD_PREVENTION_SECURITY'],
};

// ---- top-level form answers ------------------------------------------
const TOP = {
  'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA||': 'true',
  'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT||': 'true',
  // Family policy: we're not in the Designed for Families program;
  // app is rated 18+. Leave blank (not required).
  'PSL_DATA_DELETION_URL||':
    'https://www.astroseer.in/account-deletion',
  'PSL_ACCOUNT_DELETION_URL||':
    'https://www.astroseer.in/account-deletion',
  // Account creation methods: email/password + Google OAuth.
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS|PSL_ACM_USER_ID_PASSWORD|': 'true',
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS|PSL_ACM_OAUTH|': 'true',
};

// ---- CSV helpers -----------------------------------------------------
function splitCsvLine(line) {
  const out = []; let i = 0; let cur = ''; let q = false;
  while (i < line.length) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { out.push(cur); cur = ''; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return out;
}
function csvEscape(s) {
  const v = String(s == null ? '' : s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---- run -------------------------------------------------------------
const raw = readFileSync(SRC, 'utf8').replace(/^﻿/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
const header = lines.shift();
const out = [header];
let setCount = 0;
let clearedCount = 0;

for (const line of lines) {
  const cols = splitCsvLine(line);
  while (cols.length < 5) cols.push('');
  const [qid, rid, , req, label] = cols;
  let value = ''; // default: clear (override the sample's "true" values)

  // 1) Top-level direct matches.
  const key = `${qid}|${rid || ''}|`;
  if (key in TOP) value = TOP[key];

  // 2) Data-type "is this data collected?" multi-choice.
  // Pattern: PSL_DATA_TYPES_<CATEGORY>, Response ID = PSL_NAME etc.
  if (qid.startsWith('PSL_DATA_TYPES_')) {
    value = COLLECTED.has(rid) ? 'true' : '';
  }

  // 3) Per-item usage rows: PSL_DATA_USAGE_RESPONSES:<ITEM>:<SUB>
  const m = qid.match(/^PSL_DATA_USAGE_RESPONSES:([^:]+):(.+)$/);
  if (m) {
    const item = m[1];
    const sub = m[2];
    const isCollected = COLLECTED.has(item);
    const isShared = SHARED.has(item);

    if (!isCollected && !isShared) {
      value = ''; // not collected: every sub-question stays blank
    } else if (sub === 'PSL_DATA_USAGE_COLLECTION_AND_SHARING') {
      // pick one: only collected / only shared / both
      if (isCollected && isShared
        && rid === 'PSL_DATA_USAGE_COLLECTED_AND_SHARED') value = 'true';
      else if (isCollected && !isShared
        && rid === 'PSL_DATA_USAGE_ONLY_COLLECTED') value = 'true';
      else if (!isCollected && isShared
        && rid === 'PSL_DATA_USAGE_ONLY_SHARED') value = 'true';
      else value = '';
    } else if (sub === 'PSL_DATA_USAGE_EPHEMERAL') {
      // false - we persist this data (until user requests deletion).
      value = 'false';
    } else if (sub === 'DATA_USAGE_USER_CONTROL') {
      // We support data deletion via /account-deletion -> "optional"
      // is the closest match (users can choose by deleting account).
      // For payment / purchase data the law requires retention -> mark
      // those as REQUIRED.
      const required = (item === 'PSL_USER_PAYMENT_INFO'
        || item === 'PSL_PURCHASE_HISTORY'
        || item === 'PSL_CRASH_LOGS'
        || item === 'PSL_DIAGNOSTICS'
        || item === 'PSL_DEVICE_OR_OTHER_IDS');
      if (required) {
        value = rid === 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED' ? 'true' : '';
      } else {
        value = rid === 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL' ? 'true' : '';
      }
    } else if (sub === 'DATA_USAGE_COLLECTION_PURPOSE') {
      if (!isCollected) value = '';
      else {
        const purposes = PURPOSES[item] || ['PSL_APP_FUNCTIONALITY'];
        value = purposes.includes(rid) ? 'true' : '';
      }
    } else if (sub === 'DATA_USAGE_SHARING_PURPOSE') {
      // We don't share with third parties.
      value = '';
    }
  }

  if (value && !cols[2]) setCount++;
  if (!value && cols[2]) clearedCount++;
  cols[2] = value;
  out.push(cols.map(csvEscape).join(','));
}

writeFileSync(OUT, out.join('\r\n') + '\r\n');
console.log(`Wrote: ${OUT}`);
console.log(`  rows total : ${lines.length}`);
console.log(`  set values : ${setCount}`);
console.log(`  cleared    : ${clearedCount}`);
