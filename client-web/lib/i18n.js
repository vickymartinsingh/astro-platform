import { createContext, useContext, useEffect, useState } from 'react';
import { userService } from '@astro/shared';

// Lightweight i18n. English is the source of truth; every other
// language overrides per-key and falls back to English for any key it
// does not define. The chosen language is stored in localStorage:
//  - APP UPDATE keeps localStorage  -> language is preserved.
//  - UNINSTALL + REINSTALL clears it -> defaults back to English.
// (We deliberately do NOT auto-restore from the server profile, so a
// reinstall always starts in English as requested.)
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
  hi: {
    'nav.home': 'होम', 'nav.astrologers': 'ज्योतिषी',
    'nav.wallet': 'वॉलेट', 'nav.horoscope': 'राशिफल',
    'nav.profile': 'प्रोफ़ाइल', 'nav.notifications': 'सूचनाएँ',
    'nav.logout': 'लॉगआउट',
    'auth.login': 'लॉगिन', 'auth.signup': 'साइन अप',
    'common.loading': 'लोड हो रहा है…', 'profile.language': 'भाषा',
  },
  bn: {
    'nav.home': 'হোম', 'nav.astrologers': 'জ্যোতিষী',
    'nav.wallet': 'ওয়ালেট', 'nav.horoscope': 'রাশিফল',
    'nav.profile': 'প্রোফাইল', 'nav.notifications': 'বিজ্ঞপ্তি',
    'nav.logout': 'লগআউট',
    'auth.login': 'লগইন', 'auth.signup': 'সাইন আপ',
    'common.loading': 'লোড হচ্ছে…', 'profile.language': 'ভাষা',
  },
  te: {
    'nav.home': 'హోమ్', 'nav.astrologers': 'జ్యోతిష్కులు',
    'nav.wallet': 'వాలెట్', 'nav.horoscope': 'రాశిఫలం',
    'nav.profile': 'ప్రొఫైల్', 'nav.notifications': 'నోటిఫికేషన్లు',
    'nav.logout': 'లాగౌట్',
    'auth.login': 'లాగిన్', 'auth.signup': 'సైన్ అప్',
    'common.loading': 'లోడ్ అవుతోంది…', 'profile.language': 'భాష',
  },
  mr: {
    'nav.home': 'होम', 'nav.astrologers': 'ज्योतिषी',
    'nav.wallet': 'वॉलेट', 'nav.horoscope': 'राशीभविष्य',
    'nav.profile': 'प्रोफाइल', 'nav.notifications': 'सूचना',
    'nav.logout': 'लॉगआउट',
    'auth.login': 'लॉगिन', 'auth.signup': 'साइन अप',
    'common.loading': 'लोड होत आहे…', 'profile.language': 'भाषा',
  },
  ta: {
    'nav.home': 'முகப்பு', 'nav.astrologers': 'ஜோதிடர்கள்',
    'nav.wallet': 'வாலெட்', 'nav.horoscope': 'ராசிபலன்',
    'nav.profile': 'சுயவிவரம்', 'nav.notifications': 'அறிவிப்புகள்',
    'nav.logout': 'வெளியேறு',
    'auth.login': 'உள்நுழை', 'auth.signup': 'பதிவு செய்',
    'common.loading': 'ஏற்றுகிறது…', 'profile.language': 'மொழி',
  },
  gu: {
    'nav.home': 'હોમ', 'nav.astrologers': 'જ્યોતિષી',
    'nav.wallet': 'વોલેટ', 'nav.horoscope': 'રાશિફળ',
    'nav.profile': 'પ્રોફાઇલ', 'nav.notifications': 'સૂચનાઓ',
    'nav.logout': 'લૉગઆઉટ',
    'auth.login': 'લૉગિન', 'auth.signup': 'સાઇન અપ',
    'common.loading': 'લોડ થઈ રહ્યું છે…', 'profile.language': 'ભાષા',
  },
  kn: {
    'nav.home': 'ಮುಖಪುಟ', 'nav.astrologers': 'ಜ್ಯೋತಿಷಿಗಳು',
    'nav.wallet': 'ವಾಲೆಟ್', 'nav.horoscope': 'ರಾಶಿಫಲ',
    'nav.profile': 'ಪ್ರೊಫೈಲ್', 'nav.notifications': 'ಅಧಿಸೂಚನೆಗಳು',
    'nav.logout': 'ಲಾಗ್ ಔಟ್',
    'auth.login': 'ಲಾಗಿನ್', 'auth.signup': 'ಸೈನ್ ಅಪ್',
    'common.loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…', 'profile.language': 'ಭಾಷೆ',
  },
  ml: {
    'nav.home': 'ഹോം', 'nav.astrologers': 'ജ്യോതിഷർ',
    'nav.wallet': 'വാലറ്റ്', 'nav.horoscope': 'രാശിഫലം',
    'nav.profile': 'പ്രൊഫൈൽ', 'nav.notifications': 'അറിയിപ്പുകൾ',
    'nav.logout': 'ലോഗൗട്ട്',
    'auth.login': 'ലോഗിൻ', 'auth.signup': 'സൈൻ അപ്പ്',
    'common.loading': 'ലോഡ് ചെയ്യുന്നു…', 'profile.language': 'ഭാഷ',
  },
  pa: {
    'nav.home': 'ਹੋਮ', 'nav.astrologers': 'ਜੋਤਸ਼ੀ',
    'nav.wallet': 'ਵਾਲਿਟ', 'nav.horoscope': 'ਰਾਸ਼ੀਫਲ',
    'nav.profile': 'ਪ੍ਰੋਫਾਈਲ', 'nav.notifications': 'ਸੂਚਨਾਵਾਂ',
    'nav.logout': 'ਲੌਗਆਉਟ',
    'auth.login': 'ਲੌਗਇਨ', 'auth.signup': 'ਸਾਈਨ ਅੱਪ',
    'common.loading': 'ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…', 'profile.language': 'ਭਾਸ਼ਾ',
  },
  or: {
    'nav.home': 'ହୋମ୍', 'nav.astrologers': 'ଜ୍ୟୋତିଷୀ',
    'nav.wallet': 'ୱାଲେଟ୍', 'nav.horoscope': 'ରାଶିଫଳ',
    'nav.profile': 'ପ୍ରୋଫାଇଲ୍', 'nav.notifications': 'ବିଜ୍ଞପ୍ତି',
    'nav.logout': 'ଲଗଆଉଟ୍',
    'auth.login': 'ଲଗଇନ୍', 'auth.signup': 'ସାଇନ୍ ଅପ୍',
    'common.loading': 'ଲୋଡ୍ ହେଉଛି…', 'profile.language': 'ଭାଷା',
  },
  ur: {
    'nav.home': 'ہوم', 'nav.astrologers': 'نجومی',
    'nav.wallet': 'والیٹ', 'nav.horoscope': 'زائچہ',
    'nav.profile': 'پروفائل', 'nav.notifications': 'اطلاعات',
    'nav.logout': 'لاگ آؤٹ',
    'auth.login': 'لاگ ان', 'auth.signup': 'سائن اپ',
    'common.loading': 'لوڈ ہو رہا ہے…', 'profile.language': 'زبان',
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

const I18nCtx = createContext({ lang: 'en', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children, uid }) {
  const [lang, setLangState] = useState('en');

  // Language comes ONLY from localStorage (kept across app updates,
  // wiped on uninstall -> reinstall starts in English).
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined'
        ? localStorage.getItem('lang') : null;
      if (saved && DICT[saved]) setLangState(saved);
    } catch (_) { /* ignore */ }
  }, []);

  function setLang(code) {
    setLangState(code);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('lang', code);
      }
    } catch (_) { /* ignore */ }
    // Saved to the profile only as a record (not used to auto-restore).
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
