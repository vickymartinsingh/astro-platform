// callService, blueprint 8.2. Thin wrapper over Agora RTC.
// SDK is dynamically imported so it never runs during SSR / static export.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase.js';

// Agora App ID. Baked in so packaged APK / iOS builds (which have no
// NEXT_PUBLIC_* env at runtime) can still connect. An env override wins
// if provided at build time. NOTE: this is App-ID/testing-mode auth -
// the Agora project must have NO App Certificate enabled (token = null),
// otherwise a token server is required.
export const AGORA_APP_ID =
  ((typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_AGORA_APP_ID) || '').trim()
  || 'db48c9f93e334937819af474abb1b450';

// Resolve the Agora token endpoint. Explicit env wins; otherwise derive
// it from the push relay URL (same Vercel deployment, /api/agoraToken).
function tokenEndpoint() {
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_AGORA_TOKEN_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/agoraToken') : '';
}

// Fetch a short-lived RTC token. With an App Certificate enabled the
// token MUST be signed server-side (relay). Firebase uids are strings,
// so the token is account-based and must be minted per (channel, uid).
// Falls back to a Cloud Function, then to a null token (testing mode).
export async function fetchAgoraToken(channelName, uid) {
  const url = tokenEndpoint();
  if (url) {
    try {
      const r = await fetch(
        `${url}?channel=${encodeURIComponent(channelName)}`
        + `&uid=${encodeURIComponent(uid || '')}`);
      if (r.ok) return await r.json();
    } catch (_) { /* fall through */ }
  }
  try {
    const fn = httpsCallable(functions, 'generateAgoraToken');
    return (await fn({ channelName, uid })).data;
  } catch (e) {
    return { appId: AGORA_APP_ID, token: null };
  }
}

let AgoraRTC = null;
let client = null;
let localTracks = { audio: null, video: null };

async function ensureSdk() {
  if (!AgoraRTC) {
    const mod = await import('agora-rtc-sdk-ng');
    AgoraRTC = mod.default;
  }
  return AgoraRTC;
}

// Channel name is always the sessionId (blueprint 4.9, unique per session).
export async function joinAgoraChannel(
  channelName, uid, appId, token = null,
) {
  const rtc = await ensureSdk();
  client = rtc.createClient({ mode: 'rtc', codec: 'vp8' });
  await client.join(
    appId || AGORA_APP_ID, channelName, token || null, uid || null);
  return client;
}

export async function publishLocalTracks({ video = false } = {}) {
  const rtc = await ensureSdk();
  localTracks.audio = await rtc.createMicrophoneAudioTrack();
  const toPublish = [localTracks.audio];
  if (video) {
    localTracks.video = await rtc.createCameraVideoTrack();
    toPublish.push(localTracks.video);
  }
  await client.publish(toPublish);
  return localTracks;
}

export function subscribeToRemote(onRemote) {
  if (!client) return;
  client.on('user-published', async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    onRemote(user, mediaType);
  });
}

export function setMuted(muted) {
  if (localTracks.audio) localTracks.audio.setEnabled(!muted);
}

export function setCameraEnabled(enabled) {
  if (localTracks.video) localTracks.video.setEnabled(enabled);
}

export async function leaveAgoraChannel() {
  try {
    localTracks.audio?.close();
    localTracks.video?.close();
    if (client) await client.leave();
  } finally {
    localTracks = { audio: null, video: null };
    client = null;
  }
}
