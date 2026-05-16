// Android hardware-back handling for the Capacitor apps.
//
// Default Capacitor behaviour exits the app on every back press. We want
// it to navigate back through the in-app history (like a normal app) and
// only exit when there's nowhere left to go. Uses the Capacitor runtime
// global (no @capacitor/* bundler import), so the web builds are
// unaffected. @capacitor/app must be installed so the native back event
// is delivered to window.Capacitor.Plugins.App.
import { useEffect } from 'react';

export function useAndroidBack() {
  useEffect(() => {
    const C = typeof window !== 'undefined' && window.Capacitor;
    if (!C || typeof C.isNativePlatform !== 'function'
        || !C.isNativePlatform()) return undefined;
    const AppP = C.Plugins && C.Plugins.App;
    if (!AppP || !AppP.addListener) return undefined;
    let handle;
    AppP.addListener('backButton', (e) => {
      const canGo = (e && e.canGoBack)
        || (typeof window !== 'undefined' && window.history.length > 1);
      if (canGo) {
        window.history.back();
      } else if (AppP.exitApp) {
        AppP.exitApp();
      }
    }).then((h) => { handle = h; }).catch(() => {});
    return () => {
      try { if (handle && handle.remove) handle.remove(); } catch (_) {}
    };
  }, []);
}
