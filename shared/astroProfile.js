// Canonical option lists for the astrologer recruitment form +
// astrologer profile editing. One place to add a new skill / language
// so the public form, the admin panel and the astrologer dashboard
// always show the same choices.

export const LANGUAGES = [
  'Hindi', 'English', 'Tamil', 'Telugu', 'Kannada', 'Malayalam',
  'Marathi', 'Gujarati', 'Bengali', 'Punjabi', 'Odia', 'Assamese',
  'Urdu', 'Sanskrit', 'Konkani', 'Sindhi', 'Bhojpuri', 'Maithili',
  'Nepali', 'Tulu', 'Kashmiri',
];

// Skills offered on the platform. Keep aligned with the categories
// the customer-side astrologer search filters by.
export const SKILLS = [
  'Vedic Astrology', 'KP Astrology', 'Nadi Astrology', 'Numerology',
  'Tarot Reading', 'Palmistry', 'Vastu Shastra', 'Lal Kitab',
  'Western Astrology', 'Horary / Prashna', 'Face Reading',
  'Crystal Healing', 'Reiki', 'Pranic Healing', 'Marriage Matching',
  'Career Guidance', 'Love & Relationships', 'Finance & Business',
  'Gemstone Consultation', 'Remedy Specialist', 'Psychic Reading',
  'Dream Interpretation', 'Astro-Counselling', 'Spiritual Healing',
];

// Years-of-experience buckets shown as a dropdown.
export const EXPERIENCE_BUCKETS = [
  { value: '0-1', label: 'Less than 1 year' },
  { value: '1-3', label: '1 to 3 years' },
  { value: '3-5', label: '3 to 5 years' },
  { value: '5-10', label: '5 to 10 years' },
  { value: '10-15', label: '10 to 15 years' },
  { value: '15-20', label: '15 to 20 years' },
  { value: '20+', label: 'More than 20 years' },
];

// Hard limit on re-applies. After this many rejected applications
// with the same email, the public form refuses to accept another.
export const MAX_REJECTIONS_BEFORE_BLOCK = 6;

// Default referral-bonus config (admin can override in
// settings/config under the referral_* keys).
export const DEFAULT_REFERRAL = {
  // Astrologer-refers-astrologer bonus.
  astro_to_astro_enabled: true,
  astro_to_astro_amount: 500,
  // Bonus only fires once the referee completes their first
  // genuine paid session of at least this many minutes.
  astro_to_astro_min_minutes: 30,
  // Customer-refers-customer kept separate (already shipped).
  customer_to_customer_amount: 50,
};

// Resolve the live referral config from a settings/config snapshot.
// Caller supplies the raw config object; we just merge defaults.
export function resolveReferral(cfg) {
  const c = cfg || {};
  return {
    astro_to_astro_enabled: c.astro_to_astro_enabled
      ?? DEFAULT_REFERRAL.astro_to_astro_enabled,
    astro_to_astro_amount: Number(c.astro_to_astro_amount
      ?? DEFAULT_REFERRAL.astro_to_astro_amount),
    astro_to_astro_min_minutes: Number(c.astro_to_astro_min_minutes
      ?? DEFAULT_REFERRAL.astro_to_astro_min_minutes),
    customer_to_customer_amount: Number(c.customer_to_customer_amount
      ?? DEFAULT_REFERRAL.customer_to_customer_amount),
  };
}
