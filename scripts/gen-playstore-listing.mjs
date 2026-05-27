// Generate the Play Store images (512x512 app icon + 1024x500 feature
// graphic) from the brand assets, plus a copy-paste text listing.
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SPLASH = join(ROOT, 'brand',
  'AstroSeer_Splash Logo_Transprent_IOS&APK.png');
const IOS_ICON = join(ROOT, 'brand', 'AstroSeer_IOS_Cust App_ICON.png');
const BG = { r: 0x0f, g: 0x0a, b: 0x23, alpha: 1 };

const dest = join(ROOT, '..', 'AstroSeer_PlayStoreListing');
mkdirSync(dest, { recursive: true });

// 1. App icon - 512×512, opaque, no alpha (Play requires this).
const src = existsSync(IOS_ICON) ? IOS_ICON : SPLASH;
await sharp(src)
  .resize(512, 512, { fit: 'cover', position: 'centre' })
  .flatten({ background: BG })
  .png()
  .toFile(join(dest, 'app-icon-512.png'));

// 2. Feature graphic - 1024×500, branded with logo + wordmark.
const logoSize = 360;
const logoBuf = await sharp(SPLASH)
  .resize(logoSize, logoSize, { fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();
const svg = `
<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F0A23"/>
      <stop offset="0.55" stop-color="#1A0F3E"/>
      <stop offset="1" stop-color="#3B2170"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.32" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#D4A12A" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#D4A12A" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="500" fill="url(#g)"/>
  <rect width="1024" height="500" fill="url(#glow)"/>
  <text x="490" y="230" fill="#FFFFFF"
    font-family="Inter, Arial, sans-serif"
    font-size="84" font-weight="800">AstroSeer</text>
  <text x="490" y="320" fill="#D4A12A"
    font-family="Inter, Arial, sans-serif"
    font-size="56" font-weight="700">Connect</text>
  <text x="490" y="380" fill="#E5E7EB"
    font-family="Inter, Arial, sans-serif"
    font-size="26" font-weight="500" opacity="0.85">
    Talk to trusted astrologers · Chat · Call · Video
  </text>
</svg>`;
await sharp({ create: { width: 1024, height: 500, channels: 4,
  background: BG } })
  .composite([
    { input: Buffer.from(svg), top: 0, left: 0 },
    { input: logoBuf, top: Math.round((500 - logoSize) / 2),
      left: 80 },
  ])
  .png()
  .toFile(join(dest, 'feature-graphic-1024x500.png'));

// 3. Text listing.
const listing = `# Google Play Store - Default Store Listing
# Project: astrology-2092d · Package: com.astroseer.mobile

==============================================
APP DETAILS
==============================================

App name (30 char max):
AstroSeer Connect

Short description (80 char max, 73 used):
Talk to trusted Vedic astrologers - chat, call & video. Kundli, horoscope.

Full description (paste below, ~2900 char):
----------------------------------------------
AstroSeer Connect brings you trusted Vedic astrologers, real-time guidance, and personalised astrology content - all in one beautifully crafted app.

WHAT YOU GET
• Live chat, voice and video consultations with verified astrologers
• Free Kundli (birth chart) generated from your date, time and place of birth
• Daily horoscope tailored to your sign
• Tarot card readings with guided spreads
• Kundli matching for marriage (Ashtakoota / Guna milan)
• Personal remedies and gemstone suggestions
• Live astrology shows and announcements

WHY ASTROSEER
✓ Verified astrologers only - every profile is reviewed by our team
✓ Transparent per-minute pricing, secure wallet recharge
✓ Private and ad-free - your birth details are never sold or shared
✓ Beautiful Vedic-inspired design built for everyday use
✓ Save your favourite astrologers and consultation history
✓ End-to-end encrypted session transport

HOW IT WORKS
1. Sign up with email or Google - it takes seconds
2. Add your birth details to unlock your personal kundli
3. Browse astrologers by speciality (love, marriage, career, health)
4. Tap Chat, Call or Video to start a consultation
5. Top up your wallet securely and consult whenever you need

WHO IT'S FOR
Anyone curious about Vedic astrology - first-timers, regulars, devotees of jyotish, or people seeking guidance on relationships, career, marriage compatibility, finance, health and life direction.

PRIVACY & SAFETY
Your data stays yours. We collect only what's needed to deliver consultations and generate astrology content. Read our full policy at astroseer.in/privacy. You can request account and data deletion any time at astroseer.in/account-deletion or by emailing support@astroseer.in.

DISCLAIMER
Astrology content and consultations are for guidance and entertainment purposes; they do not replace professional medical, legal, financial or psychological advice.

NEED HELP?
support@astroseer.in - we usually reply within a business day.

Welcome to AstroSeer Connect - your trusted home for personal astrology.
----------------------------------------------

==============================================
GRAPHIC ASSETS (already saved in this folder)
==============================================

App icon (512×512 PNG, opaque):  app-icon-512.png
Feature graphic (1024×500 PNG):  feature-graphic-1024x500.png

Still needed (you take these from the running app):
  Phone screenshots - at least 2, up to 8
  Aspect 9:16 (portrait) or 16:9 (landscape); min 320px on the short side
  Suggested shots: Home/dashboard, Astrologers list, Astrologer profile,
  Chat in progress, Video call UI, Kundli view, Horoscope, Wallet.

==============================================
CATEGORISATION
==============================================

App category: Lifestyle (alt: Entertainment)
Tags (up to 5):  Astrology · Horoscope · Kundli · Tarot · Spiritual

==============================================
CONTACT DETAILS
==============================================

Email:           support@astroseer.in
Website:         https://www.astroseer.in
Phone:           (leave blank or your support number)
Privacy policy:  https://www.astroseer.in/privacy

==============================================
APP CONTENT - REQUIRED ANSWERS
==============================================

Privacy policy URL:        https://www.astroseer.in/privacy
Account deletion URL:      https://www.astroseer.in/account-deletion
Target audience age:       18+
Contains ads:              No
In-app purchases:          Yes (wallet recharge / consultation top-ups)
News app:                  No
Government:                No
COVID-19 contact tracing:  No
Financial features:        No (consultations only, not financial advice)
Health features:           No
`;

writeFileSync(join(dest, 'STORE-LISTING.txt'), listing);
console.log('Saved to:', dest);
