import Head from 'next/head';
import '../styles/globals.css';
import { AuthProvider, useAuth } from '../lib/useAuth';
import { I18nProvider } from '../lib/i18n';
import { AuthModalProvider } from '../lib/authModal';
import { KundliGateProvider } from '../lib/kundliGate';
import { PendingSessionProvider } from '../lib/pendingSession';

function WithProviders({ children }) {
  const { user, profile } = useAuth();
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
  return (
    <>
      <Head>
        {/* Auto-adapt: desktop layout on desktop, mobile layout on phones
            (Hard Rule 2). Without this phones render the desktop width. */}
        <meta name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <AuthProvider>
        <WithProviders>
          <Component {...pageProps} />
        </WithProviders>
      </AuthProvider>
    </>
  );
}
