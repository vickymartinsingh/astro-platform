# Astrology Consultation Marketplace (Astrotalk-level)

Full-stack platform built from `AstrologyPlatform_FULL_Blueprint.docx`
(extracted to `_blueprint.txt`, the single source of truth, 14 sections).
100% free stack: Next.js 14 + Tailwind, Firebase (Spark), Agora, Razorpay,
Capacitor, Vercel.

## Monorepo layout (strict, per blueprint Section 8.1)

```
astro-platform/
  client-web/   Client Portal      (Next.js 14, port 3000)
  astro-web/    Astrologer Portal  (Next.js 14, port 3001)
  admin-web/    Admin Panel        (Next.js 14, port 3002)
  shared/       @astro/shared, Firebase init + 13 service files
  functions/    Cloud Functions, billing, payments, auth, notifications…
  mobile/       Capacitor APK wrapper docs (wraps client-web only)
  firestore.rules / firestore.indexes.json / storage.rules / firebase.json
```

npm **workspaces** wire the three apps to `@astro/shared`. `functions/` is a
standalone package (deployed by the Firebase CLI).

## Setup

```bash
npm install                       # installs all workspaces from the root
cd functions && npm install && cd ..
```

Create a Firebase project (Firestore, Auth email/pw, Storage, Functions,
FCM). Copy `client-web/.env.example` → `.env.local` in **each** web app and
fill the `NEXT_PUBLIC_*` values. Set the Razorpay secret server-side only:

```bash
firebase functions:config:set razorpay.key_id="rzp_test_xxx" \
                               razorpay.secret="YOUR_SECRET" \
                               agora.app_id="AGORA_APP_ID" \
                               agora.app_certificate="AGORA_CERT"
```

Enable **Realtime Database** in the Firebase console (used for
`onDisconnect` presence, Hard Rule 7) and set
`NEXT_PUBLIC_FIREBASE_DATABASE_URL` in each app's `.env.local`. Agora app
id/certificate are optional: with no certificate the project runs in
testing mode and calls join with a null token.

## Run locally

```bash
npm run dev:client   # http://localhost:3000
npm run dev:astro    # http://localhost:3001
npm run dev:admin    # http://localhost:3002
firebase emulators:start   # functions + firestore + auth + storage
```

First admin: sign up via any portal, then set that user's `role` to
`admin` in Firestore (`users/{uid}`).

## Deploy (all free)

- **Web:** 3 Vercel projects, root dir = each app folder, root install.
  Auto-deploys on push (blueprint Section 12.1).
- **Backend:** `npm run functions:deploy`, `npm run rules:deploy`,
  `npm run indexes:deploy`.
- **APK:** see `mobile/README.md` (Capacitor, client-web only).

## The 10 Hard Rules (blueprint 14.4) and where they live

| # | Rule | Enforced by |
|---|------|-------------|
| 1 | Top nav only, hamburger drops down | `*/components/TopNav.js` (no sidebar anywhere) |
| 2 | Auto-responsive | Tailwind `md:` breakpoints, single layout |
| 3 | Billing in Cloud Function only | `functions/billing.js` (`billingEngine`) |
| 4 | Wallet writes in Cloud Function only | `firestore.rules` (wallet field immutable from client) + Admin SDK |
| 5 | Payment verified server-side | `functions/payments.js` (`verifyPayment` HMAC) |
| 6 | Transaction with every wallet change | `addMoney` / `billSessionOnce` / `adminAdjustWallet` |
| 7 | Billing stops on disconnect | RTDB presence `shared/services/presenceService.js` + `functions/presence.js` (`onUserStatusChanged` ends active sessions); `useSession.js` pagehide is the fast-path backup |
| 8 | Wallet checked before session | `astrologer/[id].js` pre-connection check + server re-check |
| 9 | ≥1 service to go online | `astro-web/components/GoOnlineModal.js` |
| 10 | 100% free stack | every dependency is free-tier |

## Build status (first pass = core engine + Client portal)

- **Complete & functional:** shared services, all Cloud Functions, Firestore
  rules/indexes, full Client portal (auth, dashboard, marketplace, profile,
  chat+billing, call, wallet/Razorpay, kundli, horoscope, history,
  notifications, favorites, profile, guided tour), Astrologer portal core
  loop (login, dashboard, go-online, incoming request, active session,
  sessions, earnings, profile/payout, reviews, kundli viewer), Admin
  (login, dashboard, users, astrologer approval, sessions, transactions,
  settings, payouts, disputes+refund, coupons, notification broadcast,
  feature toggles, announcement banner, analytics, audit log, **CMS/Page
  Builder with draft/publish/rollback, PDF report builder, system-health
  monitor**). Public CMS pages render at `/page/[slug]` (Terms/Privacy/
  Refund links now resolve); clients can download a **GST tax invoice**
  for any successful recharge. RTDB `onDisconnect` presence + production
  Agora token server are live; admin top-nav now matches blueprint 6.1.
  **Referral program** (server-side `applyReferral`, share link, both-side
  bonuses), **multi-language i18n** (en/hi/te, profile language selector),
  and **drag-and-drop CMS reordering** are now done.
- **Next pass:** broaden i18n string coverage (infra + nav/dashboard done,
  remaining screens fall back to English), astrologer-portal i18n,
  multi-language translation-file editing from the admin panel.
- **Intentionally NOT built, Agora cloud call recording (Module 9).**
  Agora Cloud Recording requires a paid Agora add-on plus a paid storage
  vendor (S3/OSS). That violates **Hard Rule 10 (100% free stack)**, which
  the blueprint marks non-negotiable and which wins over the optional
  ("if enabled") recording feature. Left as a documented no-op.

## Deviations from the blueprint (surfaced intentionally)

1. **Firestore rules hardened.** Blueprint 12.3 allows a user full write to
   their own `users/{uid}` doc, which would let the browser edit `wallet`, directly contradicting Hard Rules 4 & 6. Rules here make `wallet`/`role`
   client-immutable. The 10 Hard Rules win when the blueprint conflicts itself.
2. **Added `functions/admin.js`, `presence.js`, `calls.js`, `cms.js`**
   (beyond the 6-file list in 8.1): admin actions (block/approve/wallet-
   adjust/settings/payout/dispute-refund/coupon), the RTDB disconnect
   trigger (Hard Rule 7), the Agora token server, and CMS page save/
   publish/rollback. Required so privileged writes happen server-side,
   not in the browser (Hard Rules 4 & 6 & 7; pages are write:false).
3. **`astrologers` doc id == astrologer uid** for a clean
   client↔astrologer↔session join. Schema fields are otherwise verbatim.

Everything else follows the blueprint literally (folder layout, screen
lists, schema field names, Cloud Function names).
