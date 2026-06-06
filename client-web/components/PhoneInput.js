import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_COUNTRIES, DEFAULT_COUNTRY_CODE, watchCountryList, splitPhone,
  phoneLenFor,
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
//   onValidityChange(valid: boolean, info: {dialCode, national,
//                    minLen, maxLen, length}) - optional, fires on
//                    every keystroke + country change so the parent
//                    form can gate the submit button live.
//   placeholder?
//   disabled?
//   autoFocus?
//   externalNote? - extra message rendered below (e.g. "Number
//                   already registered. Please login.")
//   externalTone? - 'error' | 'success' for the externalNote color.
//
// The picker subscribes to watchCountryList so admin changes
// propagate live with no rebuild.
export default function PhoneInput({ value, onChange, onValidityChange,
  placeholder, disabled, autoFocus, externalNote, externalTone }) {
  const [list, setList] = useState(DEFAULT_COUNTRIES);
  useEffect(() => watchCountryList(setList), []);

  const initial = useMemo(() => splitPhone(value, list),
    [value, list]);
  const [code, setCode] = useState(initial.code || DEFAULT_COUNTRY_CODE);
  const [national, setNational] = useState(initial.national || '');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [touched, setTouched] = useState(false);

  // Per-country length constraints. minLen/maxLen come from the
  // shared catalogue (e.g. +91 -> 10/10, +44 -> 10/10, +971 -> 9/9).
  const { minLen, maxLen } = useMemo(() => phoneLenFor(code, list),
    [code, list]);
  const length = national.replace(/\D/g, '').length;
  const valid = length >= minLen && length <= maxLen;

  // Re-sync from outer value when it changes from props (e.g. parent
  // reset). We deliberately do NOT sync on every render to avoid
  // clobbering mid-typing state.
  useEffect(() => {
    const s = splitPhone(value, list);
    setCode(s.code || DEFAULT_COUNTRY_CODE);
    setNational(s.national || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Bubble validity up so the form can disable the submit button
  // until the number is the right shape for the chosen country.
  useEffect(() => {
    if (onValidityChange) {
      onValidityChange(valid, {
        dialCode: code, national, minLen, maxLen, length,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, code, national]);

  function emit(c, n) {
    if (onChange) onChange(`${c} ${n}`.trim());
  }
  function pickCode(c) {
    setCode(c); setOpen(false); setFilter('');
    emit(c, national);
  }
  function onNationalChange(e) {
    // Cap at the country's max length so the user can't even type
    // past the allowed digit count. Strip non-digits entirely.
    const digits = e.target.value.replace(/\D/g, '').slice(0, maxLen);
    setNational(digits);
    setTouched(true);
    emit(code, digits);
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

  // Visual states for the bordered wrapper + the status line under
  // the input.
  const ringClass = !touched || length === 0
    ? 'border-gray-300 focus-within:border-primary'
    : valid
      ? 'border-emerald-500 focus-within:border-emerald-500'
      : 'border-rose-400 focus-within:border-rose-500';

  // What to say beneath the input.
  // - If parent passed externalNote (e.g. "number already exists"),
  //   that ALWAYS wins.
  // - Otherwise show "X / Y digits" + a pass/fail blurb based on the
  //   current length.
  function statusLine() {
    if (externalNote) {
      const tone = externalTone === 'success'
        ? 'text-emerald-600' : 'text-rose-600';
      return <span className={tone}>{externalNote}</span>;
    }
    if (!touched && length === 0) {
      return (
        <span className="text-sub-text">
          {minLen === maxLen
            ? `Enter ${minLen} digits for ${selected.name || 'this country'}.`
            : `Enter ${minLen}-${maxLen} digits for ${
              selected.name || 'this country'}.`}
        </span>
      );
    }
    if (length === 0) {
      return <span className="text-rose-600">
        Mobile number is required.
      </span>;
    }
    if (length < minLen) {
      const need = minLen - length;
      return <span className="text-rose-600">
        {need} more digit{need === 1 ? '' : 's'} needed for{' '}
        {selected.code}.
      </span>;
    }
    if (length > maxLen) {
      // Capped at typing time, but defensive.
      return <span className="text-rose-600">
        Too many digits for {selected.code} (max {maxLen}).
      </span>;
    }
    return <span className="text-emerald-600">
      {'✓'} Looks good. {length}-digit {selected.name} number.
    </span>;
  }
  return (
    <div ref={wrapRef} className="relative">
      <div className={`flex items-stretch overflow-hidden rounded-card
        border bg-white ${ringClass}`}>
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
          onBlur={() => setTouched(true)}
          placeholder={placeholder
            || `${minLen}-${maxLen} digit mobile`} />
        {touched && length > 0 && (
          <div className="flex shrink-0 items-center pr-3 text-xs
            font-bold">
            <span className={valid ? 'text-emerald-600'
              : 'text-rose-500'}>
              {length}/{minLen === maxLen ? minLen
                : `${minLen}-${maxLen}`}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 text-[11px] font-semibold">
        {statusLine()}
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
