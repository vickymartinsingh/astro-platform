import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_COUNTRIES, DEFAULT_COUNTRY_CODE, watchCountryList, splitPhone,
} from '@astro/shared';

// PhoneInput: a single field that pairs a country-code picker (flag +
// dial code) with the national number. Defaults to +91 India per the
// operator's instruction; supports the full world list via the admin-
// editable country code catalogue (shared/countryCodes.js +
// settings/config.country_codes).
//
// Props:
//   value  - full string "+91 9876543210" or "9876543210" or ""
//   onChange(next: string) - called with "+CODE NATIONAL"
//   placeholder?
//   disabled?
//   autoFocus?
//
// The picker subscribes to watchCountryList so admin changes
// propagate live with no rebuild.
export default function PhoneInput({ value, onChange, placeholder,
  disabled, autoFocus }) {
  const [list, setList] = useState(DEFAULT_COUNTRIES);
  useEffect(() => watchCountryList(setList), []);

  const initial = useMemo(() => splitPhone(value, list),
    [value, list]);
  const [code, setCode] = useState(initial.code || DEFAULT_COUNTRY_CODE);
  const [national, setNational] = useState(initial.national || '');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  // Re-sync from outer value when it changes from props (e.g. parent
  // reset). We deliberately do NOT sync on every render to avoid
  // clobbering mid-typing state.
  useEffect(() => {
    const s = splitPhone(value, list);
    setCode(s.code || DEFAULT_COUNTRY_CODE);
    setNational(s.national || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(c, n) {
    if (onChange) onChange(`${c} ${n}`.trim());
  }
  function pickCode(c) {
    setCode(c); setOpen(false); setFilter('');
    emit(c, national);
  }
  function onNationalChange(e) {
    const raw = e.target.value.replace(/[^\d ]/g, '').slice(0, 16);
    setNational(raw);
    emit(code, raw);
  }

  const selected = list.find((c) => c.code === code)
    || { code, flag: '', name: '' };
  const filtered = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return list;
    return list.filter((c) => c.name.toLowerCase().includes(t)
      || c.code.includes(t)
      || c.iso.toLowerCase().includes(t));
  }, [list, filter]);

  // Close the dropdown on outside click.
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setFilter('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-stretch overflow-hidden rounded-card
        border border-gray-300 bg-white focus-within:border-primary">
        <button type="button" onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          className="flex items-center gap-1 border-r border-gray-300
            bg-bg-light/40 px-2.5 text-sm hover:bg-bg-light">
          <span className="text-base">{selected.flag || '\u{1F3F3}'}</span>
          <span className="font-semibold text-dark-text">
            {selected.code}
          </span>
          <span className="text-xs text-sub-text">{'▾'}</span>
        </button>
        <input
          className="flex-1 bg-transparent px-3 py-2 text-sm
            text-dark-text outline-none"
          inputMode="tel" type="tel"
          autoFocus={autoFocus} disabled={disabled}
          value={national}
          onChange={onNationalChange}
          placeholder={placeholder || 'Mobile number'} />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[105%] z-50
          max-h-72 overflow-hidden rounded-card border border-gray-200
          bg-white shadow-xl">
          <input className="w-full border-b border-gray-100 px-3 py-2
            text-sm outline-none" autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search country or code" />
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-sub-text">
                No country matches.
              </div>
            ) : filtered.map((c) => (
              <button key={`${c.iso}-${c.code}`} type="button"
                onClick={() => pickCode(c.code)}
                className={`flex w-full items-center justify-between
                  gap-2 px-3 py-2 text-left text-sm hover:bg-bg-light
                  ${c.code === code ? 'bg-primary/10' : ''}`}>
                <span className="flex items-center gap-2 truncate">
                  <span className="text-base">{c.flag}</span>
                  <span className="truncate text-dark-text">{c.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[12px]
                  text-sub-text">{c.code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
