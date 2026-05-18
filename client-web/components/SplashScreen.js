import { useEffect, useState } from 'react';
import { brandingService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';

// Full-screen launch screen: themed background (app gradient) + the
// splash image / logo, shown while the app boots, then it fades away.
// Admin can upload a custom splash in App Update settings
// (settings/config.splash_image); falls back to the brand logo.
function cachedConfig() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem('settings_config') || '{}');
  } catch (_) { return {}; }
}

function alreadyShown() {
  try { return sessionStorage.getItem('splashShown') === '1'; }
  catch (_) { return false; }
}

export default function SplashScreen() {
  const [gone, setGone] = useState(alreadyShown());
  const [fade, setFade] = useState(false);
  const c0 = cachedConfig();
  const [img, setImg] = useState(c0.splash_image || '');
  const [logo, setLogo] = useState('');

  useEffect(() => {
    if (alreadyShown()) { setGone(true); return undefined; }
    try { sessionStorage.setItem('splashShown', '1'); } catch (_) {}
    const unsub = brandingService.watchBranding((b) =>
      setLogo(b.logo || ''));
    getDoc(doc(db, 'settings', 'config')).then((s) => {
      const d = s.exists() ? s.data() : {};
      if (d.splash_image) setImg(d.splash_image);
    }).catch(() => {});
    const t1 = setTimeout(() => setFade(true), 1500);
    const t2 = setTimeout(() => setGone(true), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2);
      if (unsub) unsub(); };
  }, []);

  if (gone) return null;
  const src = img || logo;

  return (
    <div
      className={`fixed inset-0 z-[2147483647] flex flex-col items-center
        justify-center hero-grad transition-opacity duration-500 ${
        fade ? 'opacity-0' : 'opacity-100'}`}>
      {src ? (
        <img src={src} alt="AstroConnect"
          className="max-h-[55vh] max-w-[78%] object-contain
            drop-shadow-2xl" />
      ) : (
        <div className="text-center text-white">
          <div className="text-5xl font-extrabold tracking-wide">
            AstroConnect
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
