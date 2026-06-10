import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { kundliService } from '@astro/shared';
import { useAuth } from '../lib/useAuth';
import useScrollLock from '../lib/useScrollLock';
import { DateField, TimeField, CityField } from './BirthInputs';

// One-shot onboarding popup that asks the new user for the birth
// details we need to generate their free Vedic kundli. Fires only:
//   - once per device (localStorage `birthOnboardingDone`)
//   - when the user has zero saved kundli profiles
//   - after the guided tour has been seen (localStorage `appTourDone`)
//
// User can either Save (creates the profile + routes to /kundli) or
// Close (we mark done so it never reappears - they can still create a
// profile manually from the side menu > Kundli).
//
// Mounted globally from Layout so it follows the user across pages
// the first time they land in the app post-signup.
const KEY = 'birthOnboardingDone';
const SESSION_KEY = 'birthOnboardingShownThisSession';

export default function BirthDetailsPopup() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    name: '', gender: '', dob: '', tob: '', ampm: 'AM',
    place: '', lat: null, lng: null, tz: null,
    country: '', state: '', city: '', countryCode: '',
  });

  // Decide whether to show. We poll lightweight conditions on auth
  // changes - never on every render. THIS USED TO REOPEN if `profile`
  // ticked (e.g. lastSeenAt updated by the presence service) while
  // the user was mid-edit. Reports came in of the popup reappearing
  // the moment they reached the Time of birth field. Fix:
  //   1. Persistent localStorage flag set the FIRST time we open so
  //      it never re-fires across reloads (was set only on save /
  //      close button).
  //   2. Session-scoped flag set on open so a mid-edit profile tick
  //      cannot re-trigger the effect.
  useEffect(() => {
    if (!user || !user.uid) { setOpen(false); return; }
    if (typeof window === 'undefined') return;
    let cancelled = false;
    try {
      if (window.localStorage.getItem(KEY) === '1') return;
      if (window.sessionStorage.getItem(SESSION_KEY) === '1') return;
      if (window.localStorage.getItem('appTourDone') !== '1') return;
    } catch (_) { /* private mode */ }
    // Only show if the user has no kundli profiles yet (so we don't
    // nag returning users who built one earlier).
    (async () => {
      try {
        const list = await kundliService.getKundliProfiles(user.uid);
        if (cancelled) return;
        if (Array.isArray(list) && list.length === 0) {
          setForm((f) => ({
            ...f,
            name: profile?.name || user.displayName || '',
            gender: profile?.gender || '',
            dob: profile?.dob || '',
          }));
          // Set BOTH flags the moment we decide to open so the
          // useEffect can never re-fire this popup in the same
          // session - even if profile changes mid-edit. The user
          // gets exactly one chance per device; if they dismiss
          // without saving they can rebuild from the side menu.
          try {
            window.localStorage.setItem(KEY, '1');
            window.sessionStorage.setItem(SESSION_KEY, '1');
          } catch (_) {}
          setOpen(true);
        }
      } catch (_) { /* tolerate */ }
    })();
    return () => { cancelled = true; };
  }, [user, profile]);

  function markDone() {
    try {
      window.localStorage.setItem(KEY, '1');
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch (_) {}
    setOpen(false);
  }

  async function save() {
    setErr('');
    if (!form.name.trim()) { setErr('Enter your name.'); return; }
    if (!form.gender) { setErr('Pick a gender.'); return; }
    if (!/^\d{2}-\d{2}-\d{4}$/.test(form.dob)) {
      setErr('Pick a date of birth.'); return;
    }
    if (!form.tob) { setErr('Pick a time of birth.'); return; }
    if (!form.place || form.lat == null || form.lng == null) {
      setErr('Pick a birth place from the suggestions.'); return;
    }
    setBusy(true);
    try {
      await kundliService.saveKundli(user.uid, {
        ...form, isDefault: true,
      });
      markDone();
      router.push('/kundli');
    } catch (e) {
      setErr((e && e.message) || 'Could not save. Try again.');
    } finally { setBusy(false); }
  }

  useScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2147483645] flex items-end
      justify-center bg-black/60 p-0 backdrop-blur-sm
      sm:items-center sm:p-4">
      <div className="relative w-full max-w-md overflow-hidden
        rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
        {/* Maroon -> Amber royal palette header (no purple) */}
        <div className="relative bg-gradient-to-br from-[#7F2020]
          to-[#D4A12A] p-5 text-white">
          <button onClick={markDone} aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8
              items-center justify-center rounded-full bg-white/20
              text-white hover:bg-white/30">
            ✕
          </button>
          <div className="text-[11px] font-bold uppercase
            tracking-widest opacity-90">Welcome to AstroSeer</div>
          <div className="mt-1 text-xl font-bold leading-snug">
            Get your free Vedic kundli
          </div>
          <p className="mt-1 text-sm opacity-90">
            Share your birth details once - we will draw your full
            chart, dashas, and yogas instantly. You can edit or
            delete this any time.
          </p>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {err && (
            <div className="rounded-card bg-rose-50 p-2 text-sm
              text-rose-700">{err}</div>
          )}
          <input className="input" placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            {['Male', 'Female', 'Other'].map((g) => (
              <button key={g} type="button"
                onClick={() => setForm({ ...form, gender: g })}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm
                  font-semibold transition
                  ${form.gender === g
                    ? 'border-[#7F2020] bg-[#7F2020] text-white'
                    : 'border-gray-200 bg-white text-sub-text'}`}>
                {g}
              </button>
            ))}
          </div>
          <DateField value={form.dob}
            onChange={(v) => setForm({ ...form, dob: v })}
            label="Date of birth" />
          <TimeField value={form.tob} ampm={form.ampm}
            onChange={(v, a) => setForm({ ...form, tob: v, ampm: a })}
            label="Time of birth" />
          <CityField value={form.place}
            onPick={(p) => setForm({ ...form, ...p })}
            label="Place of birth" />
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={markDone}
              className="flex-1 rounded-full border border-gray-300
                py-3 text-sm font-bold text-sub-text">
              Maybe later
            </button>
            <button type="button" onClick={save} disabled={busy}
              className="flex-1 rounded-full bg-[#7F2020] py-3
                text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Generate my kundli'}
            </button>
          </div>
          <p className="pt-1 text-center text-[10px] text-sub-text">
            Your birth data stays private. Only you can view your chart.
          </p>
        </div>
      </div>
    </div>
  );
}
