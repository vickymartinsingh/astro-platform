import Head from 'next/head';
import Link from 'next/link';

// Public, always-reachable Account & Data Deletion page required by
// Google Play (App content -> "Web link to request account deletion").
// Two paths: in-app self-service (preferred) and email request.
const CONTACT = 'support@astroseer.in';
const UPDATED = 'May 21, 2026';

const S = ({ title, children }) => (
  <section style={{ marginTop: 26 }}>
    <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1A2E' }}>
      {title}
    </h2>
    <div style={{ marginTop: 8, color: '#374151', lineHeight: 1.65 }}>
      {children}
    </div>
  </section>
);

export default function AccountDeletion() {
  return (
    <>
      <Head>
        <title>Delete your account — AstroSeer Connect</title>
        <meta name="robots" content="index,follow" />
        <meta name="viewport"
          content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{
        maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px',
        fontFamily: 'Inter, system-ui, Arial, sans-serif',
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F0A23' }}>
          Delete your AstroSeer account
        </h1>
        <p style={{ color: '#6B7280', marginTop: 6 }}>
          AstroSeer Connect · Last updated {UPDATED}
        </p>

        <S title="1. Two ways to delete your account">
          <p><b>A. Inside the app (fastest)</b>: open the app, go to{' '}
            <b>Profile → Delete my account</b>, and confirm. Your
            request is registered immediately and your account is
            deactivated; the data purge follows within 30 days
            (see retention below).</p>
          <p style={{ marginTop: 8 }}><b>B. By email</b>: send a
            message from the email you registered with to{' '}
            <a href={`mailto:${CONTACT}?subject=${
              encodeURIComponent('Delete my AstroSeer account')
            }&body=${encodeURIComponent(
              'Please delete my AstroSeer account and personal data.'
              + '\n\nRegistered email:\nUser ID (if known):'
              + '\nReason (optional):'
            )}`} style={{ color: '#6C2BD9', fontWeight: 600 }}>
              {CONTACT}
            </a> with the subject <i>“Delete my AstroSeer account”</i>.
            We confirm within 48 hours and complete deletion within 30
            days.</p>
        </S>

        <S title="2. What gets deleted">
          <ul style={{ paddingLeft: 18 }}>
            <li>Your account, login credentials and profile (name,
              email, phone, photo).</li>
            <li>Astrology details you provided (birth date / time /
              place, kundli, questions).</li>
            <li>Your wallet balance, followers/following list,
              reviews and notification tokens.</li>
            <li>Chat messages and call/video session metadata
              attached to your account.</li>
          </ul>
        </S>

        <S title="3. What is retained (and why)">
          Records required by law or for legitimate business reasons
          are kept for the period required, then permanently deleted:
          <ul style={{ paddingLeft: 18, marginTop: 6 }}>
            <li><b>Transaction / payment records</b> — up to 7 years
              (tax & financial regulation).</li>
            <li><b>Call & video recordings</b> linked to disputes or
              safety reports — up to the resolution period.</li>
            <li><b>Anonymised analytics</b> with no link back to you
              may be kept indefinitely.</li>
          </ul>
          Nothing retained can identify you personally once your
          account record is removed.
        </S>

        <S title="4. Timeline">
          <ul style={{ paddingLeft: 18 }}>
            <li><b>Day 0:</b> You request deletion (in-app or email).
              Account is deactivated; you can no longer sign in.</li>
            <li><b>Within 30 days:</b> Personal data is purged from
              live systems and backups.</li>
            <li>Confirmation email is sent to your registered address
              when purge completes.</li>
          </ul>
        </S>

        <S title="5. Change your mind?">
          If you request deletion by mistake, email{' '}
          <a href={`mailto:${CONTACT}`}
            style={{ color: '#6C2BD9' }}>{CONTACT}</a>{' '}
          within 7 days of the request and we can cancel it. After 30
          days the data is gone and cannot be restored.
        </S>

        <S title="6. Questions">
          <a href={`mailto:${CONTACT}`} style={{ color: '#6C2BD9' }}>
            {CONTACT}
          </a> — we respond within 48 hours on business days.
        </S>

        <p style={{ marginTop: 36, fontSize: 13 }}>
          <Link href="/privacy" style={{ color: '#6C2BD9' }}>
            Privacy policy
          </Link>{' · '}
          <Link href="/terms" style={{ color: '#6C2BD9' }}>
            Terms of service
          </Link>
        </p>
        <p style={{ marginTop: 24, fontSize: 12, color: '#9CA3AF' }}>
          © {new Date().getFullYear()} AstroSeer Connect.
        </p>
      </main>
    </>
  );
}
