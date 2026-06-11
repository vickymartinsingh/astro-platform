import { useState } from 'react';
import {
  useAppUpdate, startUpdate, shouldShowPopup, dismissPopup,
} from '../lib/appUpdate';
import useScrollLock from '../lib/useScrollLock';

// Play-Store-look-alike update sheet (operator reference: Astrotalk's
// in-app modal). Slides up from the bottom on a dimmed backdrop. Body
// matches the Google Play "Update available" dialog so the user
// recognises the gesture instantly. The Update CTA hands off to the
// store deep-link via startUpdate(); the X dismisses (soft updates
// only - required updates hide the X and stay modal).
//
// The component pulls everything reactive from settings/appLinks via
// the useAppUpdate hook so the moment the admin saves a new latest
// build in /admin-app-update, every running app instance gets the
// banner without a redeploy.

// Google Play Store icon — four-triangle design in the four Play
// brand colours. Not a copy of the trademark; this is a geometric
// approximation that reads clearly as "Play Store" not "Play Games".
function PlayIcon() {
  return (
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
      {/* Top-left: blue triangle */}
      <polygon points="4,2 4,30 32,18" fill="#4285F4" />
      {/* Bottom-left: green triangle */}
      <polygon points="4,34 4,62 32,46" fill="#34A853" />
      {/* Top-right: yellow triangle */}
      <polygon points="36,18 60,5 60,32" fill="#FBBC05" />
      {/* Bottom-right: red triangle */}
      <polygon points="36,46 60,32 60,59" fill="#EA4335" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2"
        strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function UpdateModal() {
  const u = useAppUpdate();
  const [open, setOpen] = useState(true);
  // This popup is only meaningful on native Android/iOS — web users
  // don't install via Play Store. Skip entirely on web to avoid
  // confusing the browser audience.
  const isNative = typeof window !== 'undefined'
    && window.Capacitor && window.Capacitor.isNativePlatform();
  // Compute visibility BEFORE early returns so the hook call is
  // unconditional (React rules of hooks).
  const visible = isNative && u.updateAvailable && u.popupEnabled
    && (u.requiredUpdate || shouldShowPopup(u.latestBuild))
    && (open || u.requiredUpdate);
  useScrollLock(!!visible);
  // Don't render on web or when there's nothing to update.
  if (!isNative) return null;
  if (!u.updateAvailable || !u.popupEnabled) return null;
  if (!u.requiredUpdate && !shouldShowPopup(u.latestBuild)) return null;
  if (!open && !u.requiredUpdate) return null;

  function onDismiss() {
    dismissPopup(u.latestBuild);
    setOpen(false);
  }
  function onUpdate() { startUpdate(u.updateUrl); }

  return (
    <div className="fixed inset-0 z-[2147483646] flex items-end
      justify-center bg-black/60" onClick={u.requiredUpdate ? undefined
        : onDismiss}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-[#1f1f24] px-5
          pb-6 pt-4 text-white shadow-2xl">
        {/* Header row: Play badge + Google Play wordmark + close */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlayIcon />
            <span className="text-[15px] font-semibold tracking-wide">
              Google Play
            </span>
          </div>
          {!u.requiredUpdate && (
            <button onClick={onDismiss}
              className="grid h-8 w-8 place-items-center rounded-full
                hover:bg-white/10" aria-label="Close">
              <CloseIcon />
            </button>
          )}
        </div>

        <h2 className="text-[22px] font-bold leading-tight">
          {u.requiredUpdate
            ? 'Update required to continue'
            : 'Update available'}
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed
          text-white/80">
          {u.requiredUpdate
            ? 'A newer version of this app is required. Tap Update '
              + 'to install the latest version from the Play Store.'
            : 'To use this app, download the latest version. You can '
              + 'keep using this app while downloading the update.'}
        </p>

        {/* App card row: icon + name + meta. Operator screenshot
            shows star rating, size, age rating. Logo is the real
            brand /logo.png served from public so the modal matches
            what Play Store would display. */}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden
            rounded-xl bg-[#1A0F0F]">
            <img src="/logo.png" alt="AstroSeer"
              className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">
              {u.appName}
            </div>
            <div className="mt-0.5 flex items-center gap-3
              text-[12px] text-white/70">
              {u.rating && (
                <span className="inline-flex items-center gap-1">
                  {u.rating} ★
                </span>
              )}
              {u.sizeMb && <span>{u.sizeMb} MB</span>}
              <span className="inline-flex items-center gap-1">
                <span className="rounded-sm bg-white/15 px-1 py-0.5
                  text-[9px] font-bold">3+</span>
                Rated for 3+
              </span>
            </div>
          </div>
        </div>

        {/* What's new collapsible */}
        {u.notes && (
          <details className="mt-5 border-t border-white/10 pt-4">
            <summary className="cursor-pointer text-[15px] font-semibold
              list-none flex items-center justify-between">
              What&apos;s new
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M6 9l6 6 6-6" fill="none"
                  stroke="white" strokeWidth="2" />
              </svg>
            </summary>
            <p className="mt-2 whitespace-pre-line text-[13px]
              text-white/75">{u.notes}</p>
          </details>
        )}
        <div className="mt-1 text-[11px] text-white/60">
          v{u.currentVersion} to v{u.latestVersion}
        </div>

        {/* Footer buttons - centered pill row like the Play Store */}
        <div className="mt-5 flex items-center justify-end gap-2">
          {!u.requiredUpdate && (
            <button onClick={onDismiss}
              className="rounded-full border border-white/30 px-5 py-2.5
                text-[13px] font-bold text-white/90">
              Learn more
            </button>
          )}
          <button onClick={onUpdate}
            className="rounded-full bg-[#A6C8FF] px-5 py-2.5 text-[13px]
              font-bold text-[#0E1116] hover:opacity-90">
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
