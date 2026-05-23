import Head from 'next/head';

// Standalone, always-public Terms of Service for the store listing.
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

export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of Service - AstroSeer Connect</title>
        <meta name="robots" content="index,follow" />
        <meta name="viewport"
          content="width=device-width, initial-scale=1" />
      </Head>
      <main style={{
        maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px',
        fontFamily: 'Inter, system-ui, Arial, sans-serif',
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0F0A23' }}>
          Terms of Service
        </h1>
        <p style={{ color: '#6B7280', marginTop: 6 }}>
          AstroSeer Connect · Last updated {UPDATED}
        </p>

        <S title="1. Acceptance">
          By creating an account or using AstroSeer Connect you agree to
          these Terms and our Privacy Policy. If you do not agree, do not
          use the service.
        </S>
        <S title="2. The service">
          AstroSeer is a marketplace that connects users with independent
          astrologers for chat, call and video consultations, and
          provides astrology content (horoscope, kundli, tarot,
          remedies). Astrologers are independent practitioners, not
          employees of AstroSeer.
        </S>
        <S title="3. Entertainment disclaimer">
          Astrology content and consultations are provided for guidance
          and entertainment purposes only and are not a substitute for
          professional medical, legal, financial or psychological advice.
          Decisions you make are your own responsibility.
        </S>
        <S title="4. Eligibility">
          You must be at least 18 years old (or the age of majority in
          your jurisdiction) to make purchases or consultations.
        </S>
        <S title="5. Payments & wallet">
          Paid consultations are charged from your wallet or chosen
          payment method at the displayed per-minute or fixed rate.
          Recharges are processed by our payment partner. Refunds, where
          applicable, follow our in-app refund/dispute process.
        </S>
        <S title="6. Acceptable use">
          You agree not to misuse the service, harass astrologers or
          other users, share unlawful content, attempt to bypass payment,
          or interfere with the platform’s operation. We may suspend
          accounts that violate these Terms.
        </S>
        <S title="7. Recording">
          Calls and video sessions may be recorded for safety, quality
          and dispute resolution. By using those features you consent to
          such recording.
        </S>
        <S title="8. Limitation of liability">
          The service is provided “as is”. To the maximum extent
          permitted by law, AstroSeer is not liable for indirect or
          consequential damages, or for the accuracy of astrological
          guidance provided by independent astrologers.
        </S>
        <S title="9. Changes & termination">
          We may update these Terms or discontinue features. Continued
          use after changes constitutes acceptance. You may stop using
          the service and request account deletion at any time.
        </S>
        <S title="10. Contact">
          <a href={`mailto:${CONTACT}`} style={{ color: '#6C2BD9' }}>
            {CONTACT}
          </a>
        </S>

        <p style={{ marginTop: 40, fontSize: 12, color: '#9CA3AF' }}>
          © {new Date().getFullYear()} AstroSeer Connect. All rights
          reserved.
        </p>
      </main>
    </>
  );
}
