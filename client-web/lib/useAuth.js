import {
  createContext, useContext, useEffect, useRef, useState,
} from 'react';
import { useRouter } from 'next/router';
import {
  authService, userService, presenceService, pushService,
  auth as firebaseAuth,
} from '@astro/shared';
import { useAuthModal } from './authModal';

const AuthCtx = createContext({ user: null, profile: null, loading: true });

export function AuthProvider({ children }) {
  // Seed user from Firebase's CURRENT auth state at first render. On
  // route changes (and HMR reloads in dev) the AuthProvider remounts
  // and useState(null) would briefly publish `user=null` before
  // onAuthStateChanged fires - that brief null was popping the login
  // modal on every click. Seeding from auth.currentUser means signed-
  // in users see `user=X` from frame 1.
  const [user, setUser] = useState(() => {
    try {
      return (typeof firebaseAuth !== 'undefined'
        && firebaseAuth && firebaseAuth.currentUser) || null;
    } catch (_) { return null; }
  });
  const [profile, setProfile] = useState(null);
  // Loading STAYS true until the Firestore profile listener confirms
  // it has a snapshot (success or "doc-doesn't-exist-null") so pages
  // that gate on `if (loading || !profile)` don't flash skeleton
  // placeholders forever. Setting this false on the user-seed alone
  // was the bug that left /profile permanently skeletonised.
  const [loading, setLoading] = useState(true);

  // Register this device for push on every launch, even before / without
  // sign-in, so broadcast and announcement pushes always deliver.
  useEffect(() => { pushService.registerDevice().catch(() => {}); }, []);

  useEffect(() => {
    let unsubProfile = null;
    let teardownPresence = null;
    // iOS infinite-loading guard: in WKWebView under capacitor:// the
    // Firebase Auth init can silently hang on IndexedDB persistence
    // probing, the initial onAuthStateChanged callback never fires,
    // and the whole app sits on skeletons forever. After 2.5s assume
    // "no user yet" and unblock the UI; the real callback will still
    // fire later if/when Firebase finishes init and flip user/profile.
    const safety = setTimeout(() => {
      try { setLoading(false); } catch (_) {}
    }, 2500);
    const unsub = authService.watchAuth((u) => {
      clearTimeout(safety);
      setUser(u);
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (teardownPresence) { teardownPresence(); teardownPresence = null; }
      if (u) {
        teardownPresence = presenceService.setupPresence(u.uid);
        // Create the user doc if the Cloud Function hasn't (Spark/no Blaze).
        userService.ensureUserDoc(u).catch(() => {});
        // Native apps only: register for lock-screen push (no-op on web).
        pushService.registerForPush(u.uid).catch(() => {});
        // Track which app version this user is on so the admin can
        // see who needs to update + fan-out the "new version" push
        // only to users still on older builds.
        (async () => {
          try {
            const { APP_BUILD, APP_VERSION } = await import(
              '@astro/shared/appVersion.js');
            const isNative = typeof window !== 'undefined'
              && window.Capacitor
              && window.Capacitor.isNativePlatform
              && window.Capacitor.isNativePlatform();
            await userService.updateUser(u.uid, {
              appBuild: Number(APP_BUILD) || 0,
              appVersion: String(APP_VERSION || ''),
              appPlatform: isNative ? 'native' : 'web',
              lastSeenAt: new Date().toISOString(),
            });
          } catch (_) { /* best-effort */ }
        })();
        // Profile listen has its OWN safety. Two failure modes we
        // protect against:
        //  1. iOS WKWebView Firestore hang -> snapshot never fires
        //  2. users/{uid} doc doesn't exist yet (ensureUserDoc still
        //     in flight, or Spark plan write failed) -> snapshot
        //     fires with null
        // In either case, after 2.5s we synthesize a MINIMAL profile
        // from the Firebase Auth user (uid + email + displayName) so
        // pages that gate on `if (loading || !profile)` don't sit on
        // skeletons forever. The real listener still wins when it
        // arrives - it'll overwrite the stub.
        const profSafety = setTimeout(() => {
          try {
            setProfile((cur) => cur || ({
              uid: u.uid,
              email: u.email || '',
              name: u.displayName || '',
              role: 'client',
              _stub: true,
            }));
            setLoading(false);
          } catch (_) {}
        }, 2500);
        unsubProfile = userService.listenUser(u.uid, (p) => {
          clearTimeout(profSafety);
          // If Firestore returns null (doc missing) keep / synthesize
          // the stub so the page still renders.
          setProfile(p || ({
            uid: u.uid,
            email: u.email || '',
            name: u.displayName || '',
            role: 'client',
            _stub: true,
          }));
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
      clearTimeout(safety);
      unsub && unsub();
      unsubProfile && unsubProfile();
      teardownPresence && teardownPresence();
    };
  }, []);

  return (
    <AuthCtx.Provider value={{ user, profile, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

// Hard guard, for service/account screens that genuinely need an account
// (wallet, chat, call, kundli, history, notifications, favorites, profile).
// Guests get the LOGIN POPUP (no redirect); blocked accounts are signed out.
export function useRequireClient() {
  const { user, profile, loading } = useAuth();
  const { openLogin } = useAuthModal();
  const router = useRouter();
  const asked = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Ground-truth check: if Firebase Auth itself thinks the user
      // is signed in but our React state hasn't caught up yet (which
      // happens during route changes on web - the new page mounts a
      // beat before useAuth re-publishes its context), DO NOT pop the
      // login modal. That spurious popup is what makes "every click
      // logs me out" feel like a real logout. Wait one tick for the
      // state to catch up; the AuthProvider listener will fire and
      // re-render with the real user.
      if (firebaseAuth && firebaseAuth.currentUser) return;
      if (asked.current) return;
      asked.current = true;
      // Popup login; if dismissed, leave to the public home (no blink).
      openLogin(undefined, { onDismiss: () => router.replace('/dashboard') });
      return;
    }
    asked.current = false;
    // Only auto-logout on isBlocked when we have a REAL profile from
    // Firestore (not the stub we synthesise during loading delays).
    // The stub never carries isBlocked so this check would already
    // be falsy, but the explicit guard documents intent + prevents a
    // future stub change from accidentally signing the user out.
    if (profile && !profile._stub && profile.isBlocked === true) {
      authService.logoutUser();
      router.replace('/dashboard?blocked=1');
    }
    // OTP enforcement: if admin requires email verification AND this
    // user has not verified yet, force the login modal back open.
    // LoginCard sees the unverified user inside finish() and routes
    // straight to the OTP screen. No gated page becomes usable until
    // emailVerified flips true. Skips the check until profile has
    // loaded so we do not double-fire during the first paint.
    if (user && !user.emailVerified) {
      try {
        const features = JSON.parse(
          (typeof localStorage !== 'undefined'
            && localStorage.getItem('settings_features')) || '{}');
        if (features && features.email_verification === true) {
          if (asked.current) return;
          asked.current = true;
          openLogin();
        }
      } catch (_) { /* tolerate */ }
    }
  }, [user, profile, loading, router, openLogin]);
  // Keep "loading" until signed in so the page shows a skeleton behind
  // the popup instead of erroring on a missing user/profile.
  return { user, profile, loading: loading || !user };
}

// Soft guard, for publicly browsable screens (home, marketplace,
// astrologer profile, horoscope). No redirect: guests can look around and
// are only asked to sign in when they take a service.
export function useOptionalClient() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading || !user || !profile) return;
    // Same guard as useRequireClient: never auto-logout based on a
    // stub profile (synthesised when Firestore is slow / missing).
    if (!profile._stub && profile.isBlocked === true) {
      authService.logoutUser();
      router.replace('/login?blocked=1');
    }
  }, [user, profile, loading, router]);
  return { user, profile, loading };
}
