// presenceService, blueprint 7.7 (Firebase Realtime Database presence +
// onDisconnect). This is the authoritative implementation of Hard Rule 7:
// when the browser/app goes away the RTDB onDisconnect fires server-side,
// a Cloud Function flips users.isOnline=false and ENDS any active session
// so the billing engine stops immediately, no overcharge ever.
import {
  ref, onValue, onDisconnect, set, serverTimestamp,
} from 'firebase/database';
import { rtdb } from '../firebase.js';
import { setOnline } from './userService.js';

// Returns a cleanup function. Call once after auth resolves.
// No-ops when uid is missing OR Realtime Database is not configured yet
// (NEXT_PUBLIC_FIREBASE_DATABASE_URL). In that case the pagehide/visibility
// fallback in useSession.js still stops billing on disconnect.
export function setupPresence(uid) {
  if (!uid) return () => {};
  if (!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL) return () => {};
  const statusRef = ref(rtdb, `/status/${uid}`);
  const connectedRef = ref(rtdb, '.info/connected');

  const unsub = onValue(connectedRef, (snap) => {
    if (snap.val() === false) return;
    // Register the disconnect handler BEFORE marking online so a race
    // can't leave a stale "online" if the socket drops immediately.
    onDisconnect(statusRef)
      .set({ state: 'offline', last_changed: serverTimestamp() })
      .then(() => {
        set(statusRef, { state: 'online', last_changed: serverTimestamp() });
        setOnline(uid).catch(() => {});
      });
  });

  return () => {
    unsub();
    set(statusRef, { state: 'offline', last_changed: serverTimestamp() })
      .catch(() => {});
  };
}
