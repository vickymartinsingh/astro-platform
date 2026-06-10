import { useEffect, useState } from 'react';
import useScrollLock from '../lib/useScrollLock';

// App tour. Shows once per install (localStorage), re-openable via the
// 'open-tour' event. Each step SPOTLIGHTS the real button/menu it is
// talking about (cut-out highlight + ring) so the customer sees exactly
// where it is - including the slide menu (we highlight the menu button).
const KEY = 'appTourDone';
// Each step optionally has `menu: 'open'` (force the side menu open
// before measuring) or `menu: 'close'` (close it). This lets the tour
// walk the user through items hidden behind the ☰ button - which most
// new customers miss completely.
const STEPS = [
  { i: '🙏', t: 'Welcome to AstroSeer',
    m: 'A quick tour. Each step points to the exact button on screen. '
      + 'You can skip anytime.' },
  { i: '🏠', t: 'Home', sel: '[data-tour="nav-home"]',
    m: 'Your daily stars, horoscope and top astrologers.' },
  { i: '💬', t: 'Chat with an astrologer', sel: '[data-tour="nav-chat"]',
    m: 'Browse verified astrologers and start a per-minute chat.' },
  { i: '📺', t: 'Live', sel: '[data-tour="nav-live"]',
    m: 'Watch astrologers live and interact in real time.' },
  { i: '🔮', t: 'Tarot', sel: '[data-tour="nav-tarot"]',
    m: 'Pick a tarot card for instant guidance.' },
  { i: '👤', t: 'Profile', sel: '[data-tour="nav-profile"]',
    m: 'Your details, history, orders, app version and logout.' },
  { i: '💰', t: 'Wallet', sel: '[data-tour="top-wallet"]',
    m: 'Add money, redeem gift cards and see invoices - one tap here.' },
  { i: '🔔', t: 'Notifications', sel: '[data-tour="top-bell"]',
    m: 'Session, ticket and offer alerts appear here.' },
  { i: '☰', t: 'Open the side menu', sel: '[data-tour="top-menu"]',
    m: 'Tap here any time to reach Kundli, Horoscope, Numerology, '
      + 'Matching, Remedies, Following, Wallet, History, Help and more. '
      + 'We will walk through these next.' },
  { i: '🌟', t: 'Horoscope', sel: '[data-tour="menu-horoscope"]',
    menu: 'open',
    m: 'Daily, weekly and monthly horoscope for your sign.' },
  { i: '📜', t: 'Kundli', sel: '[data-tour="menu-kundli"]', menu: 'open',
    m: 'Generate your full Vedic birth chart and download a free PDF.' },
  { i: '🔢', t: 'Numerology', sel: '[data-tour="menu-numerology"]',
    menu: 'open',
    m: 'Free Chaldean numerology: life path, lucky numbers, traits.' },
  { i: '💞', t: 'Matching', sel: '[data-tour="menu-matching"]',
    menu: 'open',
    m: 'Guna Milan compatibility for marriage.' },
  { i: '🪷', t: 'Remedies', sel: '[data-tour="menu-remedies"]',
    menu: 'open',
    m: 'Browse astrologer-recommended remedies and gemstones.' },
  { i: '⭐', t: 'Following', sel: '[data-tour="menu-following"]',
    menu: 'open',
    m: 'Astrologers you follow appear here for quick access.' },
  { i: '🕘', t: 'Consultation history',
    sel: '[data-tour="menu-history"]', menu: 'open',
    m: 'Every past chat, call and video, in one place.' },
  { i: '🛟', t: 'Help & Support', sel: '[data-tour="menu-support"]',
    menu: 'open',
    m: 'Raise a ticket, chat with our team or read FAQs.' },
  { i: '🎉', t: 'You are all set!', menu: 'close',
    m: 'Tap an astrologer to begin. Replay this tour anytime from '
      + 'Profile.' },
];

// Open / close the mobile side menu by clicking the ☰ button. Used by the
// tour to walk through menu items that live behind it. No-op on desktop
// where the menu items are already visible in the top nav.
function setMenuOpen(open) {
  if (typeof document === 'undefined') return;
  const btn = document.querySelector('[data-tour="top-menu"]');
  if (!btn) return;
  const isOpen = !!document.querySelector('[data-tour="menu-horoscope"]');
  if (open === isOpen) return;
  try { btn.click(); } catch (_) {}
}

export default function GuidedTour() {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    try { if (window.localStorage.getItem(KEY) !== '1') setShow(true); }
    catch (_) { setShow(true); }
    const open = () => { setI(0); setShow(true); };
    window.addEventListener('open-tour', open);
    return () => window.removeEventListener('open-tour', open);
  }, []);

  useEffect(() => {
    if (!show) return undefined;
    const s = STEPS[i];
    // Force the side menu open / closed if this step needs it.
    if (s && s.menu === 'open') setMenuOpen(true);
    if (s && s.menu === 'close') setMenuOpen(false);
    function place() {
      if (!s || !s.sel) { setRect(null); return; }
      const el = document.querySelector(s.sel);
      if (!el) { setRect(null); return; }
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (_) { /* ignore */ }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width,
        height: r.height });
    }
    // Give the menu a beat to render its items before measuring.
    place();
    const t1 = setTimeout(place, 200);
    const t2 = setTimeout(place, 500);
    window.addEventListener('resize', place);
    return () => { clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener('resize', place); };
  }, [show, i]);

  function finish() {
    try { window.localStorage.setItem(KEY, '1'); } catch (_) {}
    setShow(false);
  }

  useScrollLock(show);
  if (!show) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  // Card avoids the highlighted element (top half -> card bottom).
  const cardTop = rect
    ? (rect.top > (typeof window !== 'undefined'
      ? window.innerHeight : 800) / 2)
    : false;

  return (
    <div className="fixed inset-0 z-[2147483646]">
      {/* Dim + spotlight cut-out around the target element. */}
      {rect ? (
        <div className="pointer-events-none absolute rounded-2xl
          transition-all duration-300"
          style={{
            top: rect.top - 8, left: rect.left - 8,
            width: rect.width + 16, height: rect.height + 16,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.66)',
            border: '3px solid #fff',
            outline: '3px solid rgba(255,255,255,0.5)',
          }} />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      {/* Step card */}
      <div className={`absolute inset-x-0 flex justify-center px-4 ${
        cardTop ? 'top-6' : 'bottom-24'}`}>
        <div className="w-full max-w-sm overflow-hidden rounded-2xl
          bg-white text-center shadow-2xl">
          <div className="hero-grad px-6 pb-6 pt-6 text-white">
            <div className="text-4xl">{s.i}</div>
            <div className="mt-2 text-xl font-bold">{s.t}</div>
          </div>
          <div className="p-5">
            <p className="text-sm text-dark-text">{s.m}</p>
            <div className="mt-3 flex items-center justify-center gap-1">
              {STEPS.map((_, n) => (
                <span key={n} className={`h-1.5 rounded-full
                  transition-all ${n === i
                    ? 'w-5 bg-primary' : 'w-1.5 bg-gray-300'}`} />
              ))}
            </div>
            <div className="mt-4 flex gap-2">
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
    </div>
  );
}
