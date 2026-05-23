import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { confirmModal } from '../components/ConfirmModal';

// Android hardware BACK. Never closes the app on a single press:
//  - not on a root screen  -> go to the previous screen
//  - on a root screen      -> must press BACK twice within 1s, then a
//                             confirm dialog; only "OK" exits the app.
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

    let lastBack = 0;
    let handle;
    const sub = App.addListener('backButton', () => {
      const path = window.location.pathname;
      const onRoot = ROOTS.includes(path) || ROOTS.includes(router.pathname);

      if (!onRoot && window.history.length > 1) {
        router.back();
        return;
      }
      if (!onRoot) { router.replace('/dashboard'); return; }

      // On a root screen: require a quick double-press, then confirm.
      const now = Date.now();
      if (now - lastBack < 1000) {
        lastBack = 0;
        confirmModal({
          title: 'Close AstroSeer?',
          message: 'You can come back any time.',
          yes: 'Close',
          no: 'Stay',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          try { App.exitApp && App.exitApp(); }
          catch (_) { try { App.minimizeApp && App.minimizeApp(); }
            catch (e) {} }
        });
      } else {
        lastBack = now;
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
