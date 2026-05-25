// presenceService, blueprint 7.7 (Firebase Realtime Database presence +
// onDisconnect). This is the authoritative implementation of Hard Rule 7:
// when the browser/app goes away the RTDB onDisconnect fires server-side,
// a Cloud Function flips users.isOnline=false and ENDS any active session
// so the billing engine stops immediately, no overcharge ever.
import {
  ref, onValue, onDisconnect, set, serverTimestamp,
} from 'firebase/database';
import { getRtdbLazy } from '../firebase.js';
import { setOnline } from './userService.js';

// Returns a cleanup function. Call once after auth resolves.
// No-ops when uid is missing OR Realtime Database is not configured
// (NEXT_PUBLIC_FIREBASE_DATABASE_URL). In that case the pagehide/
// visibility fallback in useSession.js still stops billing on
// disconnect.
//
// Perf: firebase/database (~25 KB brotli) is dynamic-imported via
// getRtdbLazy(), so the boot bundle stays small for the pages that
// don't need presence (login, public pages, etc).
export function setupPresence(uid) {
  if (!uid) return () => {};
  if (!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL) return () => {};

  // The async setup happens in the background. We expose a stable
  // cleanup function that waits on the same promise so a fast
  // mount/unmount still tears down cleanly.
  let stop = null;
  let cancelled = false;

  const ready = (async () => {
    const rtdb = await getRtdbLazy();
    if (!rtdb || cancelled) return null;
    const statusRef = ref(rtdb, `/status/${uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    const unsub = onValue(connectedRef, (snap) => {
      if (snap.val() === false) return;
      // Register the disconnect handler BEFORE marking online so a
      // race can't leave a stale "online" if the socket drops right
      // after we wired up.
      onDisconnect(statusRef)
        .set({ state: 'offline', last_changed: serverTimestamp() })
        .then(() => {
          set(statusRef,
            { state: 'online', last_changed: serverTimestamp() });
          setOnline(uid).catch(() => {});
        });
    });

    stop = () => {
      unsub();
      set(statusRef,
        { state: 'offline', last_changed: serverTimestamp() })
        .catch(() => {});
    };
    return stop;
  })();

  return () => {
    cancelled = true;
    if (stop) { stop(); return; }
    // Async setup hasn't finished yet -> chain cleanup.
    ready.then((fn) => { if (fn) fn(); });
  };
}
