import { useEffect, useState } from 'react';
import Link from 'next/link';
import { kundliService } from '@astro/shared';
import useScrollLock from '../lib/useScrollLock';

// Profile-selection prompt (2026-06-06 spec):
// "If the user is not already on a specific Kundli profile page, then
// the system must prompt the user to select a Kundli profile before
// proceeding. Selection step should include: Existing Kundli profiles
// list + Option to create a new Kundli profile (if needed)."
//
// Use as a controlled overlay:
//   <KundliPicker uid={uid} open onClose={} onPick={(profile) => ...} />
//
// Caller renders <KundliPicker open={...}> only when the click came
// from outside a specific profile. When the user is already viewing a
// single profile, skip the picker and call onPick directly with that
// profile.

export default function KundliPicker({ uid, open, onClose, onPick }) {
  useScrollLock(!!open);
  const [profiles, setProfiles] = useState(null);

  useEffect(() => {
    if (!open || !uid) return;
    setProfiles(null);
    kundliService.getKundliProfiles(uid)
      .then((list) => setProfiles(list || []))
      .catch(() => setProfiles([]));
  }, [open, uid]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2147483645] flex items-end
      justify-center bg-black/40 p-3 sm:items-center"
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2">
          <h3 className="text-base font-bold text-dark-text">
            Choose a Kundli profile
          </h3>
          <p className="mt-0.5 text-[11px] text-sub-text">
            Reports run against one profile at a time. Pick whose
            chart this is for, or create a new profile.
          </p>
        </div>

        {profiles === null ? (
          <div className="py-4 text-center text-sm text-sub-text">
            Loading profiles…
          </div>
        ) : profiles.length === 0 ? (
          <div className="rounded-card bg-bg-light p-3 text-sm
            text-sub-text">
            You don&apos;t have a kundli profile saved yet. Create one
            from the Kundli tab to continue.
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.slice().sort((a, b) =>
              (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
              .map((p) => (
              <button key={p.id} onClick={() => { onPick(p); onClose(); }}
                className="flex w-full items-start gap-2 rounded-2xl
                  border border-gray-200 p-3 text-left hover:bg-bg-light/40">
                <div className="grid h-9 w-9 shrink-0 place-items-center
                  rounded-full bg-primary/10 text-sm font-bold
                  text-primary">
                  {(p.name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-sm font-bold
                      text-dark-text">{p.name || '(unnamed)'}</div>
                    {p.isDefault && (
                      <span className="rounded-full bg-primary/15
                        px-1.5 py-0.5 text-[9px] font-bold
                        text-primary">default</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-sub-text">
                    {[p.dob, p.tob, p.pob || p.placeOfBirth]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="text-lg text-sub-text">›</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <Link href="/kundli" onClick={onClose}
            className="rounded-full border border-gray-200 px-4 py-2
              text-sm font-semibold text-primary hover:bg-bg-light">
            + Create new profile
          </Link>
          <button onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold
              text-sub-text hover:bg-bg-light">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
