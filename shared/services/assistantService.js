// AI assistant client helper. Calls the relay (key stays server-side)
// and reads the admin's AI config so the astrologer toggle only shows /
// works when the admin has enabled it.
import {
  doc, onSnapshot, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// Supported AI providers shown in the admin panel. Each row's id matches
// what the relay expects in settings/aiProviders.providers[].id.
export const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', tag: 'Free',
    keyHelp: 'aistudio.google.com/app/apikey (no credit card)',
    defaultModel: 'gemini-2.5-flash', fields: ['model'] },
  { id: 'groq', label: 'Groq Cloud', tag: 'Free',
    keyHelp: 'console.groq.com/keys (free tier, Llama 3.x, very fast)',
    defaultModel: 'llama-3.3-70b-versatile', fields: ['model'] },
  { id: 'openrouter', label: 'OpenRouter', tag: 'Mixed',
    keyHelp: 'openrouter.ai/keys (some models free, others paid)',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    fields: ['model'] },
  { id: 'openai', label: 'OpenAI', tag: 'Paid',
    keyHelp: 'platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini', fields: ['model'] },
];

export async function getAiProviders() {
  try {
    const s = await getDoc(doc(db, 'settings', 'aiProviders'));
    return s.exists() ? (s.data() || {}) : {};
  } catch (_) { return {}; }
}

export async function saveAiProviders(cfg) {
  await setDoc(doc(db, 'settings', 'aiProviders'),
    { ...cfg, updatedAt: serverTimestamp() }, { merge: true });
  return { success: true };
}

// Trigger a Vercel Deploy Hook (a URL the admin creates in Vercel project
// settings). Hitting it queues a fresh deployment of the push-relay.
export async function triggerDeploy(url) {
  if (!url) throw new Error('No deploy hook URL configured.');
  const r = await fetch(url, { method: 'POST' });
  let j = null; try { j = await r.json(); } catch (_) {}
  if (!r.ok) {
    throw new Error((j && (j.error || j.message))
      || `Deploy hook returned HTTP ${r.status}`);
  }
  return j || { ok: true };
}

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
// Opt-out semantics: AI is ON by default once admin enables it for this
// astrologer's scope. Only treated as OFF when the astrologer explicitly
// set aiAssistant to false. This stops the "have to toggle off then on
// to make it work" footgun.
export function astroAssistantOn(astroProfile) {
  if (!astroProfile) return false;
  return astroProfile.aiAssistant !== false;
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

// Probe: which providers are configured on the relay? (admin AI page)
export async function probeAi() {
  try {
    const r = await fetch(endpoint(), { method: 'GET' });
    return await r.json();
  } catch (e) { return { configured: false, error: String(e.message || e) }; }
}

// Server-side AI idle-nudge trigger: fire-and-forget POST asking the
// relay to send the next idle-follow-up bubble (or the goodbye + end
// the session, after 3 unanswered nudges). Customer chat page schedules
// this at 45s -> 30s -> 40s after each astrologer reply (counters reset
// the moment the client sends anything). Safe to call repeatedly; the
// relay re-reads aiIdleNudgeCount before posting so duplicates no-op.
export async function triggerAiNudge({ chatId, sessionId, astroUid,
  clientUid } = {}) {
  if (!chatId) return false;
  const base = endpoint().replace(/\/assistant\/?$/, '');
  const url = `${base}/aiNudge`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, sessionId, astroUid, clientUid }),
    });
    let body = null;
    try { body = await r.json(); } catch (_) {}
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.log('[aiNudge]', r.status,
      body || '(no body)');
    return r.ok;
  } catch (e) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.log('[aiNudge] error', e);
    return false;
  }
}

// Server-side AI trigger: fire-and-forget POST so the customer app
// kicks the relay to auto-accept the chat session AND post an AI reply
// AS the astrologer, even if the astrologer's app is closed. Safe to
// call repeatedly (relay is idempotent on the last client message id).
export async function triggerAiAssist({ chatId, sessionId, astroUid,
  clientUid, force, kundliId } = {}) {
  if (!chatId) return false;
  const base = endpoint().replace(/\/assistant\/?$/, '');
  const url = `${base}/aiAssist`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, sessionId, astroUid, clientUid,
        force: !!force, kundliId: kundliId || null }),
    });
    // Surface the relay's decision in the browser console so admins can
    // diagnose "AI not replying" without server access. Look for
    // [aiAssist] entries in DevTools -> Console.
    let body = null;
    try { body = await r.json(); } catch (_) {}
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.log('[aiAssist]', r.status,
      body || '(no body)');
    return r.ok;
  } catch (e) {
    // eslint-disable-next-line no-console
    if (typeof console !== 'undefined') console.log('[aiAssist] error', e);
    return false;
  }
}
