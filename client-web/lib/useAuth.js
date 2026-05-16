import {
  createContext, useContext, useEffect, useRef, useState,
} from 'react';
import { useRouter } from 'next/router';
import {
  authService, userService, presenceService, pushService,
} from '@astro/shared';
import { useAuthModal } from './authModal';

const AuthCtx = createContext({ user: null, profile: null, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile = null;
    let teardownPresence = null;
    const unsub = authService.watchAuth((u) => {
      setUser(u);
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (teardownPresence) { teardownPresence(); teardownPresence = null; }
      if (u) {
        teardownPresence = presenceService.setupPresence(u.uid);
        // Create the user doc if the Cloud Function hasn't (Spark/no Blaze).
        userService.ensureUserDoc(u).catch(() => {});
        // Native apps only: register for lock-screen push (no-op on web).
        pushService.registerForPush(u.uid).catch(() => {});
        unsubProfile = userService.listenUser(u.uid, (p) => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {
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
      if (asked.current) return;
      asked.current = true;
      // Popup login; if dismissed, leave to the public home (no blink).
      openLogin(undefined, { onDismiss: () => router.replace('/dashboard') });
      return;
    }
    asked.current = false;
    if (profile && profile.isBlocked) {
      authService.logoutUser();
      router.replace('/dashboard?blocked=1');
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
    if (profile.isBlocked) {
      authService.logoutUser();
      router.replace('/login?blocked=1');
    }
  }, [user, profile, loading, router]);
  return { user, profile, loading };
}
