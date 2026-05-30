import Head from 'next/head';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
// Deep imports avoid the @astro/shared barrel pulling all 30+ services
// into the boot chunk.
import * as themeService from '@astro/shared/services/themeService.js';
import * as auditService from '@astro/shared/services/auditService.js';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import { AuthProvider } from '../lib/useAuth';
import useNativeBack from '../lib/useNativeBack';
import ErrorBoundary from '../components/ErrorBoundary';
import SplashScreen from '../components/SplashScreen';
import NativeBack from '../components/NativeBack';

// Perf: chrome that doesn't drive first paint is dynamic + ssr:false
// so it ships in its own chunk fetched after hydration. Keeps the
// boot _app.js small (was 218 KB brotli; this is the main cut).
const AdminLiveEditor = dynamic(() => import(
  '../components/AdminLiveEditor'), { ssr: false });
const AiAutoResponder = dynamic(() => import(
  '../components/AiAutoResponder'), { ssr: false });
const ConfirmModalHost = dynamic(() => import(
  '../components/ConfirmModal'), { ssr: false });

export default function App({ Component, pageProps }) {
  useNativeBack();
  const router = useRouter();
  useEffect(() => themeService.watchTheme(), []);
  // OTA web bundle updates via capgo/capacitor-updater (native only).
  useEffect(() => {
    (async () => {
      try {
        if (typeof window === 'undefined') return;
        if (!window.Capacitor || !window.Capacitor.isNativePlatform
          || !window.Capacitor.isNativePlatform()) return;
        const mod = await import('@capgo/capacitor-updater');
        if (mod && mod.CapacitorUpdater
          && mod.CapacitorUpdater.notifyAppReady) {
          await mod.CapacitorUpdater.notifyAppReady();
        }
      } catch (_) { /* best-effort */ }
    })();
  }, []);
  // Native splash hide. capacitor.config.json sets launchAutoHide:false
  // so the native splash stays until React is up. Web/desktop no-op.
  useEffect(() => {
    (async () => {
      try {
        if (typeof window === 'undefined') return;
        if (!window.Capacitor || !window.Capacitor.isNativePlatform
          || !window.Capacitor.isNativePlatform()) return;
        // Hide dynamic import from webpack so the web/Vercel build
        // (which does NOT have @capacitor/splash-screen installed)
        // doesn't fail with "Module not found". See client-web/_app.js
        // for the full explanation of the new-Function workaround.
        const dynImport = new Function('p', 'return import(p)');
        const mod = await dynImport('@capacitor/splash-screen')
          .catch(() => null);
        if (!mod) return;
        setTimeout(() => {
          try { mod.SplashScreen.hide({ fadeOutDuration: 300 }); }
          catch (_) { /* tolerate */ }
        }, 200);
      } catch (_) { /* not native */ }
    })();
  }, []);
  useEffect(() => {
    const onChange = (url) => auditService.logRoute(url);
    onChange(router.asPath);
    router.events.on('routeChangeComplete', onChange);
    return () => router.events.off('routeChangeComplete', onChange);
  }, [router.events, router.asPath]);
  return (
    <ErrorBoundary>
      <Head>
        <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <AuthProvider>
        <Component {...pageProps} />
        <AdminLiveEditor />
        <AiAutoResponder />
      </AuthProvider>
      <NativeBack />
      <SplashScreen />
      <ConfirmModalHost />
    </ErrorBoundary>
  );
}
