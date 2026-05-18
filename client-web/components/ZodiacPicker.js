import { useEffect, useRef, useState } from 'react';
import { ZODIAC, ZODIAC_IN, iconsService } from '@astro/shared';
import ZodiacGlyph from './ZodiacGlyph';

// Swipeable zodiac selector (mobile-app style): slide left/right to see
// every sign, tap to pick. Indian (Vedic) Rashi style - the Vedic
// symbol icon + Rashi name, not the Western glyphs. Falls back to the
// dropdown when the admin sets features.zodiac_dropdown = true.
const IN = (z) => ZODIAC_IN[z] || { en: z, icon: '' };

export default function ZodiacPicker({ value, onChange, dropdown }) {
  const stripRef = useRef(null);
  const [icons, setIcons] = useState(iconsService.resolveIcons(null));
  useEffect(() => iconsService.watchIcons(setIcons), []);
  const glyph = (z) => {
    const ov = icons[`zod:${z}`];
    if (iconsService.isImage(ov)) {
      return <img src={ov} alt="" className="h-8 w-8 object-contain" />;
    }
    return <ZodiacGlyph sign={z} className="text-gold" />;
  };

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
        {ZODIAC.map((z) => (
          <option key={z} value={z}>
            {IN(z).en} ({z})
          </option>
        ))}
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
                  ? 'border-primary bg-bg-light shadow-md'
                  : 'border-gray-200 bg-white'}`}>
              {glyph(z)}
              <span className={`text-xs font-semibold ${on
                ? 'text-primary' : 'text-dark-text'}`}>
                {IN(z).en}
              </span>
              <span className="text-[10px] text-sub-text">{z}</span>
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
