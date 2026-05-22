import {
  createContext, useContext, useEffect, useState,
} from 'react';
import { userService } from '@astro/shared';

// App-wide i18n. English is the source of truth. Because almost every
// screen uses plain hard-coded English copy (not t() keys), a tiny
// dictionary alone could never translate the app. So when a non-English
// language is selected we run a live DOM translator: it walks the
// rendered text, translates it (cached in localStorage so it is instant
// after the first time and works offline once cached) and swaps it in.
// Picking "English" / Reset instantly restores the original text.
//
// The chosen language is stored in localStorage:
//  - APP UPDATE keeps localStorage  -> language is preserved.
//  - UNINSTALL + REINSTALL clears it -> defaults back to English.

const DICT = {
  en: {
    'nav.home': 'Home', 'nav.astrologers': 'Astrologers',
    'nav.chatHistory': 'Chat History', 'nav.callHistory': 'Call History',
    'nav.wallet': 'Wallet', 'nav.horoscope': 'Horoscope',
    'nav.profile': 'Profile', 'nav.notifications': 'Notifications',
    'nav.logout': 'Logout',
    'dash.walletBalance': 'Wallet Balance', 'dash.addMoney': '+ Add Money',
    'dash.chat': 'Chat with Astrologer', 'dash.call': 'Call Astrologer',
    'dash.recharge': 'Recharge Wallet', 'dash.horoscope': 'View Horoscope',
    'dash.recentChats': 'Recent Chats',
    'wallet.addMoney': 'Add Money', 'wallet.transactions': 'Transactions',
    'auth.login': 'Login', 'auth.signup': 'Sign up',
    'auth.email': 'Email', 'auth.password': 'Password',
    'common.loading': 'Loading…', 'common.retry': 'Try again',
    'profile.language': 'Language',
  },
};

// 12 major Indian languages (native script labels).
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'bn', label: 'বাংলা (Bengali)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'mr', label: 'मराठी (Marathi)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ml', label: 'മലയാളം (Malayalam)' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)' },
  { code: 'or', label: 'ଓଡ଼ିଆ (Odia)' },
  { code: 'ur', label: 'اردو (Urdu)' },
];

// ---------- live DOM translator ----------
const TR_CACHE = {}; // lang -> { sourceText: translatedText }
const SKIP_TAGS = {
  SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, TEXTAREA: 1, SELECT: 1,
};

function loadCache(lang) {
  if (TR_CACHE[lang]) return TR_CACHE[lang];
  let c = {};
  try {
    c = JSON.parse(localStorage.getItem(`tr.${lang}`) || '{}') || {};
  } catch (_) { c = {}; }
  TR_CACHE[lang] = c;
  return c;
}
function saveCache(lang) {
  try {
    localStorage.setItem(`tr.${lang}`, JSON.stringify(TR_CACHE[lang] || {}));
  } catch (_) { /* quota - ignore */ }
}

async function fetchTr(text, lang) {
  const url = 'https://translate.googleapis.com/translate_a/single'
    + `?client=gtx&sl=en&tl=${encodeURIComponent(lang)}`
    + `&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`tr ${r.status}`);
  let j;
  try { j = await r.json(); } catch (_) { throw new Error('tr parse'); }
  // Strict shape check - a blocked / challenge response is not [[...]],
  // so we throw and KEEP English instead of painting junk on the UI.
  if (!Array.isArray(j) || !Array.isArray(j[0])) throw new Error('tr shape');
  const out = j[0].map((s) => (s && s[0]) || '').join('');
  if (!out || !out.trim()) return text; // empty -> keep source
  return out;
}

function skip(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.getAttribute
      && (el.getAttribute('translate') === 'no'
        || el.hasAttribute('data-no-tr'))) return true;
    const cn = typeof el.className === 'string' ? el.className : '';
    if (cn.indexOf('notranslate') >= 0) return true;
    el = el.parentElement;
  }
  return false;
}
function translatable(s) {
  const t = (s || '').trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]/.test(t)) return false; // skip numbers / symbols / glyphs
  return true;
}

let observer = null;
let busy = false;
let pending = false;

function connect() {
  if (!observer) return;
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true,
  });
}

async function runPass(lang) {
  if (typeof document === 'undefined' || !document.body) return;
  if (busy) { pending = true; return; }
  busy = true;
  try {
    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n = walker.nextNode();
    while (n) {
      if (n.__lang !== lang) {
        if (typeof n.__en !== 'string') {
          if (!translatable(n.nodeValue) || skip(n)) {
            n.__en = n.nodeValue; n.__lang = lang;
          } else { n.__en = n.nodeValue; nodes.push(n); }
        } else nodes.push(n);
      }
      n = walker.nextNode();
    }

    if (lang === 'en') {
      nodes.forEach((nd) => {
        if (nd.nodeValue !== nd.__en) nd.nodeValue = nd.__en;
        nd.__lang = 'en';
      });
      return;
    }

    const cache = loadCache(lang);
    const need = [];
    const seen = {};
    nodes.forEach((nd) => {
      const k = nd.__en.trim();
      if (cache[k] == null && !seen[k]) { seen[k] = 1; need.push(k); }
    });

    if (need.length) {
      let idx = 0;
      const worker = async () => {
        while (idx < need.length) {
          const k = need[idx];
          idx += 1;
          try { cache[k] = await fetchTr(k, lang); }
          catch (_) { /* leave English on failure */ }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // Degenerate-response guard: if many DIFFERENT source strings all
      // came back as the SAME word, the endpoint is broken/blocked.
      // Drop those entries so we render English, not "local local local".
      const vals = need.map((k) => cache[k])
        .filter((v) => typeof v === 'string' && v.trim());
      const uniq = new Set(vals.map((v) => v.trim().toLowerCase()));
      if (vals.length >= 4 && uniq.size <= 1) {
        need.forEach((k) => { delete cache[k]; });
      }
      saveCache(lang);
    }

    if (observer) observer.disconnect();
    nodes.forEach((nd) => {
      const src = nd.__en;
      const k = src.trim();
      const tr = cache[k];
      if (tr) {
        const lead = (src.match(/^\s*/) || [''])[0];
        const trail = (src.match(/\s*$/) || [''])[0];
        const next = lead + tr + trail;
        if (nd.nodeValue !== next) nd.nodeValue = next;
      }
      nd.__lang = lang;
    });
    if (observer) connect();
  } finally {
    busy = false;
    if (pending) { pending = false; setTimeout(() => runPass(lang), 60); }
  }
}

const I18nCtx = createContext({ lang: 'en', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children, uid }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined'
        ? localStorage.getItem('lang') : null;
      if (saved && saved !== 'en') setLangState(saved);
    } catch (_) { /* ignore */ }
  }, []);

  // Live translate the whole rendered app whenever the language changes,
  // and keep translating content that React mounts later.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => runPass(lang), 250);
    };
    schedule();
    observer = new MutationObserver(schedule);
    connect();
    return () => {
      clearTimeout(timer);
      if (observer) { observer.disconnect(); observer = null; }
    };
  }, [lang]);

  function setLang(code) {
    setLangState(code);
    try {
      if (typeof window !== 'undefined') localStorage.setItem('lang', code);
    } catch (_) { /* ignore */ }
    if (uid) {
      userService.updateUser(uid, { language: code }).catch(() => {});
    }
  }

  // English is always the source string; the DOM translator handles the
  // visible language so every screen (not just t() keys) is translated.
  function t(key) { return DICT.en[key] || key; }

  return (
    <I18nCtx.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nCtx.Provider>
  );
}

export function useI18n() { return useContext(I18nCtx); }
