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
  //
  // CRITICAL: also respect the master toggles features.free_chat_enabled
  // and features.free_call_enabled. When admin turns these OFF on
  // /admin-features, freeChatMin / freeCallMin become 0 - no more
  // "First 5 min FREE" badges on any astrologer card. The change
  // propagates instantly through the existing onSnapshot listener.
  const fc = cfg.free_chat_seconds;
  const fl = cfg.free_call_seconds;
  const chatOn = features.free_chat_enabled !== false; // opt-out default
  const callOn = features.free_call_enabled !== false;
  return {
    cfg,
    features,
    freeChatMin: !chatOn ? 0
      : (fc == null || fc === '' ? 5 : Math.round(Number(fc) / 60)),
    freeCallMin: !callOn ? 0
      : (fl == null || fl === '' ? 5 : Math.round(Number(fl) / 60)),
  };
}
