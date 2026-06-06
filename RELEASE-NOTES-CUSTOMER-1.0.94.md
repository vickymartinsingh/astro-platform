# AstroSeer Customer App - v1.0.94 Release Notes

## Short release-notes text (max 500 chars, Play Console "What's new")

Worldwide phone numbers (UK, US, UAE and 100+ countries with flags), with the new picker on signup and profile pages. Birth details popup no longer reappears after you start filling it. Signup recovers cleanly when the verification email fails (no more "account already exists" dead-end). Faster app + warm relay, plus the auto-end-chat-after-3-min-inactivity refund.

## Full What's new (internal reference - copy to Play Console if a longer block is allowed)

### Signup
- Country code dropdown with flag emoji on every phone field. UK, US, UAE, Australia, Singapore, 100+ countries supported. India (+91) stays the default.
- Fixed the dead-end signup loop: when the verification email failed to send (socket close / SMTP blip), the account was being left half-created so the next try said "account already exists". Now the account is rolled back automatically and you can retry immediately.
- Verification email failure message updated to clearly say "unexpected socket close, please tap Sign up again" with a one-tap retry.

### Onboarding
- The "Get your free Vedic kundli" popup no longer reappears after you have started filling it. It now fires exactly once per device.

### Profile
- Phone number field on Profile -> Personal info gets the same country code picker, so anyone outside India can update their mobile correctly.

### Chat sessions
- Chat sessions now auto-end after 3 minutes of customer inactivity, with the inactive minutes refunded to your wallet automatically (labelled "No activity refund" with the same session ID for tracking).
- Push notification + in-app notice sent when this happens.

### Reliability
- Backend kept warm 24x7 with a 10-minute keep-alive ping, so the first request after a quiet window doesn't make you wait.
- Wallet zero bug fixed: a rare admin-reset path could silently zero your wallet while showing the credit in the admin transactions log. Will never happen again.

### Other
- Welcome bonus system: admin can now toggle a signup bonus on / off instantly (configurable amount, auto-credit or gift code, with template-able welcome email + push).

## Build commands

From the repo root:

```bash
# 1) Build the static web export.
npm --prefix client-web run build

# 2) Patch the native Android project with the latest version + permissions.
node scripts/patch-native.mjs

# 3) Sync Capacitor.
npx --prefix client-web cap sync android

# 4) Build a signed AAB (run from client-web/android, requires the
#    upload keystore + key.properties set up in client-web/android/).
cd client-web/android
./gradlew bundleRelease

# 5) Upload to Play Console alpha (closed-testing) track:
cd ../../
node scripts/play-publish.mjs \
  --aab "client-web/android/app/build/outputs/bundle/release/app-release.aab" \
  --track alpha \
  --notes "$(head -3 RELEASE-NOTES-CUSTOMER-1.0.94.md | tail -1)"
```

Version: **1.0.94** (versionCode 94).
