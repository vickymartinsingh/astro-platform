import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';

// Reads settings/config (world-readable). Exposes the "first N minutes
// free" values the admin sets, so cards/profile can show a FREE badge.
export function useSettings() {
  const [cfg, setCfg] = useState({});
  const [features, setFeatures] = useState({});
  useEffect(() => {
    getDoc(doc(db, 'settings', 'config'))
      .then((s) => setCfg(s.exists() ? s.data() : {}))
      .catch(() => {});
    getDoc(doc(db, 'settings', 'features'))
      .then((s) => setFeatures(s.exists() ? s.data() : {}))
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
