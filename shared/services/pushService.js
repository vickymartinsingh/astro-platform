// pushService - real OS push notifications (lock-screen) for the native
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
import { saveFCMToken, saveDeviceToken } from './notificationService.js';

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

// @capacitor/local-notifications - used ONLY to re-raise a push that
// arrives while the app is in the foreground (Android/iOS suppress the
// system banner in that state). Accessed via the runtime global so the
// bundler never imports it (web/static builds stay untouched).
function localPlugin() {
  return (typeof window !== 'undefined'
    && window.Capacitor && window.Capacitor.Plugins
    && window.Capacitor.Plugins.LocalNotifications) || null;
}

// Single high-importance channel so notifications appear as a heads-up
// banner even when the screen is ON (default/low channels stay silent
// in the shade). The relay targets this same channelId for backgrounded
// pushes; the foreground re-raise reuses it too.
const CHANNEL_ID = 'astro-default';

async function ensureChannel() {
  try {
    const PN = plugin();
    if (PN && PN.createChannel) {
      await PN.createChannel({
        id: CHANNEL_ID,
        name: 'AstroConnect',
        description: 'Chats, calls, video and updates',
        importance: 5,        // IMPORTANCE_HIGH -> heads-up banner
        visibility: 1,        // VISIBILITY_PUBLIC -> show on lock screen
        sound: 'default',
        vibration: true,
        lights: true,
      });
    }
    const LN = localPlugin();
    if (LN && LN.createChannel) {
      await LN.createChannel({
        id: CHANNEL_ID,
        name: 'AstroConnect',
        description: 'Chats, calls, video and updates',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
        lights: true,
      });
    }
  } catch (_) { /* channel is best-effort */ }
}

let wired = false;

let lastUid = null;

// Native only. Requests permission, registers with FCM/APNs and stores
// the device token. Works WITH or WITHOUT a signed-in user: the token
// is always written to the deviceTokens collection (so broadcast pushes
// reach every device even when nobody is logged in) and, when a uid is
// known, also to that user doc (for targeted chat/call pushes). Call it
// on every app launch and again right after sign-in.
export async function registerForPush(uid) {
  if (!isNativeApp()) return;
  lastUid = uid || lastUid || null;
  const PN = plugin();
  if (!PN) return;
  try {
    // CRITICAL ORDER: attach the 'registration' listener BEFORE calling
    // register(). register() fires the token event almost immediately;
    // if we add the listener afterwards the token is missed and never
    // saved, so the relay has no one to deliver to (the real reason
    // pushes were not arriving).
    if (!wired) {
      wired = true;            // listeners are process-wide singletons

      PN.addListener('registration', (t) => {
        if (!t || !t.value) return;
        // Always record the device (broadcast / not-signed-in delivery).
        saveDeviceToken(t.value, lastUid).catch(() => {});
        // And map it to the user when we know who they are (targeted).
        if (lastUid) saveFCMToken(lastUid, t.value).catch(() => {});
      });
      PN.addListener('registrationError', () => {});
      wireMessageListeners(PN);
    }

    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') perm = await PN.requestPermissions();
    if (perm.receive !== 'granted') return;
    await ensureChannel();
    await PN.register();

    // Local-notifications permission (foreground re-raise on iOS).
    try {
      const LN = localPlugin();
      if (LN && LN.requestPermissions) await LN.requestPermissions();
    } catch (_) {}
    return;
  } catch (_) { /* never block the app on push setup */ }
}

// Foreground re-raise + tap deep-link listeners (attached once).
function wireMessageListeners(PN) {
  try {

    // Fired when a push arrives while the app is in the FOREGROUND
    // (screen on, user inside the app). The OS does NOT draw a banner
    // in this state, so we re-raise it ourselves as a local
    // notification on the high-importance channel -> heads-up banner.
    PN.addListener('pushNotificationReceived', (notif) => {
      try {
        const LN = localPlugin();
        if (!LN) return;
        const d = (notif && notif.data) || {};
        const title = (notif && notif.title) || d.title || 'AstroConnect';
        const text = (notif && notif.body) || d.body || '';
        LN.schedule({
          notifications: [{
            id: Math.floor(Date.now() % 2147483647),
            title: String(title),
            body: String(text),
            channelId: CHANNEL_ID,
            schedule: { at: new Date(Date.now() + 150) },
            extra: d,
          }],
        }).catch(() => {});
      } catch (_) {}
    });

    // Tap on the foreground-raised local notification -> deep link.
    try {
      const LN = localPlugin();
      if (LN && LN.addListener) {
        LN.addListener('localNotificationActionPerformed', (a) => {
          const d = (a && a.notification && a.notification.extra) || {};
          if (d.route && typeof window !== 'undefined') {
            try { window.location.assign(d.route); } catch (_) {}
          }
        });
      }
    } catch (_) {}

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

// Register the device on app launch with no user yet (so broadcast
// pushes work even before / without signing in).
export function registerDevice() { return registerForPush(null); }

// Best-effort push send via the relay. NEVER throws (callers are core
// flows like sending a chat message) - failures are swallowed.
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
  } catch (_) { /* offline / not configured yet - ignore */ }
}
