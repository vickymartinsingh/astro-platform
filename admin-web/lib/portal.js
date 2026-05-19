// Admin "view-as" portal switcher state.
//
// The owner/admin can switch the WHOLE admin app to act as another
// portal without logging into each one separately:
//   admin      - normal admin panel
//   developer  - developer portal (build/config tools only)
//   support    - support-desk subset
//   client     - live customer site embedded in an iframe
//   astrologer - live astrologer site embedded in an iframe
//
// Persisted in localStorage so it survives navigation/reload. A custom
// window event lets every component react instantly.
import { useEffect, useState } from 'react';

export const PORTALS = [
  { id: 'admin', label: 'Admin', icon: '🛡️' },
  { id: 'developer', label: 'Developer', icon: '🛠️' },
  { id: 'support', label: 'Support', icon: '🎧' },
  { id: 'client', label: 'Client', icon: '👤' },
  { id: 'astrologer', label: 'Astrologer', icon: '🔮' },
];
export const IFRAME_PORTALS = ['client', 'astrologer'];

const KEY = 'adminPortal';
const URLS_KEY = 'portalUrls';
const EVT = 'portalchange';

// Sensible defaults; the switcher lets you edit these inline and they
// persist (astrologer subdomain may differ until DNS is set).
const DEFAULT_URLS = {
  client: 'https://astroseer.in',
  astrologer: 'https://astro.astroseer.in',
};

export function getPortal() {
  try {
    const v = window.localStorage.getItem(KEY);
    return PORTALS.some((p) => p.id === v) ? v : 'admin';
  } catch (_) { return 'admin'; }
}

export function setPortal(id) {
  try {
    window.localStorage.setItem(KEY, id);
    // Keep the legacy devMode flag in sync so the existing TopNav /
    // pages that still read it behave correctly in developer view.
    window.localStorage.setItem('devMode', id === 'developer' ? '1' : '0');
    window.dispatchEvent(new CustomEvent(EVT, { detail: id }));
  } catch (_) { /* ignore */ }
}

export function getPortalUrls() {
  try {
    const o = JSON.parse(window.localStorage.getItem(URLS_KEY) || '{}');
    return { ...DEFAULT_URLS, ...(o || {}) };
  } catch (_) { return { ...DEFAULT_URLS }; }
}

export function setPortalUrls(next) {
  try {
    window.localStorage.setItem(URLS_KEY, JSON.stringify({
      ...getPortalUrls(), ...(next || {}) }));
    window.dispatchEvent(new CustomEvent(EVT, { detail: getPortal() }));
  } catch (_) { /* ignore */ }
}

// React hook: current portal id + setter, re-renders on any change
// (including from other tabs / components).
export function usePortal() {
  const [portal, setP] = useState('admin');
  useEffect(() => {
    setP(getPortal());
    const onChange = () => setP(getPortal());
    window.addEventListener('portalchange', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('portalchange', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return [portal, setPortal];
}
