import { useEffect, useState } from 'react';

// Brand launch screen: gold mandala on the deep-navy brand (#0F0A23),
// then fades. Always uses the bundled /logo.png so the splash is a
// known on-brand asset - admin's custom branding logo (which may be a
// wordmark not designed for a dark background) is used for in-app
// headers only, never the splash. Self-contained: never gets stuck.
let SPLASH_DONE = false;

export default function SplashScreen() {
  const [gone, setGone] = useState(SPLASH_DONE);
  const [fade, setFade] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  useEffect(() => {
    if (SPLASH_DONE) { setGone(true); return undefined; }
    const t1 = setTimeout(() => setFade(true), 1300);
    const t2 = setTimeout(() => { SPLASH_DONE = true; setGone(true); },
      1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (gone) return null;

  return (
    <div
      style={{ backgroundColor: '#0F0A23' }}
      className={`fixed inset-0 z-[2147483647] flex flex-col items-center
        justify-center transition-opacity duration-500 ${
        fade ? 'opacity-0' : 'opacity-100'}`}>
      {!logoMissing ? (
        <img src="/logo.png" alt="AstroSeer"
          onError={() => setLogoMissing(true)}
          className="max-h-[55vh] max-w-[78%] object-contain
            drop-shadow-2xl" />
      ) : (
        <div className="text-center text-white">
          <div className="text-5xl font-extrabold tracking-wide">
            AstroSeer
          </div>
          <div className="mt-2 text-sm uppercase tracking-[0.3em]
            opacity-80">
            Trusted Astrologers
          </div>
        </div>
      )}
      <div className="mt-8 h-7 w-7 animate-spin rounded-full border-2
        border-white/40 border-t-white" />
    </div>
  );
}
