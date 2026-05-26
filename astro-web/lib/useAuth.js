import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  authService, userService, presenceService, pushService,
} from '@astro/shared';

const AuthCtx = createContext({ user: null, profile: null, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Register this device for push on every launch, even before / without
  // sign-in, so broadcast and announcement pushes always deliver.
  useEffect(() => { pushService.registerDevice().catch(() => {}); }, []);

  useEffect(() => {
    let unsubProfile = null;
    let teardownPresence = null;
    // iOS WKWebView (capacitor:// scheme) sometimes fails to fire the
    // initial onAuthStateChanged callback - the whole app then sits on
    // skeletons forever. Force loading -> false after 2.5s so the UI
    // can paint; the real callback still flips user/profile if it
    // arrives later.
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
        userService.ensureUserDoc(u).catch(() => {});
        pushService.registerForPush(u.uid).catch(() => {});
        const profSafety = setTimeout(() => {
          try { setLoading(false); } catch (_) {}
        }, 3000);
        unsubProfile = userService.listenUser(u.uid, (p) => {
          clearTimeout(profSafety);
          setProfile(p); setLoading(false);
        });
      } else { setProfile(null); setLoading(false); }
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

export function useAuth() { return useContext(AuthCtx); }

// Astrologer-only guard (blueprint 5.3, wrong portal => access denied).
export function useRequireAstrologer() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/astro-login'); return; }
    // One login can be both client and astrologer: allow when role is
    // 'astrologer' OR the account has been extended (isAstrologer).
    const allowed = profile &&
      (profile.role === 'astrologer' || profile.isAstrologer === true);
    if (profile && !allowed) {
      authService.logoutUser();
      router.replace('/astro-login?denied=1');
    }
  }, [user, profile, loading, router]);
  return { user, profile, loading };
}
