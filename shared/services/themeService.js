// One source of truth for the app colour theme. The admin picks /
// builds a theme in the admin portal (settings/theme); every app reads
// it live and sets CSS variables, so the WHOLE client + astrologer +
// admin UI (including the tarot card) re-skins in a single click with
// no rebuild and no reinstall - installed apps update live.
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../firebase.js';

function hexTriplet(hex) {
  const h = String(hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}
function darken(hex, f) {
  const t = hexTriplet(hex).split(' ').map(Number);
  const k = f == null ? 0.4 : f;
  return '#' + t.map((v) => Math.round(v * k)
    .toString(16).padStart(2, '0')).join('');
}

// Built-in themes (hex form; custom themes from admin use the same
// shape so everything resolves identically).
export const THEMES = {
  classic: {
    label: 'Classic (Purple)',
    primary: '#6C2BD9', bgLight: '#F3EEFF',
    gradA: '#6C2BD9', gradB: '#8B5CF6', tarot: '#2A1A63',
    swatch: ['#6C2BD9', '#8B5CF6', '#DB2777'],
  },
  royal: {
    label: 'Royal (Maroon / Amber / Olive)',
    primary: '#7F2020', bgLight: '#F7EFE3',
    gradA: '#7F2020', gradB: '#F59E0B', tarot: '#84994F',
    swatch: ['#7F2020', '#F59E0B', '#84994F'],
  },
};

export function themeVars(t) {
  const o = t || THEMES.classic;
  return {
    '--c-primary': hexTriplet(o.primary || '#6C2BD9'),
    '--c-bglight': hexTriplet(o.bgLight || '#F3EEFF'),
    '--grad-a': o.gradA || '#6C2BD9',
    '--grad-b': o.gradB || '#8B5CF6',
    '--c-tarot': darken(o.tarot || '#2A1A63', 0.35),
    '--c-tarot2': o.tarot || '#2A1A63',
  };
}

function setVars(vars) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  Object.entries(vars).forEach(([k, v]) => r.setProperty(k, v));
  try {
    window.localStorage.setItem('appThemeVars', JSON.stringify(vars));
  } catch (_) {}
}

// Accepts a theme object, a built-in name, or nothing (cached/default).
export function applyTheme(theme) {
  let t = theme;
  if (typeof theme === 'string') t = THEMES[theme] || THEMES.classic;
  setVars(themeVars(t || THEMES.classic));
}

// Instant, offline-safe paint on cold start (no colour flash).
export function bootTheme() {
  try {
    const c = window.localStorage.getItem('appThemeVars');
    if (c) {
      const vars = JSON.parse(c);
      const r = document.documentElement.style;
      Object.entries(vars).forEach(([k, v]) => r.setProperty(k, v));
    }
  } catch (_) {}
}

// Resolve the active theme from the settings doc (built-in OR a custom
// one saved by the admin).
function resolve(data) {
  const d = data || {};
  const active = d.active || 'classic';
  if (THEMES[active]) return THEMES[active];
  const custom = (d.custom && d.custom[active]) || null;
  return custom || THEMES.classic;
}

// Live-subscribe so EVERY installed app re-skins the instant the admin
// changes the theme - no app update needed (read from the server).
export function watchTheme() {
  bootTheme();
  try {
    return onSnapshot(doc(db, 'settings', 'theme'), (s) => {
      applyTheme(resolve(s.exists() ? s.data() : null));
    }, () => {});
  } catch (_) { return () => {}; }
}

export async function getThemeDoc() {
  try {
    const s = await getDoc(doc(db, 'settings', 'theme'));
    return s.exists() ? s.data() : { active: 'classic', custom: {} };
  } catch (_) { return { active: 'classic', custom: {} }; }
}
