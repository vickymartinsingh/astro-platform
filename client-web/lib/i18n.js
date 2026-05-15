import { createContext, useContext, useEffect, useState } from 'react';
import { userService } from '@astro/shared';

// Lightweight i18n (blueprint Module 28). English is the source of truth;
// hi/te provide overrides and fall back to en per-key. Language persists
// to localStorage and, when signed in, to users.language.
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
    'wallet.secured': 'Secured by Razorpay',
    'auth.login': 'Login', 'auth.signup': 'Sign up',
    'auth.email': 'Email', 'auth.password': 'Password',
    'common.loading': 'Loading…', 'common.retry': 'Try again',
    'profile.language': 'Language',
  },
  hi: {
    'nav.home': 'होम', 'nav.astrologers': 'ज्योतिषी',
    'nav.chatHistory': 'चैट इतिहास', 'nav.callHistory': 'कॉल इतिहास',
    'nav.wallet': 'वॉलेट', 'nav.horoscope': 'राशिफल',
    'nav.profile': 'प्रोफ़ाइल', 'nav.notifications': 'सूचनाएँ',
    'nav.logout': 'लॉगआउट',
    'dash.walletBalance': 'वॉलेट बैलेंस', 'dash.addMoney': '+ पैसे जोड़ें',
    'dash.chat': 'ज्योतिषी से चैट करें', 'dash.call': 'ज्योतिषी को कॉल करें',
    'dash.recharge': 'वॉलेट रिचार्ज', 'dash.horoscope': 'राशिफल देखें',
    'dash.recentChats': 'हाल की चैट',
    'wallet.addMoney': 'पैसे जोड़ें', 'wallet.transactions': 'लेन-देन',
    'auth.login': 'लॉगिन', 'auth.signup': 'साइन अप',
    'common.loading': 'लोड हो रहा है…', 'profile.language': 'भाषा',
  },
  te: {
    'nav.home': 'హోమ్', 'nav.astrologers': 'జ్యోతిష్కులు',
    'nav.wallet': 'వాలెట్', 'nav.horoscope': 'రాశిఫలం',
    'nav.profile': 'ప్రొఫైల్', 'nav.notifications': 'నోటిఫికేషన్లు',
    'nav.logout': 'లాగౌట్',
    'dash.walletBalance': 'వాలెట్ బ్యాలెన్స్', 'dash.addMoney': '+ డబ్బు జోడించు',
    'auth.login': 'లాగిన్', 'auth.signup': 'సైన్ అప్',
    'common.loading': 'లోడ్ అవుతోంది…', 'profile.language': 'భాష',
  },
};

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'te', label: 'తెలుగు' },
];

const I18nCtx = createContext({ lang: 'en', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children, profile, uid }) {
  const [lang, setLangState] = useState('en');

  // Initial language: localStorage, then profile when it arrives.
  useEffect(() => {
    const saved = typeof window !== 'undefined'
      ? localStorage.getItem('lang') : null;
    if (saved) setLangState(saved);
  }, []);
  useEffect(() => {
    if (profile?.language) setLangState(profile.language);
  }, [profile?.language]);

  function setLang(code) {
    setLangState(code);
    if (typeof window !== 'undefined') localStorage.setItem('lang', code);
    if (uid) userService.updateUser(uid, { language: code }).catch(() => {});
  }

  function t(key) {
    return (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
  }

  return (
    <I18nCtx.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nCtx.Provider>
  );
}

export function useI18n() { return useContext(I18nCtx); }
