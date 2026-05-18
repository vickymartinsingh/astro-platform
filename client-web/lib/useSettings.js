import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';

// Live settings/config + settings/features (world-readable).
//
// Why this shape: a one-shot getDoc + localStorage seed used to FLASH
// the old value after an admin change (stale on screen-switch/refresh).
// Now we keep a single app-wide LIVE subscription per doc and a shared
// in-memory store. Once the first snapshot has arrived this session,
// every screen renders the CURRENT value immediately (no stale flash);
// admin changes propagate everywhere instantly with no remount. The
// localStorage seed is only the very first cold paint and is refreshed
// on every snapshot so it is never far behind.
const MEM = { config: undefined, features: undefined };
const SUBS = { config: false, features: false };
const LISTENERS = { config: new Set(), features: new Set() };

function lsGet(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}
function lsSet(key, v) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(v || {}));
    }
  } catch (_) { /* ignore */ }
}

function ensureSub(name) {
  if (SUBS[name]) return;
  SUBS[name] = true;
  try {
    onSnapshot(doc(db, 'settings', name), (s) => {
      const d = s.exists() ? s.data() : {};
      MEM[name] = d;
      lsSet(`settings_${name}`, d);
      LISTENERS[name].forEach((fn) => { try { fn(d); } catch (_) {} });
    }, () => {});
  } catch (_) { SUBS[name] = false; }
}

function useDoc(name) {
  const [val, setVal] = useState(
    () => MEM[name] || lsGet(`settings_${name}`) || {});
  useEffect(() => {
    ensureSub(name);
    if (MEM[name]) setVal(MEM[name]);
    const fn = (d) => setVal(d);
    LISTENERS[name].add(fn);
    return () => LISTENERS[name].delete(fn);
  }, []);
  return val;
}

export function useSettings() {
  const cfg = useDoc('config');
  const features = useDoc('features');
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
