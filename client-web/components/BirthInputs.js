import { useMemo, useState } from 'react';
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

export function DateField({ value, onChange, label = 'Date of birth' }) {
  return (
    <div>
      <label className="text-sm text-sub-text">{label}</label>
      <input className="input mt-1" type="date" max="9999-12-31"
        value={toInputDate(value)}
        onChange={(e) => onChange(fromInputDate(e.target.value))} />
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
