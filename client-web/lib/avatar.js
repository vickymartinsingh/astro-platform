// Deterministic gradient avatar (initial + colour from name), matches the
// "Ask Astro" reference where most experts show a coloured circle, not a photo.
const GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-sky-400 to-blue-500',
  'from-fuchsia-500 to-purple-600',
  'from-orange-400 to-rose-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-pink-500 to-rose-500',
  'from-indigo-500 to-purple-500',
];

export function avatarGradient(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function initial(name = '?') {
  return (name.trim()[0] || '?').toUpperCase();
}
