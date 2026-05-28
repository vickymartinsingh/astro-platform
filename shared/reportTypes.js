// Single source of truth for the kundli report catalogue. Both the
// client (to render the buy buttons + confirm popups) and the relay
// (to know which AstroSeer tier + sections to request and which
// Firestore price field to read) import from here. Admin overrides
// each price in settings/config.kundli_<id>_price; if unset the
// defaultPrice below applies.
//
// Marriage compatibility (gunaMilan) takes TWO charts so the buy
// flow surfaces a second-person form - wired later when the UI
// supports a partner kundli picker.

export const REPORT_TYPES = [
  {
    id: 'free',
    name: 'Free 250+ Page Vedic Kundli',
    shortName: 'Janma Kundli',
    summary: 'Full birth chart with all 16 divisional charts, '
      + 'planetary positions, Vimshottari dasha tree, yogas, '
      + 'doshas, panchang and core predictions.',
    defaultPrice: 0,
    tier: 9,
    sections: [
      'Birth chart D1 with planet degrees',
      '16 divisional charts (Navamsa, Dasamsa, Chaturthamsa…)',
      'Nakshatra detail with pada, lord, yoni, gana, nadi',
      'Full Vimshottari dasha tree (Maha, Antar, Pratyantar)',
      'Planetary aspects, dignities and friendship table',
      'Yogas (Mahapurusha, Raj, Gajakesari and others)',
      'Doshas (Mangal, Kalsarp, Sade Sati where present)',
      'Avkahada Chakra, Ghatak and Favourable Points',
      'Panchang at birth (Tithi, Yoga, Karana, Nakshatra)',
      'PDF emailed plus saved in Orders for re-download',
    ],
    tat: 'PDF arrives in 30 minutes to 4 hours (most are ready in '
      + 'under an hour). You will get an email AND a download link '
      + 'in My Orders.',
    sla: '30 minutes to 4 hours',
    confirmCta: 'Yes, generate the report',
  },
  {
    id: 'forecast12',
    name: '12-Month Vedic Forecast',
    shortName: '12-Month Forecast',
    summary: 'Personalised monthly predictions for the next 12 '
      + 'months from this month. Covers career, finance, love, '
      + 'health, family, travel based on running Maha, Antar and '
      + 'Pratyantar dasha plus current transits.',
    defaultPrice: 50,
    tier: 9,
    months: 12,
    sections: [
      'Monthly outlook for each of the next 12 months',
      'Maha, Antar and Pratyantar dasha lord for every month',
      'Career, finance and business indications month by month',
      'Love, relationships and marriage timing windows',
      'Health and wellbeing watch-outs',
      'Travel and relocation opportunities',
      'Important transits (Saturn, Jupiter, Rahu and Ketu)',
      'Remedies with lucky days, colours and mantras per month',
      'PDF emailed plus saved in Orders for re-download',
    ],
    tat: 'PDF arrives in 2 to 6 hours. You will get an email AND '
      + 'a download link in My Orders. Wallet is debited now and '
      + 'auto-refunded if generation fails.',
    sla: '2 to 6 hours',
    confirmCta: 'Yes, proceed to payment',
  },
  {
    id: 'careerFinance',
    name: 'Career and Finance Deep Dive',
    shortName: 'Career Report',
    summary: '10th house (career), 2nd house (wealth), 11th house '
      + '(gains) and 6th house (service) deep analysis with dasha '
      + 'periods affecting work, business vs job indication, '
      + 'lucky industries and finance windows for the next five '
      + 'years.',
    defaultPrice: 99,
    tier: 9,
    sections: [
      '10th house deep analysis (Karma bhava)',
      '2nd house wealth and 11th house gains breakdown',
      'Business vs job indication based on dasha plus 7th lord',
      'Lucky industries and professions for your chart',
      'Finance windows for the next 5 years',
      'Career-defining transits coming up (Saturn, Jupiter)',
      'Dasha periods that boost or stall career',
      'Remedies for career obstacles',
      'PDF emailed plus saved in Orders for re-download',
    ],
    tat: 'PDF arrives in 6 to 12 hours due to depth of analysis. '
      + 'You will get an email AND a download link in My Orders. '
      + 'Wallet is debited now and auto-refunded if generation '
      + 'fails.',
    sla: '6 to 12 hours',
    confirmCta: 'Yes, proceed to payment',
  },
  {
    id: 'lifetime',
    name: 'Lifetime Vedic Report',
    shortName: 'Lifetime Report',
    summary: 'Every Mahadasha across your lifetime, each broken '
      + 'down into sub-period predictions. Birth to age 120. The '
      + 'most comprehensive report, naturally 300+ pages. Ideal '
      + 'for serious astrology readers and gifting.',
    defaultPrice: 299,
    tier: 9,
    sections: [
      'All 9 Mahadasha periods with full antardasha trees',
      'Decade-by-decade life outlook',
      'Pratyantar and Sookshma dasha detail',
      'Yogini dasha alongside Vimshottari',
      'Transit forecast for the next 12 years',
      'Marriage, child, career, finance, health all in one place',
      'Sade Sati windows across the lifetime',
      'Remedies and mantras specific to each major period',
      'PDF emailed plus saved in Orders for re-download',
    ],
    tat: 'PDF arrives in 12 to 24 hours due to size (300+ pages). '
      + 'You will get an email AND a download link in My Orders. '
      + 'Wallet is debited now and auto-refunded if generation '
      + 'fails.',
    sla: '12 to 24 hours',
    confirmCta: 'Yes, proceed to payment',
  },
];

// Lookup by id. Returns null for unknown ids so callers can fall
// back to a safe default ('free') instead of crashing.
export function reportType(id) {
  return REPORT_TYPES.find((r) => r.id === id) || null;
}

// Resolve the live price for a report type by merging in any
// admin overrides from settings/config.kundli_<id>_price.
// configDoc is the raw data() of settings/config (or {} if missing).
export function resolvePrice(id, configDoc) {
  const t = reportType(id);
  if (!t) return 0;
  const overrideKey = `kundli_${id}_price`;
  const override = configDoc && Number(configDoc[overrideKey]);
  if (Number.isFinite(override) && override >= 0) return override;
  // Backwards compat: forecast12 used kundli_report_price before
  // we introduced per-type prices.
  if (id === 'forecast12'
    && configDoc && Number.isFinite(Number(configDoc.kundli_report_price))) {
    return Number(configDoc.kundli_report_price);
  }
  return t.defaultPrice;
}
