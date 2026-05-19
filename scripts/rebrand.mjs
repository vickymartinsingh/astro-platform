// One-shot rebrand: user-facing "AstroConnect" -> "AstroSeer".
//
// SAFE BY DESIGN: only the exact case-sensitive token `AstroConnect`
// (brand text) is replaced. Package / bundle IDs are all lowercase
// (com.astroconnect.* / com.vickymartin.astroconnect) and are NEVER
// touched, so Firebase, Google sign-in fingerprints and existing
// installs keep working. The two astrologer/admin app display names
// ("... by AC") are renamed explicitly.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TOKEN_FILES = [
  'capacitor.config.json',
  'client-web/capacitor.config.json',
  'android/app/src/main/res/values/strings.xml',
  'android/app/src/main/assets/capacitor.config.json',
  'push-relay/package.json',
  'push-relay/api/sendPush.js',
  'push-relay/api/pay.js',
  'push-relay/api/kundli.js',
  'push-relay/api/agoraToken.js',
  '.github/workflows/ios.yml',
  'shared/services/brandingService.js',
  'shared/services/emailService.js',
  'shared/services/pushService.js',
  'shared/services/reviewService.js',
  'shared/services/sessionService.js',
  'astro-web/components/TopNav.js',
  'astro-web/components/IncomingRequest.js',
  'astro-web/pages/astro-login.js',
  'client-web/components/TopNav.js',
  'client-web/components/SplashScreen.js',
  'client-web/components/GuidedTour.js',
  'client-web/components/LoginCard.js',
  'client-web/pages/invoice/[id].js',
  'client-web/pages/wallet.js',
  'client-web/pages/remedies.js',
  'admin-web/pages/admin-settings.js',
];

let changed = 0;
for (const rel of TOKEN_FILES) {
  if (!existsSync(rel)) { console.log('skip (missing):', rel); continue; }
  const before = readFileSync(rel, 'utf8');
  const after = before.split('AstroConnect').join('AstroSeer');
  if (after !== before) {
    writeFileSync(rel, after);
    const n = before.split('AstroConnect').length - 1;
    console.log(`rebranded ${rel} (${n}x)`);
    changed += 1;
  } else {
    console.log('no-op:', rel);
  }
}

// Explicit per-app display names (these are NOT "AstroConnect").
const renameOne = (rel, from, to) => {
  if (!existsSync(rel)) { console.log('skip (missing):', rel); return; }
  const b = readFileSync(rel, 'utf8');
  if (b.includes(from)) {
    writeFileSync(rel, b.split(from).join(to));
    console.log(`renamed ${rel}: "${from}" -> "${to}"`);
    changed += 1;
  } else { console.log(`no "${from}" in`, rel); }
};
renameOne('astro-web/capacitor.config.json',
  'Astrologer by AC', 'AstroSeer for Astrologers');
renameOne('admin-web/capacitor.config.json',
  'Admin by AC', 'AstroSeer Admin');

console.log(`\nrebrand done: ${changed} files changed`);
