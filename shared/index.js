// @astro/shared, single entry point reused by client-web, astro-web, admin-web.
export {
  default as firebaseApp, auth, db, storage, functions, rtdb,
  getStorageLazy, getFunctionsLazy, getRtdbLazy,
} from './firebase.js';
export * from './theme.js';
export {
  APP_BUILD, APP_VERSION, APP_SUFFIX, appVersionName,
} from './appVersion.js';
export {
  ADMIN_EMAILS, isAdminEmail, isAdminUser, hasRole, TEAM_ROLES,
  isDeveloperUser, isSupportUser,
} from './admins.js';
export { getHoroscope, horoscopeText } from './horoscope.js';
export {
  TAROT, drawCards, tarotReading, aspectReading, TAROT_ASPECTS,
} from './tarot.js';
export { gunaMilan, signFromDOB } from './matching.js';
export { CITIES, INDIAN_STATES } from './cities.js';
export * as vimshottari from './vimshottari.js';
export {
  LANGUAGES, SKILLS, EXPERIENCE_BUCKETS, MAX_REJECTIONS_BEFORE_BLOCK,
  DEFAULT_REFERRAL, resolveReferral,
} from './astroProfile.js';
export {
  FEATURE_GROUPS, FEATURES, featurePrice, featureById, featureStatus,
} from './astroFeatures.js';
export {
  inr, rupees, rupees2, setCurrencyPrefix, CURRENCY_OPTIONS,
} from './money.js';

export * as authService from './services/authService.js';
export * as userService from './services/userService.js';
export * as walletService from './services/walletService.js';
export * as astrologerService from './services/astrologerService.js';
export * as chatService from './services/chatService.js';
export * as sessionService from './services/sessionService.js';
export * as callService from './services/callService.js';
export * as notificationService from './services/notificationService.js';
export * as pushService from './services/pushService.js';
export * as presenceService from './services/presenceService.js';
export * as assistantService from './services/assistantService.js';
export * as numerologyService from './services/numerologyService.js';
export * as avatarService from './services/avatarService.js';
export * as auditService from './services/auditService.js';
export * as applicationService from './services/applicationService.js';
export * as appReleaseService from './services/appReleaseService.js';
export * as kundliService from './services/kundliService.js';
export * as reviewService from './services/reviewService.js';
export * as payoutService from './services/payoutService.js';
export * as adminService from './services/adminService.js';
export * as reportService from './services/reportService.js';
export * as cmsService from './services/cmsService.js';
export * as remedyService from './services/remedyService.js';
export * as liveService from './services/liveService.js';
export * as offerService from './services/offerService.js';
export * as galleryService from './services/galleryService.js';
export * as liveBotService from './services/liveBotService.js';
export * as themeService from './services/themeService.js';
export * as brandingService from './services/brandingService.js';
export * as menuService from './services/menuService.js';
export * as iconsService from './services/iconsService.js';
export * as horoscopeService from './services/horoscopeService.js';
export * as soundService from './services/soundService.js';
export * as supportService from './services/supportService.js';
export * as ticketService from './services/ticketService.js';
export * as abuseService from './services/abuseService.js';
export * as followService from './services/followService.js';
export * as tarotService from './services/tarotService.js';
export * as hoursService from './services/hoursService.js';
export * as recordService from './services/recordService.js';
export * as emailService from './services/emailService.js';
export * as referralService from './services/referralService.js';
export * as welcomeBonusService from './services/welcomeBonusService.js';

// Catalogue of paid + free PDF report types. Both client (buy
// buttons, confirm popup, /orders labels) and the relay (price
// + AstroSeer tier + section list per type) read from here so
// adding a new product type is one file change.
export {
  REPORT_TYPES, reportType, resolvePrice,
} from './reportTypes.js';

export {
  DEFAULT_COUNTRIES, DEFAULT_COUNTRY_CODE, DEFAULT_COUNTRY_ISO,
  buildCountryList, watchCountryList, splitPhone,
  phoneLenFor, isPhoneValidFor,
} from './countryCodes.js';
