import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Android hardware BACK button. By default Capacitor closes the whole
// app on back; instead we navigate to the previous screen. Only when
// already on a top-level screen (Home) does back minimise the app.
// Accessed via the Capacitor runtime global so the bundler never
// imports the plugin (web/static builds stay untouched).
const ROOTS = ['/', '/dashboard'];

export default function useNativeBack() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const Cap = window.Capacitor;
    if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) {
      return undefined;
    }
    const App = Cap.Plugins && Cap.Plugins.App;
    if (!App || !App.addListener) return undefined;

    let handle;
    const sub = App.addListener('backButton', () => {
      // Close any open overlay first (the topmost ESC-style dismiss).
      const onRoot = ROOTS.includes(window.location.pathname)
        || ROOTS.includes(router.pathname);
      if (!onRoot && window.history.length > 1) {
        router.back();
      } else if (onRoot) {
        try { App.minimizeApp && App.minimizeApp(); }
        catch (_) { try { App.exitApp && App.exitApp(); } catch (e) {} }
      } else {
        router.replace('/dashboard');
      }
    });
    Promise.resolve(sub).then((h) => { handle = h; }).catch(() => {});
    return () => {
      try {
        if (handle && handle.remove) handle.remove();
        else if (sub && sub.remove) sub.remove();
      } catch (_) {}
    };
  }, [router]);
}
