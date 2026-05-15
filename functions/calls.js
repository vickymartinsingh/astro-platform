// Agora token server (blueprint 8 / Section 4.9). Free tier still needs a
// token unless the project is in testing mode; this issues a short-lived
// RTC token so calls work in production. App Certificate stays server-side.
const functions = require('firebase-functions');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const { requireAuth } = require('./lib/utils');

exports.generateAgoraToken = functions.https.onCall((data, context) => {
  const uid = requireAuth(context);
  const channelName = data && data.channelName;
  if (!channelName) {
    throw new functions.https.HttpsError(
      'invalid-argument', 'channelName required');
  }
  const cfg = functions.config().agora || {};
  const appId = cfg.app_id || process.env.AGORA_APP_ID;
  const appCertificate = cfg.app_certificate || process.env.AGORA_APP_CERT;
  if (!appId || !appCertificate) {
    // No certificate configured -> project is in testing mode; the client
    // joins with a null token, which is valid in that mode.
    return { token: null };
  }
  const expireSeconds = 3600;
  const privilegeExpire = Math.floor(Date.now() / 1000) + expireSeconds;
  // Agora numeric uid 0 lets the SDK assign one; we pass account = uid.
  const token = RtcTokenBuilder.buildTokenWithAccount(
    appId, appCertificate, channelName, uid,
    RtcRole.PUBLISHER, privilegeExpire);
  return { token, appId };
});
