import { useEffect, useState } from 'react';
import Link from 'next/link';
import { kundliService, userService, db, vimshottari } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { DateField, TimeField, CityField } from '../components/BirthInputs';
import ZodiacGlyph from '../components/ZodiacGlyph';

// Form shape. lat/lng/tz are captured at place-pick time so the
// relay always has the right coordinates + timezone - fixes the
// silent "kundli with coordinates 0,0 / GMT+0" failure mode.
const EMPTY = { name: '', gender: '', dob: '', tob: '', ampm: 'AM',
  place: '', lat: null, lng: null, tz: null,
  country: '', state: '', city: '', countryCode: '',
  isDefault: false };

// Format DD-MM-YYYY as DD-Mmm-YYYY (e.g. 01-11-1995 -> 01-Nov-1995).
// Three-letter English month abbreviations - clearer than ambiguous
// numeric months (US 01-11 = 11 Jan vs IN 01-11 = 1 Nov).
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDateLong(s) {
  if (!s) return '';
  // Accept dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd.
  const m = String(s).match(
    /^(\d{4})-(\d{2})-(\d{2})|^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (!m) return s;
  let d; let mo; let y;
  if (m[1]) { y = m[1]; mo = m[2]; d = m[3]; }
  else { d = m[4]; mo = m[5]; y = m[6]; }
  const idx = Math.max(0, Math.min(11, Number(mo) - 1));
  return `${d}-${MONTH_ABBR[idx]}-${y}`;
}

export default function Kundli() {
  const { user, profile, loading } = useRequireClient();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null); // null = create
  const [toolUrl, setToolUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState({});   // { [kundliId]: data|'loading'|'err' }
  // One-profile-at-a-time UX: when /kundli loads we no longer dump
  // every saved profile into the page. Instead a picker modal opens
  // first and the user chooses (or adds new). After that, only the
  // chosen profile is rendered; "Choose another kundli" reopens the
  // picker. mode:
  //   'pick'  -> picker modal visible (default on first load when >0
  //              profiles exist)
  //   'view'  -> showing the picked profile + its full kundli
  //   'add'   -> showing the add/edit form (new or editing existing)
  const [mode, setMode] = useState('pick');
  const [selectedId, setSelectedId] = useState(null);
  // Inline picker list: search term + delete confirmation target.
  // pendingDelete holds the kundli the user clicked Delete on; the
  // confirm modal asks for explicit yes before remove() actually
  // fires, so a slip on the trash icon does not nuke a profile.
  const [pickerSearch, setPickerSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  // Wizard step for the add / edit form. 0..4 maps to:
  //   0 = name, 1 = gender, 2 = DOB, 3 = TOB, 4 = place. Resets to 0
  //   whenever the user enters add mode fresh; if they enter via Edit
  //   we jump straight to step 0 too (all fields are pre-filled, the
  //   user can advance with Next without re-typing).
  const [addStep, setAddStep] = useState(0);
  const ADD_STEPS = 5;

  async function viewFull(k) {
    setChart((c) => ({ ...c, [k.id]: 'loading' }));
    const data = await kundliService.getFullKundli(k);
    setChart((c) => ({ ...c, [k.id]: data || 'err' }));
  }

  async function refresh() {
    const l = await kundliService.getKundliProfiles(user.uid);
    setList(l);
    // Pre-cache the default profile's chart in the background so a
    // subsequent pick is instant. The picker modal still opens on
    // first load - we never auto-render a profile without consent.
    const def = l.find((k) => k.isDefault) || l[0];
    if (def) {
      setChart((c) => (c[def.id] ? c
        : { ...c, [def.id]: 'loading' }));
      kundliService.getFullKundli(def).then((data) => {
        setChart((c) => ({ ...c, [def.id]: data || 'err' }));
      });
    }
  }

  // Open the picker modal (no profile rendered).
  function openPicker() {
    setMode('pick');
    setSelectedId(null);
  }
  // Show ONLY the chosen profile + its full kundli.
  function pickProfile(k) {
    setSelectedId(k.id);
    setMode('view');
    if (!chart[k.id] || chart[k.id] === 'err') viewFull(k);
  }

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, name: profile?.name || '',
      gender: profile?.gender || f.gender || '' }));
    refresh();
    // Cached read - returns instantly from localStorage when the
    // config was fetched within the last 10 min. Drops 5 redundant
    // Firestore reads per /kundli mount.
    kundliService.readSettingsConfig().then((cfg) =>
      setToolUrl(cfg.kundliToolUrl || ''));
    // eslint-disable-next-line
  }, [user, profile]);

  // Once the saved-profile list resolves, decide which UX to show:
  //   no profiles -> straight to the add form
  //   profiles + nothing chosen yet -> picker stays open
  // We do this in an effect (not inside render) so React stays
  // happy and the picker doesn't flash for empty lists.
  useEffect(() => {
    if (list && list.length === 0 && mode === 'pick') {
      setMode('add');
    }
  }, [list, mode]);

  // Reset the add wizard back to step 0 every time the user enters
  // the add form, so a previous half-finished flow does not leave
  // them stranded on step 4.
  useEffect(() => {
    if (mode === 'add') setAddStep(0);
  }, [mode, editingId]);

  async function save(e) {
    e.preventDefault();
    // Hard gate: lat/lng/tz are MANDATORY. Without them AstroSeer
    // generates a kundli for (0,0) GMT+0 which is wrong on every
    // axis. The CityField captures these on selection from the
    // dropdown - if any are missing, the user typed a city but
    // never picked from the suggestions.
    const lat = form.lat != null ? Number(form.lat) : null;
    const lng = form.lng != null ? Number(form.lng) : null;
    const tz = form.tz != null ? Number(form.tz) : null;
    // Hard gates: DOB + TOB + place MUST be present. Previously the
    // form accepted an empty dob silently - the saved profile was
    // unusable downstream (chart fetch failed, the background auto-
    // gen relay calls 400'd, /orders stayed empty). Reject early
    // with an explicit message so the customer fixes it on the
    // spot rather than discovering it later.
    if (!form.name || !form.name.trim()) {
      window.alert('Please enter the name.');           // eslint-disable-line
      return;
    }
    if (!form.dob || !/^\d{2}-\d{2}-\d{4}$/.test(form.dob)) {
      window.alert('Please enter a valid date of birth ' // eslint-disable-line
        + '(dd/mm/yyyy).');
      return;
    }
    // Blank time of birth = "I don't know". Default to 12:00 PM so
    // the chart still generates. Only reject if the user typed a
    // value but it isn't a valid h:mm.
    if (!form.tob || !form.tob.trim()) {
      form.tob = '12:00';
      form.ampm = 'PM';
    } else if (!/^\d{1,2}:\d{2}$/.test(form.tob)) {
      window.alert('Please enter the time of birth as h:mm.'); // eslint-disable-line
      return;
    }
    if (!form.place || !form.place.trim()) {
      window.alert('Please enter the place of birth.'); // eslint-disable-line
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
        || !Number.isFinite(tz)) {
      // eslint-disable-next-line no-alert
      window.alert('Please pick the city from the suggestions list '
        + 'so we can lock the latitude, longitude and timezone - '
        + 'these are mandatory for an accurate kundli. Start typing '
        + 'the city again and choose from the dropdown.');
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await kundliService.updateKundli(user.uid, editingId, form);
        // Clear the cached chart for this profile so the user sees
        // fresh data the next time they tap View Full Kundli (the
        // service already drops report+reportSig from Firestore when
        // birth fields change).
        setChart((c) => ({ ...c, [editingId]: undefined }));
      } else {
        await kundliService.saveKundli(user.uid, form);
      }
      // If the customer picked their gender here (and it isn't already
      // on their account), also save it onto the user doc so it powers
      // the customer's avatar everywhere in the app.
      if (form.gender && form.gender !== (profile && profile.gender)) {
        try { await userService.updateUser(user.uid,
          { gender: form.gender }); } catch (_) {}
      }
      setForm({ ...EMPTY, name: profile?.name || '',
        gender: profile?.gender || form.gender || '' });
      const wasEditing = editingId;
      setEditingId(null);
      await refresh();
      // After saving from the add form, jump straight to the
      // single-profile view of the new (or edited) kundli so the
      // user doesn't land on an empty page. We re-fetch the list
      // and pick the matching record by name + dob since the
      // newly-created doc id isn't returned to us here.
      try {
        const l = await kundliService.getKundliProfiles(user.uid);
        const just = wasEditing
          ? l.find((x) => x.id === wasEditing)
          : l.find((x) => x.name === form.name && x.dob === form.dob);
        if (just) {
          setSelectedId(just.id);
          setMode('view');
          viewFull(just);
          // BACKGROUND AUTO-GENERATE the free kundli PDF the moment
          // the profile is saved. This now uses the Firestore-FREE
          // rescue path (deterministic orderId per profile) so it
          // works even when Firestore is at quota / unreachable.
          // By the time the customer taps View PDF / Download PDF,
          // the PDF is already cached at the deterministic R2 URL.
          try {
            kundliService.ensureKundliPdfReady(just)
              .catch(() => { /* swallow - best-effort */ });
          } catch (_) { /* swallow */ }
          // Also fire the original Firestore-driven flow when it's
          // working - the rescue path handles either side winning.
          try {
            kundliService.requestReport({
              uid: user.uid,
              kundliProfileId: just.id,
              kind: 'free',
              autoGenerated: true,
              skipEmail: true,
            }).catch(() => { /* swallow */ });
          } catch (_) { /* swallow */ }
          // ALSO pre-generate the paid reports for the same
          // profile (per user requirement 2026-05-28: 'for the
          // paid one as well the moment user enter the details
          // in the background api should generated all the kundli
          // and keep it ready in our astrology storage'). The
          // relay accepts prepayForAll:true to generate WITHOUT
          // debiting the wallet - it creates the order with
          // status:'prepaid'. When customer clicks Buy later,
          // the cache check finds the prepaid order, charges
          // the wallet, flips it to 'ready', and serves the
          // PDF instantly. Best-effort; failures are silent.
          try {
            ['forecast12', 'careerFinance', 'lifetime'].forEach(
              (k) => {
                kundliService.requestReport({
                  uid: user.uid,
                  kundliProfileId: just.id,
                  kind: k,
                  autoGenerated: true,
                  prepayForAll: true,
                  skipEmail: true,
                }).catch(() => { /* swallow */ });
              });
          } catch (_) { /* swallow */ }
        } else {
          setMode('pick');
        }
      } catch (_) { setMode('pick'); }
    } finally { setBusy(false); }
  }

  function edit(k) {
    setEditingId(k.id);
    setMode('add');
    setForm({
      name: k.name || '',
      gender: k.gender || profile?.gender || '',
      dob: k.dob || '',
      tob: k.tob || '',
      ampm: k.ampm || 'AM',
      place: k.place || '',
      // Carry locked location data across the edit if it exists.
      // Without lat/lng the CityField shows just the text and the
      // user has to re-pick from autocomplete to re-lock coords.
      lat: k.lat != null ? Number(k.lat) : null,
      lng: k.lng != null ? Number(k.lng) : null,
      tz: k.tz != null ? Number(k.tz) : null,
      country: k.country || '',
      state: k.state || '',
      city: k.city || '',
      countryCode: k.countryCode || '',
      isDefault: !!k.isDefault,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function cancelEdit() {
    setEditingId(null);
    setForm({ ...EMPTY, name: profile?.name || '',
      gender: profile?.gender || '' });
    setMode(list && list.length > 0 ? 'pick' : 'add');
  }

  async function makeDefault(id) {
    await kundliService.setDefaultKundli(user.uid, id);
    refresh();
  }
  // Stage a delete - opens the confirm modal. The actual irreversible
  // remove waits for confirmDelete() below. We also try to enrich
  // the staged kundli with its MOON SIGN (chandra rasi) so the modal
  // can show it instead of the DOB-derived sun zodiac. If the chart
  // hasn't been loaded yet for this kundli, we fall back to whatever
  // sign label the saved profile carries.
  function remove(k) {
    const c = chart[k.id];
    const moonSign = (c && typeof c === 'object')
      ? (c.chandra_rasi || c.moonSign
        || (c.raw && c.raw.moon_sign
          && (c.raw.moon_sign.name || c.raw.moon_sign))
        || '') : '';
    setPendingDelete({ ...k, moonSign: String(moonSign || '') });
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    if (selectedId === id) { setSelectedId(null); setMode('pick'); }
    try { await kundliService.deleteKundli(id); } catch (_) {}
    refresh();
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  // Pick the currently-displayed kundli (only rendered in 'view'
  // mode). Drives the FullKundli + the "Choose another" header.
  const selected = (list || []).find((k) => k.id === selectedId);

  return (
    <Layout>
      {/* Hero header. Shown ONLY on the picker (saved-profiles list)
          and the add / edit form. Hidden in 'view' mode once the
          customer has opened a kundli, so the chart itself gets the
          full screen. A small "Switch profile" chip still appears
          above the kundli card in view mode for navigation. */}
      {mode !== 'view' && (
      <div className="mb-3 overflow-hidden rounded-2xl
        bg-gradient-to-br from-[#7F2020] to-[#D4A12A] p-4 text-white
        shadow-md">
        <div className="text-[11px] font-bold uppercase tracking-widest
          opacity-90">Vedic Kundli</div>
        <div className="mt-1 text-2xl font-bold leading-tight">
          {mode === 'add'
            ? (editingId ? 'Edit your kundli' : 'New kundli profile')
            : mode === 'view' ? 'Your kundli chart'
              : 'Your saved profiles'}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed opacity-95">
          Birth chart, dashas, yogas and remedies - generated from your
          birth details. Free to view, premium PDFs available.
        </p>
        {/* Quick-action chips so the user can jump to the most common
            tasks without scrolling through the picker. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mode !== 'add' && (
            <button type="button"
              onClick={() => { setEditingId(null);
                setForm({ ...EMPTY, name: profile?.name || '',
                  gender: profile?.gender || '' });
                setMode('add'); }}
              className="rounded-full bg-white/20 px-3 py-1
                text-[10.5px] font-bold backdrop-blur-sm
                hover:bg-white/30">
              + Add new profile
            </button>
          )}
          {mode !== 'pick' && list && list.length > 0 && (
            <button type="button" onClick={openPicker}
              className="rounded-full bg-white/20 px-3 py-1
                text-[10.5px] font-bold backdrop-blur-sm
                hover:bg-white/30">
              ☰ Switch profile
            </button>
          )}
          {list && list.length > 0 && (
            <span className="rounded-full bg-white/15 px-3 py-1
              text-[10.5px] font-bold backdrop-blur-sm">
              {list.length} profile{list.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <h1 className="sr-only">
          {mode === 'add'
            ? (editingId ? 'Edit kundli' : 'Add new kundli')
            : mode === 'view' ? 'Kundli'
              : 'Kundli Profiles'}
        </h1>
        {/* Top-of-page action: jump back to the picker so the user
            can swap to a different saved profile without scrolling. */}
        {mode === 'view' && (
          <button type="button" onClick={openPicker}
            className="rounded-full bg-primary px-4 py-1.5
              text-[12px] font-bold text-white shadow-sm
              hover:opacity-90">
            Choose another kundli
          </button>
        )}
        {mode === 'add' && list && list.length > 0 && (
          <button type="button" onClick={openPicker}
            className="rounded-full bg-bg-light px-4 py-1.5
              text-[12px] font-bold text-sub-text">
            Cancel
          </button>
        )}
      </div>

      {/* INLINE picker - replaces the old modal. Lives directly in
          the kundli section as a search input + dashboard tile list.
          Each row has Edit + Delete chips next to it so the user does
          not have to drill into a separate "manage profiles" screen.
          Search filters by name / DOB / place so a list of dozens
          stays usable. Birth-details popup (from Layout) only fires
          when list.length is 0, so this UI only shows when there is
          at least one saved profile. */}
      {mode === 'pick' && list != null && list.length > 0 && (
        <div className="card mb-4">
          <div className="flex flex-wrap items-center justify-between
            gap-2">
            <div className="font-bold">Your saved kundlis</div>
            <button type="button"
              onClick={() => {
                setEditingId(null);
                setForm({ ...EMPTY, name: profile?.name || '',
                  gender: profile?.gender || '' });
                setMode('add');
              }}
              className="rounded-full bg-[#7F2020] px-3 py-1.5
                text-[12px] font-bold text-white hover:opacity-90">
              + Add new
            </button>
          </div>
          <input className="input mt-2"
            placeholder="Search by name…"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)} />
          <ul className="mt-2 divide-y divide-gray-100">
            {list.filter((k) => {
              // Name-only search per user request - simpler than the
              // earlier name/date/place fuzzy match. Case-insensitive
              // substring; empty query returns everything.
              const q = pickerSearch.trim().toLowerCase();
              if (!q) return true;
              return (k.name || '').toLowerCase().includes(q);
            }).map((k) => (
              <li key={k.id} className="overflow-hidden py-3">
                {/* min-w-0 must cascade ALL the way up the flex chain
                    or the inner truncate has nothing to truncate
                    against (the flex item grows to fit the unbroken
                    text and overflows its parent). Every ancestor in
                    the flex tree gets min-w-0 here. */}
                <button type="button"
                  onClick={() => pickProfile(k)}
                  className="flex w-full min-w-0 items-center gap-3
                    overflow-hidden text-left">
                  {(() => {
                    // Prefer the chart's MOON SIGN (chandra rasi) for
                    // the avatar glyph when we already have the chart
                    // loaded. Falls back to the saved sun zodiac for
                    // kundlis we haven't drawn yet, so the row always
                    // shows a sign.
                    const c = chart[k.id];
                    const moonSign = (c && typeof c === 'object')
                      ? (c.chandra_rasi || c.moonSign || '') : '';
                    const sign = moonSign || k.zodiac || '';
                    return (
                      <div className="grid h-12 w-12 shrink-0
                        place-items-center rounded-xl
                        bg-gradient-to-br from-[#7F2020]
                        to-[#D4A12A] text-white shadow-sm">
                        <ZodiacGlyph sign={sign}
                          className="h-7 w-7 fill-white" />
                      </div>
                    );
                  })()}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 truncate font-bold
                        text-dark-text">
                        {k.name || '(unnamed)'}
                      </div>
                      {k.isDefault && (
                        <span className="shrink-0 rounded-full
                          bg-[#7F2020]/10 px-1.5 py-0.5
                          text-[9px] font-bold uppercase
                          tracking-wider text-[#7F2020]">
                          Default
                        </span>
                      )}
                    </div>
                    {/* DOB+TOB on one line, place on its own line
                        below so a long city name does not push the
                        DOB into a truncation. */}
                    <div className="mt-0.5 truncate text-[11.5px]
                      text-sub-text">
                      {fmtDateLong(k.dob)} · {k.tob} {k.ampm || ''}
                    </div>
                    {k.place && (
                      <div className="truncate text-[11.5px]
                        text-sub-text">
                        {k.place}
                      </div>
                    )}
                  </div>
                </button>
                {/* Action chips - own row, full width, can't be hidden
                    by overflow. Big tap targets (~36px). Inline icons
                    so they read clearly even at small font sizes. */}
                <div className="mt-2 ml-[60px] grid grid-cols-3
                  gap-1.5">
                  <button type="button"
                    onClick={(e) => {
                      e.stopPropagation(); pickProfile(k);
                    }}
                    className="rounded-full bg-[#7F2020] px-2.5 py-1.5
                      text-[11px] font-bold text-white hover:opacity-90">
                    Open
                  </button>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); edit(k); }}
                    className="flex items-center justify-center gap-1
                      rounded-full bg-bg-light px-2.5 py-1.5
                      text-[11px] font-bold text-[#7F2020]
                      hover:bg-[#7F2020]/10">
                    <span aria-hidden>✎</span> Edit
                  </button>
                  <button type="button"
                    onClick={(e) => {
                      e.stopPropagation(); remove(k);
                    }}
                    className="flex items-center justify-center gap-1
                      rounded-full bg-rose-50 px-2.5 py-1.5
                      text-[11px] font-bold text-danger
                      hover:bg-rose-100">
                    <span aria-hidden>🗑</span> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {(() => {
            const q = pickerSearch.trim().toLowerCase();
            const filtered = list.filter((k) => !q
              || (k.name || '').toLowerCase().includes(q));
            if (filtered.length === 0) {
              return (
                <div className="rounded-card bg-bg-light p-3 text-center
                  text-sm text-sub-text">
                  No saved kundli matches that search.
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* If the user has zero profiles yet, send them straight to
          the add form so /kundli isn't an empty modal. The effect
          below switches mode out of 'pick' when list arrives empty. */}

      {/* EDIT mode = single full form. The wizard below is reserved
          for ADD. Users editing an existing kundli see every field
          at once so they can change just the bit they want without
          clicking Next four times. Time of birth defaults to 12:00
          PM when left blank ("I don't know" case). Submit becomes
          "Update". After save we drop straight back into the chart
          view of the just-edited kundli. */}
      {mode === 'add' && editingId && (
        <form onSubmit={save} className="card mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase
                tracking-widest text-sub-text">
                Edit
              </div>
              <div className="text-base font-bold text-dark-text">
                {form.name || 'Edit kundli'}
              </div>
            </div>
            <button type="button" onClick={cancelEdit}
              className="rounded-full bg-bg-light px-3 py-1
                text-[11px] font-bold text-sub-text">
              Cancel
            </button>
          </div>
          <label className="block text-sm">
            Name
            <input className="input mt-1" placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({
                ...form, name: e.target.value,
              })} required />
          </label>
          <div>
            <label className="block text-sm">Gender</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[['male', 'Male'], ['female', 'Female'],
                ['other', 'Other']].map(([v, l]) => (
                <button key={v} type="button"
                  onClick={() => setForm({ ...form, gender: v })}
                  className={`rounded-xl border px-3 py-2.5 text-sm
                    font-bold transition
                    ${form.gender === v
                      ? 'border-[#7F2020] bg-[#7F2020] text-white'
                      : 'border-gray-200 bg-white text-sub-text'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            Date of birth
            <div className="mt-1">
              <DateField value={form.dob}
                onChange={(dob) => setForm({ ...form, dob })} />
            </div>
          </label>
          <label className="block text-sm">
            Time of birth
            <div className="mt-1">
              <TimeField value={form.tob} ampm={form.ampm}
                onChange={(tob, ampm) =>
                  setForm({ ...form, tob, ampm })} />
            </div>
            <p className="mt-1 text-[11px] text-sub-text">
              Don&apos;t know the exact time? Leave blank - we
              will use 12:00 PM.
            </p>
          </label>
          <label className="block text-sm">
            Place of birth
            <div className="mt-1">
              <CityField
                value={form.lat ? {
                  place: form.place, lat: form.lat,
                  lng: form.lng, tz: form.tz,
                  country: form.country, state: form.state,
                  city: form.city,
                  countryCode: form.countryCode,
                  label: form.place,
                } : form.place}
                onChange={(loc) => setForm((f) => ({
                  ...f,
                  place: loc.place || '',
                  lat: loc.lat != null ? loc.lat : null,
                  lng: loc.lng != null ? loc.lng : null,
                  tz: loc.tz != null ? loc.tz : null,
                  country: loc.country || '',
                  state: loc.state || '',
                  city: loc.city || '',
                  countryCode: loc.countryCode || '',
                }))} />
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isDefault}
              onChange={(e) =>
                setForm({ ...form, isDefault: e.target.checked })} />
            Set as default profile
          </label>
          <button className="w-full rounded-full
            bg-gradient-to-br from-[#7F2020] to-[#D4A12A] py-2.5
            text-sm font-bold text-white shadow-sm
            disabled:opacity-50"
            disabled={busy}>
            {busy ? 'Updating…' : 'Update'}
          </button>
        </form>
      )}
      {mode === 'add' && !editingId && (() => {
        // Per-step validation. Returns false to block the Next button.
        const stepOk = (() => {
          if (addStep === 0) return form.name.trim().length > 0;
          if (addStep === 1) return !!form.gender;
          if (addStep === 2) return /^\d{2}-\d{2}-\d{4}$/.test(form.dob);
          if (addStep === 3) return !!form.tob;
          if (addStep === 4) return !!form.place && form.lat != null;
          return true;
        })();
        const isLast = addStep === ADD_STEPS - 1;
        const STEP_LABELS = ['Name', 'Gender', 'Date of birth',
          'Time of birth', 'Place of birth'];
        return (
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!stepOk) return;
            if (isLast) { save(e); return; }
            setAddStep((s) => Math.min(ADD_STEPS - 1, s + 1));
          }} className="card mb-4 space-y-4">
            {/* Wizard header: step counter + progress bar. The user
                sees "Step 2 of 5" and a maroon-amber fill bar that
                grows as they advance, so each Next click feels like
                visible progress. */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase
                  tracking-widest text-sub-text">
                  Step {addStep + 1} of {ADD_STEPS}
                </div>
                <div className="text-base font-bold text-dark-text">
                  {STEP_LABELS[addStep]}
                </div>
              </div>
              <button type="button" onClick={cancelEdit}
                className="rounded-full bg-bg-light px-3 py-1
                  text-[11px] font-bold text-sub-text">
                Cancel
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full
              bg-bg-light">
              <div className="h-full rounded-full
                bg-gradient-to-r from-[#7F2020] to-[#D4A12A]
                transition-all"
                style={{ width: `${((addStep + 1) / ADD_STEPS) * 100}%` }} />
            </div>

            {/* STEP CONTENTS - only one renders at a time so the
                customer never sees a wall of fields. */}
            {addStep === 0 && (
              <div>
                <label className="block text-sm text-sub-text">
                  Whose kundli are we making?
                </label>
                <input className="input mt-2"
                  placeholder="Full name" value={form.name} autoFocus
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })} />
              </div>
            )}
            {addStep === 1 && (
              <div>
                <label className="block text-sm text-sub-text">
                  Pick a gender (used for kundli matching and
                  prediction tone).
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[['male', 'Male'], ['female', 'Female'],
                    ['other', 'Other']].map(([v, l]) => (
                    <button key={v} type="button"
                      onClick={() => setForm({ ...form, gender: v })}
                      className={`rounded-xl border px-3 py-2.5
                        text-sm font-bold transition
                        ${form.gender === v
                          ? 'border-[#7F2020] bg-[#7F2020] text-white'
                          : 'border-gray-200 bg-white text-sub-text'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {addStep === 2 && (
              <div>
                <label className="block text-sm text-sub-text">
                  Pick the date of birth.
                </label>
                <div className="mt-2">
                  <DateField value={form.dob}
                    onChange={(dob) => setForm({ ...form, dob })} />
                </div>
              </div>
            )}
            {addStep === 3 && (
              <div>
                <label className="block text-sm text-sub-text">
                  Enter the time of birth and confirm AM / PM.
                </label>
                <div className="mt-2">
                  <TimeField value={form.tob} ampm={form.ampm}
                    onChange={(tob, ampm) =>
                      setForm({ ...form, tob, ampm })} />
                </div>
              </div>
            )}
            {addStep === 4 && (
              <div>
                <label className="block text-sm text-sub-text">
                  Pick the city of birth. Coordinates auto-lock.
                </label>
                <div className="mt-2">
                  <CityField
                    value={form.lat ? {
                      place: form.place, lat: form.lat,
                      lng: form.lng, tz: form.tz,
                      country: form.country, state: form.state,
                      city: form.city,
                      countryCode: form.countryCode,
                      label: form.place,
                    } : form.place}
                    onChange={(loc) => setForm((f) => ({
                      ...f,
                      place: loc.place || '',
                      lat: loc.lat != null ? loc.lat : null,
                      lng: loc.lng != null ? loc.lng : null,
                      tz: loc.tz != null ? loc.tz : null,
                      country: loc.country || '',
                      state: loc.state || '',
                      city: loc.city || '',
                      countryCode: loc.countryCode || '',
                    }))} />
                </div>
                <label className="mt-3 flex items-center gap-2
                  text-sm">
                  <input type="checkbox" checked={form.isDefault}
                    onChange={(e) =>
                      setForm({
                        ...form, isDefault: e.target.checked,
                      })} />
                  Set as default profile (auto-shared at session
                  start)
                </label>
              </div>
            )}

            {/* Nav buttons - Back is hidden on the first step so the
                customer never sees a dead button. */}
            <div className="flex gap-2 pt-1">
              {addStep > 0 && (
                <button type="button"
                  onClick={() => setAddStep((s) => Math.max(0, s - 1))}
                  className="flex-1 rounded-full border
                    border-gray-300 py-2.5 text-sm font-bold
                    text-sub-text">
                  Back
                </button>
              )}
              <button className="flex-1 rounded-full
                bg-gradient-to-br from-[#7F2020] to-[#D4A12A]
                py-2.5 text-sm font-bold text-white shadow-sm
                disabled:opacity-50"
                disabled={busy || !stepOk}>
                {busy ? 'Saving…' : isLast
                  ? (editingId ? 'Save changes' : 'Generate kundli')
                  : 'Next'}
              </button>
            </div>
          </form>
        );
      })()}

      {/* Single-profile view. Renders ONLY the selected kundli; no
          other saved profile is visible until the user reopens the
          picker via "Choose another kundli". */}
      {mode === 'view' && selected && (
        <div className="space-y-2">
          <div key={selected.id} className="card">
            <div className="flex items-center justify-between">
              <div className="font-semibold">
                {selected.name}{' '}
                {selected.isDefault && (
                  <span className="badge bg-bg-light text-primary">
                    Default
                  </span>
                )}
              </div>
              {/* Was `k.zodiac` (sun sign by DOB). Per product:
                  zodiac sign belongs only on /horoscope; on the
                  kundli card we leave the chip blank and let the
                  Overview tab inside FullKundli show Moon + Sun
                  signs in their proper place. */}
            </div>
            {/* DOB+TOB on line 1, place on line 2 - so a long city
                name does not push other info into a truncation. */}
            <div className="mt-1 text-sm text-sub-text">
              {fmtDateLong(selected.dob)} · {selected.tob}{' '}
              {selected.ampm}
            </div>
            {selected.place && (
              <div className="text-sm text-sub-text">
                {selected.place}
              </div>
            )}
            {/* Action bar removed - the user requested it not show
                above the selected chart. All actions (refresh, edit,
                make default, delete) now live in the inline kundli
                picker list rows, where each profile carries its own
                action chips next to it. The "Switch profile" chip
                in the hero header takes the user back to the list. */}
            {chart[selected.id] === 'loading' && (
              <div className="mt-2 text-sm text-sub-text">
                Generating kundli…
              </div>
            )}
            {chart[selected.id] === 'err' && (
              <div className="mt-2 flex flex-wrap items-center gap-2
                              text-sm text-danger">
                <span>
                  Could not load the chart right now. The kundli
                  service may be waking up. Please try again in a
                  moment.
                </span>
                <button type="button"
                  onClick={() => viewFull(selected)}
                  className="rounded-full border border-danger px-3
                    py-1 text-xs font-bold text-danger">
                  Retry
                </button>
              </div>
            )}
            {chart[selected.id]
              && typeof chart[selected.id] === 'object' && (
              <FullKundli r={chart[selected.id]} kundli={selected} />
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation. Royal-palette card with a clear warning
          message + two buttons: Cancel (default) and Delete (danger).
          Esc / backdrop click both cancel safely. Always CENTERED on
          every viewport (was sliding up from the bottom on mobile,
          which the user did not want). */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[2147483645] flex items-center
          justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) {
            setPendingDelete(null);
          } }}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl
            bg-white shadow-2xl">
            <div className="bg-gradient-to-br from-[#7F2020]
              to-[#D4A12A] p-4 text-center text-white">
              <div className="text-lg font-bold leading-snug">
                Are you sure?
              </div>
            </div>
            <div className="space-y-3 p-4">
              {/* Identity card so the user can visually confirm they
                  are deleting the right profile - avatar + birth
                  meta laid out as labeled rows. Helps when there are
                  several similarly-named kundlis. */}
              <div className="flex items-center gap-3 rounded-card
                bg-bg-light p-3">
                <div className="grid h-12 w-12 shrink-0
                  place-items-center rounded-xl
                  bg-gradient-to-br from-[#7F2020] to-[#D4A12A]
                  text-white shadow-sm">
                  {/* Glyph draws the MOON SIGN only - we never
                      substitute the sun zodiac and pretend it is
                      the moon sign. If moon data isn't loaded the
                      avatar shows a neutral kundli icon instead. */}
                  {pendingDelete.moonSign ? (
                    <ZodiacGlyph sign={pendingDelete.moonSign}
                      className="h-7 w-7 fill-white" />
                  ) : (
                    <span className="text-[22px]">☸</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-[12.5px]
                  leading-relaxed">
                  {/* Name on top so the user reads "who" before the
                      meta. The avatar glyph to the left already IS
                      the moon-sign signal - we drop the textual
                      "Moon sign: X" label to keep the card lean. */}
                  <div className="truncate text-[14px] font-bold
                    text-dark-text">
                    {pendingDelete.name || '(unnamed)'}
                  </div>
                  <div className="text-sub-text">
                    <b>Born:</b>{' '}
                    {fmtDateLong(pendingDelete.dob)} ·{' '}
                    {pendingDelete.tob} {pendingDelete.ampm || ''}
                  </div>
                  {pendingDelete.place && (
                    <div className="truncate text-sub-text">
                      <b>Place:</b> {pendingDelete.place}
                    </div>
                  )}
                  {pendingDelete.isDefault && (
                    <div className="mt-1 inline-block rounded-full
                      bg-[#7F2020]/10 px-2 py-0.5 text-[10px]
                      font-bold uppercase tracking-wider
                      text-[#7F2020]">
                      Currently default
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[12.5px] text-sub-text
                leading-relaxed">
                Once you delete this kundli, it cannot be undone.
                However, you can add a new profile any time for
                free by just tapping <b>+ Add new</b> on the
                kundli page.
              </p>
              <div className="flex gap-2 pt-1">
                <button type="button"
                  onClick={() => setPendingDelete(null)}
                  className="flex-1 rounded-full border border-gray-300
                    py-2.5 text-sm font-bold text-sub-text">
                  Cancel
                </button>
                <button type="button"
                  onClick={confirmDelete}
                  className="flex-1 rounded-full bg-danger py-2.5
                    text-sm font-bold text-white hover:opacity-90">
                  Yes, remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

// Brand banner header used at the top of every boxed section.
// Inline brand-gradient (purple) - never yellow, even if a stale
// Tailwind purge / CDN cache strips bg-primary.
function Banner({ title, sub }) {
  return (
    <div className="mt-3 rounded-card py-2 text-center"
      style={{
        background: 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)',
      }}>
      <div className="text-sm font-bold text-white">{title}</div>
      {sub && (
        <div className="mt-0.5 text-[11px] font-semibold text-white/80">
          {sub}
        </div>
      )}
    </div>
  );
}

// AstroSeer / AstroTalk-style providers sometimes return rich
// objects for fields the UI expects to be scalars (e.g. nakshatra
// arrives as `{ name, lord, number, pada }`, sign_lord arrives as
// `{ name, vedic_name }`). Rendering an object directly is the
// classic React error #31. txt() coerces any of these into the
// best human-readable string before they hit JSX.
function txt(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number'
    || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map(txt).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') {
    return String(v.name || v.title || v.label || v.vedic_name
      || v.value || v.id || v.lord || '');
  }
  return '';
}

// Legacy small-header section used inside cards; left as-is for the
// existing tabs (transits / yogas / doshas etc) that haven't been
// restyled yet.
// Picker modal - shown on /kundli load when the user has at least
// one saved profile. Brand maroon header strip, polished cards,
// dismissable via × button OR clicking outside the panel. List is
// scrollable for power users with many saved profiles. The "Add
// new" CTA at the bottom is the only entry point to the form so
// the picker is the single source of truth for kundli switching.
function KundliPickerModal({ list, onPick, onAddNew, onClose }) {
  return (
    <div
      onClick={onClose
        ? (e) => { if (e.target === e.currentTarget) onClose(); }
        : undefined}
      className="fixed inset-0 z-[60] flex items-end justify-center
        bg-black/50 px-3 py-4 sm:items-center"
      role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
        bg-white shadow-2xl"
        style={{
          border: '2px solid #7F2020',
          boxShadow: '0 20px 50px rgba(127,32,32,.25)',
        }}>
        {/* Brand header - maroon gradient strip with title +
            saved-count chip + close button. The close button is
            ALWAYS shown (was previously gated behind a "canClose"
            prop that hid it on first-load - that's the wrong
            default; the user must always be able to dismiss). */}
        <div className="flex items-center justify-between gap-2
          px-4 py-3 text-white"
          style={{
            background: 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)',
          }}>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em]
              opacity-80">AstroSeer</div>
            <div className="text-base font-bold">
              Choose a kundli to open
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/15 px-2 py-0.5
              text-[10px] font-bold">
              {list.length} saved
            </span>
            {onClose && (
              <button type="button" onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center
                  rounded-full bg-white text-lg font-bold
                  shadow-sm hover:bg-bg-light"
                style={{ color: '#7F2020' }}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* Saved profiles list. Maroon left border on the default
            profile + a quiet "DEFAULT" chip flag it. Hover state
            uses brand maroon outline so it reads as a primary CTA
            even before click. */}
        {/* Saved profiles list - dashboard tile style. Each card now
            shows a zodiac glyph avatar (computed from DOB), the name,
            zodiac sign, and the birth meta as soft chips. Bigger tap
            target (min ~88px tall), clearer visual hierarchy. The
            default profile gets a maroon left rail + tinted badge. */}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
          {list.map((k) => (
            <button key={k.id} type="button"
              onClick={() => onPick(k)}
              className={`flex w-full items-center gap-3 rounded-2xl
                border bg-white p-3 text-left transition
                active:scale-[0.98] hover:border-[#7F2020]
                hover:shadow-md ${k.isDefault
                  ? 'border-l-4 border-l-[#7F2020] border-[#7F2020]/30'
                  : 'border-gray-200'}`}>
              {/* Royal-palette zodiac avatar so the profile is
                  visually identifiable at a glance (vs reading text). */}
              <div className="grid h-14 w-14 shrink-0 place-items-center
                rounded-xl bg-gradient-to-br from-[#7F2020]
                to-[#D4A12A] text-white shadow-sm">
                <ZodiacGlyph sign={k.zodiac || ''}
                  className="h-8 w-8 fill-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between
                  gap-2">
                  <div className="truncate text-[14px] font-bold
                    text-dark-text">
                    {k.name || '(unnamed)'}
                  </div>
                  {k.isDefault && (
                    <span className="shrink-0 rounded-full
                      bg-[#7F2020]/10 px-2 py-0.5 text-[9.5px]
                      font-bold uppercase tracking-wider
                      text-[#7F2020]">
                      Default
                    </span>
                  )}
                </div>
                {k.zodiac && (
                  <div className="mt-0.5 text-[11px] font-semibold
                    text-[#7F2020]">
                    {k.zodiac}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center
                  gap-1 text-[10.5px] text-sub-text">
                  {k.dob && (
                    <span className="rounded-full bg-bg-light
                      px-1.5 py-0.5">{k.dob}</span>
                  )}
                  {k.tob && (
                    <span className="rounded-full bg-bg-light
                      px-1.5 py-0.5">{k.tob} {k.ampm || ''}</span>
                  )}
                  {k.place && (
                    <span className="truncate rounded-full
                      bg-bg-light px-1.5 py-0.5">{k.place}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-[18px] text-sub-text">
                ›
              </div>
            </button>
          ))}
        </div>

        {/* CTA footer. Inline Royal brand gradient (Amber
            #D4A12A -> Rust #B45309 -> Maroon #7F2020) so even a
            stale Tailwind purge or CDN cache can never ship this
            in a non-brand colour. No purple, no flat yellow. */}
        <div className="border-t border-gray-100 p-3">
          <button type="button" onClick={onAddNew}
            className="w-full rounded-full py-2.5 text-sm
              font-bold text-white shadow-sm hover:opacity-90"
            style={{
              background:
                'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)',
            }}>
            + Add new kundli
          </button>
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

// "Connect with an Astrologer..." CTA strip. Inline brand
// gradient so it never falls back to a yellow Tailwind class.
function TalkChatCTA() {
  return (
    <div className="mt-4 rounded-card p-3 text-center"
      style={{
        background: 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)',
      }}>
      <div className="mb-2 text-[12px] font-semibold text-white">
        Connect with an Astrologer on Call or Chat for more
        personalised detailed predictions.
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/astrologers?mode=call"
          className="inline-flex items-center gap-1.5 rounded-full
            bg-white px-4 py-1.5 text-xs font-bold text-primary
            shadow-sm">
          <span>📞</span> Talk to Astrologer
        </Link>
        <Link href="/astrologers?mode=chat"
          className="inline-flex items-center gap-1.5 rounded-full
            bg-white px-4 py-1.5 text-xs font-bold text-primary
            shadow-sm">
          <span>💬</span> Chat with Astrologer
        </Link>
      </div>
    </div>
  );
}

// "Download & share your kundli report" dark banner the reference
// places at the bottom of each tab. Wires straight to the same
// download path the Reports section uses.
function DownloadBanner({ kundli, full }) {
  return (
    <button type="button"
      onClick={() => kundliService.downloadKundliReport(
        kundli || {}, full || {})}
      className="mt-3 flex w-full items-center gap-3 rounded-card
        bg-gradient-to-r from-[#0F0A23] to-[#1A1245] p-4 text-left
        text-white shadow">
      <div className="grid h-12 w-12 shrink-0 place-items-center
        rounded-full bg-primary/15 text-2xl">📜</div>
      <div className="flex-1">
        <div className="text-sm font-bold">
          Download &amp; share your kundli report
        </div>
        <span className="mt-1 inline-block rounded-full bg-primary
          px-3 py-1 text-[11px] font-bold text-dark-text">
          Download Kundli PDF
        </span>
      </div>
    </button>
  );
}

// Collapsible Maha-dasha row with nested Antar -> Pratyantar.
// Current period (any level) is always expanded + highlighted; the
// rest collapse so the list of 9 mahas stays scannable.
// Generic per-house indication. Combined with the dasha lord's
// karakatva, this powers the per-period "Likely areas" text in
// DashaRow / AntarRow when the admin toggle is on.
const HOUSE_THEMES = {
  1: 'self, body, vitality, identity',
  2: 'wealth, family, speech, savings',
  3: 'siblings, courage, short trips, communication',
  4: 'home, mother, comfort, real estate',
  5: 'children, romance, learning, creativity',
  6: 'work, debts, health, competition',
  7: 'marriage, partnerships, business deals',
  8: 'transformation, occult, joint finances',
  9: 'fortune, dharma, long trips, mentors',
  10: 'career, status, public reputation',
  11: 'gains, network, elder siblings, ambitions',
  12: 'foreign lands, retreat, expenses, moksha',
};
const PLANET_KARAKA = {
  Sun: 'authority, government, father, vitality',
  Moon: 'mind, mother, emotions, public',
  Mars: 'energy, courage, property, siblings',
  Mercury: 'communication, study, business, skill',
  Jupiter: 'wisdom, finances, teachers, children',
  Venus: 'love, comfort, art, partners, beauty',
  Saturn: 'discipline, work, longevity, structure',
  Rahu: 'foreign, technology, sudden gains, obsession',
  Ketu: 'detachment, spirituality, research, losses',
};
function dashaInsight(lord, planetsArr) {
  const planet = (planetsArr || []).find((p) =>
    String(p.name || '').toLowerCase()
      === String(lord || '').toLowerCase());
  const house = planet && Number(planet.house);
  const k = PLANET_KARAKA[lord] || '';
  const h = house >= 1 && house <= 12 ? HOUSE_THEMES[house] : '';
  if (!k && !h) return '';
  if (k && h) {
    return `${lord} (${k}) sits in house ${house} (${h}). The period `
      + `activates these areas - expect themes here to surface.`;
  }
  return k || `House ${house}: ${h}.`;
}

function DashaRow({ d, planets, showInsight }) {
  const [open, setOpen] = useState(!!d.current);
  const has = (d.antardasha || []).length > 0;
  const insight = showInsight ? dashaInsight(d.planet, planets) : '';
  return (
    <div className={`rounded-card border p-2 text-xs ${d.current
      ? 'border-primary/40 bg-primary/5'
      : 'border-gray-200 bg-white'}`}>
      <button type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
                    text-left">
        <span className={`flex items-center gap-2 font-semibold
          ${d.current ? 'text-primary' : ''}`}>
          <span className={`inline-block w-3 text-center
              transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {d.planet}
          {d.current && (
            <span className="rounded-full bg-primary px-2 py-0.5
                              text-[10px] font-bold text-white">
              current
            </span>
          )}
        </span>
        <span className="shrink-0 text-sub-text">
          {String(d.start || '').slice(0, 10)} to{' '}
          {String(d.end || '').slice(0, 10)}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
          {insight && (
            <div className="rounded-card bg-bg-light p-2 text-[11px]
              leading-relaxed text-dark-text">
              <b className="text-primary">Likely areas:</b>{' '}
              {insight}
            </div>
          )}
          {has ? d.antardasha.map((a, j) => (
            <AntarRow key={j} a={a} parentCurrent={!!d.current}
              planets={planets} showInsight={showInsight} />
          )) : (
            <div className="text-[11px] text-sub-text">
              No antardasha breakdown returned by the provider.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AntarRow({ a, parentCurrent, planets, showInsight }) {
  const [open, setOpen] = useState(!!a.current);
  const has = (a.pratyantardasha || []).length > 0;
  const insight = showInsight ? dashaInsight(a.planet, planets) : '';
  return (
    <div className={`rounded p-1.5 text-[11px] ${a.current
      ? 'bg-primary/10 font-semibold text-primary'
      : parentCurrent ? '' : 'text-sub-text'}`}>
      <button type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
                    text-left">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2.5 text-center
              transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {a.planet}
          {a.current && (
            <span className="rounded-full bg-primary px-1.5 py-0.5
                              text-[9px] font-bold text-white">
              now
            </span>
          )}
        </span>
        <span className="shrink-0">
          {String(a.start || '').slice(0, 10)} to{' '}
          {String(a.end || '').slice(0, 10)}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 border-t border-primary/10 pt-1
                         pl-4">
          {insight && (
            <div className="rounded bg-white p-1.5 text-[10.5px]
              leading-relaxed text-dark-text">
              <b className="text-primary">Sub-period:</b> {insight}
            </div>
          )}
          {has ? a.pratyantardasha.map((p, k) => (
            <div key={k}
              className={`flex justify-between ${p.current
                ? 'font-bold text-accent' : 'text-sub-text'}`}>
              <span>{p.planet}{p.current ? ' · now' : ''}</span>
              <span>
                {String(p.start || '').slice(0, 10)} to{' '}
                {String(p.end || '').slice(0, 10)}
              </span>
            </div>
          )) : (
            <div className="text-[10.5px] text-sub-text">
              No pratyantar breakdown for this antardasha.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FullKundli({ r, kundli }) {
  const [tab, setTab] = useState('overview');
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  const raw = r.raw || {};
  // Admin can hide the per-period "Likely areas" insight text via
  // settings/features.dasha_predictions_enabled. Default = on. We
  // stamp the resolved value onto r._showDashaInsight so the deeply-
  // nested DashaRow / AntarRow components don't need to thread an
  // extra prop manually.
  const [showInsight, setShowInsight] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'features'));
        const v = s.exists() && s.data().dasha_predictions_enabled;
        if (v === false) setShowInsight(false);
      } catch (_) { /* keep default */ }
    })();
  }, []);
  // eslint-disable-next-line no-param-reassign
  r._showDashaInsight = showInsight;
  // Read user's preferred chart style. Stored on users/{uid}.
  // .chartStyle: 'north' | 'south'. Default = north.
  const [chartStyle, setChartStyle] = useState('north');
  useEffect(() => {
    (async () => {
      try {
        const uid = kundli && kundli.userId;
        if (!uid) return;
        const u = await getDoc(doc(db, 'users', uid));
        const s = u.exists() && u.data().chartStyle;
        if (s === 'north' || s === 'south') setChartStyle(s);
      } catch (_) { /* keep default */ }
    })();
  }, [kundli]);
  async function saveChartStyle(s) {
    setChartStyle(s);
    try {
      const uid = kundli && kundli.userId;
      if (!uid) return;
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'users', uid), { chartStyle: s });
    } catch (_) { /* best effort */ }
  }

  // Seven top-level tabs that mirror the AstroTalk reference exactly.
  // Older tabs (transits / yogas / doshas / compat / numerology) are
  // folded into the relevant new tab as a sub-section so nothing is
  // lost - just reorganised to match the reference layout.
  // Labels kept SHORT (single word) so every tab fits on one line
  // at the same height across the 4-column phone grid.
  const TABS = [
    ['basic', 'Basic'],
    ['kundli', 'Kundli'],
    ['kp', 'KP'],
    ['ashtakvarga', 'AV'],
    ['charts', 'Charts'],
    ['dasha', 'Dasha'],
    ['freeReport', 'Report'],
    // NEW (user-requested): a dashboard tab listing every paid
    // kundli report with a monochrome icon, demo link, and buy CTA.
    ['premium', 'Premium'],
  ];

  // Coerce older saved tab keys to the new schema so the bookmarked
  // ?tab=overview keeps working after the rename.
  const ALIAS = {
    overview: 'basic', chart: 'kundli', planets: 'kundli',
    transits: 'kundli', yogas: 'kundli', doshas: 'kundli',
    panchang: 'basic', compat: 'freeReport', nav: 'freeReport',
  };
  const activeTab = ALIAS[tab] || tab;

  return (
    <div className="mt-3 rounded-card bg-bg-light p-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">Your Vedic Kundli</div>
        <span className="text-[11px] text-sub-text">
          {r.cached ? 'Saved report' : 'Newly generated'}
        </span>
      </div>
      {/* The old ReportButtons row (Janma Kundli + 12-Month + Career +
          Lifetime buy pills) used to render here, ABOVE the tabs.
          Removed because it duplicated the Premium Reports tab and
          confused the layout. Premium reports now have their own
          dedicated tab; the free PDF lives at the top of Free Report. */}

      {/* Pill tabs - mobile-first WRAPPING grid instead of a horizontal
          scroller. On phone all 8 tabs are visible at once (4 per row),
          so the user does not have to swipe sideways to see "Premium
          Reports". On desktop they collapse into one row. The native
          scrollbar that was appearing on mobile is gone. */}
      {/* All tabs share the SAME height + are vertically centred so
          the selected pill never looks taller than the others. Two
          rows of 4 on phone; flow-wraps to a single row on sm+. */}
      <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-2xl
        bg-white p-1.5 shadow-sm sm:flex sm:flex-wrap">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex h-10 items-center justify-center
              rounded-xl px-2 text-center text-[12px] font-bold
              leading-none transition sm:h-11 sm:px-4
              sm:text-[13px] ${activeTab === k
                ? 'bg-[#7F2020] text-white shadow-sm'
                : 'bg-bg-light text-sub-text hover:text-dark-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'basic' && (
        <BasicTab r={r} raw={raw} kundli={kundli} />
      )}
      {activeTab === 'kundli' && (
        <KundliMainTab r={r} raw={raw} kundli={kundli}
          chartStyle={chartStyle} onChangeStyle={saveChartStyle} />
      )}
      {activeTab === 'kp' && <KpTab r={r} raw={raw} />}
      {activeTab === 'ashtakvarga' && (
        <AshtakvargaTab r={r} raw={raw} />
      )}
      {activeTab === 'charts' && (
        <ChartsGridTab r={r} raw={raw} chartStyle={chartStyle} />
      )}
      {activeTab === 'dasha' && <DashaTab r={r} />}
      {activeTab === 'freeReport' && (
        <FreeReportTab r={r} n={n} lucky={lucky} kundli={kundli} />
      )}
      {activeTab === 'premium' && (
        <PremiumReportsTab kundli={kundli} />
      )}

      {/* Removed: the "Connect with an Astrologer" CTA strip - the
          user did not want it under every tab. */}
      {/* Download banner intentionally NOT rendered globally any more.
          It now lives at the bottom of the Free Report tab (relocated
          per user request) so it is not duplicated under every other
          tab's content. */}
    </div>
  );
}

// =====================================================================
// AstroTalk-style tabs. Mirror the user's reference screenshots:
//   Basic | Kundli | KP | Ashtakvarga | Charts | Dasha | Free Report
// Each tab opens with a yellow banner header, content in clean rows,
// and the CTA + download banner appear underneath via the shell.
// =====================================================================

// ---------- Tab: Basic --------------------------------------------
// Three boxed tables: Basic Details, Avakhada Details, Panchang Details.
// Mirrors User-kundali-report.pdf p.2 + p.3 layout.
function BasicTab({ r, raw, kundli }) {
  // Robust ascendant resolution - check every shape AstroSeer + its
  // adapters might return. Without this fallback the row falls back
  // to "·" silently and the user does not see the Lagna even though
  // we asked for it. Mirrors planetsWithAscendant() below.
  const ascFromPlanets = (r.planets || []).find((x) => /asc|lagna|ascend/i
    .test(String(x.name || '')));
  const a = r.ascendant
    || r.lagna
    || (raw && (raw.ascendant || raw.lagna))
    || ascFromPlanets
    || {};
  const p = (raw && raw.panchang) || r.panchang || {};
  const moon = (r.planets || []).find((x) => /moon/i.test(x.name || ''))
    || {};
  // Birth details, taken from the kundli profile + r.basic when set.
  const basic = r.basic || {};
  const tz = basic.timezone || kundli?.tz != null
    ? `GMT${kundli.tz >= 0 ? '+' : ''}${kundli.tz}` : '·';
  const placeStr = kundli?.place
    || [basic.city, basic.state, basic.country].filter(Boolean).join(', ');
  const dobStr = kundli?.dob || basic.date || '·';
  const tobStr = kundli?.tob
    ? `${kundli.tob} ${kundli.ampm || ''}`.trim()
    : (basic.time || '·');
  // Every row value goes through txt() so provider-returned objects
  // (e.g. r.nakshatra = { name, lord, number, pada }) never reach
  // React as a child - that's React error #31.
  // Ascendant (Lagna) is the anchor of the whole chart - it MUST
  // be the very first thing the customer sees in Basic Details
  // per user feedback ("first should be ascendent even on this").
  // We compose a one-line summary "Capricorn (Dhanishta)" so the
  // user reads sign + nakshatra at a glance.
  const ascSign = txt(a.sign || a.zodiac || a.rasi
    || (a.rasi && a.rasi.name)) || '';
  const ascNak = txt(a.nakshatra
    || (a.nakshatra && a.nakshatra.name)) || '';
  const ascLord = txt(a.sign_lord || a.lord || a.rasi_lord) || '';
  // Per product: in Basic Details the Lagna row shows JUST the
  // ascendant sign - no nakshatra in parens, no "Lord X" suffix. The
  // detailed breakdown lives in the Avakhada panel below where it
  // belongs.
  const ascSummary = ascSign || '·';
  const birthRows = [
    ['Lagna', ascSummary],
    ['Name', txt(kundli?.name || basic.name) || '·'],
    ['Date', fmtDateLong(dobStr) || '·'],
    ['Time', txt(tobStr) || '·'],
    ['Place', txt(placeStr) || '·'],
    ['Latitude', kundli?.lat != null ? Number(kundli.lat).toFixed(2)
      : txt(basic.latitude) || '·'],
    ['Longitude', kundli?.lng != null ? Number(kundli.lng).toFixed(2)
      : txt(basic.longitude) || '·'],
    ['Timezone', txt(tz || basic.timezone) || '·'],
    ['Sunrise', txt(basic.sunrise || p.sunrise) || '·'],
    ['Sunset', txt(basic.sunset || p.sunset) || '·'],
    ['Ayanamsha', txt(basic.ayanamsha || raw?.ayanamsha) || '·'],
  ];
  // Avakhada - pull from raw.avakhada if AstroSeer returns it,
  // fall back to derived values from the existing fields so the
  // table is never empty.
  const av = raw?.avakhada || raw?.avakhada_details || {};
  const avakhadaRows = [
    // Ascendant rows at the very top of the Avakhada panel too so
    // the customer sees the Lagna no matter which sub-panel they
    // are reading. Sign / Sign Lord here are the ASCENDANT sign +
    // lord; the Moon-sign + Moon-sign-lord rows further down stay
    // for Avakhada-traditional readers.
    ['Ascendant (Lagna)', ascSign || '·'],
    ['Ascendant Lord', ascLord || '·'],
    ['Ascendant Nakshatra', ascNak || '·'],
    ['Varna', txt(av.varna) || '·'],
    ['Vashya', txt(av.vashya) || '·'],
    ['Yoni', txt(av.yoni) || '·'],
    ['Gan', txt(av.gan || av.gana) || '·'],
    ['Nadi', txt(av.nadi) || '·'],
    ['Moon Sign', txt(av.sign || moon.sign || r.chandra_rasi) || '·'],
    ['Moon Sign Lord', txt(av.sign_lord || moon.sign_lord) || '·'],
    ['Nakshatra-Charan',
      txt(av.nakshatra_charan || moon.pada || r.nakshatra) || '·'],
    ['Yog', txt(av.yog || p.yoga) || '·'],
    ['Karan', txt(av.karan || p.karana) || '·'],
    ['Tithi', txt(av.tithi || p.tithi) || '·'],
    ['Yunja', txt(av.yunja) || '·'],
    ['Tatva', txt(av.tatva) || '·'],
    ['Name alphabet', txt(av.name_alphabet || av.syllable) || '·'],
    ['Paya', txt(av.paya) || '·'],
  ];
  const panchangRows = [
    ['Tithi', txt(p.tithi) || '·'],
    ['Karan', txt(p.karana) || '·'],
    ['Yog', txt(p.yoga) || '·'],
    ['Nakshatra', txt(p.nakshatra || r.nakshatra) || '·'],
  ];
  return (
    <>
      <Banner title="Basic Astrological Details" />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <YBox title="Basic Details" rows={birthRows} />
        <YBox title="Avakhada Details" rows={avakhadaRows} />
      </div>
      <div className="mt-3">
        <YBox title="Panchang Details" rows={panchangRows} />
      </div>
    </>
  );
}

// Yellow-headed two-column key/value table - the building block used
// by every "Details" box across the AstroTalk reference.
function YBox({ title, rows }) {
  return (
    <div className="overflow-hidden rounded-card border border-gray-200
      bg-white">
      <div className="py-2 text-center text-sm font-bold text-white"
        style={{
          background: 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)',
        }}>
        {title}
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 px-3 py-1.5 text-[12px]">
            <span className="w-1/2 shrink-0 font-bold text-dark-text">
              {k}
            </span>
            <span className="flex-1 text-dark-text">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Tab: Kundli (Lagna chart + Planets table) --------------
function KundliMainTab({ r, raw, kundli,
  chartStyle, onChangeStyle }) {
  return (
    <>
      <Banner title="Lagna / Ascendant / Basic Birth chart" />
      <div className="mt-2 flex items-center justify-center gap-2">
        {['north', 'south'].map((s) => (
          <button key={s} type="button"
            onClick={() => onChangeStyle(s)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${chartStyle === s
                ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {s === 'north' ? 'North Indian' : 'South Indian'}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-card bg-bg-light p-3">
        {chartStyle === 'north'
          ? <NorthChart r={r} />
          : <SouthChart r={r} />}
      </div>

      <Banner title="Planets" />
      {/* MOBILE: stacked card list - every field visible without any
          horizontal scrolling. Each planet is its own card with a
          colored header and a 2-column data grid below. Sorted by
          HOUSE NUMBER (1 -> 12) so the customer reads the cards in
          chart order; Ascendant stays at the very top regardless
          because it anchors the whole chart. */}
      <div className="mt-2 grid gap-2 md:hidden">
        {(() => {
          const all = planetsWithAscendant(r);
          const asc = all.filter((p) => p.isAscendant);
          const rest = all.filter((p) => !p.isAscendant)
            .slice()
            .sort((a, b) => {
              const ha = Number(a.house);
              const hb = Number(b.house);
              const va = Number.isFinite(ha) ? ha : 99;
              const vb = Number.isFinite(hb) ? hb : 99;
              return va - vb;
            });
          return [...asc, ...rest];
        })().map((p) => {
          const dignityClass = txt(p.dignity) === 'Debilitated'
            ? 'text-danger' : txt(p.dignity) === 'Exalted'
              ? 'text-success' : 'text-dark-text';
          const cells = [
            ['Sign', txt(p.sign) || '·'],
            ['Sign Lord', txt(p.sign_lord) || '·'],
            ['Nakshatra', txt(p.nakshatra) || '·'],
            ['Naksh Lord', txt(p.nakshatra_lord) || '·'],
            ['Degree', txt(p.degree) || '·'],
            ['Retrograde', p.isAscendant ? '-'
              : (p.retrograde ? 'Retro' : 'Direct')],
            ['Combust', p.isAscendant ? '-'
              : (p.combust ? 'Yes' : 'No')],
            ['Avastha', txt(p.avastha) || '·'],
            ['House', txt(p.house) || '·'],
          ];
          return (
            <div key={txt(p.name)}
              className="overflow-hidden rounded-2xl border
                border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between
                gap-2 bg-gradient-to-r from-[#7F2020] to-[#D4A12A]
                px-3 py-2 text-white">
                <div className="text-[13px] font-bold">
                  {txt(p.name)}
                </div>
                <span className={`rounded-full bg-white/20 px-2
                  py-0.5 text-[10px] font-bold ${dignityClass
                    === 'text-danger' ? 'text-rose-100'
                    : dignityClass === 'text-success'
                      ? 'text-emerald-100' : ''}`}>
                  {txt(p.dignity) || txt(p.status) || '·'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1
                p-3 text-[11.5px]">
                {cells.map(([k, v]) => (
                  <div key={k} className="flex justify-between
                    gap-2 border-b border-gray-100 pb-1
                    last:border-0">
                    <span className="text-sub-text">{k}</span>
                    <span className="text-right font-semibold
                      text-dark-text">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* DESKTOP: original full-width table - the horizontal scroll is
          fine on a wide viewport and keeps the side-by-side comparison
          experience that astrologers prefer. */}
      <div className="mt-2 hidden overflow-x-auto rounded-card
        bg-white p-2 md:block">
        <table className="w-full text-[11px]">
          <thead className="bg-bg-light text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Planet</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Nakshatra</th>
              <th className="px-2 py-1.5">Naksh Lord</th>
              <th className="px-2 py-1.5">Degree</th>
              <th className="px-2 py-1.5">Retro(R)</th>
              <th className="px-2 py-1.5">Combust</th>
              <th className="px-2 py-1.5">Avastha</th>
              <th className="px-2 py-1.5">House</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {planetsWithAscendant(r).map((p) => (
              <tr key={txt(p.name)}
                className="border-t border-gray-100">
                <td className="px-2 py-1 font-semibold">{txt(p.name)}</td>
                <td className="px-2 py-1">{txt(p.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(p.sign_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(p.nakshatra) || '·'}</td>
                <td className="px-2 py-1">
                  {txt(p.nakshatra_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(p.degree) || '·'}</td>
                <td className="px-2 py-1">
                  {p.isAscendant ? '-'
                    : (p.retrograde ? 'Retro' : 'Direct')}
                </td>
                <td className="px-2 py-1">
                  {p.isAscendant ? '-' : (p.combust ? 'Yes' : 'No')}
                </td>
                <td className="px-2 py-1">{txt(p.avastha) || '·'}</td>
                <td className="px-2 py-1">{p.house ?? '·'}</td>
                <td className={`px-2 py-1 ${
                  txt(p.dignity) === 'Debilitated'
                    ? 'text-danger'
                    : txt(p.dignity) === 'Exalted'
                      ? 'text-success' : ''}`}>
                  {txt(p.dignity) || txt(p.status) || '·'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Build the Planets table rows with the Ascendant (Lagna) as the
// FIRST row - traditional Vedic order puts the rising sign at the
// top because it anchors every house calculation. ALWAYS renders
// the row, even if the provider returned no ascendant data - empty
// fields fall back to "·" rather than hiding the row entirely
// (user explicitly asked for Ascendant to be visible).
//
// Sources tried, first match wins:
//   1. r.ascendant (top-level shape returned by the relay)
//   2. r.lagna (some kundli APIs use this name)
//   3. r.raw.ascendant / r.raw.lagna (legacy field locations)
//   4. r.raw.basic.ascendant_sign / r.raw.basic.lagna_sign
//   5. A planet entry whose name matches /asc|lagna/i (a few
//      providers embed Ascendant in the planets array directly)
function planetsWithAscendant(r) {
  const planets = (r && r.planets) || [];
  // De-duplicate: if a planet entry already represents Ascendant,
  // hoist it to the front and we are done.
  const ascInPlanets = planets.find((p) => /asc|lagna|ascend/i
    .test(String((p && p.name) || '')));
  if (ascInPlanets) {
    const rest = planets.filter((p) => p !== ascInPlanets);
    return [{ ...ascInPlanets, name: 'Ascendant',
      isAscendant: true, house: ascInPlanets.house ?? 1 }, ...rest];
  }
  // Compose synthetic ascendant row from any source we can find.
  const raw = (r && r.raw) || {};
  const asc = (r && r.ascendant)
    || (r && r.lagna)
    || (raw && raw.ascendant)
    || (raw && raw.lagna)
    || {};
  const basicSign = (raw && raw.basic && (raw.basic.ascendant_sign
    || raw.basic.lagna_sign || raw.basic.ascendant)) || '';
  const ascRow = {
    name: 'Ascendant',
    sign: asc.sign || asc.zodiac || asc.rasi
      || (asc.rasi && asc.rasi.name) || basicSign || '',
    sign_lord: asc.sign_lord || asc.lord || asc.rasi_lord || '',
    nakshatra: asc.nakshatra
      || (asc.nakshatra && asc.nakshatra.name) || '',
    nakshatra_lord: asc.nakshatra_lord
      || (asc.nakshatra && asc.nakshatra.lord) || '',
    degree: asc.degree || asc.degree_display
      || asc.degrees_in_sign || '',
    house: 1,
    isAscendant: true,
    avastha: '',
    dignity: '',
    status: '',
  };
  return [ascRow, ...planets];
}

// ---------- Tab: KP (Bhav Chalit + Ruling Planets + KP Planets) ----
function KpTab({ r, raw }) {
  const kp = raw?.kp || {};
  const ruling = kp.ruling_planets || raw?.ruling_planets || {};
  const cusps = kp.cusps || raw?.cusps || [];
  return (
    <>
      <Banner title="Bhav Chalit Chart" />
      <div className="mt-3 rounded-card bg-bg-light p-3">
        <NorthChart r={r} />
      </div>

      <Banner title="Ruling Planets" />
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {[['Sign Lord', ruling.sign_lord],
          ['Star Lord', ruling.star_lord],
          ['Sub Lord', ruling.sub_lord]].map(([k, v]) => (
          <div key={k} className="rounded-card border border-gray-200
            bg-white p-3 text-center text-sm">
            <div className="text-[11px] font-bold uppercase
              tracking-wide text-sub-text">{k}</div>
            <div className="mt-1 font-bold text-dark-text">
              {txt(v) || '·'}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-card bg-white p-2">
          <span className="font-bold text-dark-text">Day Lord:</span>{' '}
          {txt(ruling.day_lord) || '·'}
        </div>
        <div className="rounded-card bg-white p-2">
          <span className="font-bold text-dark-text">Asc:</span>{' '}
          {txt(r.ascendant && r.ascendant.sign) || '·'}
        </div>
      </div>

      <Banner title="Planets" />
      <div className="mt-2 overflow-x-auto rounded-card bg-white p-2">
        <table className="w-full text-[11px]">
          <thead className="bg-bg-light text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Planet</th>
              <th className="px-2 py-1.5">Cusp</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Star Lord</th>
              <th className="px-2 py-1.5">Sub Lord</th>
            </tr>
          </thead>
          <tbody>
            {planetsWithAscendant(r).map((p) => (
              <tr key={txt(p.name)}
                className="border-t border-gray-100">
                <td className="px-2 py-1 font-semibold">{txt(p.name)}</td>
                <td className="px-2 py-1">
                  {p.cusp ?? p.house ?? '·'}
                </td>
                <td className="px-2 py-1">{txt(p.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(p.sign_lord) || '·'}</td>
                <td className="px-2 py-1">
                  {txt(p.nakshatra_lord || p.star_lord) || '·'}
                </td>
                <td className="px-2 py-1">{txt(p.sub_lord) || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Banner title="Cusps" />
      <div className="mt-2 overflow-x-auto rounded-card bg-white p-2">
        <table className="w-full text-[11px]">
          <thead className="bg-bg-light text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Cusp</th>
              <th className="px-2 py-1.5">Degree</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Star Lord</th>
              <th className="px-2 py-1.5">Sub Lord</th>
            </tr>
          </thead>
          <tbody>
            {(cusps && cusps.length > 0
              ? cusps : Array.from({ length: 12 }, (_, i) => ({
                cusp: i + 1, degree: '·',
              }))).map((c, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1">{c.cusp || (i + 1)}</td>
                <td className="px-2 py-1">{txt(c.degree) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sign_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(c.star_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sub_lord) || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Tab: Ashtakvarga (grid of 8 mini-charts) ---------------
function AshtakvargaTab({ r, raw }) {
  // Try every shape AstroSeer / providers use for ashtakvarga:
  //   raw.ashtakvarga            { sarvashtaka: {...}, sun: {...} }
  //   raw.ashtakvarga_full       same
  //   raw.bhinnashtakvarga       { sun: {...}, moon: {...}, ... }
  //   raw.sarvashtakvarga        12-key map for SAV
  //   r.ashtakvarga              top-level (some providers flatten)
  const av = raw?.ashtakvarga || raw?.ashtakvarga_full
    || r?.ashtakvarga || raw?.bhinnashtakvarga || null;
  const sav = raw?.sarvashtakvarga || raw?.sarvashtaka
    || (av && (av.sarvashtaka || av.sarvashtakvarga || av.sav))
    || null;
  const ENTRIES = [
    ['Sav', 'Sarvashtaka'],
    ['Asc', 'Ascendant'],
    ['Jupiter', 'Jupiter'],
    ['Mars', 'Mars'],
    ['Mercury', 'Mercury'],
    ['Moon', 'Moon'],
    ['Saturn', 'Saturn'],
    ['Sun', 'Sun'],
    ['Venus', 'Venus'],
  ];
  // Pull house bindus out of whatever shape the provider returned.
  // Accepts: array indexed 0..11 OR 1..12, object keyed "1".."12",
  // or nested under .bindus / .houses.
  function normaliseHouseMap(node) {
    if (!node) return null;
    let raw0 = node;
    if (node.bindus) raw0 = node.bindus;
    else if (node.houses) raw0 = node.houses;
    const out = {};
    if (Array.isArray(raw0)) {
      // Either 12 entries (0-indexed: house 1 at idx 0) or 13 (1-indexed).
      const offset = raw0.length === 13 ? 0 : -1;
      for (let h = 1; h <= 12; h += 1) {
        const v = raw0[h + offset];
        if (v != null && v !== '') out[h] = Number(v);
      }
    } else if (typeof raw0 === 'object') {
      for (let h = 1; h <= 12; h += 1) {
        const v = raw0[h] ?? raw0[String(h)] ?? raw0[`house_${h}`];
        if (v != null && v !== '') out[h] = Number(v);
      }
    }
    return Object.keys(out).length ? out : null;
  }
  function bindu(key) {
    if (key === 'Sav') return normaliseHouseMap(sav);
    if (!av) return null;
    const node = av[key] || av[key.toLowerCase()]
      || av[key.toUpperCase()] || null;
    return normaliseHouseMap(node);
  }
  // Detect "no data at all" so we can show a single clear message
  // instead of nine blank chart skeletons.
  const hasAny = ENTRIES.some(([k]) => bindu(k));
  return (
    <>
      <Banner title="Ashtakvarga Chart" />
      <p className="mt-2 text-[11px] text-sub-text">
        Ashtakvarga is used to assess the strength and patterns each
        planet creates in your chart. A score of 1 to 8 bindus is given
        per house; the total across all 8 BAVs are overlaid here. A
        score of 4 or less indicates the house should be 30+.
      </p>
      {!hasAny ? (
        <div className="mt-3 rounded-card border border-dashed
          border-gray-300 bg-white p-6 text-center text-sm
          text-sub-text">
          <div className="mb-1 text-2xl">⋮</div>
          <div className="font-bold text-dark-text">
            Ashtakvarga data is not available yet
          </div>
          <p className="mt-1 text-xs">
            The provider has not returned bindu scores for this
            chart. Tap <b>Refresh kundli</b> at the top to retry,
            or try a different profile.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {ENTRIES.map(([key, label]) => (
            <div key={key}
              className="rounded-card bg-bg-light p-2 text-center">
              <div className="mb-1 text-[12px] font-bold
                text-dark-text">
                {label}
              </div>
              <AshtakvargaMiniChart bindus={bindu(key)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Mini Ashtakvarga chart - North-Indian diamond with one bindu number
// per house. Reused 8 times in the AshtakvargaTab grid.
function AshtakvargaMiniChart({ bindus }) {
  const cells = bindus && typeof bindus === 'object'
    ? bindus : {};
  const HOUSES = [
    { h: 1, x: 100, y: 60 }, { h: 2, x: 50, y: 38 },
    { h: 3, x: 30, y: 80 }, { h: 4, x: 50, y: 100 },
    { h: 5, x: 30, y: 120 }, { h: 6, x: 50, y: 160 },
    { h: 7, x: 100, y: 140 }, { h: 8, x: 150, y: 160 },
    { h: 9, x: 170, y: 120 }, { h: 10, x: 150, y: 100 },
    { h: 11, x: 170, y: 80 }, { h: 12, x: 150, y: 38 },
  ];
  return (
    <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[170px]">
      <rect x="8" y="8" width="184" height="184" fill="#fff"
        stroke="#A77B1F" strokeWidth="1.5" />
      <line x1="8" y1="8" x2="192" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="192" y1="8" x2="8" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="100" y1="8" x2="8" y2="100"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="100" y1="8" x2="192" y2="100"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="192" y1="100" x2="100" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="8" y1="100" x2="100" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      {HOUSES.map(({ h, x, y }) => (
        <text key={h} x={x} y={y} textAnchor="middle"
          fontSize="11" fontWeight="bold" fill="#1a1a2e">
          {cells[h] != null ? String(cells[h]) : ''}
        </text>
      ))}
    </svg>
  );
}

// ---------- Tab: Charts (12 divisional charts grid) ----------------
function ChartsGridTab({ r, raw, chartStyle }) {
  const div = raw?.divisional || raw?.divisional_charts || {};
  // Canonical divisional list with the AstroTalk subtitle. Each entry
  // pulls its planets/sign data from raw.divisional[<key>] when
  // present; otherwise the slot still renders the layout so it's
  // obvious where the data is missing.
  const DIVS = [
    ['Hora', 'Prospects of marriage', 'd2'],
    ['Drekkana', 'Relationship with siblings', 'd3'],
    ['Chaturthamsa', 'Assets', 'd4'],
    ['Saptamsa', 'Progeny', 'd7'],
    ['Navamsa', 'Marriage', 'd9'],
    ['Dasamsa', 'Profession', 'd10'],
    ['Dvadasamsa', 'Native parents / Ancestors', 'd12'],
    ['Shodasamsa', 'Travel', 'd16'],
    ['Vimsamsa', 'Spiritual progress', 'd20'],
    ['Chaturvimsamsa', 'Intellectual', 'd24'],
    ['Saptavimsamsa', 'Strength / Protection', 'd27'],
    ['Trimsamsa', 'Misfortunes', 'd30'],
    ['Khavedamsa', 'Auspiciousness', 'd40'],
    ['Akshavedamsa', 'General issues', 'd45'],
    ['Shastiamsa', 'Summary of charts', 'd60'],
  ];
  return (
    <>
      <Banner title="Divisional Charts" />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2
        md:grid-cols-3">
        {DIVS.map(([name, sub, key]) => {
          const d = div[key] || div[name.toLowerCase()] || null;
          // Provider returns either the same { planets[], ascendant }
          // shape as the main report or a flat string. Coerce to a
          // shape NorthChart can render.
          const rd = (d && d.planets) ? d
            : { planets: r.planets || [], ascendant: r.ascendant };
          return (
            <div key={key}
              className="rounded-card bg-bg-light p-2 text-center">
              <div className="text-[12px] font-bold text-dark-text">
                {name}
              </div>
              <div className="mb-1 text-[10px] text-sub-text">{sub}</div>
              {chartStyle === 'south'
                ? <SouthChart r={rd} />
                : <NorthChart r={rd} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Tab: Free Report (Ascendant report sections) -----------
// Default-on admin toggle reader. Returns true unless features doc
// explicitly sets the flag to false, so a new feature ships visible.
function useFeatureFlag(key, defaultOn = true) {
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'features'));
        if (s.exists()) {
          const v = s.data()[key];
          if (v === false) setOn(false);
          else if (v === true) setOn(true);
        }
      } catch (_) {}
    })();
  }, [key]);
  return on;
}

function FreeReportTab({ r, n, lucky, kundli }) {
  const raw = r.raw || {};
  // Sub-tab state - mirrors the AstroTalk Free Report top strip:
  // General · Remedies · Doshas, with General further split into
  // General / Planetary / Vimshottari Dasha / Yoga via nested
  // chip tabs. Each section is independently admin-gated.
  const [sub, setSub] = useState('general');
  const [innerSub, setInnerSub] = useState('overview');

  // Per-section admin toggles. Default ON. Admin can flip any of
  // these in /admin-features under "Kundli Free Report sections".
  const showGeneral = useFeatureFlag('free_report_general_enabled');
  const showPlanetary = useFeatureFlag('free_report_planetary_enabled');
  const showDasha = useFeatureFlag('free_report_dasha_enabled');
  const showYoga = useFeatureFlag('free_report_yoga_enabled');
  const showRemedies = useFeatureFlag('free_report_remedies_enabled');
  const showDoshas = useFeatureFlag('free_report_doshas_enabled');

  // Build the visible sub-tab list dynamically so a fully-disabled
  // group doesn't leave an empty chip.
  const TOP_TABS = [
    showGeneral || showPlanetary || showDasha || showYoga
      ? ['general', 'General'] : null,
    showRemedies ? ['remedies', 'Remedies'] : null,
    showDoshas ? ['doshas', 'Doshas'] : null,
  ].filter(Boolean);

  const INNER_TABS = [
    showGeneral ? ['overview', 'General'] : null,
    showPlanetary ? ['planetary', 'Planetary'] : null,
    showDasha ? ['dasha', 'Vimshottari Dasha'] : null,
    showYoga ? ['yoga', 'Yoga'] : null,
  ].filter(Boolean);

  // Coerce inner tab to a visible one if the admin disabled it.
  const activeInner = INNER_TABS.some(([k]) => k === innerSub)
    ? innerSub : (INNER_TABS[0] && INNER_TABS[0][0]) || 'overview';

  return (
    <>
      <Banner title="Free Report" />

      {/* HERO: open the API-generated PDF (the one actually saved in
          our system) in a popup viewer with download + close. This is
          the format the customer / admin sees everywhere - matches
          the user's stated requirement: "the format made by the API
          only, that should only get saved in our systems and when
          anyone click on report that only should open like this".  */}
      <ApiPdfHero kundli={kundli} />

      {/* Top sub-tabs - General / Remedies / Doshas */}
      {TOP_TABS.length > 1 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {TOP_TABS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSub(k)}
              className={`rounded-full px-4 py-1 text-[12px]
                font-bold transition ${sub === k
                  ? 'bg-primary text-white'
                  : 'bg-white text-sub-text'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {sub === 'general' && (
        <>
          {/* Inner chip tabs - General · Planetary · Vimshottari ·
              Yoga. Hidden when admin disables all of them. */}
          {INNER_TABS.length > 1 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {INNER_TABS.map(([k, label]) => (
                <button key={k} type="button"
                  onClick={() => setInnerSub(k)}
                  className={`rounded-full border px-3 py-1
                    text-[11px] font-bold transition
                    ${activeInner === k
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-300 bg-white text-sub-text'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {activeInner === 'overview' && showGeneral && (
            <AscendantOverviewSection r={r} n={n} lucky={lucky} />
          )}
          {activeInner === 'planetary' && showPlanetary && (
            <PlanetaryNarrativeSection r={r} raw={raw} />
          )}
          {activeInner === 'dasha' && showDasha && (
            <VimshottariNarrativeSection r={r} raw={raw} />
          )}
          {activeInner === 'yoga' && showYoga && (
            <YogaNarrativeSection r={r} raw={raw} />
          )}
        </>
      )}

      {sub === 'remedies' && showRemedies && (
        <RemediesSection r={r} raw={raw} />
      )}
      {sub === 'doshas' && showDoshas && (
        <DoshasNarrativeSection r={r} raw={raw} />
      )}

      {/* DownloadBanner removed entirely per user feedback - the
          ApiPdfHero at the top of this tab already provides View +
          Download with the live API PDF. The legacy banner was just
          rendering an empty dark strip that did not open anything
          on mobile. */}
    </>
  );
}

// ---- Free Report: Ascendant overview ----------------------------
function AscendantOverviewSection({ r, n, lucky }) {
  const a = r.ascendant || {};
  const sign = txt(a.sign || r.chandra_rasi) || '·';
  const moonSign = txt(r.chandra_rasi);
  const sunSign = txt(r.soorya_rasi);
  const nakshatra = txt(r.nakshatra);
  // Compose richer paragraphs by stitching together the provider's
  // narrative with sign/nakshatra/lord context so the rendered
  // section reads like a real reading rather than 1-line stubs.
  function richPara(label, base, augment) {
    if (!base && !augment) return null;
    return (
      <ReportSection label={label}>
        {base && <p>{base}</p>}
        {augment && <p className="mt-2">{augment}</p>}
      </ReportSection>
    );
  }
  return (
    <>
      <Banner title="Ascendant Report" />
      {a.sign && (
        <div className="mt-3 rounded-card bg-bg-light p-3 text-sm
          leading-relaxed">
          <b>Description.</b> Ascendant is one of the most sought
          concepts in astrology when it comes to predicting the
          minute events in your life. At the time of birth, the
          sign that rises in the sky is the person&apos;s ascendant.
          It helps in making predictions about the minute events,
          unlike your Moon or Sun sign that help in making weekly,
          monthly or yearly predictions for you. Your ascendant is{' '}
          <b>{sign}</b>{moonSign ? `, your Moon sign is ${moonSign}`
            : ''}{sunSign ? `, your Sun sign is ${sunSign}` : ''}
          {nakshatra ? `, and your birth star is ${nakshatra}` : ''}.
        </div>
      )}
      {richPara('Personality', n.personality,
        a.sign && `Your Lagna (ascendant) is ${sign}. `
          + houseBlurb('lagna', sign)
          + (moonSign ? ` Moon in ${moonSign} colours your `
            + 'emotional nature.' : '')
          + (nakshatra ? ` Your birth star ${nakshatra} adds its `
            + 'own signature to your temperament and instincts.'
            : ''))}
      {richPara('Career', n.career,
        a.sign && `Career path: ${careerBlurb(sign)} `
          + 'Pair these tendencies with the running dasha lord to '
          + 'time professional decisions.')}
      {richPara('Health', n.health,
        a.sign && `Health constitution: ${healthBlurb(sign)} `
          + 'Routine, sleep and a moderate diet matter more than '
          + 'fasting fixes.')}
      {richPara('Love & Relationships', n.love,
        a.sign && `In love: ${loveBlurb(sign)}`)}
      {richPara('Life Path', n.life,
        a.sign && `Life path: with ${nakshatra || moonSign || sign}, `
          + 'your journey rewards patience, dharma and using your '
          + 'natural gifts in service of clear goals. Favourable '
          + `direction as per chart, lucky colour ${lucky.color
            || '·'}, birth stone ${lucky.stone || '·'}.`)}

      {(lucky.deity || lucky.color || lucky.stone
        || lucky.direction || lucky.syllables) && (
        <>
          <Banner title="Lucky" />
          <div className="mt-3 rounded-card bg-white p-3 text-sm">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {lucky.deity && <div>Deity: <b>{lucky.deity}</b></div>}
              {lucky.color && <div>Colour: <b>{lucky.color}</b></div>}
              {lucky.stone && <div>Stone: <b>{lucky.stone}</b></div>}
              {lucky.direction && (
                <div>Direction: <b>{lucky.direction}</b></div>)}
              {lucky.syllables && (
                <div>Syllables: <b>{lucky.syllables}</b></div>)}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Per-sign micro-blurbs used to thicken the Ascendant section even
// when the provider returns terse one-liners. Picked from classical
// associations - generic but accurate.
function houseBlurb(_kind, sign) {
  const S = (sign || '').toLowerCase();
  if (S === 'aries') return 'You lead with initiative, courage and a '
    + 'pioneering spirit. You move first and refine later.';
  if (S === 'taurus') return 'You move steadily, value comfort and '
    + 'beauty, and resist what is rushed.';
  if (S === 'gemini') return 'You think in possibilities, speak '
    + 'fluently and pick up skills quickly.';
  if (S === 'cancer') return 'You are caring, intuitive and '
    + 'protective with deep emotional intelligence.';
  if (S === 'leo') return 'You radiate warmth, want recognition and '
    + 'lead by example.';
  if (S === 'virgo') return 'You analyse, refine and serve. Details '
    + 'others miss are obvious to you.';
  if (S === 'libra') return 'You weigh, balance and seek fair '
    + 'partnerships in everything.';
  if (S === 'scorpio') return 'You feel intensely, dig deep and '
    + 'transform what you touch.';
  if (S === 'sagittarius') return 'You aim high, travel widely and '
    + 'teach what you have learned.';
  if (S === 'capricorn') return 'You build patiently, plan long and '
    + 'achieve through structure.';
  if (S === 'aquarius') return 'You think originally, network widely '
    + 'and reform what is stuck.';
  if (S === 'pisces') return 'You feel collectively, imagine vividly '
    + 'and dissolve boundaries.';
  return '';
}
function careerBlurb(sign) {
  const S = (sign || '').toLowerCase();
  const M = {
    aries: 'leadership, sport, military, surgery, entrepreneurship.',
    taurus: 'finance, food, design, luxury goods, real estate.',
    gemini: 'media, writing, sales, tech, teaching.',
    cancer: 'care-giving, hospitality, real estate, family business.',
    leo: 'government, performance, gold, leadership roles.',
    virgo: 'analytics, accounts, editing, health, service roles.',
    libra: 'law, diplomacy, design, partnerships, beauty.',
    scorpio: 'research, surgery, finance, intelligence, occult.',
    sagittarius: 'teaching, law, travel, publishing, advisory.',
    capricorn: 'administration, construction, mining, long-haul work.',
    aquarius: 'tech, research, social causes, networks.',
    pisces: 'arts, healing, spirituality, marine, charity.',
  };
  return M[S] || 'work where your natural gifts apply.';
}
function healthBlurb(sign) {
  const S = (sign || '').toLowerCase();
  const M = {
    aries: 'strong vitality; mind headaches and burn-out.',
    taurus: 'sturdy frame; mind throat and weight.',
    gemini: 'fast metabolism; mind lungs and nerves.',
    cancer: 'sensitive digestion and emotions; nurture rest and diet.',
    leo: 'strong heart; mind blood pressure and back.',
    virgo: 'sharp digestion; mind anxiety and intestines.',
    libra: 'balanced look; mind kidneys and sugar.',
    scorpio: 'powerful constitution; mind reproductive system.',
    sagittarius: 'athletic frame; mind hips and liver.',
    capricorn: 'lean, lasting; mind knees and joints.',
    aquarius: 'wiry; mind circulation and ankles.',
    pisces: 'sensitive; mind feet, immune system, moods.',
  };
  return M[S] || 'pay attention to your body signals early.';
}
function loveBlurb(sign) {
  const S = (sign || '').toLowerCase();
  const M = {
    aries: 'you fall fast and need a partner who can keep pace.',
    taurus: 'you love steadily and value loyalty above all.',
    gemini: 'you want conversation and variety in a partner.',
    cancer: 'you are devoted and nurturing; family and emotional '
      + 'safety matter most.',
    leo: 'you love grandly and need to be appreciated.',
    virgo: 'you love through care and quiet acts of service.',
    libra: 'you are romantic and want harmony, almost any cost.',
    scorpio: 'you bond intensely; trust and depth matter.',
    sagittarius: 'you want a partner who shares your search.',
    capricorn: 'you commit slowly but for life.',
    aquarius: 'you love freedom and friendship-first partnerships.',
    pisces: 'you love selflessly; protect against being absorbed.',
  };
  return M[S] || 'partnership themes vary with the chart.';
}

// ---- Free Report: Planetary narratives (Sun..Ketu per planet) ---
function PlanetaryNarrativeSection({ r, raw }) {
  // Provider may put per-planet narratives under raw.planetary,
  // raw.planet_reports, or fold them into narrative.planets. Try
  // all three. Each entry: { planet, sign, house, text }.
  const list = (Array.isArray(raw.planetary) && raw.planetary)
    || (Array.isArray(raw.planet_reports) && raw.planet_reports)
    || (Array.isArray(r.planetary) && r.planetary)
    || [];
  const planets = r.planets || [];
  if (list.length === 0 && planets.length === 0) {
    return <PlaceholderNote text="Planetary narratives are loading
      or unavailable for this profile." />;
  }
  return (
    <>
      <Banner title="Planetary Influence" />
      <div className="mt-3 space-y-2">
        {planets.map((p) => {
          const provider = list.find((x) =>
            txt(x.planet || x.name).toLowerCase()
              === txt(p.name).toLowerCase());
          const text = provider
            && (provider.text || provider.description
              || provider.body);
          return (
            <div key={p.name} className="rounded-card bg-white p-3
              text-sm">
              <div className="mb-1 font-bold text-primary">
                {txt(p.name)}
                {p.sign && (
                  <span className="ml-2 text-[11px] font-semibold
                    text-sub-text">in {txt(p.sign)}{p.house
                    ? `, house ${p.house}` : ''}</span>
                )}
              </div>
              <p className="leading-relaxed text-dark-text">
                {text || (`${txt(p.name)} (${PLANET_KARAKA[txt(p.name)]
                  || 'karaka'}) sits in ${txt(p.sign) || 'your chart'}`
                  + (p.house ? `, house ${p.house}` : '')
                  + (p.house && HOUSE_THEMES[p.house]
                    ? ` - ${HOUSE_THEMES[p.house]}` : '')
                  + `. ${(p.retrograde ? 'Retrograde here turns its '
                    + 'energy inward - old themes get revisited.'
                    : 'Direct motion runs its themes forward in this '
                      + 'life.')}`)}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Free Report: Vimshottari dasha narratives ------------------
function VimshottariNarrativeSection({ r, raw }) {
  // Provider may return per-mahadasha narratives under
  // raw.dasha_narratives or r.dashaNarratives. Each: { planet,
  // start, end, text }.
  const list = (Array.isArray(raw.dasha_narratives)
    && raw.dasha_narratives)
    || (Array.isArray(r.dashaNarratives) && r.dashaNarratives)
    || [];
  const mahas = r.dasha || [];
  if (mahas.length === 0) {
    return <PlaceholderNote text="Dasha periods are loading or
      unavailable for this profile." />;
  }
  return (
    <>
      <Banner title="Vimshottari Dasha - Period Predictions" />
      <div className="mt-3 space-y-2">
        {mahas.map((d, i) => {
          const provider = list.find((x) =>
            txt(x.planet).toLowerCase()
              === txt(d.planet).toLowerCase());
          const text = (provider && (provider.text
            || provider.description)) || '';
          const startYear = String(d.start || '').slice(0, 4);
          const endYear = String(d.end || '').slice(0, 4);
          return (
            <div key={i} className={`rounded-card p-3 text-sm
              leading-relaxed ${d.current
                ? 'bg-primary/5 ring-1 ring-primary/30'
                : 'bg-white'}`}>
              <div className="mb-1 font-bold text-primary">
                {txt(d.planet)} Mahadasha
                <span className="ml-2 text-[11px] font-semibold
                  text-sub-text">
                  {startYear}{startYear && endYear
                    ? `-${endYear}` : ''}
                  {d.current ? ' · current' : ''}
                </span>
              </div>
              <p className="text-dark-text">
                {text || (`The ${txt(d.planet)} Mahadasha runs from `
                  + `${String(d.start || '').slice(0, 10)} to `
                  + `${String(d.end || '').slice(0, 10)}. `
                  + `${PLANET_KARAKA[txt(d.planet)]
                    ? 'Themes activated: ' + PLANET_KARAKA[txt(d.planet)]
                      + '. ' : ''}`
                  + 'The sub-periods inside refine the year-by-year '
                  + 'experience; consult the Dasha tab for the '
                  + 'antardasha drilldown.')}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Free Report: Yoga narratives (detected yogas in detail) ----
function YogaNarrativeSection({ r, raw }) {
  const yogas = (Array.isArray(raw.yogas_detected) && raw.yogas_detected)
    || (Array.isArray(r.yogas) && r.yogas) || [];
  if (yogas.length === 0) {
    return <PlaceholderNote text="No classical yogas detected in
      this chart." />;
  }
  return (
    <>
      <Banner title={`Yogas Detected (${yogas.length})`} />
      <div className="mt-3 space-y-2">
        {yogas.map((y, i) => {
          const name = txt(y.name || y.title || y);
          const desc = y.description || y.effect || y.meaning
            || y.text;
          const planets = Array.isArray(y.planets)
            ? y.planets.map(txt).join(', ') : '';
          return (
            <div key={i} className="rounded-card bg-white p-3
              text-sm leading-relaxed">
              <div className="mb-1 font-bold text-primary">{name}</div>
              {desc && <p className="text-dark-text">{desc}</p>}
              {planets && (
                <div className="mt-2 text-[11px] text-sub-text">
                  Formed by: <b>{planets}</b>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Free Report: Remedies (gemstone, rudraksha, mantras…) ------
function RemediesSection({ r, raw }) {
  const rem = raw.remedies || r.remedies || {};
  const gem = rem.gemstone || rem.birthstone;
  const rudraksha = rem.rudraksha;
  const mantra = rem.mantra || rem.mantras;
  const fast = rem.fasting || rem.fasts;
  const charity = rem.charity || rem.donations;
  return (
    <>
      <Banner title="Remedies" />
      {!gem && !rudraksha && !mantra && !fast && !charity && (
        <PlaceholderNote text="No remedy block returned by the
          provider for this chart yet." />
      )}
      {gem && (
        <RemedyCard title="Gemstone"
          body={typeof gem === 'string' ? gem
            : (gem.text || gem.description
              || `${gem.name || ''} ${gem.metal
                ? `set in ${gem.metal}` : ''}`)} />
      )}
      {rudraksha && (
        <RemedyCard title="Rudraksha"
          body={typeof rudraksha === 'string' ? rudraksha
            : (rudraksha.text || rudraksha.description
              || `${rudraksha.mukhi || ''} Mukhi rudraksha`)} />
      )}
      {mantra && (
        <RemedyCard title="Mantras"
          body={typeof mantra === 'string' ? mantra
            : Array.isArray(mantra)
              ? mantra.map(txt).filter(Boolean).join('\n')
              : (mantra.text || mantra.description)} />
      )}
      {fast && (
        <RemedyCard title="Fasting"
          body={typeof fast === 'string' ? fast
            : (fast.text || fast.description)} />
      )}
      {charity && (
        <RemedyCard title="Charity / Donations"
          body={typeof charity === 'string' ? charity
            : (charity.text || charity.description)} />
      )}
    </>
  );
}
function RemedyCard({ title, body }) {
  return (
    <div className="mt-3 rounded-card bg-white p-3 text-sm
      leading-relaxed">
      <div className="mb-1 font-bold text-primary">{title}</div>
      <p className="whitespace-pre-line text-dark-text">
        {body || '·'}
      </p>
    </div>
  );
}

// ---- Free Report: Dosha narratives -------------------------------
function DoshasNarrativeSection({ r, raw }) {
  const d = raw.doshas_full || r.doshas || {};
  const items = [
    ['Mangal Dosha', d.mangal, 'Mars in 1, 2, 4, 7, 8 or 12. '
      + 'Affects marriage compatibility. Remedies: Hanuman Chalisa '
      + 'Tuesdays, coral on right ring finger after consulting an '
      + 'astrologer.'],
    ['Kalsarp Dosha', d.kalsarp, 'All planets between Rahu and Ketu. '
      + 'Causes delays and obstacles. Silver naag-naagin worship and '
      + 'Naga Panchami rituals help.'],
    ['Sade Sati', d.sade_sati, 'Saturn through 12th, 1st and 2nd '
      + 'from natal Moon. Slows things, tests patience. Hanuman '
      + 'Chalisa and Saturday Saturn offerings help.'],
    ['Pitra Dosha', d.pitra, 'Karma carried from ancestors; ease '
      + 'with shradh on Pitru Paksha + selfless service.'],
    ['Guru Chandal', d.guru_chandal, 'Jupiter conjunct Rahu - '
      + 'wisdom mixed with confusion. Yellow sapphire after expert '
      + 'consultation.'],
  ].filter(([, val]) => val);
  return (
    <>
      <Banner title="Doshas" />
      {items.length === 0 && (
        <PlaceholderNote text="No major doshas flagged in this chart." />
      )}
      {items.map(([label, val, fallback]) => {
        const present = val && (val.present || val.is_present
          || val.detected);
        const severity = val && (val.severity || val.type
          || val.phase || val.current_phase);
        const note = val && (val.text || val.note || val.description);
        return (
          <div key={label} className={`mt-3 rounded-card p-3 text-sm
            leading-relaxed ${present
              ? 'border border-warning/40 bg-warning/5'
              : 'border border-success/30 bg-success/5'}`}>
            <div className={`font-bold ${present
              ? 'text-warning' : 'text-success'}`}>
              {label} · {present ? 'Present' : 'Not present'}
              {present && severity ? ` (${severity})` : ''}
            </div>
            {note && (
              <p className="mt-1 text-dark-text">{note}</p>
            )}
            <p className="mt-1 text-[11.5px] text-sub-text">
              {fallback}
            </p>
          </div>
        );
      })}
    </>
  );
}

function PlaceholderNote({ text }) {
  return (
    <div className="mt-3 rounded-card bg-bg-light p-3 text-sm
      text-sub-text">
      {text}
    </div>
  );
}

function ReportSection({ label, children }) {
  return (
    <div className="mt-3 rounded-card bg-white p-3 text-sm
      leading-relaxed">
      <div className="mb-1 font-bold text-primary">{label}</div>
      <div className="text-dark-text">{children}</div>
    </div>
  );
}

// ---------- Tab: Overview ----------------------------------------
function OverviewTab({ r, n, lucky }) {
  const a = r.ascendant || {};
  return (
    <div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm
                      sm:grid-cols-4">
        <Stat label="Ascendant"
          value={txt(a.sign)}
          sub={txt(a.degree_display || a.degree)} />
        <Stat label="Nakshatra"
          value={txt(r.nakshatra)}
          sub={a.pada ? `Pada ${a.pada}` : ''} />
        <Stat label="Moon sign" value={txt(r.chandra_rasi)} />
        <Stat label="Sun sign" value={txt(r.soorya_rasi)} />
        {a.lord && (
          <Stat label="Lagna lord" value={txt(a.lord)} />)}
        {a.nakshatra_lord && (
          <Stat label="Nakshatra lord" value={txt(a.nakshatra_lord)} />)}
        {a.element && <Stat label="Element" value={txt(a.element)} />}
        {a.modality && <Stat label="Modality" value={txt(a.modality)} />}
      </div>
      {n.personality && <Sec title="Personality">{n.personality}</Sec>}
      {n.career && <Sec title="Career">{n.career}</Sec>}
      {n.health && <Sec title="Health">{n.health}</Sec>}
      {n.love && <Sec title="Love and Relationships">{n.love}</Sec>}
      {n.life && <Sec title="Life Path">{n.life}</Sec>}
      <Sec title="Lucky">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <div>Deity: <b>{lucky.deity || '·'}</b></div>
          <div>Colour: <b>{lucky.color || '·'}</b></div>
          <div>Stone: <b>{lucky.stone || '·'}</b></div>
          <div>Direction: <b>{lucky.direction || '·'}</b></div>
          <div>Syllables: <b>{lucky.syllables || '·'}</b></div>
        </div>
      </Sec>
    </div>
  );
}
function Stat({ label, value, sub }) {
  return (
    <div>
      <span className="text-sub-text">{label}</span><br />
      <b>{value || '·'}</b>
      {sub && (
        <div className="text-[10px] text-sub-text">{sub}</div>
      )}
    </div>
  );
}

// ---------- Tab: Chart (North + South Indian, toggle) ------------
function ChartTab({ r, chartStyle, onChangeStyle }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-sub-text">Style:</span>
        {['north', 'south'].map((s) => (
          <button key={s} type="button" onClick={() => onChangeStyle(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold
              ${chartStyle === s
                ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {s === 'north' ? 'North Indian' : 'South Indian'}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-sub-text">
          Saved as default
        </span>
      </div>
      <div className="rounded-card bg-white p-3">
        <div className="mb-2 text-sm font-bold text-primary">
          Rasi chart (D1)
        </div>
        {chartStyle === 'north'
          ? <NorthChart r={r} />
          : <SouthChart r={r} />}
      </div>
    </div>
  );
}

// North Indian diamond chart - Lagna at top middle, houses run
// counter-clockwise. Drawn as a single SVG so it looks identical
// on web + bundled APK/iOS shells.
function NorthChart({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  const SHORT = {
    Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
    Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
  };
  // 12 house cells with x/y positions inside a 300x300 SVG.
  const CELLS = [
    { h: 1, x: 150, y: 75 },   { h: 12, x: 75, y: 75 },
    { h: 11, x: 75, y: 150 },  { h: 10, x: 75, y: 225 },
    { h: 9, x: 150, y: 225 },  { h: 8, x: 225, y: 225 },
    { h: 7, x: 225, y: 150 },  { h: 6, x: 225, y: 75 },
    { h: 5, x: 150, y: 35 },   { h: 4, x: 75, y: 35 },
    { h: 3, x: 35, y: 150 },   { h: 2, x: 75, y: 35 },
  ];
  // Simpler reliable layout: 4x4 grid with diamond split.
  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <svg viewBox="0 0 300 300" className="w-full">
        <rect x="10" y="10" width="280" height="280"
          fill="#fff" stroke="#7F2020" strokeWidth="2" />
        <line x1="10" y1="10" x2="290" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="290" y1="10" x2="10" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="150" y1="10" x2="10" y2="150"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="150" y1="10" x2="290" y2="150"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="290" y1="150" x2="150" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="10" y1="150" x2="150" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        {/* North Indian house numbers + planets */}
        {[
          { h: 1, x: 150, y: 90 },
          { h: 2, x: 75, y: 60 },
          { h: 3, x: 50, y: 120 },
          { h: 4, x: 80, y: 150 },
          { h: 5, x: 50, y: 180 },
          { h: 6, x: 75, y: 240 },
          { h: 7, x: 150, y: 210 },
          { h: 8, x: 225, y: 240 },
          { h: 9, x: 250, y: 180 },
          { h: 10, x: 220, y: 150 },
          { h: 11, x: 250, y: 120 },
          { h: 12, x: 225, y: 60 },
        ].map(({ h, x, y }) => {
          const ps = byHouse[h] || [];
          return (
            <g key={h}>
              <text x={x} y={y - 8} textAnchor="middle"
                fontSize="9" fill="#888">H{h}</text>
              <text x={x} y={y + 4} textAnchor="middle"
                fontSize="11" fontWeight="bold" fill="#1a1a2e">
                {ps.map((p) => SHORT[p.name] || p.name.slice(0, 2))
                  .join(' ')}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Ascendant (Lagna) is House 1. Counter-clockwise from there.
        {ascSign ? ` Your Lagna sign: ${ascSign}.` : ''}
      </p>
    </div>
  );
}

// South Indian chart - fixed sign layout, planets slot into the
// sign-cell they currently occupy. Always reads the same way.
function SouthChart({ r }) {
  const SIGN_CELLS = [
    { sign: 'Pisces',      col: 0, row: 0 },
    { sign: 'Aries',       col: 1, row: 0 },
    { sign: 'Taurus',      col: 2, row: 0 },
    { sign: 'Gemini',      col: 3, row: 0 },
    { sign: 'Aquarius',    col: 0, row: 1 },
    { sign: 'Cancer',      col: 3, row: 1 },
    { sign: 'Capricorn',   col: 0, row: 2 },
    { sign: 'Leo',         col: 3, row: 2 },
    { sign: 'Sagittarius', col: 0, row: 3 },
    { sign: 'Scorpio',     col: 1, row: 3 },
    { sign: 'Libra',       col: 2, row: 3 },
    { sign: 'Virgo',       col: 3, row: 3 },
  ];
  const bySign = {};
  (r.planets || []).forEach((p) => {
    if (!p.sign) return;
    (bySign[p.sign] = bySign[p.sign] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  const SHORT = {
    Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
    Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
  };
  return (
    <div className="mx-auto" style={{ maxWidth: 360 }}>
      <div className="grid grid-cols-4 overflow-hidden rounded
                      border-2 border-primary">
        {Array.from({ length: 16 }).map((_, idx) => {
          const col = idx % 4; const row = Math.floor(idx / 4);
          // Center 2x2 is empty (traditional kundli layout).
          if ((col === 1 || col === 2) && (row === 1 || row === 2)) {
            if (idx === 5) {
              return (
                <div key={idx}
                  className="col-span-2 row-span-2 flex items-center
                             justify-center border border-primary/30
                             bg-bg-light p-2 text-center text-xs
                             text-sub-text">
                  <div>
                    <div className="text-[10px] uppercase
                                    tracking-wide">
                      Lagna
                    </div>
                    <div className="font-bold text-primary">
                      {ascSign || '·'}
                    </div>
                  </div>
                </div>
              );
            }
            return null; // covered by the col-span-2 row-span-2
          }
          const cell = SIGN_CELLS.find(
            (c) => c.col === col && c.row === row);
          if (!cell) return <div key={idx} />;
          const ps = bySign[cell.sign] || [];
          const isAsc = cell.sign === ascSign;
          return (
            <div key={idx}
              className={`border border-primary/30 p-2 text-center
                ${isAsc ? 'bg-primary/10' : 'bg-white'}`}>
              <div className="text-[10px] text-sub-text">
                {cell.sign}
              </div>
              <div className="mt-1 min-h-[24px] text-xs
                              font-semibold text-dark-text">
                {ps.map((p) => SHORT[p.name] || p.name.slice(0, 2))
                  .join(' ') || ''}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Signs are fixed; the highlighted cell is your Lagna
        ({ascSign || '·'}).
      </p>
    </div>
  );
}

// ---------- Tab: Planets & Houses --------------------------------
function PlanetsTab({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  return (
    <div className="mt-3 space-y-4">
      <Sec title="Planet positions">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Planet</th>
                <th className="py-1 pr-3">Sign</th>
                <th className="py-1 pr-3">House</th>
                <th className="py-1 pr-3">Degree</th>
                <th className="py-1 pr-3">Nakshatra</th>
                <th className="py-1 pr-3">Pada</th>
                <th className="py-1 pr-3">Dignity</th>
                <th className="py-1">State</th>
              </tr>
            </thead>
            <tbody>
              {(r.planets || []).map((p) => (
                <tr key={txt(p.name)} className="border-t border-white">
                  <td className="py-1 pr-3 font-semibold">{txt(p.name)}</td>
                  <td className="py-1 pr-3">{txt(p.sign) || '·'}</td>
                  <td className="py-1 pr-3">{p.house ?? '·'}</td>
                  <td className="py-1 pr-3">{txt(p.degree) || '·'}</td>
                  <td className="py-1 pr-3">{txt(p.nakshatra) || '·'}</td>
                  <td className="py-1 pr-3">{p.pada ?? '·'}</td>
                  <td className={`py-1 pr-3 ${
                    txt(p.dignity) === 'Debilitated' ? 'text-danger'
                      : txt(p.dignity) === 'Exalted' ? 'text-success'
                        : ''}`}>{txt(p.dignity) || '·'}</td>
                  <td className="py-1">
                    {[p.retrograde ? 'R' : '',
                      p.combust ? 'C' : ''].filter(Boolean).join(' ')
                      || '·'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sec>
      <Sec title="Planets in houses">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3
                        md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <div key={h} className="rounded-card bg-white p-2">
              <div className="text-[10px] font-bold uppercase
                              tracking-wide text-sub-text">
                House {h}
              </div>
              <div className="mt-0.5 text-xs font-semibold
                              text-dark-text">
                {(byHouse[h] || []).map((p) => txt(p.name))
                  .filter(Boolean).join(', ') || '·'}
              </div>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  );
}

// ---------- Tab: Dashas (Vimshottari full + current 6 levels) ----
function DashaTab({ r }) {
  const [sub, setSub] = useState('current');
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          ['current', 'Current periods'],
          ['drilldown', '4-level drilldown'],
          ['table', 'Full Vimshottari (120 years)'],
          ['tree', 'Interactive tree'],
        ].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${sub === k ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {l}
          </button>
        ))}
      </div>
      {sub === 'current' && (
        <CurrentDashaCard cd={r.currentDasha} r={r} />
      )}
      {sub === 'drilldown' && (
        <DashaDrilldown dasha={r.dasha || []} />
      )}
      {sub === 'table' && (
        <Sec title="Vimshottari Maha Dasha (full lifetime, 120 years)">
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Mahadasha</th>
                <th className="py-1 pr-3">Starts</th>
                <th className="py-1 pr-3">Ends</th>
                <th className="py-1">Years</th>
              </tr>
            </thead>
            <tbody>
              {(r.dasha || []).map((d, i) => {
                const yrs = d.start && d.end
                  ? ((Date.parse(d.end) - Date.parse(d.start))
                     / (365.25 * 86400 * 1000)).toFixed(1)
                  : '·';
                return (
                  <tr key={i}
                    className={`border-t border-white ${d.current
                      ? 'bg-primary/10 font-bold' : ''}`}>
                    <td className="py-1 pr-3">
                      {d.planet}{d.current ? ' (current)' : ''}
                    </td>
                    <td className="py-1 pr-3">
                      {String(d.start || '').slice(0, 10)}
                    </td>
                    <td className="py-1 pr-3">
                      {String(d.end || '').slice(0, 10)}
                    </td>
                    <td className="py-1">{yrs}</td>
                  </tr>
                );
              })}
              {(r.dasha || []).length === 0 && (
                <tr><td colSpan="4" className="py-3 text-center
                  text-sub-text">
                  Dasha data is loading or unavailable for this profile.
                </td></tr>
              )}
            </tbody>
          </table>
        </Sec>
      )}
      {sub === 'tree' && (
        <Sec title="Interactive Vimshottari tree">
          <div className="space-y-1">
            {(r.dasha || []).length === 0 && (
              <div className="text-sub-text">No dasha data.</div>
            )}
            {(r.dasha || []).map((d, i) => (
              <DashaRow key={i} d={d}
                planets={r.planets || []}
                showInsight={r._showDashaInsight !== false} />
            ))}
          </div>
        </Sec>
      )}
    </div>
  );
}

// ---------- 4-level interactive drilldown ----------------------
// AstroTalk-style: click a Mahadasha to see its 9 Antardashas,
// click an Antardasha to see its 9 Pratyantars, click a Pratyantar
// to see its 9 Sookshmas. "LEVEL UP" button climbs back. The Maha
// level comes straight from r.dasha; the deeper levels are computed
// with proportional Vimshottari math (no extra API calls).
const LEVEL_LABELS = [
  'Mahadasha', 'Antardasha', 'Pratyantardasha', 'Sookshmadasha',
];

function DashaDrilldown({ dasha }) {
  // path = chain of selections, one per level above the one we're
  // currently viewing. path[0] = chosen Maha, path[1] = chosen
  // Antar, path[2] = chosen Pratyantar. Length 0 = looking at the
  // list of 9 Mahas. Length 3 = looking at 9 Sookshmas (deepest).
  const [path, setPath] = useState([]);
  const nowMs = Date.now();

  // Normalize the maha list once: { lord, startMs, endMs }.
  const mahas = (dasha || [])
    .map((d) => {
      const startMs = vimshottari.toMs(d.start);
      const endMs = vimshottari.toMs(d.end);
      const lord = vimshottari.normalizeLord(d.planet) || d.planet;
      if (!lord || !Number.isFinite(startMs)
          || !Number.isFinite(endMs)) return null;
      return { lord, startMs, endMs };
    })
    .filter(Boolean);

  if (!mahas.length) {
    return (
      <div className="rounded-card bg-white p-4 text-sm text-sub-text">
        Dasha data unavailable for this profile yet. Re-open the
        kundli to fetch from the provider.
      </div>
    );
  }

  // Walk the path. At each level the "current" list is the children
  // of the selected node from the prior level.
  let current = mahas;
  for (let i = 0; i < path.length; i += 1) {
    const node = current[path[i]];
    if (!node) { current = []; break; }
    current = vimshottari.subPeriods(node);
  }
  const depth = path.length; // 0 = Maha, 3 = Sookshma
  const canDrill = depth < 3;

  // Build the breadcrumb of selected lords (with short labels).
  const crumbs = [];
  let cursor = mahas;
  for (let i = 0; i < path.length; i += 1) {
    const sel = cursor[path[i]];
    if (!sel) break;
    crumbs.push(sel);
    cursor = vimshottari.subPeriods(sel);
  }

  const curIdx = vimshottari.findCurrent(current, nowMs);

  return (
    <div className="space-y-3">
      {/* Stepper: 4 chips showing the 4 levels, with the
          currently-viewed level highlighted + breadcrumb of
          chosen lords underneath. */}
      {/* Horizontal 4-step stepper matching the AstroTalk reference.
          Numbered circles connected by a dashed line; active = yellow,
          visited = success-green, todo = gray. Tap any visited step to
          jump back to that level. */}
      <div className="rounded-card border border-gray-200 bg-white p-3">
        <div className="mb-3 text-center text-[11px] font-bold
          uppercase tracking-wider text-sub-text">
          Vimshottari Dasha
        </div>
        <div className="relative flex items-start justify-between">
          <div className="absolute left-6 right-6 top-3
            border-t border-dashed border-gray-300" />
          {LEVEL_LABELS.map((label, i) => {
            const active = i === depth;
            const visited = i < depth;
            const sel = crumbs[i];
            return (
              <button key={label} type="button"
                disabled={i > depth}
                onClick={() => setPath(path.slice(0, i))}
                className="relative z-10 flex flex-col items-center
                  bg-bg-light px-1
                  disabled:cursor-default">
                <span className={`grid h-7 w-7 place-items-center
                  rounded-full text-[12px] font-bold transition
                  ${active ? 'bg-primary text-white shadow'
                    : visited ? 'bg-success text-white'
                      : 'bg-gray-100 text-sub-text'}`}>
                  {i + 1}
                </span>
                <span className={`mt-1 text-center text-[10px]
                  font-bold ${active ? 'text-dark-text'
                    : visited ? 'text-success' : 'text-sub-text'}`}>
                  {label}
                </span>
                {sel && (
                  <span className="text-[9px] text-sub-text">
                    {vimshottari.SHORT[sel.lord] || sel.lord}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {crumbs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center
            justify-center gap-1.5 border-t border-gray-100 pt-2
            text-[10px] text-sub-text">
            <span className="font-semibold">Path:</span>
            {crumbs.map((c, i) => (
              <span key={i} className="rounded-full bg-bg-light
                px-2 py-0.5 font-bold text-dark-text">
                {vimshottari.SHORT[c.lord] || c.lord}
                {i < crumbs.length - 1 && (
                  <span className="ml-1 opacity-50">›</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Level Up button - visible whenever we're below level 1.
          AstroTalk reference shows this as a full-width yellow strip
          underneath the table; we use a centered pill that fits the
          same visual language. */}
      {depth > 0 && (
        <button type="button"
          onClick={() => setPath(path.slice(0, -1))}
          className="mx-auto block rounded-full bg-primary px-6
            py-1.5 text-[11px] font-bold uppercase tracking-wider
            text-white shadow-sm hover:opacity-90">
          LEVEL UP
        </button>
      )}

      {/* List of 9 children at the current level. Click any
          row to drill one level deeper (unless we're at the
          deepest level - Sookshma - already). */}
      <div className="rounded-card bg-white p-2">
        <div className="mb-1 px-2 text-[11px] font-bold
          uppercase tracking-wide text-sub-text">
          {LEVEL_LABELS[depth]}
          {' · '}
          {current.length} periods
          {canDrill && ' · tap a row to drill deeper'}
        </div>
        <div className="space-y-1">
          {current.map((c, i) => {
            const isCur = i === curIdx;
            return (
              <button key={i} type="button"
                disabled={!canDrill}
                onClick={() => canDrill
                  && setPath([...path, i])}
                className={`flex w-full items-center
                  justify-between gap-2 rounded-card px-3 py-2
                  text-left text-[12px] transition
                  ${isCur
                    ? 'bg-primary/10 font-bold text-primary'
                    : 'bg-gray-50 hover:bg-primary/5'}
                  ${canDrill ? 'cursor-pointer' : 'cursor-default'}`}>
                <span className="flex items-center gap-2">
                  <span className={`inline-flex h-6 w-9
                    items-center justify-center rounded-full
                    text-[10px] font-extrabold
                    ${isCur
                      ? 'bg-primary text-white'
                      : 'bg-white text-primary'}`}>
                    {vimshottari.SHORT[c.lord] || c.lord}
                  </span>
                  <span>{c.lord}</span>
                  {isCur && (
                    <span className="rounded-full bg-accent
                      px-2 py-0.5 text-[9px] font-bold text-white">
                      now
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2
                  text-[10.5px] text-sub-text">
                  <span>{vimshottari.fmtDate(c.startMs)}</span>
                  <span className="opacity-50">→</span>
                  <span>{vimshottari.fmtDate(c.endMs)}</span>
                  {canDrill && (
                    <span className={`ml-1 ${isCur
                      ? 'text-primary' : 'text-sub-text'}`}>›</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {!canDrill && (
          <p className="mt-2 px-2 text-[10px] text-sub-text">
            You're at the deepest level (Sookshma).
            Use LEVEL UP to climb back.
          </p>
        )}
      </div>
    </div>
  );
}

// Vedic planetary themes - what the planet typically governs.
const PLANET_THEME = {
  Sun: 'authority and self-confidence',
  Moon: 'emotions and inner comfort',
  Mars: 'energy, courage and drive',
  Mercury: 'communication and intellect',
  Jupiter: 'wisdom, expansion and good fortune',
  Venus: 'relationships, art and material comfort',
  Saturn: 'discipline, patience and slow but lasting gains',
  Rahu: 'ambition, sudden change and foreign opportunities',
  Ketu: 'detachment, spirituality and quiet introspection',
};

// What each Vedic house signifies in plain language.
const HOUSE_MEANING = {
  1: 'your sense of self and outward identity',
  2: 'finances, family and personal values',
  3: 'siblings, courage and short travels',
  4: 'home, mother and emotional security',
  5: 'children, creativity and intelligence',
  6: 'health, daily routine and competition',
  7: 'partnerships and marriage',
  8: 'transformation, research and hidden matters',
  9: 'fortune, higher learning and dharma',
  10: 'career, public standing and authority',
  11: 'gains, friendships and goals',
  12: 'release, foreign lands and spiritual retreat',
};

// Look up which house a planet sits in. Returns 0 when the chart
// has no data for that planet (Sookshma+ are sometimes absent).
function houseOf(rPlanets, planetName) {
  const want = String(planetName || '').toLowerCase();
  const p = (rPlanets || []).find((x) =>
    String(x.name || '').toLowerCase() === want);
  const h = p && Number(p.house);
  return Number.isFinite(h) && h >= 1 && h <= 12 ? h : 0;
}

function CurrentDashaCard({ cd, r }) {
  if (!cd || !cd.planet) {
    return <div className="rounded-card bg-white p-3 text-sm
      text-sub-text">No current period data yet.</div>;
  }
  const levels = [
    ['Maha', cd.planet, cd.start, cd.end],
    cd.antar && ['Antar', cd.antar.planet,
      cd.antar.start, cd.antar.end],
    cd.pratyantar && ['Pratyantar', cd.pratyantar.planet,
      cd.pratyantar.start, cd.pratyantar.end],
  ].filter(Boolean);

  // CHART-BACKED prediction. We look up the actual house each of the
  // three active dasha lords occupies in the user's natal chart, then
  // string them together with each planet's traditional significations
  // PLUS what those houses govern. Result: a prediction grounded in
  // the user's real positions (not just a generic planet-theme line).
  const rPlanets = (r && r.planets) || [];
  const lord = (label) => {
    const planet = (levels.find((l) => l[0] === label) || [])[1] || '';
    const house = houseOf(rPlanets, planet);
    return {
      planet,
      house,
      theme: PLANET_THEME[planet] || 'shifting themes',
      houseSig: house ? HOUSE_MEANING[house] : '',
    };
  };
  const M = lord('Maha');
  const A = lord('Antar');
  const P = lord('Pratyantar');

  const sentence = (x, prefix) => {
    if (!x.planet) return '';
    if (x.house) {
      return `${prefix} ${x.planet} sits in your ${x.house}th house, `
        + `so its ${x.theme} flows through ${x.houseSig}.`;
    }
    return `${prefix} ${x.planet} brings ${x.theme}.`;
  };

  // Deduplicate: when two or three levels share the same planet (very
  // common at the very start of a new Maha period when Antar +
  // Pratyantar are also that lord), the old code printed the same
  // sentence two or three times. Detect the duplicates and write
  // one stronger, consolidated sentence instead.
  let prediction = '';
  if (M.planet) {
    const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd'
      : n === 3 ? 'rd' : 'th'}`;
    const allSame = M.planet && M.planet === A.planet
      && M.planet === P.planet;
    const mEqualsA = M.planet && M.planet === A.planet
      && M.planet !== P.planet;
    const aEqualsP = A.planet && A.planet === P.planet
      && A.planet !== M.planet;
    if (allSame) {
      // Triple alignment - say it once, hard.
      prediction = `All three active periods are ruled by ${M.planet}, `
        + `so this window is doubly weighted toward ${M.theme}`
        + (M.house ? `, with ${ordinal(M.house)}-house themes of `
          + `${M.houseSig} clearly in focus. ` : '. ')
        + 'Channel this concentrated energy into one or two clear '
        + 'priorities for the cleanest results.';
    } else if (mEqualsA) {
      // Maha + Antar share a lord, Pratyantar differs.
      prediction = `Both your major and sub-period lords are `
        + `${M.planet}`
        + (M.house ? `, sitting in your ${ordinal(M.house)} house `
          + `of ${M.houseSig}` : '')
        + `. Its ${M.theme} is the dominant note right now. `
        + sentence(P, 'Within that, the active inner lord')
        + ' Lean into these themes for the smoothest results.';
    } else if (aEqualsP) {
      prediction = sentence(M, 'Your major-period lord')
        + ` Both your sub-period and inner lords are ${A.planet}`
        + (A.house ? `, in your ${ordinal(A.house)} house of `
          + `${A.houseSig}` : '')
        + `, so its ${A.theme} colours the months ahead. `
        + 'Lean into these themes for the smoothest results.';
    } else {
      // Three distinct lords - original three-sentence template.
      prediction = [
        sentence(M, 'Your major-period lord'),
        A.planet && sentence(A, 'The current sub-period lord'),
        P.planet && sentence(P, 'Within that, the active inner lord'),
        'Lean into these themes through this window for the '
        + 'smoothest results.',
      ].filter(Boolean).join(' ');
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl
      bg-gradient-to-br from-[#7F2020] to-[#B45309] text-white
      shadow-md">
      {/* Header strip - eyebrow only, no big duplicated title row */}
      <div className="px-4 pt-4">
        <div className="text-[11px] font-bold uppercase
          tracking-[0.18em] opacity-85">
          Currently running
        </div>
      </div>

      {/* Three clean rows, one per active level. Planet name first
          (bold) so the eye lands on "Jupiter" before the dates. */}
      <div className="space-y-2 px-4 py-3">
        {levels.map(([label, planet, s, e]) => (
          <div key={label}
            className="rounded-xl bg-white/10 p-2.5
              backdrop-blur-sm">
            <div className="flex items-center justify-between
              gap-2">
              <div className="text-[14px] font-bold leading-tight">
                {planet}
              </div>
              <span className="rounded-full bg-white/20 px-2
                py-0.5 text-[10px] font-bold uppercase
                tracking-wider">
                {label}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] opacity-85">
              {fmtDateLong(String(s || '').slice(0, 10))}{' '}
              <span className="opacity-60">to</span>{' '}
              {fmtDateLong(String(e || '').slice(0, 10))}
            </div>
          </div>
        ))}
      </div>

      {/* Prediction tied to actual chart houses */}
      {prediction && (
        <div className="border-t border-white/15 bg-black/15 p-4
          text-[12.5px] leading-relaxed">
          <div className="text-[10px] font-bold uppercase
            tracking-[0.18em] opacity-85">
            What this means for you
          </div>
          <p className="mt-1.5">{prediction}</p>
        </div>
      )}
    </div>
  );
}

// ---------- Tab: Transits ----------------------------------------
function TransitsTab({ r }) {
  // Transits are typically retrieved per-date. AstroSeer's main
  // /api/kundli returns raw.transits = current snapshot. We show
  // that + a date input so the user can recompute via the relay.
  const t = (r.raw && r.raw.transits) || null;
  const planets = t && (t.planets || t.planetary_position) || [];
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Transits (current planetary positions vs your natal chart)">
        <p className="mb-2 text-[11px] text-sub-text">
          A transit happens when a planet's current sky position
          activates a house or planet in your birth chart. Mark a
          period for the future or past below to see what was/will
          be active then.
        </p>
        {planets.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm
                          text-sub-text">
            Transit snapshot is loading. Refresh in a moment if it
            stays empty.
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Planet</th>
                <th className="py-1 pr-3">Now in sign</th>
                <th className="py-1 pr-3">House (vs natal)</th>
                <th className="py-1">Aspecting natal</th>
              </tr>
            </thead>
            <tbody>
              {planets.map((p, i) => (
                <tr key={i} className="border-t border-white">
                  <td className="py-1 pr-3 font-semibold">
                    {p.name || p.planet}
                  </td>
                  <td className="py-1 pr-3">{p.sign || '·'}</td>
                  <td className="py-1 pr-3">{p.house ?? '·'}</td>
                  <td className="py-1">
                    {Array.isArray(p.aspects)
                      ? p.aspects.join(', ')
                      : (p.aspects || '·')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Sec>
    </div>
  );
}

// ---------- Tab: Yogas -------------------------------------------
function YogasTab({ r, raw }) {
  // Use raw.yogas_detected when present (AstroSeer v1.1+), fall
  // back to the top-level mapped yogas array.
  const yogas = (Array.isArray(raw.yogas_detected) && raw.yogas_detected)
    || (Array.isArray(r.yogas) && r.yogas) || [];
  return (
    <div className="mt-3 space-y-3">
      <Sec title={`Yogas detected (${yogas.length})`}>
        {yogas.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm
                          text-sub-text">
            No special yogas detected in this chart.
          </div>
        ) : (
          <div className="space-y-2">
            {yogas.map((y, i) => {
              const name = y.name || y.title || y;
              const desc = y.description || y.effect || y.meaning;
              return (
                <div key={i} className="rounded-card bg-white p-3">
                  <div className="font-bold text-primary">{name}</div>
                  {desc && (
                    <p className="mt-1 text-[12px] text-dark-text">
                      {desc}
                    </p>
                  )}
                  {y.planets && Array.isArray(y.planets) && (
                    <div className="mt-1 text-[10px] text-sub-text">
                      Formed by: {y.planets.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Sec>
    </div>
  );
}

// ---------- Tab: Doshas (with future/past date check) ------------
function DoshasTab({ r, raw }) {
  const doshas = raw.doshas_full || r.doshas || {};
  const [date, setDate] = useState(
    () => new Date().toISOString().slice(0, 10));
  // Sade Sati window check: pure client-side, runs against Saturn
  // transit windows over the natal Moon sign. AstroSeer returns
  // doshas.sade_sati with start/end ranges when available.
  function sadeSatiActiveAt(d) {
    const ss = doshas.sade_sati;
    if (!ss || !Array.isArray(ss.windows)) return null;
    const t = Date.parse(d);
    return ss.windows.find(
      (w) => Date.parse(w.start) <= t && t <= Date.parse(w.end))
      || null;
  }
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-sub-text">
          Check dosha status at any date:
        </label>
        <input type="date" className="input !w-auto !min-h-0 py-1
                                       text-xs"
          value={date}
          onChange={(e) => setDate(e.target.value)} />
      </div>
      <Sec title="Mangal Dosha">
        <DoshaCard
          present={!!(doshas.mangal && doshas.mangal.present)}
          severity={doshas.mangal && doshas.mangal.severity}
          note={doshas.mangal && doshas.mangal.note}
          extra="Activated by Mars in 1, 2, 4, 7, 8 or 12. Affects
                 marriage compatibility. Remedies: Hanuman Chalisa
                 Tuesdays, coral on right ring finger after
                 consulting an astrologer." />
      </Sec>
      <Sec title="Kalsarp Dosha">
        <DoshaCard
          present={!!(doshas.kalsarp && doshas.kalsarp.present)}
          severity={doshas.kalsarp && doshas.kalsarp.type}
          note={doshas.kalsarp && doshas.kalsarp.note}
          extra="All planets between Rahu and Ketu. Causes delays
                 and obstacles. Remedies include silver naag-naagin
                 worship and Naga Panchami rituals." />
      </Sec>
      <Sec title="Sade Sati">
        {(() => {
          const active = sadeSatiActiveAt(date);
          if (!doshas.sade_sati) {
            return <div className="rounded-card bg-white p-3 text-sm
              text-sub-text">Sade Sati data not available.</div>;
          }
          return (
            <DoshaCard
              present={!!active}
              severity={active ? active.phase : doshas.sade_sati.current_phase}
              note={active
                ? `Active on ${date}. Phase: ${active.phase}.`
                : `Not active on ${date}.`}
              extra="Saturn transiting the 12th, 1st and 2nd houses
                     from natal Moon. Slows things down, tests
                     patience. Remedies: Hanuman Chalisa, mustard
                     oil offerings to Saturn on Saturdays." />
          );
        })()}
      </Sec>
    </div>
  );
}
function DoshaCard({ present, severity, note, extra }) {
  return (
    <div className={`rounded-card p-3 text-sm ${present
      ? 'border border-warning/40 bg-warning/5'
      : 'border border-success/30 bg-success/5'}`}>
      <div className={`font-bold ${present
        ? 'text-warning' : 'text-success'}`}>
        {present ? 'Present' : 'Not present'}
        {present && severity ? ` · ${severity}` : ''}
      </div>
      {note && (
        <p className="mt-1 text-[12px] text-dark-text">{note}</p>
      )}
      {extra && (
        <p className="mt-1 text-[11px] text-sub-text">{extra}</p>
      )}
    </div>
  );
}

// ---------- Tab: Panchang ----------------------------------------
function PanchangTab({ r, raw }) {
  const p = (raw && raw.panchang) || r.panchang || {};
  const items = [
    ['Tithi', p.tithi],
    ['Yoga', p.yoga],
    ['Karana', p.karana],
    ['Nakshatra', p.nakshatra],
    ['Day of birth', p.day_of_birth || p.weekday],
    ['Hindu weekday', p.hindu_weekday],
    ['Sunrise', p.sunrise],
    ['Sunset', p.sunset],
    ['Moonrise', p.moonrise],
    ['Moonset', p.moonset],
    ['Paksha', p.paksha],
    ['Rahu kaalam', p.rahu_kaal],
    ['Gulika kaalam', p.gulika_kaal],
    ['Yamaganda', p.yamaganda],
  ].filter(([, v]) => v && (typeof v !== 'object' || v.name));
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Panchang at your birth">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-card bg-white p-2">
              <div className="text-[10px] uppercase tracking-wide
                              text-sub-text">{label}</div>
              <div className="mt-0.5 text-xs font-semibold
                              text-dark-text">
                {typeof value === 'object'
                  ? (value.name || JSON.stringify(value).slice(0, 40))
                  : value}
              </div>
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <div className="text-sub-text">No panchang data.</div>
        )}
      </Sec>
    </div>
  );
}

// ---------- Tab: Compatibility (Guna Milan) ----------------------
function CompatibilityTab() {
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Guna Milan (marriage compatibility)">
        <p className="text-[12px] text-dark-text">
          Match two charts using the Ashta-Koota 36-point system.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link href="/matching"
            className="rounded-full bg-primary py-2 text-center
              text-xs font-bold text-white">
            Pick a partner from saved profiles
          </Link>
          <Link href="/matching"
            className="rounded-full border border-primary py-2
              text-center text-xs font-bold text-primary">
            Enter partner details manually
          </Link>
        </div>
        <p className="mt-2 text-[10px] text-sub-text">
          Both options take you to the Matching page where your
          chart is pre-filled and you only add the partner.
        </p>
      </Sec>
    </div>
  );
}

// ---------- Tab: Numerology --------------------------------------
function NumerologyTab() {
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Numerology">
        <p className="text-[12px] text-dark-text">
          Driver / conductor / soul numbers, lucky days, gemstones
          and detailed numerology reading powered by your name and
          DOB.
        </p>
        <Link href="/numerology"
          className="mt-3 inline-block rounded-full bg-primary px-4
            py-2 text-xs font-bold text-white">
          Open Numerology
        </Link>
      </Sec>
    </div>
  );
}

// ---- Report CTAs (free + paid) ------------------------------------
// Two buttons that sit inside the FullKundli card:
//   1. Free 250+ page Vedic kundli - server-side PDF, emailed,
//      downloadable immediately + later from /orders.
//   2. Paid 12-month forecast - price comes from Firestore
//      settings/config.kundli_report_price (default 50, set by
//      admin). Wallet-deducted server-side inside a Firestore
//      transaction; insufficient balance pops a "Top up wallet"
//      link instead of failing silently.
// On success the user sees an immediate Download popup with the
// signed Firebase Storage URL - same one stored on users/{uid}/
// orders/{id} for unlimited re-download.
// Table of contents shown in the confirm popup so the customer
// knows exactly what they're getting before we deduct any money
// (paid kind) or kick off any processing (free kind).
// Sections + names live in shared/reportTypes.js so client + relay
// stay in sync (one place to add a new product).
import { REPORT_TYPES, reportType, resolvePrice } from '@astro/shared';

function ReportButtons({ kundli }) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Per-report-type prices. Loaded from settings/config once.
  const [prices, setPrices] = useState(() => {
    const out = {};
    REPORT_TYPES.forEach((t) => { out[t.id] = t.defaultPrice; });
    return out;
  });
  // Holds the kind the user clicked. Non-null = confirm popup open.
  const [pending, setPending] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const cfg = await kundliService.readSettingsConfig();
        const next = {};
        REPORT_TYPES.forEach((t) => {
          next[t.id] = resolvePrice(t.id, cfg);
        });
        setPrices(next);
      } catch (_) { /* keep defaults */ }
    })();
  }, []);
  async function buy(kind) {
    setError(null); setBusy(kind); setResult(null);
    try {
      const uid = kundli && kundli.userId;
      if (!uid || !kundli.id) {
        throw new Error('Save a kundli profile first.');
      }
      const out = await kundliService.requestReport({
        uid, kundliProfileId: kundli.id, kind,
      });
      setResult(out);
    } catch (e) {
      setError(e);
    } finally { setBusy(''); }
  }
  // Show confirm popup; only on Yes does buy() actually fire.
  function ask(kind) {
    setError(null); setResult(null);
    setPending({ kind, price: prices[kind] || 0 });
  }
  // Build a per-type button. Free uses primary maroon; paid types
  // use accent + show the live price.
  const renderButton = (t) => {
    const price = prices[t.id] || 0;
    const isPaid = price > 0;
    const isBusy = busy === t.id;
    const busyLabel = t.id === 'free' ? 'Preparing…' : 'Charging wallet…';
    const label = isPaid
      ? `${t.shortName} · ₹${price} from wallet`
      : t.shortName;
    return (
      <button key={t.id} type="button" onClick={() => ask(t.id)}
        disabled={!!busy}
        className={`rounded-full px-3 py-1.5 text-xs font-bold
          text-white disabled:opacity-60 ${isPaid
            ? 'bg-accent' : 'bg-primary'}`}>
        {isBusy ? busyLabel : label}
      </button>
    );
  };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {REPORT_TYPES.map(renderButton)}
      </div>
      {error && (
        <div className="rounded-card bg-danger/10 p-2 text-xs text-danger">
          {error.code === 'insufficient_wallet' ? (
            <>
              Wallet balance ₹{error.wallet || 0} is not enough for
              ₹{error.price || price}.{' '}
              <a href="/wallet" className="font-bold underline">
                Add money to wallet
              </a>
            </>
          ) : (
            <>
              Could not generate the report: {error.message}
              {error.refunded ? ' (wallet refunded automatically)' : ''}
            </>
          )}
        </div>
      )}
      {pending && (
        <ConfirmReportPopup
          spec={(() => {
            const t = reportType(pending.kind);
            if (!t) return null;
            return {
              title: t.name,
              badge: t.defaultPrice === 0 ? 'No charge' : '',
              sections: t.sections,
              tat: t.tat,
              confirmCta: t.confirmCta,
              summary: t.summary,
            };
          })()}
          price={pending.price}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const k = pending.kind;
            setPending(null);
            buy(k);
          }}
        />
      )}
      {result && result.ok && (
        <DownloadPopup result={result}
          onClose={() => setResult(null)} />
      )}
    </div>
  );
}

// Pre-purchase confirm popup. Lists every section the report will
// contain + the expected delivery time + the price (for paid kinds).
// Two CTAs, Cancel on the left and the action on the right so the
// user has a real "are you sure?" beat before any wallet deduction.
function ConfirmReportPopup({ spec, price, kind, onCancel, onConfirm }) {
  if (!spec) return null;
  const isPaid = kind === 'forecast12';
  // Professional, dash-free layout: serif-feel title, a single muted
  // divider, a numbered list (no colourful emojis), a quiet outlined
  // delivery panel and balanced full-width CTAs. Replaces the older
  // emoji-heavy / dash-heavy popup that read "messy".
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
                    justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
                      bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-100 px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-primary">
              {spec.title}
            </h2>
            <span className={`shrink-0 rounded-full px-3 py-1
                text-[11px] font-bold uppercase tracking-wide
                ${isPaid
                  ? 'bg-accent/10 text-accent'
                  : 'bg-success/10 text-success'}`}>
              {isPaid ? `₹${price} from wallet` : spec.badge}
            </span>
          </div>
          {spec.summary && (
            <p className="mt-2 text-[13px] leading-snug text-dark-text">
              {spec.summary}
            </p>
          )}
          <p className="mt-2 text-xs font-medium uppercase
                        tracking-wide text-sub-text">
            What is included in your PDF
          </p>
        </div>

        {/* Sections - numbered, plain text, scrollable */}
        <ol className="max-h-72 list-none space-y-2 overflow-auto
                       px-5 py-4 text-[13px] leading-snug
                       text-dark-text">
          {spec.sections.map((text, i) => (
            <li key={text} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0
                  items-center justify-center rounded-full
                  bg-primary/10 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>

        {/* Delivery panel */}
        <div className="border-t border-gray-100 bg-bg-light px-5 py-3">
          <div className="text-[11px] font-bold uppercase
                          tracking-wide text-primary">
            Delivery
          </div>
          <p className="mt-1 text-[12px] leading-snug text-dark-text">
            {spec.tat}
          </p>
        </div>

        {/* CTAs */}
        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onCancel}
            className="flex-1 rounded-full border border-gray-300
              bg-white py-2.5 text-sm font-bold text-dark-text
              transition hover:bg-bg-light">
            No
          </button>
          <button type="button" onClick={onConfirm}
            className={`flex-1 rounded-full py-2.5 text-sm
              font-bold text-white shadow-sm transition
              ${isPaid
                ? 'bg-accent hover:brightness-95'
                : 'bg-primary hover:brightness-95'}`}>
            {spec.confirmCta}
          </button>
        </div>
      </div>
    </div>
  );
}

// Themed download popup. Shows the moment the relay returns the
// signed URL. Single primary CTA + hint that the same PDF is also
// in their email + the Orders section for later.
function DownloadPopup({ result, onClose }) {
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
                    justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl
                      bg-white shadow-2xl">
        {/* Header strip on the brand colour - gives a confident,
            professional vibe without resorting to emoji confetti. */}
        <div className="bg-primary px-5 py-4 text-white">
          <div className="text-[11px] font-bold uppercase
                          tracking-wide opacity-80">
            Report ready
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {result.kind === 'forecast12'
              ? '12-Month Forecast'
              : 'Your Vedic Kundli'}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 text-center">
          <p className="text-[13px] leading-snug text-dark-text">
            Your PDF is ready to download.
          </p>
          <p className="mt-2 text-[12px] text-sub-text">
            {result.amount > 0
              ? `₹${result.amount} deducted from wallet. `
              : ''}
            {result.emailed
              ? 'A copy has also been sent to your email. '
              : ''}
            Saved in Orders for unlimited re-download.
          </p>

          <button type="button"
            onClick={() => kundliService.downloadPdfFromUrl(
              result.pdfUrl,
              result.pdfName || 'AstroSeer-Kundli.pdf')}
            className="mt-4 block w-full rounded-full bg-primary
              py-2.5 text-sm font-bold text-white shadow-sm
              transition hover:brightness-95">
            Download PDF now
          </button>
          <a href="/orders"
            className="mt-2 block text-xs font-semibold text-primary
                       hover:underline">
            View all my orders
          </a>
          <button type="button" onClick={onClose}
            className="mt-2 block w-full text-xs text-sub-text
                       hover:text-dark-text">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// 12-house grid showing planets in each bhava + ascendant marker.
// Used as a fallback when the provider didn't ship a rendered SVG
// chart (AstroSeer's /api/kundli omits charts by design - they sit
// on a separate /api/chart/render endpoint we'll wire later). Far
// more useful than the old "Chart image unavailable on the current
// Prokerala plan" placeholder, which read like a broken feature to
// the user.
function HouseGrid({ r, title }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) {
      (byHouse[h] = byHouse[h] || []).push(p.name);
    }
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  return (
    <div>
      <div className="mb-2 text-sm font-bold text-primary">{title}</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => {
          const planets = byHouse[h] || [];
          return (
            <div key={h}
              className={`rounded-card border p-2 text-center
                ${h === 1
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-gray-200 bg-white'}`}>
              <div className="text-[10px] uppercase tracking-wide
                              text-sub-text">
                House {h}{h === 1 && ascSign ? ` · ${ascSign}` : ''}
              </div>
              <div className="mt-1 min-h-[36px] text-xs font-semibold
                              text-dark-text">
                {planets.length ? planets.join(', ') : '·'}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-sub-text">
        House 1 holds the Ascendant (Lagna). Read planets in each
        bhava with their lord + nakshatra (see Planets & Houses tab).
      </p>
    </div>
  );
}

// =====================================================================
// API PDF HERO + PDF VIEWER POPUP + PREMIUM REPORTS TAB
//
// Three pieces, all user-requested in the long feedback message:
//
//   1. ApiPdfHero          - sits at the top of the Free Report tab.
//                            Renders a prominent card that triggers
//                            generation (or fetches the cached order)
//                            of the API-generated PDF, then opens it
//                            in a popup with View / Download / Close
//                            buttons. This is the format the customer
//                            asked us to use everywhere; we no longer
//                            ship the HTML-print-dialog flavour as the
//                            default report.
//
//   2. PdfViewerPopup      - in-app PDF viewer modal. iframe for web
//                            and desktop, plus a Download button that
//                            uses the upgraded kundliService
//                            .downloadPdfFromUrl helper (which now
//                            falls back to opening in the OS browser
//                            on Capacitor iOS / Android so the file
//                            actually lands in Files / Downloads).
//
//   3. PremiumReportsTab   - new top-level kundli tab. Lists every
//                            paid report type as a card on a dashboard
//                            grid with a SINGLE-COLOUR icon (not a
//                            colourful emoji), the price, a Demo link
//                            that previews the section list + delivery
//                            time, and a Buy CTA that runs the same
//                            wallet-deduct flow the existing
//                            ReportButtons component uses.
// =====================================================================

function ApiPdfHero({ kundli }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [viewing, setViewing] = useState(false);
  const [err, setErr] = useState('');
  // Live progress message during the 5-min async polling window.
  const [progress, setProgress] = useState('');
  // Live state of the auto-generated free order for this profile.
  // null = none, 'generating' = in flight, 'ready' = available,
  // 'failed' = AstroSeer rejected. Polled via Firestore onSnapshot
  // so the customer sees the state flip live.
  const [autoGen, setAutoGen] = useState({ status: null });
  // (Send-via-email button was removed 2026-05-28 - per user
  // requirement the Free Report card carries ONLY View + Download.
  // Email delivery for paid reports happens automatically when the
  // relay finishes generating; auto-generated free reports never
  // auto-email.)

  // Pre-warm the AstroSeer Render dyno on mount so the customer's
  // click goes against a hot dyno (5-15s) instead of a cold one
  // (30-60s).
  useEffect(() => { kundliService.wakeAstroSeer(); }, []);

  // FIRESTORE-FREE PIPELINE (user requirement 2026-05-29):
  // On mount, immediately probe the deterministic R2 URL for this
  // profile's PDF. If hit -> instant ready state. If miss -> fire
  // a regenerate request (still no Firestore involved). Then poll
  // every 25s until ready. This is the path that works even when
  // Firebase is at quota.
  useEffect(() => {
    if (!kundli || !kundli.id) return undefined;
    let cancelled = false;
    let pollId = null;
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await kundliService.ensureKundliPdfReady(kundli);
        if (cancelled) return;
        if (r && r.pdfUrl) {
          setAutoGen({ status: 'ready', order: { id: r.orderId },
            url: r.pdfUrl,
            name: `AstroSeer-Kundli-${kundli.name || ''}.pdf` });
          if (pollId) clearInterval(pollId);
          pollId = null;
        } else if (r && r.status === 'generating') {
          setAutoGen((cur) => (cur.status === 'ready' ? cur
            : { status: 'generating', order: { id:
              kundliService.profileOrderId(kundli) } }));
        }
      } catch (_) { /* keep polling */ }
    };
    tick();                                              // fire now
    pollId = setInterval(tick, 25 * 1000);               // every 25s
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [kundli && kundli.id]);

  // Subscribe to this profile's free orders so we can detect when
  // a background auto-generated order is in flight (and show the
  // "you'll be notified shortly" popup if the customer impatiently
  // clicks View PDF before it finishes) - or already ready (skip
  // the order modal and open the PDF directly).
  useEffect(() => {
    if (!kundli || !kundli.id || !kundli.userId) return undefined;
    let unsub;
    (async () => {
      try {
        const { collection, query, where, onSnapshot } = await import(
          'firebase/firestore');
        const { db: fdb } = await import('@astro/shared');
        const q = query(
          collection(fdb, 'users', kundli.userId, 'orders'),
          where('kundliProfileId', '==', kundli.id),
          where('kind', '==', 'free'),
        );
        unsub = onSnapshot(q, (snap) => {
          // Sort newest first, then pick the first ready (else
          // generating, else failed).
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
              const at = (a.paidAt && a.paidAt.toMillis
                && a.paidAt.toMillis()) || 0;
              const bt = (b.paidAt && b.paidAt.toMillis
                && b.paidAt.toMillis()) || 0;
              return bt - at;
            });
          const ready = docs.find((d) => d.status === 'ready'
            && (d.pdfUrl || d.pdfBase64
              || (d.pdfChunked && d.pdfChunkCount > 0)));
          if (ready) {
            // Resolve URL across every storage tier (Vercel Blob,
            // Firebase Storage, inline base64, chunked Firestore).
            // Chunked PDFs require an async read of the subcollection;
            // resolveOrderPdfUrl handles that and returns a data URL.
            (async () => {
              const url = await kundliService.resolveOrderPdfUrl(
                kundli.userId, ready);
              if (url) {
                setAutoGen({ status: 'ready', order: ready, url,
                  name: ready.pdfName || 'AstroSeer-Kundli.pdf' });
              }
            })();
            return;
          }
          const gen = docs.find((d) => d.status === 'paid_generating'
            || d.status === 'free_generating');
          if (gen) {
            setAutoGen({ status: 'generating', order: gen });
            // AUTO-RESCUE: if the order has been generating for more
            // than ~2 minutes, try the Firestore-free rescue path.
            // Covers the case where Firebase is down/at-quota and
            // the relay's normal sweep can't flip the status. The
            // rescue endpoint pulls the PDF straight from AstroSeer
            // and pushes it to R2 - no Firestore involvement.
            const ageMs = gen.paidAt && gen.paidAt.toMillis
              ? Date.now() - gen.paidAt.toMillis() : 0;
            if (ageMs > 2 * 60 * 1000) {
              (async () => {
                const rescued = await kundliService
                  .rescuePdfByOrderId(gen.id);
                if (rescued && rescued.pdfUrl) {
                  setAutoGen({ status: 'ready', order: gen,
                    url: rescued.pdfUrl,
                    name: `AstroSeer-Kundli-${gen.id}.pdf` });
                }
              })();
            }
            return;
          }
          const failed = docs.find((d) => d.status === 'failed'
            || d.status === 'failed_refunded');
          setAutoGen({ status: failed ? 'failed' : null,
            order: failed || null });
        }, () => { /* swallow */ });
      } catch (_) { /* swallow */ }
    })();
    return () => { try { unsub && unsub(); } catch (_) { /* */ } };
  }, [kundli && kundli.id, kundli && kundli.userId]);

  // FREE KUNDLI FLOW (user requirement 2026-05-28):
  // NO popups, NO order-confirmation modals on the Free Report card.
  // The auto-gen fires on profile save; the onSnapshot listener
  // populates `autoGen.status` here. View PDF / Download PDF react
  // purely off that state - they NEVER pop an "Already generating"
  // or "Order placed" modal. While generating, a small inline
  // notice appears under the buttons; while ready, they open the
  // viewer / trigger download instantly.
  // No confirmation/inFlight modal state on the free card - per user
  // requirement 2026-05-28, the free flow renders only:
  //   - View PDF / Download PDF buttons (always visible)
  //   - inline "generating in the background" badge while
  //     autoGen.status === 'generating'
  //   - ephemeral progress line from open() / downloadNow() handlers
  // No setConfirmation, no KundliBeingGeneratedPopup, no
  // OrderConfirmationModal. The paid buy flow (below this hero card)
  // keeps its own confirmation modal because the customer is
  // spending wallet money there - they need the explicit Order ID +
  // SLA receipt.
  function open() {
    if (!kundli || !kundli.id || !kundli.userId) {
      setErr('Save a kundli profile first.'); return;
    }
    setErr('');
    // READY: open the in-app viewer instantly.
    if (autoGen.status === 'ready' && autoGen.url) {
      setResult({ ok: true, pdfUrl: autoGen.url,
        pdfName: autoGen.name });
      setViewing(true);
      return;
    }
    // STILL GENERATING (per Firestore order doc): the order doc
    // may be stale - e.g. created weeks ago but never processed
    // because the relay dyno was sleeping and the webhook dropped.
    // Recovery flow per user spec:
    //   1. Ask the relay FIRST (rescue endpoint) - cheapest,
    //      returns the PDF directly if it exists anywhere.
    //   2. If rescue has no PDF, call requestReport() which the
    //      relay treats as "return the existing order if one is
    //      already queued, else start a fresh generation now."
    //      That single call doubles as the "is there an in-flight
    //      request?" check AND the kick-off, so we never fire two
    //      generation requests for the same kundli.
    //   3. If requestReport returns an immediate pdfUrl (relay had
    //      it cached on R2), open it.
    //   4. Otherwise the relay queued / restarted the job; the
    //      Firestore onSnapshot listener will flip us to 'ready'
    //      when the PDF lands.
    if (autoGen.status === 'generating') {
      setProgress('Looking for your kundli now...');
      (async () => {
        // Step 1: rescue.
        if (autoGen.order && autoGen.order.id) {
          const rescued = await kundliService.rescuePdfByOrderId(
            autoGen.order.id,
            { profile: kundli, uid: kundli.userId, kind: 'free' });
          if (rescued && rescued.pdfUrl) {
            setResult({ ok: true, pdfUrl: rescued.pdfUrl,
              pdfName: `AstroSeer-Kundli-${autoGen.order.id}.pdf` });
            setAutoGen({ status: 'ready', order: autoGen.order,
              url: rescued.pdfUrl,
              name: `AstroSeer-Kundli-${autoGen.order.id}.pdf` });
            setViewing(true);
            setProgress('');
            return;
          }
        }
        // Step 2: dedup-safe restart via requestReport.
        setProgress('Restarting your kundli generation...');
        try {
          const fresh = await kundliService.requestReport({
            uid: kundli.userId,
            kundliProfileId: kundli.id,
            kind: 'free',
            autoGenerated: true,
            skipEmail: true,
          });
          if (fresh && fresh.ok && fresh.pdfUrl) {
            setResult(fresh); setViewing(true); setProgress('');
            return;
          }
          // Queued - onSnapshot listener takes over.
          setProgress('Your kundli is being generated now. The PDF '
            + 'will appear here automatically when ready.');
          setTimeout(() => setProgress(''), 8000);
        } catch (e) {
          setProgress('');
          setErr((e && e.message)
            || 'Could not restart generation. Please try again.');
        }
      })();
      return;
    }
    // NO ORDER YET (or previous attempt failed): silently kick off
    // a fresh generation in the background. No confirmation modal,
    // no popup - the inline notice is the only feedback.
    setProgress('Starting your free kundli generation. The PDF will '
      + 'appear here automatically when ready.');
    setTimeout(() => setProgress(''), 8000);
    kundliService.requestReport({
      uid: kundli.userId,
      kundliProfileId: kundli.id,
      kind: 'free',
      autoGenerated: true,
      skipEmail: true,
    }).then((initial) => {
      // Cache hit - the existing PDF is ready. Open it now.
      if (initial && initial.ok && initial.pdfUrl) {
        setResult(initial); setViewing(true); setProgress('');
        return;
      }
      // Otherwise the order doc was created; onSnapshot will flip
      // us to 'generating' and then 'ready' on its own.
    }).catch((e) => {
      setProgress('');
      setErr((e && e.message)
        || 'Could not start generation. Please try again.');
    });
  }

  // Download path - mirrors open() but for downloads:
  //   - PDF ready (via the autoGen onSnapshot listener)         -> download instantly
  //   - PDF cached on this session (result.pdfUrl set)          -> download instantly
  //   - Still generating in the background                      -> brief inline notice, NO popup
  //   - No order yet                                            -> defer to open() which kicks one off
  function downloadNow() {
    if (autoGen.status === 'ready' && autoGen.url) {
      kundliService.downloadPdfFromUrl(autoGen.url,
        autoGen.name || 'AstroSeer-Kundli.pdf');
      return;
    }
    if (result && result.pdfUrl) {
      kundliService.downloadPdfFromUrl(result.pdfUrl,
        result.pdfName || 'AstroSeer-Kundli.pdf');
      return;
    }
    if (autoGen.status === 'generating') {
      // Same dedup-safe recovery as open(): rescue first, fall
      // through to requestReport (which the relay treats as
      // "return existing or kick off") when rescue has nothing.
      setProgress('Looking for your kundli now...');
      (async () => {
        if (autoGen.order && autoGen.order.id) {
          const rescued = await kundliService.rescuePdfByOrderId(
            autoGen.order.id,
            { profile: kundli, uid: kundli.userId, kind: 'free' });
          if (rescued && rescued.pdfUrl) {
            kundliService.downloadPdfFromUrl(rescued.pdfUrl,
              `AstroSeer-Kundli-${autoGen.order.id}.pdf`);
            setAutoGen({ status: 'ready', order: autoGen.order,
              url: rescued.pdfUrl,
              name: `AstroSeer-Kundli-${autoGen.order.id}.pdf` });
            setProgress('');
            return;
          }
        }
        setProgress('Restarting your kundli generation...');
        try {
          const fresh = await kundliService.requestReport({
            uid: kundli.userId,
            kundliProfileId: kundli.id,
            kind: 'free',
            autoGenerated: true,
            skipEmail: true,
          });
          if (fresh && fresh.ok && fresh.pdfUrl) {
            kundliService.downloadPdfFromUrl(fresh.pdfUrl,
              fresh.pdfName || 'AstroSeer-Kundli.pdf');
            setAutoGen({ status: 'ready',
              order: { id: fresh.orderId || '' },
              url: fresh.pdfUrl,
              name: fresh.pdfName || 'AstroSeer-Kundli.pdf' });
            setProgress('');
            return;
          }
          setProgress('Your kundli is being generated now. The PDF '
            + 'will appear here automatically when ready.');
          setTimeout(() => setProgress(''), 8000);
        } catch (e) {
          setProgress('');
          setErr((e && e.message)
            || 'Could not restart generation. Please try again.');
        }
      })();
      return;
    }
    // No PDF cached yet AND no auto-gen on the way - fall through
    // to the regular order-placement flow which will kick one off.
    open();
  }

  return (
    <div className="mt-3 rounded-card bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center
          rounded-full bg-primary/10 text-2xl text-primary">📄</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-primary">
            Your free Vedic Kundli PDF
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-sub-text">
            The full 250+ page chart generated by our system. View
            inside the app or download to your device.
          </p>
        </div>
      </div>
      {/* Single CTA on the free report card (user requirement
          2026-05-29): VIEW REPORT opens the in-app PDF viewer which
          already exposes its own Download button. No separate
          Download PDF button needed - the customer downloads from
          inside the viewer once it's open. */}
      <div className="mt-3 flex">
        <button type="button" onClick={open} disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-xs
            font-bold text-white disabled:opacity-60">
          {busy ? 'Opening...' : 'View Report'}
        </button>
      </div>
      {/* Permanent inline generating notice (no modal). Persists
          while the auto-gen order is in flight; clears the moment
          the onSnapshot listener flips autoGen.status to 'ready'. */}
      {autoGen.status === 'generating' && !progress && (
        <div className="mt-2 inline-flex items-center gap-2 rounded-full
          bg-bg-light px-3 py-1 text-[11px] text-sub-text">
          <span className="inline-block h-1.5 w-1.5 animate-pulse
            rounded-full bg-amber-500" />
          Generating in the background. The PDF will appear here when
          ready.
        </div>
      )}
      {/* Ephemeral status from the open() / downloadNow() handlers
          (e.g. "Starting your free kundli generation..."). Clears
          itself on a timeout. */}
      {progress && (
        <div className="mt-2 rounded-card bg-bg-light px-3 py-2
          text-[11px] text-primary">
          {progress}
        </div>
      )}
      {err && (
        <div className="mt-2 rounded-card bg-danger/10 px-3 py-2
          text-[11px] text-danger">
          {err}
        </div>
      )}
      {viewing && result && (
        <PdfViewerPopup
          url={result.pdfUrl}
          name={result.pdfName || 'AstroSeer-Kundli.pdf'}
          onClose={() => setViewing(false)} />
      )}
      {/* Confirmation + KundliBeingGenerated modals removed from the
          Free Report card on 2026-05-28: per user requirement the
          free flow must NEVER pop a modal. The two inline banners
          above (generating notice + ephemeral progress) cover all
          the customer feedback the buttons need. The OrderConfirmation
          and KundliBeingGenerated components still exist for the
          PAID buy flow below this card. */}
    </div>
  );
}

// Popup shown when the customer taps View PDF on the Free Report
// tab while the auto-generated kundli is still being prepared in
// the background. Direct text from the user request 2026-05-28.
function KundliBeingGeneratedPopup({ orderId, onClose }) {
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
      justify-center bg-black/60 px-3 py-4"
      role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
        bg-white shadow-2xl">
        <div className="px-5 py-5 text-white"
          style={{ background: 'linear-gradient(135deg, '
            + '#D4A12A 0%, #B45309 50%, #7F2020 100%)' }}>
          <div className="text-[11px] font-bold uppercase
            tracking-wide opacity-90">Already generating</div>
          <div className="mt-0.5 text-xl font-bold">
            Your kundli is being prepared
          </div>
          <p className="mt-2 text-[12px] leading-snug opacity-95">
            We started generating it the moment you saved your
            birth details. Please check back in about 5 minutes,
            the PDF will be available right here for instant
            view and download.
          </p>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center
              rounded-full bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" className="h-5 w-5"
                fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase
                tracking-wide text-sub-text">
                Typical wait
              </div>
              <div className="text-base font-bold text-dark-text">
                30 minutes to 4 hours
              </div>
            </div>
          </div>
          {orderId && (
            <div className="mt-3 rounded-card bg-bg-light px-3 py-2
              text-[11px]">
              <div className="text-sub-text">Order ID</div>
              <div className="mt-0.5 font-mono break-all
                text-dark-text">{orderId}</div>
            </div>
          )}
          <p className="mt-3 text-[12px] leading-snug text-sub-text">
            You can also tap <b>My Orders</b> any time to see the
            status. The download will appear here automatically
            the moment AstroSeer finishes generating.
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-full border border-gray-300
                bg-white py-2.5 text-sm font-bold text-dark-text
                transition hover:bg-bg-light">
              Got it
            </button>
            <Link href="/orders" onClick={onClose}
              className="flex-1 rounded-full bg-primary py-2.5
                text-center text-sm font-bold text-white shadow-sm
                hover:brightness-95">
              Check My Orders
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Full-screen PDF viewer with close + download. The iframe is rebuilt
// on each open with the latest URL; on iOS Capacitor where iframes do
// not render PDF inline reliably, the "Open externally" button kicks
// it into Safari (the same path downloadPdfFromUrl uses).
function PdfViewerPopup({ url, name, onClose }) {
  function isNative() {
    return typeof window !== 'undefined'
      && !!window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
  }
  function download() {
    kundliService.downloadPdfFromUrl(url,
      name || 'AstroSeer-Kundli.pdf');
  }
  function openExternal() {
    try { window.open(url, '_system'); }
    catch (_) {
      try { window.open(url, '_blank'); } catch (e) { /* */ }
    }
  }
  return (
    <div className="fixed inset-0 z-[2147483647] flex flex-col
      bg-black/80">
      <div className="flex items-center justify-between gap-2
        bg-primary px-3 py-2 text-white">
        <div className="min-w-0 flex-1 truncate text-sm font-bold">
          {name || 'Kundli PDF'}
        </div>
        <button type="button" onClick={download}
          className="rounded-full bg-white/20 px-3 py-1 text-[11px]
            font-bold hover:bg-white/30">
          Download
        </button>
        {isNative() && (
          <button type="button" onClick={openExternal}
            className="rounded-full bg-white/20 px-3 py-1 text-[11px]
              font-bold hover:bg-white/30">
            Open in browser
          </button>
        )}
        <button type="button" onClick={onClose}
          aria-label="Close"
          className="ml-1 grid h-8 w-8 place-items-center rounded-full
            bg-white/20 text-base font-bold hover:bg-white/30">
          ×
        </button>
      </div>
      <div className="flex-1 bg-white">
        <iframe src={url} title={name || 'Kundli PDF'}
          className="h-full w-full border-0"
          style={{ minHeight: '60vh' }} />
      </div>
    </div>
  );
}

// Post-purchase confirmation modal. Shows the customer that their
// order was placed successfully, the expected delivery SLA based
// on the report kind, the order ID for tracking, and a clear CTA
// to /orders where the PDF will appear when ready. Replaces the
// in-page polling spinner which made long-running paid reports
// feel broken even though they were generating fine.
// Three states this modal renders:
//   - pending: relay request in flight, order id not yet known.
//     Shows the SLA + a "Confirming with our system..." hint.
//   - confirmed (orderId set): shows the real order id + "Check
//     My Orders" CTA.
//   - error: shows the failure reason inside the modal (so the
//     customer is not left thinking the order succeeded when it
//     actually hit insufficient_wallet or a network blip).
function OrderConfirmationModal({ orderId, kind, pending, error,
  walletShortfall, onClose }) {
  const t = reportType(kind || 'free');
  const sla = (t && t.sla) || '30 minutes to 4 hours';
  const label = (t && t.shortName)
    || (kind === 'forecast12' ? '12-Month Forecast'
      : kind === 'careerFinance' ? 'Career Report'
        : kind === 'lifetime' ? 'Lifetime Report'
          : 'Vedic Kundli');
  const isError = !!error;
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
      justify-center bg-black/60 px-3 py-4"
      role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
        bg-white shadow-2xl">
        {/* Header strip - red on error, NEUTRAL gradient + spinner
            on pending (so customer clearly sees a processing beat,
            not an instant "ORDER PLACED"), brand gradient on
            confirmed. The pending look is visually distinct from
            confirmed - same colors but a big spinner + "Processing"
            language, never "Thank you" until the order id is in. */}
        <div className="px-5 py-5 text-white"
          style={{ background: isError
            ? 'linear-gradient(135deg, #C0392B 0%, #7F2020 100%)'
            : pending
              ? 'linear-gradient(135deg, #5A6E32 0%, #3F4E22 100%)'
              : 'linear-gradient(135deg, '
                + '#D4A12A 0%, #B45309 50%, #7F2020 100%)' }}>
          <div className="text-[11px] font-bold uppercase
            tracking-wide opacity-90">
            {isError ? 'Order could not be placed'
              : pending ? 'Processing' : 'Order placed'}
          </div>
          {pending && !isError ? (
            <div className="mt-2 flex items-center gap-3">
              <svg className="h-6 w-6 shrink-0 animate-spin
                text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor"
                  strokeOpacity="0.35" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9"
                  stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round" />
              </svg>
              <div>
                <div className="text-xl font-bold">
                  Placing your {label} order...
                </div>
                <div className="mt-1 text-[12px] leading-snug
                  opacity-95">
                  Confirming with our system. This usually takes
                  a few seconds, please do not close this window.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-1 text-xl font-bold">
                {isError
                  ? `We could not place your ${label} order`
                  : `Thank you, your ${label} is on its way`}
              </div>
              {!isError && (
                <div className="mt-2 text-[12px] leading-snug
                  opacity-95">
                  We have started generating your report. You will
                  get an email AND a download link in My Orders
                  when it is ready.
                </div>
              )}
            </>
          )}
        </div>
        <div className="border-b border-gray-100 px-5 py-4">
          {!isError && !pending && (
            <>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0
                  place-items-center rounded-full bg-primary/10
                  text-primary">
                  <svg viewBox="0 0 24 24" className="h-5 w-5"
                    fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase
                    tracking-wide text-sub-text">
                    Expected delivery
                  </div>
                  <div className="text-base font-bold text-dark-text">
                    {sla}
                  </div>
                </div>
              </div>
              {orderId && (
                <div className="mt-3 rounded-card bg-bg-light px-3
                  py-2 text-[11px]">
                  <div className="text-sub-text">Order ID</div>
                  <div className="mt-0.5 font-mono break-all
                    text-dark-text">{orderId}</div>
                </div>
              )}
              <p className="mt-3 text-[12px] leading-snug
                text-sub-text">
                You can close this window and continue using the
                app. We will email you the moment the report is
                ready, and the download link lives permanently in
                My Orders.
              </p>
            </>
          )}
          {pending && !isError && (
            <div className="rounded-card bg-bg-light px-3 py-3
              text-[12px] leading-snug text-sub-text">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 animate-pulse
                  rounded-full bg-amber-500" />
                <span className="font-bold text-dark-text">
                  Confirming your order with our system
                </span>
              </div>
              <div className="mt-1">
                This usually takes 3 to 5 seconds. We will show your
                Order ID and SLA the moment it is confirmed.
              </div>
            </div>
          )}
          {isError && (
            <div className="rounded-card bg-danger/10 p-3
              text-[12px] text-danger">
              <div className="font-bold">What went wrong</div>
              <div className="mt-1 break-all">{error}</div>
              {walletShortfall && (
                <div className="mt-3 rounded-card bg-white p-2">
                  <div>Wallet balance:
                    <b> ₹{walletShortfall.wallet || 0}</b></div>
                  <div>Report price:
                    <b> ₹{walletShortfall.price || 0}</b></div>
                  <Link href="/wallet" onClick={onClose}
                    className="mt-2 inline-block font-bold
                      underline">
                    Add money to wallet →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
        {/* CTAs */}
        <div className="flex gap-2 px-5 py-4">
          <button type="button" onClick={onClose}
            disabled={pending && !isError}
            className="flex-1 rounded-full border border-gray-300
              bg-white py-2.5 text-sm font-bold text-dark-text
              transition hover:bg-bg-light disabled:cursor-not-allowed
              disabled:opacity-50">
            {pending && !isError ? 'Please wait...' : 'Close'}
          </button>
          {!isError && !pending && (
            <Link href="/orders" onClick={onClose}
              className="flex-1 rounded-full bg-primary py-2.5
                text-center text-sm font-bold text-white shadow-sm
                hover:brightness-95">
              Check My Orders
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// Inline monochrome SVG icons for the premium-report cards. Single
// theme colour (primary), no colourful emoji - matches the
// "single color icon not colorful" rule.
function PremiumIcon({ kind }) {
  const cls = 'h-7 w-7 text-primary';
  if (kind === 'forecast12') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none"
        stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
        <path d="M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2M15 17h2" />
      </svg>
    );
  }
  if (kind === 'careerFinance') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none"
        stroke="currentColor" strokeWidth="1.8">
        <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6" />
      </svg>
    );
  }
  if (kind === 'lifetime') {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none"
        stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l5 3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none"
      stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4h9l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M14 4v5h5M8 14h8M8 18h5" />
    </svg>
  );
}

function PremiumReportsTab({ kundli }) {
  const [prices, setPrices] = useState(() => {
    const out = {};
    REPORT_TYPES.forEach((t) => { out[t.id] = t.defaultPrice; });
    return out;
  });
  const [pending, setPending] = useState(null);   // confirm popup
  const [demo, setDemo] = useState(null);         // demo popup
  const [result, setResult] = useState(null);     // download popup
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await kundliService.readSettingsConfig();
        const next = {};
        REPORT_TYPES.forEach((t) => {
          next[t.id] = resolvePrice(t.id, cfg);
        });
        setPrices(next);
      } catch (_) { /* keep defaults */ }
    })();
  }, []);

  // Async-with-polling: kick off generation, then poll the status
  // every 5s for up to 5 minutes. Long premium reports (lifetime,
  // careerFinance) take 60-90s on Render free tier, well past the
  // old 90s synchronous timeout.
  // OPTIMISTIC UI with a 1.5-2.8s minimum-display floor so the
  // 'Placing order' state always feels like a real processing
  // beat. Same pattern as ApiPdfHero.open() above.
  const [confirmation, setConfirmation] = useState(null);
  function buy(kind) {
    setError(null); setResult(null);
    if (!kundli || !kundli.id || !kundli.userId) {
      setError({ message: 'Save a kundli profile first.' });
      return;
    }
    setConfirmation({ orderId: null, kind, pending: true });
    const startMs = Date.now();
    const minDelayMs = 3000 + Math.floor(Math.random() * 1000);
    const settle = (updater) => {
      const elapsed = Date.now() - startMs;
      const wait = Math.max(0, minDelayMs - elapsed);
      setTimeout(() => setConfirmation((c) => updater(c)), wait);
    };
    kundliService.requestReport({
      uid: kundli.userId, kundliProfileId: kundli.id, kind,
    }).then((initial) => {
      if (initial && initial.ok && initial.pdfUrl) {
        settle(() => null);
        setTimeout(() => setResult(initial),
          Math.max(0, minDelayMs - (Date.now() - startMs)));
        return;
      }
      if (!initial || !initial.orderId) {
        settle((c) => ({ ...(c || {}),
          pending: false,
          error: (initial && initial.error)
            || 'Could not place the order.' }));
        return;
      }
      settle(() => ({ orderId: initial.orderId, kind,
        pending: false }));
    }).catch((e) => {
      settle((c) => ({ ...(c || {}),
        pending: false,
        error: (e && e.message) || 'Could not place the order.',
        walletShortfall: e && e.code === 'insufficient_wallet'
          ? { wallet: e.wallet, price: e.price } : null }));
    });
  }

  // Pre-warm the AstroSeer dyno so the user's click goes against a
  // hot dyno instead of a cold one.
  useEffect(() => { kundliService.wakeAstroSeer(); }, []);

  // Paid reports only (free already lives at the top of the Free
  // Report tab).
  const PAID = REPORT_TYPES.filter((t) => t.id !== 'free');

  return (
    <div className="mt-3">
      <Banner title="Premium Reports" />
      <p className="mt-3 text-center text-[12px] text-sub-text">
        Detailed Vedic reports generated by our system. Tap a card
        to preview the sections inside, or buy the PDF straight to
        your Orders.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PAID.map((t) => {
          const price = prices[t.id] || t.defaultPrice;
          const isBusy = busy === t.id;
          return (
            <div key={t.id} className="flex flex-col rounded-card
              bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center
                  rounded-full bg-primary/10">
                  <PremiumIcon kind={t.id} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-primary">
                    {t.name}
                  </div>
                  <div className="mt-0.5 text-[11px] text-sub-text">
                    {t.tat}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-base font-bold text-primary">
                    ₹{price}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide
                    text-sub-text">from wallet</div>
                </div>
              </div>
              <p className="mt-2 line-clamp-3 text-[12px]
                leading-snug text-dark-text">
                {t.summary}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setDemo(t)}
                  className="flex-1 rounded-full border border-primary
                    bg-white px-3 py-2 text-xs font-bold text-primary">
                  Demo
                </button>
                <button type="button" disabled={!!busy}
                  onClick={() => setPending({ kind: t.id, price })}
                  className="flex-1 rounded-full bg-accent px-3 py-2
                    text-xs font-bold text-white disabled:opacity-60">
                  {isBusy ? 'Charging...' : `Buy for ₹${price}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error / busy state is now surfaced INSIDE the confirmation
          modal which opens optimistically; no inline strip needed
          here. The outer `error` state is kept only for top-of-
          page wallet shortfall messaging if the modal was closed
          before the relay finished. */}
      {error && !confirmation && (
        <div className="mt-3 rounded-card bg-danger/10 p-3 text-xs
          text-danger">
          {error.code === 'insufficient_wallet' ? (
            <>
              Wallet balance ₹{error.wallet || 0} is not enough.{' '}
              <Link href="/wallet" className="font-bold underline">
                Add money to wallet
              </Link>
            </>
          ) : (
            <>Could not place the order: {error.message}
              {error.refunded ? ' (wallet refunded automatically)' : ''}
            </>
          )}
        </div>
      )}

      {confirmation && (
        <OrderConfirmationModal
          orderId={confirmation.orderId}
          kind={confirmation.kind}
          pending={confirmation.pending}
          error={confirmation.error}
          walletShortfall={confirmation.walletShortfall}
          onClose={() => setConfirmation(null)} />
      )}

      {pending && (
        <ConfirmReportPopup
          spec={(() => {
            const t = reportType(pending.kind);
            if (!t) return null;
            return {
              title: t.name,
              badge: '',
              sections: t.sections,
              tat: t.tat,
              confirmCta: t.confirmCta,
              summary: t.summary,
            };
          })()}
          price={pending.price}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const k = pending.kind;
            setPending(null);
            buy(k);
          }} />
      )}

      {demo && (
        <PremiumDemoPopup spec={demo} price={prices[demo.id]
          || demo.defaultPrice}
          onClose={() => setDemo(null)}
          onBuy={() => {
            const k = demo.id;
            setDemo(null);
            setPending({ kind: k, price: prices[k] || demo.defaultPrice });
          }} />
      )}

      {result && result.ok && (
        <DownloadPopup result={result}
          onClose={() => setResult(null)} />
      )}
    </div>
  );
}

// Demo / preview popup for a premium report. Shows the full section
// list, delivery time and a representative sample-page screenshot
// placeholder. Two CTAs: Close, Buy.
function PremiumDemoPopup({ spec, price, onClose, onBuy }) {
  if (!spec) return null;
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
      justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
        bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3
          border-b border-gray-100 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-primary">
              {spec.name}
            </h2>
            <div className="mt-1 text-[11px] uppercase tracking-wide
              text-sub-text">Sample preview</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center
              rounded-full bg-bg-light text-lg font-bold text-primary">
            ×
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto px-5 py-4">
          <p className="text-[13px] leading-snug text-dark-text">
            {spec.summary}
          </p>
          <div className="mt-4 text-[11px] font-bold uppercase
            tracking-wide text-primary">
            What you receive
          </div>
          <ol className="mt-2 list-none space-y-2 text-[13px]
            leading-snug text-dark-text">
            {spec.sections.map((text, i) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0
                  items-center justify-center rounded-full
                  bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 rounded-card border border-gray-100
            bg-bg-light px-3 py-2 text-[12px] leading-snug
            text-dark-text">
            <div className="text-[10px] font-bold uppercase
              tracking-wide text-primary">Delivery</div>
            <div className="mt-1">{spec.tat}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2
          border-t border-gray-100 px-5 py-4">
          <div>
            <div className="text-xs text-sub-text">Price</div>
            <div className="text-lg font-bold text-primary">
              ₹{price}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="rounded-full border border-gray-300 bg-white
                px-4 py-2 text-sm font-bold text-dark-text">
              Close
            </button>
            <button type="button" onClick={onBuy}
              className="rounded-full bg-accent px-4 py-2 text-sm
                font-bold text-white shadow-sm">
              Buy for ₹{price}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
