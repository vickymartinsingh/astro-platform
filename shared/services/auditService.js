// Client-side audit logger. Sends a POST to the relay's /api/audit
// endpoint which captures the user's IP (from request headers) + user
// agent and writes to `audits/{auto}` via the Firebase Admin SDK. The
// audit collection is ADMIN-ONLY - customers / astrologers never see
// their own log; it exists for compliance / fraud review.
import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase.js';

function endpoint() {
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_AUDIT_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/audit')
    : 'https://astro-platform-push-relay.vercel.app/api/audit';
}

function detectApp() {
  if (typeof window === 'undefined') return 'server';
  const h = String(window.location.hostname || '').toLowerCase();
  if (h.includes('admin')) return 'admin';
  if (h.includes('astro') && !h.includes('astroseer')) return 'astrologer';
  if (h.includes('astrologer')) return 'astrologer';
  // Capacitor builds: look at the bundled appId via window.Capacitor.
  try {
    const C = window.Capacitor;
    if (C && C.getPlatform) {
      const id = (C.Plugins && C.Plugins.App
        && C.Plugins.App.appId) || '';
      if (id.includes('admin')) return 'admin';
      if (id.includes('astrologer')) return 'astrologer';
      if (id.includes('mobile')) return 'customer';
    }
  } catch (_) {}
  return 'customer';
}

// Best-effort device snapshot (user agent + screen + language). The relay
// also stores the full UA from the request header for cross-checking.
function deviceInfo() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {};
  }
  const screen = window.screen || {};
  return {
    ua: navigator.userAgent || '',
    platform: navigator.platform || '',
    language: navigator.language || '',
    online: !!navigator.onLine,
    screen: `${screen.width || 0}x${screen.height || 0}`,
    timezone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || '',
  };
}

// Fire-and-forget audit log. `type` examples:
//   'signup', 'login', 'logout', 'recharge', 'redeem', 'route',
//   'admin-action', 'session-start', 'session-end'.
// `meta` is an arbitrary small object stored with the event.
export async function logEvent(type, meta = {}) {
  if (typeof window === 'undefined') return false;
  const url = endpoint();
  let token = null;
  try {
    token = auth && auth.currentUser
      ? await auth.currentUser.getIdToken() : null;
  } catch (_) { /* ignore */ }
  // Best-effort: include uid in body too (so signup events that fire
  // before the ID token mints still associate to the right uid).
  const uid = (auth && auth.currentUser && auth.currentUser.uid) || null;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        uid, type, app: detectApp(),
        meta: { ...deviceInfo(), ...meta },
      }),
    });
    return true;
  } catch (_) { return false; }
}

// Admin reads -- list the latest events for a given uid. Firestore rules
// should restrict this collection to admin reads only.
export async function getAuditByUser(uid, lim = 100) {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'audits'),
      where('uid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(lim),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) { return []; }
}
