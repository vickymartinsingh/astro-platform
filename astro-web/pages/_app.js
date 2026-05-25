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
