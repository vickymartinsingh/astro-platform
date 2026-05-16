// Agora RTC token minting for the AstroConnect call/video feature.
//
// Why this exists: once an Agora App Certificate is enabled, every
// channel join needs a SIGNED token. The certificate is a secret and
// must never ship in the app or the Git repo — it lives ONLY here as a
// Vercel environment variable.
//
// Env vars (Vercel -> Project -> Settings -> Environment Variables):
//   AGORA_APP_ID           - your Agora App ID (public; default below)
//   AGORA_APP_CERTIFICATE  - the PRIMARY App Certificate (SECRET)
//
// GET/POST  ?channel=<sessionId>&uid=<firebaseUid>
//   -> { appId, token, channel, uid, expiresIn }
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const APP_ID = process.env.AGORA_APP_ID
  || 'db48c9f93e334937819af474abb1b450';
const TTL = 3600; // 1 hour; client rejoins/refreshes for longer sessions

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST'
    ? (typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch (_) { return {}; } })()
        : (req.body || {}))
    : (req.query || {});
  const channel = src.channel || src.channelName;
  const uid = String(src.uid || '');           // Firebase uid = string acct
  if (!channel) return res.status(400).json({ error: 'channel required' });

  const cert = process.env.AGORA_APP_CERTIFICATE;
  if (!cert) {
    // No certificate configured -> caller should join with a null token
    // (only valid if the Agora project is in testing mode).
    return res.status(200).json({ appId: APP_ID, token: null });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const expire = now + TTL;
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      APP_ID, cert, String(channel), uid || '0',
      RtcRole.PUBLISHER, TTL, TTL);
    return res.status(200).json({
      appId: APP_ID, token, channel: String(channel),
      uid, expiresIn: TTL, expireAt: expire,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
