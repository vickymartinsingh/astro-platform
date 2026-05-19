import Head from 'next/head';
import { useEffect } from 'react';
import { themeService } from '@astro/shared';
import '../styles/globals.css';
import { AuthProvider } from '../lib/useAuth';
import useNativeBack from '../lib/useNativeBack';
import ErrorBoundary from '../components/ErrorBoundary';
import SplashScreen from '../components/SplashScreen';
import NativeBack from '../components/NativeBack';
import PortalSwitcher from '../components/PortalSwitcher';

export default function App({ Component, pageProps }) {
  useNativeBack();
  useEffect(() => themeService.watchTheme(), []);
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
