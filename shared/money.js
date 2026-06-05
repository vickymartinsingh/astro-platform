// Currency formatting helpers - one place so every screen shows
// money the same way. Indian numbering (1,00,000 not 100,000) per
// the platform's home market.
//
// Examples:
//   inr(0)         -> "0"
//   inr(50)        -> "50"
//   inr(1000)      -> "1,000"
//   inr(10000)     -> "10,000"
//   inr(100000)    -> "1,00,000"        (Indian lakh grouping)
//   inr(1000000)   -> "10,00,000"
//   inr(99.5)      -> "99.50"           (cents always shown when fractional)
//   inr(50, {decimals: 2}) -> "50.00"
//   rupees(50)     -> "₹50"
//   rupees(99.5)   -> "₹99.50"
//
// Always use these instead of `${n.toFixed(0)}` or raw `${n}` so
// large numbers like ₹1,00,000 read naturally instead of ₹100000.

const INR = (typeof Intl !== 'undefined' && Intl.NumberFormat)
  ? new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) : null;
const INR2 = (typeof Intl !== 'undefined' && Intl.NumberFormat)
  ? new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) : null;

// Naive fallback for environments without Intl.NumberFormat (very
// old WebView). Approximates Indian lakh grouping for whole numbers
// + optional 2dp.
function fallback(n, decimals) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Number(n) || 0);
  const intPart = Math.floor(abs);
  const frac = abs - intPart;
  let s = String(intPart);
  // Last 3 digits, then groups of 2.
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const restGrouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    s = `${restGrouped},${last3}`;
  }
  if (decimals && decimals > 0) {
    s += '.' + frac.toFixed(decimals).slice(2);
  } else if (frac > 0) {
    s += '.' + frac.toFixed(2).slice(2);
  }
  return sign + s;
}

// Format a number as an Indian-grouped string. NEVER includes the
// rupee symbol - caller adds it (handy when the symbol is in a
// stylised pill / prefix span).
//
// opts.decimals: force a specific decimal count (e.g. 2 for invoices).
export function inr(value, opts) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const decimals = opts && Number(opts.decimals);
  if (Number.isFinite(decimals)) {
    try {
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
    } catch (_) { return fallback(n, decimals); }
  }
  if (INR) {
    try { return INR.format(n); } catch (_) { /* fall through */ }
  }
  return fallback(n);
}

// Convenience: number with the rupee symbol prefix.
export function rupees(value, opts) {
  return `${currencyPrefix()}${inr(value, opts)}`;
}

// Two-decimal explicit form for invoices / receipts / wallet
// statements where we always want "₹10,000.00" not "₹10,000".
export function rupees2(value) {
  if (INR2) {
    try { return `${currencyPrefix()}${INR2.format(Number(value) || 0)}`; }
    catch (_) { /* fall through */ }
  }
  return `${currencyPrefix()}${fallback(Number(value) || 0, 2)}`;
}

// Admin-configurable display currency. Sourced from
// settings/config.currency_symbol (string set in /admin-settings).
// Defaults to the Rupee glyph. Cached on window for cheap reads.
//
// Supported symbols (admin can also type any custom string):
//   "₹"   - Indian Rupee (default)
//   "Rs " - Rupee text label
//   "INR " - INR ISO code
//   "$"   - US Dollar
//   "€"   - Euro
//   "£"   - GBP
//   "AED " - UAE Dirham, etc.
//
// We intentionally only swap the GLYPH, not the locale - the rest of
// the app stays in Indian numbering (lakh grouping) because that is
// what the customer base expects regardless of which symbol they see.
export const CURRENCY_OPTIONS = [
  { symbol: '₹', label: 'Indian Rupee', code: 'INR' },
  { symbol: 'Rs ', label: 'Rupee (Rs)', code: 'INR' },
  { symbol: 'INR ', label: 'INR code', code: 'INR' },
  { symbol: '$', label: 'US Dollar', code: 'USD' },
  { symbol: '€', label: 'Euro', code: 'EUR' },
  { symbol: '£', label: 'British Pound', code: 'GBP' },
  { symbol: 'AED ', label: 'UAE Dirham', code: 'AED' },
];
function currencyPrefix() {
  try {
    if (typeof window !== 'undefined') {
      const v = window.__currencyPrefix;
      if (typeof v === 'string' && v) return v;
    }
  } catch (_) {}
  return '₹';
}
// Public setter so the admin settings page / a startup watcher can
// publish the current symbol globally. Caller pulls the value from
// settings/config.currency_symbol and calls this once on load.
export function setCurrencyPrefix(symbol) {
  try {
    if (typeof window !== 'undefined') {
      window.__currencyPrefix = String(symbol || '₹');
    }
  } catch (_) {}
}
