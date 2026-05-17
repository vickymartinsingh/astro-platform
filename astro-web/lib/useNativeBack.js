import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Android hardware BACK (astrologer app). Single press never closes the
// app: go to the previous screen, or on a root screen require a quick
// double-press then a confirm dialog before exiting.
const ROOTS = ['/', '/astro-dashboard'];

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

    let lastBack = 0;
    let handle;
    const sub = App.addListener('backButton', () => {
      const path = window.location.pathname;
      const onRoot = ROOTS.includes(path) || ROOTS.includes(router.pathname);
      if (!onRoot && window.history.length > 1) { router.back(); return; }
      if (!onRoot) { router.replace('/astro-dashboard'); return; }
      const now = Date.now();
      if (now - lastBack < 1000) {
        lastBack = 0;
        // eslint-disable-next-line no-alert
        const ok = window.confirm('Are you sure you want to close the app?');
        if (ok) {
          try { App.exitApp && App.exitApp(); }
          catch (_) { try { App.minimizeApp && App.minimizeApp(); }
            catch (e) {} }
        }
      } else { lastBack = now; }
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
