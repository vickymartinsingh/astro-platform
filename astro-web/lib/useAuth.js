import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { authService, userService, presenceService } from '@astro/shared';

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
        userService.ensureUserDoc(u).catch(() => {});
        unsubProfile = userService.listenUser(u.uid, (p) => {
          setProfile(p); setLoading(false);
        });
      } else { setProfile(null); setLoading(false); }
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

export function useAuth() { return useContext(AuthCtx); }

// Astrologer-only guard (blueprint 5.3, wrong portal => access denied).
export function useRequireAstrologer() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/astro-login'); return; }
    if (profile && profile.role !== 'astrologer') {
      authService.logoutUser();
      router.replace('/astro-login?denied=1');
    }
  }, [user, profile, loading, router]);
  return { user, profile, loading };
}
