import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { authService, userService, isAdminUser } from '@astro/shared';

const AuthCtx = createContext({ user: null, profile: null, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile = null;
    // iOS WKWebView (capacitor:// scheme) can fail to fire the initial
    // onAuthStateChanged callback, leaving the app on skeletons
    // forever. Force loading -> false after 2.5s so the UI can paint;
    // the real callback still flips user/profile when it arrives.
    const safety = setTimeout(() => {
      try { setLoading(false); } catch (_) {}
    }, 2500);
    const unsub = authService.watchAuth((u) => {
      clearTimeout(safety);
      setUser(u);
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (u) {
        userService.ensureUserDoc(u).catch(() => {});
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
    };
  }, []);

  return (
    <AuthCtx.Provider value={{ user, profile, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() { return useContext(AuthCtx); }

// Admin-only guard. Privileged mutations still go through Cloud Functions
// that re-check the admin role server-side (Hard Rules 4 & 6).
export function useRequireAdmin() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/admin-login'); return; }
    if (profile && !isAdminUser(profile, user.email)) {
      authService.logoutUser();
      router.replace('/admin-login?denied=1');
    }
  }, [user, profile, loading, router]);
  return { user, profile, loading };
}
