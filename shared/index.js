// @astro/shared, single entry point reused by client-web, astro-web, admin-web.
export { default as firebaseApp, auth, db, storage, functions, rtdb } from './firebase.js';
export * from './theme.js';
export { ADMIN_EMAILS, isAdminEmail, isAdminUser, hasRole } from './admins.js';
export { getHoroscope, horoscopeText } from './horoscope.js';
export { TAROT, drawCards, tarotReading } from './tarot.js';
export { gunaMilan, signFromDOB } from './matching.js';
export { CITIES, INDIAN_STATES } from './cities.js';

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
export * as kundliService from './services/kundliService.js';
export * as reviewService from './services/reviewService.js';
export * as payoutService from './services/payoutService.js';
export * as adminService from './services/adminService.js';
export * as reportService from './services/reportService.js';
export * as cmsService from './services/cmsService.js';
export * as remedyService from './services/remedyService.js';
export * as liveService from './services/liveService.js';
export * as themeService from './services/themeService.js';
