import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';

// Live settings/config + settings/features (world-readable). One
// app-wide subscription per doc + in-memory store, so screens render
// the current value with no stale flash and admin changes propagate
// instantly. (Mirror of the client app's hook.)
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
  return { cfg, features };
}
