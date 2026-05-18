import { useEffect, useState } from 'react';
import { useAppUpdate, startUpdate } from '../lib/appUpdate';

// Shown only when a newer app build is published by the admin. Themed
// (uses the app gradient). Dismissable for the session; vanishes the
// moment the app is up to date. Also drives a once-per-launch popup
// (admin can switch the popup off in App Update settings).
export default function UpdateBanner() {
  const { updateAvailable, latestVersion, updateUrl, notes,
    popupEnabled } = useAppUpdate();
  const [hideBanner, setHideBanner] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    if (!updateAvailable || !popupEnabled) return;
    try {
      if (sessionStorage.getItem('updPopupShown') === '1') return;
      sessionStorage.setItem('updPopupShown', '1');
    } catch (_) { /* ignore */ }
    setShowPopup(true);
  }, [updateAvailable, popupEnabled]);

  if (!updateAvailable) return null;

  return (
    <>
      {!hideBanner && (
        <div className="hero-grad flex items-center gap-3 px-4 py-2
          text-sm text-white">
          <span className="flex-1">
            A new version ({latestVersion}) is available.
          </span>
          <button onClick={() => startUpdate(updateUrl)}
            className="rounded-full bg-white px-3 py-1 text-xs
              font-bold text-primary">
            Update
          </button>
          <button onClick={() => setHideBanner(true)}
            aria-label="Dismiss"
            className="rounded-full bg-white/20 px-2 py-1 text-xs">
            ✕
          </button>
        </div>
      )}

      {showPopup && (
        <div className="fixed inset-0 z-[2147483646] flex items-center
          justify-center bg-black/60 px-5">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl
            bg-white text-center shadow-2xl">
            <div className="hero-grad px-6 pb-7 pt-7 text-white">
              <div className="text-4xl">🚀</div>
              <div className="mt-2 text-xl font-bold">
                Update available
              </div>
              <div className="text-sm opacity-90">
                Version {latestVersion}
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm text-dark-text">
                {notes || 'A newer version of the app is available with '
                  + 'improvements and fixes.'}
              </p>
              <div className="mt-5 flex gap-2">
                <button onClick={() => setShowPopup(false)}
                  className="btn-ghost flex-1 !min-h-0 py-2.5 text-sm">
                  Later
                </button>
                <button
                  onClick={() => { setShowPopup(false);
                    startUpdate(updateUrl); }}
                  className="btn-primary flex-[2] !min-h-0 py-2.5
                    text-sm">
                  Update now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
