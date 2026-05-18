import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';

// Reads settings/config + settings/features (world-readable). Seeds from
// a localStorage cache so navigating between screens renders the LAST
// known values immediately instead of flashing empty/defaults first
// (that flash was the "blinking" while switching menus/buttons).
function cached(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}
function store(key, v) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(v || {}));
    }
  } catch (_) { /* ignore */ }
}

export function useSettings() {
  const [cfg, setCfg] = useState(() => cached('settings_config') || {});
  const [features, setFeatures] = useState(
    () => cached('settings_features') || {});
  useEffect(() => {
    getDoc(doc(db, 'settings', 'config'))
      .then((s) => {
        const d = s.exists() ? s.data() : {};
        setCfg(d); store('settings_config', d);
      })
      .catch(() => {});
    getDoc(doc(db, 'settings', 'features'))
      .then((s) => {
        const d = s.exists() ? s.data() : {};
        setFeatures(d); store('settings_features', d);
      })
      .catch(() => {});
  }, []);
  // Default: every new user gets the first 5 minutes free, shown on all
  // astrologers, UNLESS the admin explicitly sets the value (incl. 0).
  const fc = cfg.free_chat_seconds;
  const fl = cfg.free_call_seconds;
  return {
    cfg,
    features,
    freeChatMin: fc == null || fc === '' ? 5 : Math.round(Number(fc) / 60),
    freeCallMin: fl == null || fl === '' ? 5 : Math.round(Number(fl) / 60),
  };
}
