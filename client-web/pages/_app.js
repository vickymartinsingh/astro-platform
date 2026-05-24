import Head from 'next/head';
import { useEffect, useState } from 'react';
import { themeService, auditService } from '@astro/shared';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import { AuthProvider, useAuth } from '../lib/useAuth';
import { I18nProvider } from '../lib/i18n';
import { AuthModalProvider } from '../lib/authModal';
import { KundliGateProvider } from '../lib/kundliGate';
import { PendingSessionProvider } from '../lib/pendingSession';
import useNativeBack from '../lib/useNativeBack';
import GuidedTour from '../components/GuidedTour';
import SplashScreen from '../components/SplashScreen';
import NativeBack from '../components/NativeBack';
import AdminLiveEditor from '../components/AdminLiveEditor';
import ActiveSessionBar from '../components/ActiveSessionBar';
import ErrorBoundary from '../components/ErrorBoundary';
import ConfirmModalHost from '../components/ConfirmModal';

function WithProviders({ children }) {
  const { user, profile } = useAuth();
  useNativeBack();
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
