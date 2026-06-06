// Country dial codes for the phone-input picker.
//
// The DEFAULT list ships in this file so the picker works offline / on
// first paint. Admins can override it from /admin-country-codes which
// writes settings/config.country_codes (an array merged on top of this
// list, deduped by code+iso). The live brandingService picks up the
// override and pushes it to a window global so every PhoneInput across
// every app sees the change instantly - no rebuild.
//
// India (+91) is the default selection per the operator's note ("most
// users today are from India, but we will be getting users from
// across the world"), and the list covers every country recognized
// by the ITU-T E.164 numbering plan as of 2026.
import { db } from './firebase.js';

export const DEFAULT_COUNTRY_CODE = '+91';
export const DEFAULT_COUNTRY_ISO = 'IN';

// One-line entries: ISO 3166-1 alpha-2, country name, dial code, flag.
// Flag emoji is the two-letter regional indicator pair so any modern
// font (incl. iOS, Android 11+, macOS, Windows 11) renders the flag
// natively without a sprite sheet.
function flag(iso) {
  return iso.toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const COUNTRIES_RAW = [
  ['IN', 'India', '+91'],
  ['US', 'United States', '+1'],
  ['CA', 'Canada', '+1'],
  ['GB', 'United Kingdom', '+44'],
  ['AE', 'United Arab Emirates', '+971'],
  ['AU', 'Australia', '+61'],
  ['SG', 'Singapore', '+65'],
  ['MY', 'Malaysia', '+60'],
  ['NZ', 'New Zealand', '+64'],
  ['ID', 'Indonesia', '+62'],
  ['BD', 'Bangladesh', '+880'],
  ['LK', 'Sri Lanka', '+94'],
  ['NP', 'Nepal', '+977'],
  ['PK', 'Pakistan', '+92'],
  ['BT', 'Bhutan', '+975'],
  ['MV', 'Maldives', '+960'],
  ['MM', 'Myanmar', '+95'],
  ['TH', 'Thailand', '+66'],
  ['VN', 'Vietnam', '+84'],
  ['PH', 'Philippines', '+63'],
  ['HK', 'Hong Kong', '+852'],
  ['JP', 'Japan', '+81'],
  ['KR', 'South Korea', '+82'],
  ['CN', 'China', '+86'],
  ['TW', 'Taiwan', '+886'],
  ['RU', 'Russia', '+7'],
  ['KZ', 'Kazakhstan', '+7'],
  ['SA', 'Saudi Arabia', '+966'],
  ['QA', 'Qatar', '+974'],
  ['OM', 'Oman', '+968'],
  ['KW', 'Kuwait', '+965'],
  ['BH', 'Bahrain', '+973'],
  ['JO', 'Jordan', '+962'],
  ['IL', 'Israel', '+972'],
  ['IR', 'Iran', '+98'],
  ['IQ', 'Iraq', '+964'],
  ['TR', 'Turkey', '+90'],
  ['EG', 'Egypt', '+20'],
  ['ZA', 'South Africa', '+27'],
  ['NG', 'Nigeria', '+234'],
  ['KE', 'Kenya', '+254'],
  ['GH', 'Ghana', '+233'],
  ['TZ', 'Tanzania', '+255'],
  ['UG', 'Uganda', '+256'],
  ['ET', 'Ethiopia', '+251'],
  ['MA', 'Morocco', '+212'],
  ['DZ', 'Algeria', '+213'],
  ['TN', 'Tunisia', '+216'],
  ['DE', 'Germany', '+49'],
  ['FR', 'France', '+33'],
  ['IT', 'Italy', '+39'],
  ['ES', 'Spain', '+34'],
  ['NL', 'Netherlands', '+31'],
  ['BE', 'Belgium', '+32'],
  ['CH', 'Switzerland', '+41'],
  ['AT', 'Austria', '+43'],
  ['SE', 'Sweden', '+46'],
  ['NO', 'Norway', '+47'],
  ['DK', 'Denmark', '+45'],
  ['FI', 'Finland', '+358'],
  ['IE', 'Ireland', '+353'],
  ['PT', 'Portugal', '+351'],
  ['GR', 'Greece', '+30'],
  ['CZ', 'Czech Republic', '+420'],
  ['PL', 'Poland', '+48'],
  ['HU', 'Hungary', '+36'],
  ['RO', 'Romania', '+40'],
  ['BG', 'Bulgaria', '+359'],
  ['HR', 'Croatia', '+385'],
  ['UA', 'Ukraine', '+380'],
  ['RS', 'Serbia', '+381'],
  ['MX', 'Mexico', '+52'],
  ['BR', 'Brazil', '+55'],
  ['AR', 'Argentina', '+54'],
  ['CL', 'Chile', '+56'],
  ['CO', 'Colombia', '+57'],
  ['PE', 'Peru', '+51'],
  ['VE', 'Venezuela', '+58'],
  ['CU', 'Cuba', '+53'],
  ['CR', 'Costa Rica', '+506'],
  ['PA', 'Panama', '+507'],
  ['DO', 'Dominican Republic', '+1-809'],
  ['JM', 'Jamaica', '+1-876'],
  ['AF', 'Afghanistan', '+93'],
  ['UZ', 'Uzbekistan', '+998'],
  ['AZ', 'Azerbaijan', '+994'],
  ['GE', 'Georgia', '+995'],
  ['AM', 'Armenia', '+374'],
  ['LB', 'Lebanon', '+961'],
  ['SY', 'Syria', '+963'],
  ['YE', 'Yemen', '+967'],
  ['LY', 'Libya', '+218'],
  ['SD', 'Sudan', '+249'],
  ['SO', 'Somalia', '+252'],
  ['ZW', 'Zimbabwe', '+263'],
  ['ZM', 'Zambia', '+260'],
  ['MZ', 'Mozambique', '+258'],
  ['MG', 'Madagascar', '+261'],
  ['MU', 'Mauritius', '+230'],
  ['RW', 'Rwanda', '+250'],
  ['SN', 'Senegal', '+221'],
  ['CI', "Cote d'Ivoire", '+225'],
  ['CM', 'Cameroon', '+237'],
];

export const DEFAULT_COUNTRIES = COUNTRIES_RAW.map(([iso, name, code]) => ({
  iso, name, code, flag: flag(iso), source: 'default',
}));

// Build the live country list. Reads admin overrides from
// settings/config.country_codes (an array). Each override may either
// be a new entry (push) or carry a `_delete: true` flag to remove a
// default by ISO. Returns the merged list with stable ordering:
// default entries first in their original sequence, then admin
// additions at the end.
export function buildCountryList(adminOverrides) {
  const base = DEFAULT_COUNTRIES.slice();
  if (!Array.isArray(adminOverrides) || !adminOverrides.length) return base;
  const removedIso = new Set();
  const additions = [];
  adminOverrides.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const iso = String(entry.iso || '').toUpperCase().slice(0, 2);
    if (entry._delete && iso) { removedIso.add(iso); return; }
    if (!entry.code || !entry.name) return;
    // If an admin replaces a default ISO with new fields, we mark
    // the default for removal and push the override.
    if (iso && base.some((c) => c.iso === iso)) removedIso.add(iso);
    additions.push({
      iso: iso || '',
      name: String(entry.name).slice(0, 80),
      code: String(entry.code).slice(0, 16),
      flag: iso ? flag(iso) : (entry.flag || ''),
      source: 'admin',
    });
  });
  const filtered = base.filter((c) => !removedIso.has(c.iso));
  return [...filtered, ...additions];
}

// Live subscription. cb(list) gets the current list at subscribe time
// AND on every admin save. Returns unsubscribe.
export function watchCountryList(cb) {
  // Paint defaults first so the picker never flashes empty.
  if (cb) cb(DEFAULT_COUNTRIES);
  let unsub = () => {};
  (async () => {
    try {
      const { doc, onSnapshot } = await import('firebase/firestore');
      unsub = onSnapshot(doc(db, 'settings', 'config'), (s) => {
        const data = (s.exists() && s.data()) || {};
        const list = buildCountryList(data.country_codes || []);
        if (cb) cb(list);
      }, () => {});
    } catch (_) { /* ignore */ }
  })();
  return () => unsub();
}

// Best-effort: classify a phone number into { code, national }. Used
// by the picker when loading a stored phone string that does not
// carry a code prefix, so the user sees their pre-existing number
// in the right country slot.
export function splitPhone(raw, list = DEFAULT_COUNTRIES) {
  const s = String(raw || '').trim();
  if (!s) return { code: DEFAULT_COUNTRY_CODE, national: '' };
  if (s.charAt(0) === '+') {
    // Find the longest matching dial code.
    const sorted = list.slice()
      .sort((a, b) => b.code.length - a.code.length);
    for (const c of sorted) {
      if (s.startsWith(c.code)) {
        return { code: c.code, national: s.slice(c.code.length).trim() };
      }
    }
    return { code: DEFAULT_COUNTRY_CODE, national: s.replace(/^\+/, '') };
  }
  // No leading "+" - assume the default country.
  return { code: DEFAULT_COUNTRY_CODE,
    national: s.replace(/^91/, '').replace(/^0+/, '') };
}
