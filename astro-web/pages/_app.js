import Head from 'next/head';
import '../styles/globals.css';
import { AuthProvider } from '../lib/useAuth';

export default function App({ Component, pageProps }) {
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
