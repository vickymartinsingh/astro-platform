// Live branding (logo / favicon / platform name) from settings/config.
// Every app subscribes, so the MOMENT the admin saves a new logo it
// updates across client + astrologer + admin (and web) - no rebuild,
// no reinstall, no refresh. Cached for instant flash-free paint.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { setCurrencyPrefix } from '../money.js';

function applyFavicon(url) {
  if (typeof document === 'undefined' || !url) return;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}

export function cachedBranding() {
  try {
    const c = window.localStorage.getItem('appBranding2');
    return c ? JSON.parse(c) : null;
  } catch (_) { return null; }
}

// cb({ logo, favicon, name }) is called immediately with the live
// value and again on every admin save. Returns an unsubscribe.
export function watchBranding(cb) {
  // Paint cached value instantly.
  const c = cachedBranding();
  if (c) {
    applyFavicon(c.favicon || c.logo);
    try { setCurrencyPrefix(c.currencySymbol || '₹'); } catch (_) {}
    if (cb) cb(c);
  }
  try {
    return onSnapshot(doc(db, 'settings', 'config'), (s) => {
      const d = s.exists() ? s.data() : {};
      const b = {
        logo: d.logo || '',
        favicon: d.favicon || d.logo || '',
        name: d.platformName || 'AstroSeer',
        currencySymbol: d.currency_symbol_custom
          || d.currency_symbol || '₹',
      };
      try {
        window.localStorage.setItem('appBranding2', JSON.stringify(b));
      } catch (_) {}
      applyFavicon(b.favicon);
      // Push the admin-configured currency symbol into the money
      // helpers so every rupees() call across the app uses it.
      try { setCurrencyPrefix(b.currencySymbol); } catch (_) {}
      if (cb) cb(b);
    }, () => {});
  } catch (_) { return () => {}; }
}
