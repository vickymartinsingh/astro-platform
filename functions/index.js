// Cloud Functions entry, exports every function (blueprint 8.1).
const billing = require('./billing');
const payments = require('./payments');
const auth = require('./auth');
const notifications = require('./notifications');
const reports = require('./reports');
const admin = require('./admin');
const presence = require('./presence');
const calls = require('./calls');
const cms = require('./cms');

// Core engine
exports.billingEngine = billing.billingEngine;
exports.endSession = billing.endSession;
exports.sessionTimeout = billing.sessionTimeout;

// Payments (Hard Rule 5)
exports.createRazorpayOrder = payments.createRazorpayOrder;
exports.verifyPayment = payments.verifyPayment;

// Auth trigger + referral
exports.createUser = auth.createUser;
exports.applyReferral = auth.applyReferral;

// Notifications
exports.onAstrologerGoOnline = notifications.onAstrologerGoOnline;
exports.sendNotification = notifications.sendNotification;
exports.sendScheduledNotification = notifications.sendScheduledNotification;

// Reports
exports.generatePDFReport = reports.generatePDFReport;
exports.emailReport = reports.emailReport;

// Presence / disconnect (Hard Rule 7)
exports.onUserStatusChanged = presence.onUserStatusChanged;

// Agora token server (production calls)
exports.generateAgoraToken = calls.generateAgoraToken;

// Privileged admin actions
exports.adminBlockUser = admin.adminBlockUser;
exports.adminApproveAstrologer = admin.adminApproveAstrologer;
exports.adminAdjustWallet = admin.adminAdjustWallet;
exports.adminUpdateSettings = admin.adminUpdateSettings;
exports.adminForceEndSession = admin.adminForceEndSession;
exports.adminProcessPayout = admin.adminProcessPayout;
exports.adminResolveDispute = admin.adminResolveDispute;
exports.adminSaveCoupon = admin.adminSaveCoupon;

// CMS / Page Builder
exports.adminSavePage = cms.adminSavePage;
exports.adminPublishPage = cms.adminPublishPage;
exports.adminRollbackPage = cms.adminRollbackPage;
