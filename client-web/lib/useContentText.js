// Hook for admin-editable user-facing copy.
//
// The admin /admin-builder page writes overrides into
// settings/content.text[key]. Anywhere in the app a string is
// shown to a customer, we read it through T(key, defaultText) so
// admins can rephrase it live without a deploy. The keys follow
// the dotted convention "<screen>.<element>.<field>", e.g.:
//   modals.orderPlaced.label
//   modals.orderPlaced.title
//   modals.rateModal.endedByBalance
// Defaults baked into each call site stay the source of truth in
// code; overrides simply replace them at render time.
import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import { doc, onSnapshot } from 'firebase/firestore';

// Module-level cache shared by every component using the hook, so
// multiple modals on the same page don't each open their own snapshot.
const STATE = { text: null };
const LISTENERS = new Set();
let SUBBED = false;

function ensureSub() {
  if (SUBBED) return;
  SUBBED = true;
  try {
    onSnapshot(doc(db, 'settings', 'content'), (s) => {
      const d = s.exists() ? s.data() : {};
      STATE.text = (d && typeof d.text === 'object') ? d.text : {};
      LISTENERS.forEach((fn) => { try { fn(STATE.text); } catch (_) {} });
    }, () => { /* offline / rules deny - silently use defaults */ });
  } catch (_) { SUBBED = false; }
}

export function useContentText() {
  const [txt, setTxt] = useState(() => STATE.text || {});
  useEffect(() => {
    ensureSub();
    if (STATE.text) setTxt(STATE.text);
    const fn = (next) => setTxt(next || {});
    LISTENERS.add(fn);
    return () => LISTENERS.delete(fn);
  }, []);
  // T(key, default): returns admin override if present + non-empty,
  // otherwise the default supplied at the call site. Supports a
  // {placeholder} interpolation map as a third argument so admins can
  // template a string like "Thank you, your {title} is on its way."
  function T(key, def, vars) {
    let raw = (txt && txt[key] != null && String(txt[key]).trim() !== '')
      ? String(txt[key]) : String(def == null ? '' : def);
    if (vars && typeof vars === 'object') {
      for (const k of Object.keys(vars)) {
        raw = raw.split(`{${k}}`).join(String(vars[k] == null ? '' : vars[k]));
      }
    }
    return raw;
  }
  return T;
}
