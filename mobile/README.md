# Mobile (Android APK) — Capacitor wrapper

Per blueprint Section 11, **only the Client Portal** is wrapped into an
Android APK. The Astrologer portal and Admin panel stay as web apps.

Capacitor is initialised **inside `client-web/`** (that is where the web
build and `capacitor.config.json` live) — this folder is documentation only.

## Build steps (all free)

```bash
cd ../client-web

# 1. Static export for the WebView. Uncomment `output: 'export'`
#    in next.config.js first, then:
npm run build            # produces ./out

# 2. Add Capacitor (first time only)
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android

# 3. Sync the web build into the native project
npx cap copy android
npx cap sync android

# 4. Open in Android Studio and build the APK
npx cap open android
#   Build > Build Bundle(s)/APK(s) > Build APK(s)
#   Debug APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Every-update workflow
1. Edit `client-web` source
2. `npm run build`
3. `npx cap copy android`
4. Rebuild APK in Android Studio

## Notes
- `capacitor.config.json` uses `webDir: "out"` (Next static export folder).
- Dynamic routes (`/chat/[id]`, `/call/[id]`, `/astrologer/[id]`) need the
  static export to keep client-side routing — the screens already fetch all
  data client-side via the shared services, so SSR is not required.
- Push notifications: add `@capacitor/push-notifications` and follow the
  Capacitor + Firebase FCM guide (blueprint 11.6).
