// pushService — real OS push notifications (lock-screen) for the native
// apps via FCM + @capacitor/push-notifications.
//
// Design notes:
// - Web is untouched: every native call goes through the Capacitor runtime
//   global (window.Capacitor.Plugins.PushNotifications), so the plugin is
//   NEVER imported by the bundler and the web/static builds are unaffected.
// - Sending a push to a device REQUIRES a trusted server (FCM rule). We
//   POST to a tiny relay (push-relay/, deployed free on Vercel) whose URL
//   is provided at build time via NEXT_PUBLIC_PUSH_ENDPOINT. If that env
//   is not set, sends are a silent no-op so nothing in chat/session breaks.
import { saveFCMToken } from './notificationService.js';

const ENDPOINT =
  (typeof process !== 'undefined'
    && process.env && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
const RELAY_KEY =
  (typeof process !== 'undefined'
    && process.env && process.env.NEXT_PUBLIC_PUSH_KEY) || '';

function isNativeApp() {
  return typeof window !== 'undefined'
    && !!window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();
}

function plugin() {
  return (typeof window !== 'undefined'
    && window.Capacitor && window.Capacitor.Plugins
    && window.Capacitor.Plugins.PushNotifications) || null;
}

let wired = false;

// Call once the user is signed in (native only). Requests permission,
// registers with FCM/APNs, stores the device token on the user doc, and
// routes taps to a sensible screen.
export async function registerForPush(uid) {
  if (!uid || !isNativeApp()) return;
  const PN = plugin();
  if (!PN) return;
  try {
    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') perm = await PN.requestPermissions();
    if (perm.receive !== 'granted') return;
    await PN.register();

    if (wired) return;            // listeners are process-wide singletons
    wired = true;

    PN.addListener('registration', (t) => {
      if (t && t.value) saveFCMToken(uid, t.value).catch(() => {});
    });
    PN.addListener('registrationError', () => {});

    // Tap on a notification (app was background/closed) -> deep link.
    PN.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action && action.notification
        && action.notification.data) || {};
      if (data.route && typeof window !== 'undefined') {
        try { window.location.assign(data.route); } catch (_) {}
      }
    });
  } catch (_) { /* never block the app on push setup */ }
}

// Best-effort push send via the relay. NEVER throws (callers are core
// flows like sending a chat message) — failures are swallowed.
export async function sendPushToUser(payload) {
  if (!ENDPOINT) return;
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RELAY_KEY ? { 'x-push-key': RELAY_KEY } : {}),
      },
      body: JSON.stringify(payload || {}),
      keepalive: true,
    });
  } catch (_) { /* offline / not configured yet — ignore */ }
}
