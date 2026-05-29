import Head from 'next/head';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
// Deep imports (not the barrel) - pull ONLY the two services _app
// actually uses. Going through `@astro/shared` index re-exports drags
// ~30 services + their Firestore queries into the boot chunk even
// when only a couple are referenced.
import * as themeService from '@astro/shared/services/themeService.js';
import * as auditService from '@astro/shared/services/auditService.js';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import { AuthProvider, useAuth } from '../lib/useAuth';
import { useOrderSyncer } from '../lib/useOrderSyncer';
import { I18nProvider } from '../lib/i18n';
import { AuthModalProvider } from '../lib/authModal';
import { KundliGateProvider } from '../lib/kundliGate';
import { PendingSessionProvider } from '../lib/pendingSession';
import useNativeBack from '../lib/useNativeBack';
import SplashScreen from '../components/SplashScreen';
import NativeBack from '../components/NativeBack';
import ErrorBoundary from '../components/ErrorBoundary';

// Perf: lazy-load chrome that doesn't need to be on the first-paint
// path. Each ssr:false dynamic() ships its component code in its OWN
// chunk that the browser pulls only after hydration, so the initial
// _app.js stays small.
//   - GuidedTour: only on a first-time visit (localStorage gate).
//   - AdminLiveEditor: only for admins.
//   - ActiveSessionBar: only while the user has a live chat/call.
//   - ConfirmModalHost: only when something calls confirmModal().
const GuidedTour = dynamic(() => import('../components/GuidedTour'),
  { ssr: false });
const AdminLiveEditor = dynamic(() => import(
  '../components/AdminLiveEditor'), { ssr: false });
const ActiveSessionBar = dynamic(() => import(
  '../components/ActiveSessionBar'), { ssr: false });
const ConfirmModalHost = dynamic(
  () => import('../components/ConfirmModal'), { ssr: false });

function WithProviders({ children }) {
  const { user, profile } = useAuth();
  useNativeBack();
  // Background order syncer - runs on every customer-app page
  // for signed-in users. Fires the relay's sweepPending sweep
  // every 60s so any *_generating order in Firestore catches up
  // with AstroSeer's actual SENT status without the customer
  // needing to land on /orders specifically.
  useOrderSyncer({ enabled: !!user });
  return (
    <I18nProvider profile={profile} uid={user?.uid}>
      <AuthModalProvider>
        <KundliGateProvider>
          <PendingSessionProvider>{children}</PendingSessionProvider>
        </KundliGateProvider>
      </AuthModalProvider>
    </I18nProvider>
  );
}

export default function App({ Component, pageProps }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const router = useRouter();
  useEffect(() => themeService.watchTheme(), []);
  // OTA web bundle updates via capgo/capacitor-updater. On native
  // platforms only - no-op on web. Tells the plugin the new bundle
  // booted successfully so it doesn't roll back on next launch.
  // The actual download + swap happens automatically in the plugin
  // (autoUpdate:true in capacitor.config.json) on app launch + when
  // the app comes back from background.
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
      } catch (_) { /* OTA is best-effort, never crash boot */ }
    })();
  }, []);
  // ASTROSEER RENDER DYNO KEEP-ALIVE: ping /health every 4 minutes
  // while the app is open so the free-tier dyno never enters its
  // 15-minute idle sleep. The kundli chart fetch (which needs that
  // dyno awake) then never sees a cold-start 30-60s delay. Also
  // fires once on mount so the very first chart request is warm.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      import('@astro/shared').then((m) => {
        if (m && m.kundliService
          && typeof m.kundliService.wakeAstroSeer === 'function') {
          m.kundliService.wakeAstroSeer().catch(() => { /* fine */ });
        }
      }).catch(() => { /* */ });
    };
    ping();                                          // immediate
    const id = setInterval(ping, 4 * 60 * 1000);     // every 4 min
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  // Compliance: log every route change (deduped per uid+path) so admin
  // can see what each user clicked / browsed in their activity log.
  useEffect(() => {
    const onChange = (url) => auditService.logRoute(url);
    onChange(router.asPath);
    router.events.on('routeChangeComplete', onChange);
    return () => router.events.off('routeChangeComplete', onChange);
  }, [router.events, router.asPath]);
  useEffect(() => {
    const onRefresh = () => setRefreshKey((k) => k + 1);
    window.addEventListener('app:refresh', onRefresh);
    return () => window.removeEventListener('app:refresh', onRefresh);
  }, []);
  return (
    <ErrorBoundary>
      <Head>
        {/* Auto-adapt: desktop layout on desktop, mobile layout on phones
            (Hard Rule 2). Without this phones render the desktop width. */}
        <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <AuthProvider>
        <WithProviders>
          <Component key={refreshKey} {...pageProps} />
        </WithProviders>
        <ActiveSessionBar />
        <AdminLiveEditor />
      </AuthProvider>
      <GuidedTour />
      <NativeBack />
      <SplashScreen />
      <ConfirmModalHost />
    </ErrorBoundary>
  );
}
