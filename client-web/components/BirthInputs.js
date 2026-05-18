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
export function CityField({ value, onChange, label = 'Place of birth' }) {
  const known = useMemo(() => {
    const map = new Map();
    CITIES.forEach(([c, s]) => map.set(c.toLowerCase(), s));
    return map;
  }, []);
  const [city, setCity] = useState((value || '').split(',')[0].trim());
  const [state, setState] = useState((value || '').split(',')[1]?.trim() || '');
  const matched = known.get(city.trim().toLowerCase());
  const needState = city.trim() && !matched;

  function commit(c, s) {
    const st = s ?? (known.get(c.trim().toLowerCase()) || state);
    onChange(st ? `${c.trim()}, ${st}` : c.trim());
  }

  return (
    <div>
      <label className="text-sm text-sub-text">{label}</label>
      <input className="input mt-1" list="india-cities"
        placeholder="Start typing your city" value={city}
        onChange={(e) => {
          setCity(e.target.value);
          const auto = known.get(e.target.value.trim().toLowerCase());
          if (auto) setState(auto);
          commit(e.target.value, auto || (needState ? state : undefined));
        }} />
      <datalist id="india-cities">
        {CITIES.map(([c, s]) => (
          <option key={`${c}-${s}`} value={c}>{c}, {s}</option>
        ))}
      </datalist>
      {needState && (
        <div className="mt-2">
          <label className="text-xs text-warning">
            New city. Please pick its state so we can add it.
          </label>
          <select className="input mt-1" value={state}
            onChange={(e) => { setState(e.target.value);
              commit(city, e.target.value); }}>
            <option value="">Select state</option>
            {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
