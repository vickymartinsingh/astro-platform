import Head from 'next/head';
import { useEffect } from 'react';
import { themeService } from '@astro/shared';
import '../styles/globals.css';
import { AuthProvider } from '../lib/useAuth';
import useNativeBack from '../lib/useNativeBack';

export default function App({ Component, pageProps }) {
  useNativeBack();
  useEffect(() => themeService.watchTheme(), []);
  return (
    <>
      <Head>
        <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    </>
  );
}
