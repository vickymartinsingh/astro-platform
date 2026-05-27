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

// Every themeable colour. Built-in + custom themes share this shape.
export const THEME_FIELDS = [
  ['primary', 'Primary'],
  ['gradA', 'Gradient start'],
  ['gradB', 'Gradient end'],
  ['bgLight', 'Soft background'],
  ['accent', 'Accent'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['danger', 'Danger'],
  ['verify', 'Verified badge'],
  ['tarot', 'Tarot card'],
];

// Royal (Maroon / Amber / Olive) is the ONLY approved brand
// palette. The Classic (Purple) variant has been retired - its
// key now resolves to the Royal palette so any legacy save in
// settings/branding still renders the brand-correct colours.
const ROYAL = {
  label: 'Royal (Maroon / Amber / Olive)',
  primary: '#7F2020', gradA: '#D4A12A', gradB: '#7F2020',
  bgLight: '#FBF7EE', accent: '#B45309', success: '#5A6E32',
  warning: '#D4A12A', danger: '#C0392B', verify: '#7F2020',
  tarot: '#2A1408',
  swatch: ['#7F2020', '#D4A12A', '#5A6E32'],
};
export const THEMES = {
  classic: ROYAL,
  royal: ROYAL,
};

export function themeVars(t) {
  const o = { ...THEMES.classic, ...(t || {}) };
  return {
    '--c-primary': hexTriplet(o.primary),
    '--c-bglight': hexTriplet(o.bgLight),
    '--grad-a': o.gradA,
    '--grad-b': o.gradB,
    '--c-accent': hexTriplet(o.accent),
    '--c-success': hexTriplet(o.success),
    '--c-warning': hexTriplet(o.warning),
    '--c-danger': hexTriplet(o.danger),
    '--c-verify': hexTriplet(o.verify || o.primary),
    '--c-tarot': darken(o.tarot, 0.35),
    '--c-tarot2': o.tarot,
  };
}

function setVars(vars) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  Object.entries(vars).forEach(([k, v]) => r.setProperty(k, v));
  try {
    window.localStorage.setItem('appThemeVars2', JSON.stringify(vars));
  } catch (_) {}
}

export function applyTheme(theme) {
  let t = theme;
  if (typeof theme === 'string') t = THEMES[theme] || THEMES.classic;
  setVars(themeVars(t || THEMES.classic));
}

export function bootTheme() {
  try {
    const c = window.localStorage.getItem('appThemeVars2');
    if (c) {
      const vars = JSON.parse(c);
      const r = document.documentElement.style;
      Object.entries(vars).forEach(([k, v]) => r.setProperty(k, v));
    }
  } catch (_) {}
}

function resolve(data) {
  const d = data || {};
  const active = d.active || 'classic';
  if (THEMES[active]) return THEMES[active];
  return (d.custom && d.custom[active]) || THEMES.classic;
}

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
