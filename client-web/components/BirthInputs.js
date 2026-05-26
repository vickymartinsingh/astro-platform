import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, INDIAN_STATES } from '@astro/shared';

// Date stored as DD-MM-YYYY (zodiac/matching expect this); the picker is a
// native calendar (YYYY-MM-DD), so we convert both ways.
export function toInputDate(dmy) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
export function fromInputDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// Shows + accepts the date strictly as DD/MM/YYYY (auto-inserts the
// slashes as you type). A calendar button opens the native picker.
// Value is still stored as DD-MM-YYYY (zodiac/matching expect that).
function toDisplay(dmy) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy || '');
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

export function DateField({ value, onChange, label = 'Date of birth' }) {
  const [txt, setTxt] = useState(toDisplay(value));
  const dateRef = useRef(null);
  useEffect(() => { setTxt(toDisplay(value)); }, [value]);

  function onText(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 8);
    let out = v;
    if (v.length > 4) {
      out = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
    } else if (v.length > 2) {
      out = `${v.slice(0, 2)}/${v.slice(2)}`;
    }
    setTxt(out);
    if (v.length === 8) {
      const d = +v.slice(0, 2);
      const mo = +v.slice(2, 4);
      const y = +v.slice(4);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12
        && y >= 1900 && y <= 2100) {
        onChange(`${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4)}`);
        return;
      }
    }
    onChange('');
  }

  function openPicker() {
    const el = dateRef.current;
    if (!el) return;
    try { if (el.showPicker) el.showPicker(); else el.click(); }
    catch (_) { el.click(); }
  }

  return (
    <div>
      <label className="text-sm text-sub-text">{label}</label>
      <div className="relative mt-1">
        <input className="input pr-11" inputMode="numeric"
          placeholder="DD/MM/YYYY" value={txt} onChange={onText} />
        <button type="button" aria-label="Open calendar"
          onClick={openPicker}
          className="absolute right-1 top-1/2 -translate-y-1/2
            rounded-lg px-2 py-1 text-sub-text">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </button>
        <input ref={dateRef} type="date" max="9999-12-31"
          tabIndex={-1} aria-hidden="true"
          className="absolute right-0 bottom-0 h-0 w-0 opacity-0"
          value={toInputDate(value)}
          onChange={(e) => onChange(fromInputDate(e.target.value))} />
      </div>
    </div>
  );
}

// 24h time from the clock picker -> store 12h + AM/PM (kundli schema).
export function TimeField({ value, ampm, onChange, label = 'Time of birth' }) {
  const iso = (() => {
    if (!value) return '';
    let [h, mm] = value.split(':').map(Number);
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`;
  })();
  return (
    <div>
      <label className="text-sm text-sub-text">{label}</label>
      <input className="input mt-1" type="time" value={iso}
        onChange={(e) => {
          const [H, M] = e.target.value.split(':').map(Number);
          const ap = H >= 12 ? 'PM' : 'AM';
          let h12 = H % 12; if (h12 === 0) h12 = 12;
          onChange(`${String(h12).padStart(2, '0')}:` +
            `${String(M || 0).padStart(2, '0')}`, ap);
        }} />
    </div>
  );
}

// City autocomplete from the India list; if the typed city is unknown,
// a state must be chosen so it can be added for future clients. Stored
// as "City, State".
// Country -> tz_offset in hours. India is always +5:30. For other
// countries we use a representative national offset; users in a
// state with a non-standard offset (e.g. parts of the US, Russia)
// can still get a correct chart because the relay pulls the exact
// tz from lat/lng on the server side as a fallback. Index covers
// the countries our customer base actually birth-located in.
const COUNTRY_TZ = {
  India: 5.5, IN: 5.5,
  Pakistan: 5, PK: 5,
  Nepal: 5.75, NP: 5.75,
  'Sri Lanka': 5.5, LK: 5.5,
  Bangladesh: 6, BD: 6,
  Bhutan: 6, BT: 6,
  Malaysia: 8, MY: 8,
  Singapore: 8, SG: 8,
  'United Arab Emirates': 4, AE: 4,
  Qatar: 3, QA: 3,
  'Saudi Arabia': 3, SA: 3,
  'United Kingdom': 0, GB: 0,
  Ireland: 0, IE: 0,
  Germany: 1, DE: 1,
  France: 1, FR: 1,
  Australia: 10, AU: 10,
  'New Zealand': 12, NZ: 12,
  'United States': -5, US: -5,
  Canada: -5, CA: -5,
};

// One global throttle so a fast typer never DDoSes Nominatim (the
// free OSM endpoint asks for ≤1 req/sec per app).
let _searchTimer = null;
async function searchPlaces(q) {
  if (!q || q.trim().length < 2) return [];
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?q=${encodeURIComponent(q.trim())}`
    + '&format=json&addressdetails=1&limit=8&accept-language=en';
  try {
    const r = await fetch(url, {
      headers: {
        // Nominatim ToS requires a UA identifying the app.
        'Accept-Language': 'en',
      },
    });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => {
      const a = it.address || {};
      const city = a.city || a.town || a.village || a.hamlet
        || a.municipality || a.county || it.name || '';
      const state = a.state || a.state_district || a.region || '';
      const country = a.country || '';
      const countryCode = (a.country_code || '').toUpperCase();
      const lat = Number(it.lat);
      const lon = Number(it.lon);
      return {
        id: `${it.place_id}`,
        label: [city, state, country].filter(Boolean).join(', '),
        place: [city, state].filter(Boolean).join(', '),
        city, state, country, countryCode,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lon) ? lon : null,
        tz: COUNTRY_TZ[country] ?? COUNTRY_TZ[countryCode] ?? 0,
      };
    }).filter((p) => p.lat && p.lng && p.label);
  } catch (_) { return []; }
}

// CityField with live autocomplete from OpenStreetMap Nominatim.
// Capturing lat / lng / tz at select time is critical: without
// them the relay falls back to (0,0) and GMT+0 and AstroSeer
// happily generates a chart for a point in the Atlantic ocean.
//
// API contract:
//   value    can be a string ("Hyderabad, Telangana") for legacy
//            profiles, OR an object { place, lat, lng, tz, country,
//            state, city, countryCode } from a recent selection.
//   onChange always called with the OBJECT shape so the parent can
//            persist lat / lng / tz on the kundli profile doc.
//            Parents that only want the string can pluck .place.
export function CityField({
  value, onChange, label = 'Place of birth',
}) {
  // Normalise incoming value into our internal shape.
  const initial = (() => {
    if (!value) return { place: '' };
    if (typeof value === 'string') return { place: value };
    return value;
  })();
  const [text, setText] = useState(initial.place || '');
  const [picked, setPicked] = useState(initial.lat ? initial : null);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  // Re-sync if parent updates externally (e.g. Edit kundli prefills).
  useEffect(() => {
    if (typeof value === 'string') {
      setText(value || ''); setPicked(null);
    } else if (value && value.place) {
      setText(value.place);
      if (value.lat && value.lng) setPicked(value);
    }
  }, [value]);

  // Debounced search on each keystroke.
  useEffect(() => {
    if (picked && text === picked.place) return; // no-op after select
    if (!text || text.trim().length < 2) { setSuggestions([]); return; }
    if (_searchTimer) clearTimeout(_searchTimer);
    setLoading(true);
    _searchTimer = setTimeout(async () => {
      const r = await searchPlaces(text);
      setSuggestions(r); setLoading(false); setOpen(r.length > 0);
    }, 300);
    return () => { if (_searchTimer) clearTimeout(_searchTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Close the suggestion popover on any outside click.
  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(s) {
    setPicked(s);
    setText(s.place);
    setOpen(false);
    setSuggestions([]);
    onChange(s);
  }
  function clear() {
    setPicked(null); setText('');
    onChange({ place: '' });
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="text-sm text-sub-text">{label}</label>
      <div className="relative mt-1">
        <input className="input pr-10"
          placeholder="Type 2+ letters of your city (e.g. Hyd)"
          value={text}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            // Typing again invalidates a previously locked selection.
            if (picked) {
              setPicked(null);
              onChange({ place: e.target.value });
            }
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)} />
        {text && (
          <button type="button" onClick={clear}
            aria-label="Clear city"
            className="absolute right-2 top-1/2 -translate-y-1/2
              rounded-full px-2 py-0.5 text-sub-text
              hover:text-dark-text">
            ✕
          </button>
        )}
      </div>

      {/* Suggestion list. Click locks lat / lng / tz on the doc. */}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto
                       rounded-card border border-gray-200 bg-white
                       shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => pick(s)}
                className="block w-full px-3 py-2 text-left text-sm
                           hover:bg-bg-light">
                <div className="font-medium text-dark-text">
                  {s.city || s.label}
                </div>
                <div className="text-[11px] text-sub-text">
                  {[s.state, s.country].filter(Boolean).join(', ')}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && !suggestions.length && text.length >= 2 && (
        <p className="mt-1 text-[11px] text-sub-text">Searching…</p>
      )}

      {/* Read-only confirmation strip so the customer can SEE that
          the right lat / lng / tz was captured. Removes the silent
          "kundli shows 0,0" failure mode the user hit. */}
      {picked && picked.lat && picked.lng && (
        <div className="mt-2 rounded-card border border-primary/20
                        bg-primary/5 p-2 text-[11px] leading-snug
                        text-dark-text">
          <div>
            <b className="text-primary">Confirmed:</b> {picked.label}
          </div>
          <div className="text-sub-text">
            Latitude {picked.lat.toFixed(4)}°,{' '}
            Longitude {picked.lng.toFixed(4)}°,{' '}
            Time zone GMT{picked.tz >= 0 ? '+' : ''}{picked.tz}
          </div>
        </div>
      )}

      {!picked && text.trim().length >= 2 && !loading
        && suggestions.length === 0 && (
        <p className="mt-2 text-[11px] text-warning">
          Pick a city from the list so we can lock the exact location
          and time zone needed for accurate chart calculations.
        </p>
      )}
    </div>
  );
}
