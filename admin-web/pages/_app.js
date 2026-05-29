import Head from 'next/head';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
// Deep imports avoid the @astro/shared barrel pulling all 30+ services
// into the boot chunk.
import * as themeService from '@astro/shared/services/themeService.js';
import * as auditService from '@astro/shared/services/auditService.js';
import '../styles/globals.css';
import { AuthProvider } from '../lib/useAuth';
import useNativeBack from '../lib/useNativeBack';
import ErrorBoundary from '../components/ErrorBoundary';
import SplashScreen from '../components/SplashScreen';
import NativeBack from '../components/NativeBack';

// Perf: portal switcher is only meaningful when an authenticated admin
// opens the floating widget. Lazy-load + ssr:false keeps it out of the
// initial _app boot chunk.
const PortalSwitcher = dynamic(() => import(
  '../components/PortalSwitcher'), { ssr: false });

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
        const mod = await import('@capacitor/splash-screen');
        setTimeout(() => {
          try { mod.SplashScreen.hide({ fadeOutDuration: 300 }); }
          catch (_) { /* tolerate */ }
        }, 200);
      } catch (_) { /* not native */ }
    })();
  }, []);
  useEffect(() => {
    const onChange = (url) => auditService.logRoute(url, { admin: true });
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
        <PortalSwitcher />
      </AuthProvider>
      <NativeBack />
      <SplashScreen />
    </ErrorBoundary>
  );
}
