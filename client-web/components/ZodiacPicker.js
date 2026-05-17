import { useEffect, useRef } from 'react';
import { ZODIAC } from '@astro/shared';

// Swipeable zodiac selector (mobile-app style): slide left/right to see
// every sign, tap to pick. Falls back to the old dropdown when the admin
// sets features.zodiac_dropdown = true (App Builder / Developer Portal).
const SYM = {
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋',
  Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏',
  Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒',
  Pisces: '♓',
};

export default function ZodiacPicker({ value, onChange, dropdown }) {
  const stripRef = useRef(null);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const sel = el.querySelector('[data-sel="1"]');
    if (sel) {
      el.scrollTo({
        left: sel.offsetLeft - el.clientWidth / 2 + sel.clientWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [value]);

  if (dropdown) {
    return (
      <select className="input" value={value}
        onChange={(e) => onChange(e.target.value)}>
        {ZODIAC.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
    );
  }

  const idx = Math.max(0, ZODIAC.indexOf(value));
  const step = (d) => {
    const n = (idx + d + ZODIAC.length) % ZODIAC.length;
    onChange(ZODIAC[n]);
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous sign"
        onClick={() => step(-1)}
        className="flex h-9 w-9 shrink-0 items-center justify-center
          rounded-full bg-bg-light text-lg text-primary">
        ‹
      </button>
      <div ref={stripRef}
        className="flex flex-1 gap-2 overflow-x-auto scroll-smooth py-1"
        style={{ scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch' }}>
        {ZODIAC.map((z) => {
          const on = z === value;
          return (
            <button key={z} type="button" data-sel={on ? '1' : '0'}
              onClick={() => onChange(z)}
              style={{ scrollSnapAlign: 'center' }}
              className={`flex min-w-[76px] shrink-0 flex-col items-center
                gap-0.5 rounded-2xl border px-3 py-2 text-center
                transition-all ${on
                  ? 'border-primary bg-primary text-white shadow-md'
                  : 'border-gray-200 bg-white text-dark-text'}`}>
              <span className="text-2xl leading-none">{SYM[z]}</span>
              <span className="text-xs font-semibold">{z}</span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next sign"
        onClick={() => step(1)}
        className="flex h-9 w-9 shrink-0 items-center justify-center
          rounded-full bg-bg-light text-lg text-primary">
        ›
      </button>
    </div>
  );
}
