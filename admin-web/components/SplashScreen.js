import { useEffect, useState } from 'react';

// Brief launch screen: the brand mark centred on the app's dark theme
// background (#0F0A23, styles --c-tarot), then fades out. Self-contained
// (no network) so it can never get stuck.
let SPLASH_DONE = false;

export default function SplashScreen() {
  const [gone, setGone] = useState(SPLASH_DONE);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    if (SPLASH_DONE) { setGone(true); return undefined; }
    const t1 = setTimeout(() => setFade(true), 1300);
    const t2 = setTimeout(() => { SPLASH_DONE = true; setGone(true); }, 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (gone) return null;
  return (
    <div
      style={{ backgroundColor: '#0F0A23' }}
      className={`fixed inset-0 z-[2147483647] flex flex-col items-center
        justify-center transition-opacity duration-500 ${
        fade ? 'opacity-0' : 'opacity-100'}`}>
      <img src="/logo.png" alt="AstroSeer Admin"
        className="max-h-[55vh] max-w-[78%] object-contain drop-shadow-2xl"
        onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <div className="mt-8 h-7 w-7 animate-spin rounded-full border-2
        border-white/40 border-t-white" />
    </div>
  );
}
