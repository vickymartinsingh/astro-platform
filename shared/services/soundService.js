// Admin-selectable / uploadable notification tone + ringtone, used for
// IN-APP alerts (new message / notification) and incoming-or-waiting
// call ringing. Presets are synthesised with WebAudio (no asset files);
// a custom upload is stored as a data-URL and played via <audio>.
// Selection lives in settings/config (cached by the apps), so it is
// live - change it in the admin panel and the apps use it immediately.
//
// NOTE: the Android lock-screen PUSH sound is a notification-channel
// property fixed when the app is built and cannot be changed from
// settings at runtime; this controls the sounds the app itself plays.

export const NOTIF_PRESETS = [
  ['chime', 'Chime'],
  ['bell', 'Bell'],
  ['ding', 'Ding'],
  ['cosmic', 'Cosmic'],
  ['soft', 'Soft'],
];
export const RING_PRESETS = [
  ['classic', 'Classic ring'],
  ['tring', 'Tring tring'],
  ['cosmic', 'Cosmic'],
  ['pulse', 'Pulse'],
];

function isData(v) {
  return typeof v === 'string' && v.slice(0, 5) === 'data:';
}
function cfg() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem('settings_config') || '{}');
  } catch (_) { return {}; }
}

let ctx;
function ac() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// One short "blip": freq sweep f0->f1 over dur seconds at time t.
function blip(t, f0, f1, dur, vol, type) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, c.currentTime + t);
  o.frequency.exponentialRampToValueAtTime(
    f1, c.currentTime + t + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + t);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + t + 0.03);
  g.gain.exponentialRampToValueAtTime(
    0.0001, c.currentTime + t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + t);
  o.stop(c.currentTime + t + dur + 0.02);
}

// Each preset = a short pattern of blips.
function playPreset(key) {
  try {
    switch (key) {
      case 'bell':
        blip(0, 880, 660, 0.5, 0.25, 'triangle'); break;
      case 'ding':
        blip(0, 1320, 1320, 0.18, 0.22); break;
      case 'cosmic':
        blip(0, 440, 1200, 0.5, 0.2, 'sawtooth');
        blip(0.18, 700, 1600, 0.4, 0.16, 'sine'); break;
      case 'soft':
        blip(0, 520, 600, 0.4, 0.16, 'sine'); break;
      case 'tring':
        blip(0, 1000, 1000, 0.1, 0.22);
        blip(0.14, 1000, 1000, 0.1, 0.22); break;
      case 'classic':
        blip(0, 480, 620, 0.18, 0.24);
        blip(0.22, 480, 620, 0.18, 0.24); break;
      case 'pulse':
        blip(0, 700, 700, 0.12, 0.22);
        blip(0.2, 700, 700, 0.12, 0.22);
        blip(0.4, 700, 700, 0.12, 0.22); break;
      case 'chime':
      default:
        blip(0, 660, 990, 0.12, 0.22);
        blip(0.13, 880, 1320, 0.25, 0.18); break;
    }
  } catch (_) { /* audio not allowed yet */ }
}

let audioEl;
function playData(url, loop) {
  try {
    if (!audioEl) audioEl = new Audio();
    audioEl.src = url;
    audioEl.loop = !!loop;
    audioEl.currentTime = 0;
    const p = audioEl.play();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* ignore */ }
}

// Play the admin-chosen notification tone once.
export function playNotification() {
  if (typeof window === 'undefined') return;
  const v = cfg().sound_notif || 'chime';
  if (isData(v)) playData(v, false); else playPreset(v);
}

let ringTimer;
// Start the admin-chosen ringtone, looping until stopRing().
export function startRing() {
  if (typeof window === 'undefined') return;
  stopRing();
  const v = cfg().sound_ring || 'classic';
  if (isData(v)) { playData(v, true); return; }
  playPreset(v);
  ringTimer = setInterval(() => playPreset(v), 2200);
}
export function stopRing() {
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
  try {
    if (audioEl) { audioEl.pause(); audioEl.loop = false; }
  } catch (_) { /* ignore */ }
}

// Admin preview (works for a preset key or a data-URL).
export function preview(value, loop) {
  if (typeof window === 'undefined') return;
  if (isData(value)) playData(value, !!loop); else playPreset(value);
}
