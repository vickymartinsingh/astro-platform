// One source of truth for the app colour theme. The admin picks a
// theme in the admin portal (settings/theme.active); every app reads
// it live and sets CSS variables, so the whole client + astrologer +
// admin UI re-skins in a single click with no rebuild.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

// rgb triplets so Tailwind opacity utilities (primary/10 etc) work.
export const THEMES = {
  classic: {
    label: 'Classic (Purple)',
    cPrimary: '108 43 217',     // #6C2BD9
    cBgLight: '243 238 255',    // #F3EEFF
    gradA: '#6C2BD9',
    gradB: '#8B5CF6',
    swatch: ['#6C2BD9', '#8B5CF6', '#DB2777'],
  },
  royal: {
    label: 'Royal (Maroon / Amber / Olive)',
    cPrimary: '127 32 32',      // #7F2020
    cBgLight: '247 239 227',    // soft amber tint
    gradA: '#7F2020',
    gradB: '#F59E0B',
    swatch: ['#7F2020', '#F59E0B', '#84994F'],
  },
};

export function applyTheme(name) {
  if (typeof document === 'undefined') return;
  const t = THEMES[name] || THEMES.classic;
  const r = document.documentElement.style;
  r.setProperty('--c-primary', t.cPrimary);
  r.setProperty('--c-bglight', t.cBgLight);
  r.setProperty('--grad-a', t.gradA);
  r.setProperty('--grad-b', t.gradB);
}

// Live-subscribe to settings/theme and apply it everywhere. Returns an
// unsubscribe. Safe if Firestore is unreachable (keeps the default).
export function watchTheme() {
  try {
    return onSnapshot(doc(db, 'settings', 'theme'), (s) => {
      const name = (s.exists() && s.data().active) || 'classic';
      applyTheme(name);
    }, () => {});
  } catch (_) { return () => {}; }
}
