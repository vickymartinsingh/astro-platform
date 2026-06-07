import { useState } from 'react';
import {
  useAppUpdate, startUpdate, shouldShowPopup, dismissPopup,
} from '../lib/appUpdate';

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

function PlayIcon() {
  // The Google Play triangle, hand-drawn so we don't ship the logo
  // asset and run into trademark trouble. Same visual cue without
  // being a literal copy.
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
      <defs>
        <linearGradient id="pg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#00D4FF" />
          <stop offset=".5" stopColor="#33FF88" />
          <stop offset="1" stopColor="#FFCB05" />
        </linearGradient>
      </defs>
      <path fill="url(#pg)"
        d="M14 8c-1.7 0-3 1.3-3 3v42c0 1.7 1.3 3 3 3 .6 0 1.1-.2
        1.6-.5l30-21c1.1-.8 1.1-2.4 0-3.2l-30-21c-.5-.3-1-.5-1.6-.5z" />
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
  // Don't render at all when there's nothing to update or the admin
  // killed the popup setting OR the user already dismissed this build.
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
            shows star rating, size, age rating. */}
        <div className="mt-4 flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center
            overflow-hidden rounded-xl bg-amber-400">
            <svg viewBox="0 0 64 64" width="40" height="40">
              <circle cx="32" cy="32" r="26" fill="#1A0F0F" />
              <circle cx="32" cy="32" r="22" fill="none"
                stroke="#D4A12A" strokeWidth="2" />
              <circle cx="32" cy="22" r="3" fill="#D4A12A" />
              <path d="M22 38 L32 32 L42 38" stroke="#D4A12A"
                strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
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
          v{u.currentVersion} → v{u.latestVersion}
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
