import { useEffect, useState } from 'react';

// App tour. Shows automatically on a fresh install (device-based: a
// localStorage flag, so it appears after every install for everyone),
// walks through every feature with a visual + WHERE to find it, and is
// skippable. Re-openable from Profile via window event 'open-tour'.
const KEY = 'appTourDone';
const STEPS = [
  { i: '🙏', t: 'Welcome to AstroConnect',
    m: 'A 30-second tour so you know exactly where everything is. '
      + 'You can skip anytime.', w: '' },
  { i: '🏠', t: 'Home',
    m: 'Your daily horoscope, quick actions and top astrologers.',
    w: 'Bottom bar - 1st tab' },
  { i: '💬', t: 'Chat with an astrologer',
    m: 'Browse verified astrologers and start a per-minute chat. The '
      + 'first connect needs the astrologer to accept.',
    w: 'Bottom bar - "Chat"' },
  { i: '📺', t: 'Live',
    m: 'Watch astrologers live, comment and like in real time.',
    w: 'Bottom bar - "Live"' },
  { i: '📞', t: 'Call & Video',
    m: 'Voice or video consultation, billed per minute. First 40s of '
      + 'any drop is free.', w: 'Bottom bar - "Call"' },
  { i: '👤', t: 'Profile',
    m: 'Your details, consultation & call history, orders and the menu.',
    w: 'Bottom bar - "Profile"' },
  { i: '💰', t: 'Wallet & recharge',
    m: 'Add money (UPI/cards), redeem gift cards, see invoices. Low '
      + 'balance warns you before a call ends.',
    w: 'Menu (top) - "Wallet"' },
  { i: '📜', t: 'Kundli',
    m: 'Save birth details once for a full chart - planets, houses, '
      + 'dasha and life predictions.', w: 'Menu - "Kundli"' },
  { i: '✨', t: 'Horoscope, Tarot & Matching',
    m: "Daily/tomorrow horoscope, tarot pick and partner matching.",
    w: 'Menu (top)' },
  { i: '🛍️', t: 'Remedies',
    m: 'Personalised remedies recommended by your astrologer.',
    w: 'Menu - "Remedies"' },
  { i: '🛟', t: 'Help & Support',
    m: 'Chat with our support team anytime - we reply in the app.',
    w: 'Menu - "Help & Support"' },
  { i: '🎉', t: 'You are all set!',
    m: 'Tap an astrologer to begin. You can replay this tour from '
      + 'Profile.', w: '' },
];

export default function GuidedTour() {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    try { if (window.localStorage.getItem(KEY) !== '1') setShow(true); }
    catch (_) { setShow(true); }
    const open = () => { setI(0); setShow(true); };
    window.addEventListener('open-tour', open);
    return () => window.removeEventListener('open-tour', open);
  }, []);

  function finish() {
    try { window.localStorage.setItem(KEY, '1'); } catch (_) {}
    setShow(false);
  }
  if (!show) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl
        bg-white text-center shadow-2xl">
        <div className="hero-grad px-6 pb-8 pt-7 text-white">
          <div className="text-5xl">{s.i}</div>
          <div className="mt-3 text-xl font-bold">{s.t}</div>
        </div>
        <div className="p-6">
          <p className="text-sm text-dark-text">{s.m}</p>
          {s.w && (
            <div className="mt-3 inline-block rounded-full bg-bg-light
              px-3 py-1 text-xs font-semibold text-primary">
              Where: {s.w}
            </div>
          )}
          <div className="mt-4 flex items-center justify-center gap-1">
            {STEPS.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-all
                ${n === i ? 'w-5 bg-primary' : 'w-1.5 bg-gray-300'}`} />
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={finish}
              className="btn-ghost flex-1 !min-h-0 py-2.5 text-sm">
              Skip
            </button>
            {i > 0 && (
              <button onClick={() => setI(i - 1)}
                className="rounded-card border border-gray-200 px-4
                  text-sm">Back</button>
            )}
            <button
              onClick={() => (last ? finish() : setI(i + 1))}
              className="btn-primary flex-[2] !min-h-0 py-2.5 text-sm">
              {last ? 'Start exploring' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
