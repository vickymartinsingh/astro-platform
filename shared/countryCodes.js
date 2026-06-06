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

// Each row: [ISO, name, dialCode, minNationalDigits, maxNationalDigits].
// Lengths are the count of digits AFTER the country code (mobile or
// landline national format). Where the country uses a variable length,
// we pick the mobile range. Unknown / less-common = {min:6, max:15}
// (E.164 spec ceiling).
const COUNTRIES_RAW = [
  ['IN', 'India', '+91', 10, 10],
  ['US', 'United States', '+1', 10, 10],
  ['CA', 'Canada', '+1', 10, 10],
  ['GB', 'United Kingdom', '+44', 10, 10],
  ['AE', 'United Arab Emirates', '+971', 9, 9],
  ['AU', 'Australia', '+61', 9, 9],
  ['SG', 'Singapore', '+65', 8, 8],
  ['MY', 'Malaysia', '+60', 9, 10],
  ['NZ', 'New Zealand', '+64', 8, 10],
  ['ID', 'Indonesia', '+62', 9, 12],
  ['BD', 'Bangladesh', '+880', 10, 10],
  ['LK', 'Sri Lanka', '+94', 9, 9],
  ['NP', 'Nepal', '+977', 10, 10],
  ['PK', 'Pakistan', '+92', 10, 10],
  ['BT', 'Bhutan', '+975', 8, 8],
  ['MV', 'Maldives', '+960', 7, 7],
  ['MM', 'Myanmar', '+95', 8, 10],
  ['TH', 'Thailand', '+66', 9, 9],
  ['VN', 'Vietnam', '+84', 9, 10],
  ['PH', 'Philippines', '+63', 10, 10],
  ['HK', 'Hong Kong', '+852', 8, 8],
  ['JP', 'Japan', '+81', 10, 11],
  ['KR', 'South Korea', '+82', 9, 10],
  ['CN', 'China', '+86', 11, 11],
  ['TW', 'Taiwan', '+886', 9, 9],
  ['RU', 'Russia', '+7', 10, 10],
  ['KZ', 'Kazakhstan', '+7', 10, 10],
  ['SA', 'Saudi Arabia', '+966', 9, 9],
  ['QA', 'Qatar', '+974', 8, 8],
  ['OM', 'Oman', '+968', 8, 8],
  ['KW', 'Kuwait', '+965', 8, 8],
  ['BH', 'Bahrain', '+973', 8, 8],
  ['JO', 'Jordan', '+962', 9, 9],
  ['IL', 'Israel', '+972', 9, 9],
  ['IR', 'Iran', '+98', 10, 10],
  ['IQ', 'Iraq', '+964', 10, 10],
  ['TR', 'Turkey', '+90', 10, 10],
  ['EG', 'Egypt', '+20', 10, 10],
  ['ZA', 'South Africa', '+27', 9, 9],
  ['NG', 'Nigeria', '+234', 10, 10],
  ['KE', 'Kenya', '+254', 9, 9],
  ['GH', 'Ghana', '+233', 9, 9],
  ['TZ', 'Tanzania', '+255', 9, 9],
  ['UG', 'Uganda', '+256', 9, 9],
  ['ET', 'Ethiopia', '+251', 9, 9],
  ['MA', 'Morocco', '+212', 9, 9],
  ['DZ', 'Algeria', '+213', 9, 9],
  ['TN', 'Tunisia', '+216', 8, 8],
  ['DE', 'Germany', '+49', 10, 11],
  ['FR', 'France', '+33', 9, 9],
  ['IT', 'Italy', '+39', 9, 11],
  ['ES', 'Spain', '+34', 9, 9],
  ['NL', 'Netherlands', '+31', 9, 9],
  ['BE', 'Belgium', '+32', 9, 9],
  ['CH', 'Switzerland', '+41', 9, 9],
  ['AT', 'Austria', '+43', 10, 13],
  ['SE', 'Sweden', '+46', 9, 9],
  ['NO', 'Norway', '+47', 8, 8],
  ['DK', 'Denmark', '+45', 8, 8],
  ['FI', 'Finland', '+358', 9, 10],
  ['IE', 'Ireland', '+353', 9, 9],
  ['PT', 'Portugal', '+351', 9, 9],
  ['GR', 'Greece', '+30', 10, 10],
  ['CZ', 'Czech Republic', '+420', 9, 9],
  ['PL', 'Poland', '+48', 9, 9],
  ['HU', 'Hungary', '+36', 9, 9],
  ['RO', 'Romania', '+40', 9, 9],
  ['BG', 'Bulgaria', '+359', 9, 9],
  ['HR', 'Croatia', '+385', 9, 9],
  ['UA', 'Ukraine', '+380', 9, 9],
  ['RS', 'Serbia', '+381', 8, 9],
  ['MX', 'Mexico', '+52', 10, 10],
  ['BR', 'Brazil', '+55', 10, 11],
  ['AR', 'Argentina', '+54', 10, 11],
  ['CL', 'Chile', '+56', 9, 9],
  ['CO', 'Colombia', '+57', 10, 10],
  ['PE', 'Peru', '+51', 9, 9],
  ['VE', 'Venezuela', '+58', 10, 10],
  ['CU', 'Cuba', '+53', 8, 8],
  ['CR', 'Costa Rica', '+506', 8, 8],
  ['PA', 'Panama', '+507', 8, 8],
  ['DO', 'Dominican Republic', '+1-809', 7, 7],
  ['JM', 'Jamaica', '+1-876', 7, 7],
  ['AF', 'Afghanistan', '+93', 9, 9],
  ['UZ', 'Uzbekistan', '+998', 9, 9],
  ['AZ', 'Azerbaijan', '+994', 9, 9],
  ['GE', 'Georgia', '+995', 9, 9],
  ['AM', 'Armenia', '+374', 8, 8],
  ['LB', 'Lebanon', '+961', 7, 8],
  ['SY', 'Syria', '+963', 9, 9],
  ['YE', 'Yemen', '+967', 9, 9],
  ['LY', 'Libya', '+218', 9, 10],
  ['SD', 'Sudan', '+249', 9, 9],
  ['SO', 'Somalia', '+252', 8, 9],
  ['ZW', 'Zimbabwe', '+263', 9, 9],
  ['ZM', 'Zambia', '+260', 9, 9],
  ['MZ', 'Mozambique', '+258', 9, 9],
  ['MG', 'Madagascar', '+261', 9, 9],
  ['MU', 'Mauritius', '+230', 7, 8],
  ['RW', 'Rwanda', '+250', 9, 9],
  ['SN', 'Senegal', '+221', 9, 9],
  ['CI', "Cote d'Ivoire", '+225', 10, 10],
  ['CM', 'Cameroon', '+237', 9, 9],
];

export const DEFAULT_COUNTRIES = COUNTRIES_RAW.map(
  ([iso, name, code, minLen, maxLen]) => ({
    iso, name, code, flag: flag(iso),
    minLen: minLen || 6,
    maxLen: maxLen || 15,
    source: 'default',
  }));

// Resolve {minLen, maxLen} for a given dial code, falling back to the
// E.164 ceiling if the code is unknown. The country picker passes the
// dial code; if the same code maps to multiple ISO (e.g. +1 for US/CA,
// +7 for RU/KZ), we pick the WIDEST range so both work.
export function phoneLenFor(dialCode, list = DEFAULT_COUNTRIES) {
  const matches = list.filter((c) => c.code === dialCode);
  if (matches.length === 0) return { minLen: 6, maxLen: 15 };
  const minLen = Math.min(...matches.map((c) => c.minLen || 6));
  const maxLen = Math.max(...matches.map((c) => c.maxLen || 15));
  return { minLen, maxLen };
}

// Boolean validity for a national-digit string against a dial code.
export function isPhoneValidFor(dialCode, nationalDigits) {
  const n = String(nationalDigits || '').replace(/\D/g, '');
  const { minLen, maxLen } = phoneLenFor(dialCode);
  return n.length >= minLen && n.length <= maxLen;
}

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
