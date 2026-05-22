// AI assistant client helper. Calls the relay (key stays server-side)
// and reads the admin's AI config so the astrologer toggle only shows /
// works when the admin has enabled it.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';

function endpoint() {
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_ASSISTANT_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/assistant')
    : 'https://astro-platform-push-relay.vercel.app/api/assistant';
}

// settings/config AI keys:
//   ai_enabled        - master on/off (admin)
//   ai_scope          - 'all' | 'selected'
//   ai_astrologers    - array of astro uids when scope === 'selected'
export function aiAvailableForAstro(cfg, astroId) {
  const c = cfg || {};
  if (!c.ai_enabled) return false;
  if (c.ai_scope === 'selected') {
    return Array.isArray(c.ai_astrologers)
      && c.ai_astrologers.includes(astroId);
  }
  return true; // 'all' (default when enabled)
}

// Whether THIS astrologer has turned their personal assistant ON.
// Stored on the astrologer doc: astrologers/{id}.aiAssistant === true.
export function astroAssistantOn(astroProfile) {
  return !!(astroProfile && astroProfile.aiAssistant);
}

export function watchAiConfig(callback) {
  try {
    return onSnapshot(doc(db, 'settings', 'config'), (s) =>
      callback(s.exists() ? (s.data() || {}) : {}), () => {});
  } catch (_) { return () => {}; }
}

// Generate an AI reply for a chat. `messages` = recent turns, oldest
// first: [{ text, fromClient: bool }]. Returns the reply string or ''.
export async function generateReply({ messages, astrologerName,
  clientName, context }) {
  const url = endpoint();
  if (!url || !Array.isArray(messages) || !messages.length) return '';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages, astrologerName, clientName, context: context || '',
      }),
    });
    if (!r.ok) return '';
    const j = await r.json();
    return (j && j.reply) ? String(j.reply) : '';
  } catch (_) { return ''; }
}

// Probe: is the relay's Bedrock key configured? (admin AI page)
export async function probeAi() {
  try {
    const r = await fetch(endpoint(), { method: 'GET' });
    return await r.json();
  } catch (e) { return { configured: false, error: String(e.message || e) }; }
}
