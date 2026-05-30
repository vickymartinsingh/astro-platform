import Head from 'next/head';

// Standalone, always-public Privacy Policy for the Google Play / App
// Store listing. Deliberately NOT behind auth/CMS so the URL
// (https://astroseer.in/privacy) is always reachable by reviewers.
const UPDATED = 'May 19, 2026';
const CONTACT = 'support@astroseer.in';

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

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - AstroSeer</title>
        <meta name="robots" content="index,follow" />
        <meta name="viewport"
          content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{
        maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px',
        fontFamily: 'Inter, system-ui, Arial, sans-serif',
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F0A23' }}>
          Privacy Policy
        </h1>
        <p style={{ color: '#6B7280', marginTop: 6 }}>
          AstroSeer · Last updated {UPDATED}
        </p>

        <S title="1. Introduction">
          AstroSeer (“we”, “us”) provides an
          astrology marketplace connecting users with astrologers via
          chat, voice and video, plus horoscope, kundli and related
          content. This policy explains what we collect, why, and your
          choices. By using the app or website you agree to this policy.
        </S>

        <S title="2. Information we collect">
          <ul style={{ paddingLeft: 18 }}>
            <li><b>Account data:</b> name, email, phone number, profile
              photo, and password (stored hashed by our auth provider).</li>
            <li><b>Astrology data you provide:</b> date, time and place
              of birth, gender and questions you submit - used only to
              generate kundli/horoscope and for your consultation.</li>
            <li><b>Consultation content:</b> chat messages, and call /
              video sessions (which may be recorded for safety, quality
              and dispute resolution - you are notified in-app).</li>
            <li><b>Transaction data:</b> wallet balance, purchases and
              payment status. Card/UPI details are handled by our
              payment processor; we do not store full card numbers.</li>
            <li><b>Device &amp; usage data:</b> device model, OS version,
              app version, IP address, push token, crash logs and basic
              analytics to operate and improve the service.</li>
          </ul>
        </S>

        <S title="3. How we use information">
          To create and manage your account; deliver consultations and
          generate astrology content you request; process payments and
          wallet; send service messages and notifications you opt into;
          provide support; ensure safety and prevent fraud/abuse; comply
          with law; and improve the product. We do <b>not</b> sell your
          personal data.
        </S>

        <S title="4. Sharing">
          We share data only with: the astrologer you choose to consult
          (limited to what is needed for the session); service providers
          who process it on our behalf (cloud hosting and database,
          authentication, push notifications, payment gateway,
          voice/video infrastructure) under confidentiality obligations;
          and authorities when required by law. These providers include
          Google Firebase (auth, database, notifications) and our
          payment and real-time-communication partners.
        </S>

        <S title="5. Data retention">
          We keep personal data while your account is active and as
          needed for the purposes above or to meet legal, tax and
          dispute obligations. You can request deletion of your account
          and associated personal data (see Section 8).
        </S>

        <S title="6. Security">
          Data is transmitted over encrypted connections and stored with
          access controls. No method of transmission or storage is 100%
          secure, but we take reasonable measures to protect your
          information.
        </S>

        <S title="7. Children">
          The service is not directed to children under 13 (or the
          minimum age in your country). We do not knowingly collect data
          from children. If you believe a child has provided us data,
          contact us and we will delete it.
        </S>

        <S title="8. Your rights & choices">
          You can view/update your profile in the app, control
          notification permissions on your device, and request access to
          or deletion of your personal data by emailing{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: '#6C2BD9' }}>
            {CONTACT}
          </a>. We will respond within a reasonable period as required
          by applicable law.
        </S>

        <S title="9. Account & data deletion">
          To delete your account and personal data, email{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: '#6C2BD9' }}>
            {CONTACT}
          </a>{' '}from your registered email with the subject “Delete my
          account”. Consultation records required for legal/financial
          compliance may be retained for the legally required period and
          then deleted.
        </S>

        <S title="10. Changes">
          We may update this policy; material changes will be posted on
          this page with a new “Last updated” date.
        </S>

        <S title="11. Contact">
          Questions about this policy or your data:{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: '#6C2BD9' }}>
            {CONTACT}
          </a>.
        </S>

        <p style={{ marginTop: 40, fontSize: 12, color: '#9CA3AF' }}>
          © {new Date().getFullYear()} AstroSeer. All rights
          reserved.
        </p>
      </main>
    </>
  );
}
