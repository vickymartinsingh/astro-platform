import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  db, DEFAULT_COUNTRIES, buildCountryList,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-country-codes
//
// Manage the dial-code list every signup + edit form across the
// platform uses. Operator can:
//   - Add a brand new country / region (ISO + name + dial code).
//   - Edit a default's name / dial code (writes an override row).
//   - Remove a default with a soft "_delete" marker so the picker
//     stops showing it.
//   - Reset everything back to the bundled defaults.
//
// All changes are written to settings/config.country_codes (array)
// and brandingService / watchCountryList pushes them to every app
// instantly - no rebuild.

function flagOf(iso) {
  return String(iso || '').toUpperCase()
    .replace(/./g, (c) => c >= 'A' && c <= 'Z'
      ? String.fromCodePoint(127397 + c.charCodeAt(0)) : '');
}

export default function AdminCountryCodes() {
  const { loading } = useRequireAdmin();
  const [overrides, setOverrides] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // {iso?, name, code} for new/edit
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (loading) return undefined;
    return onSnapshot(doc(db, 'settings', 'config'), (s) => {
      const d = (s.exists() && s.data()) || {};
      setOverrides(Array.isArray(d.country_codes)
        ? d.country_codes : []);
    }, () => {});
  }, [loading]);

  const merged = useMemo(() => buildCountryList(overrides),
    [overrides]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return merged;
    return merged.filter((c) => c.name.toLowerCase().includes(t)
      || c.code.includes(t) || c.iso.toLowerCase().includes(t));
  }, [merged, q]);

  async function save(nextOverrides) {
    setBusy(true);
    try {
      await setDoc(doc(db, 'settings', 'config'),
        { country_codes: nextOverrides }, { merge: true });
      flash('Country list updated. All apps refresh instantly.');
    } catch (e) {
      flash(`Save failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  function upsertOverride(entry) {
    // De-dupe by iso+code; remove any prior entry for the same key.
    const key = `${entry.iso || ''}-${entry.code}`;
    const next = overrides.filter((o) =>
      `${o.iso || ''}-${o.code}` !== key);
    next.push(entry);
    save(next);
  }
  function softDelete(c) {
    if (!window.confirm(`Remove ${c.name} (${c.code}) from the picker?`))
      return;
    // For default ISO, write a _delete row. For an admin-added entry,
    // strip it from the overrides array.
    if (c.source === 'default') {
      const isoKey = `${c.iso}-delete`;
      const next = overrides
        .filter((o) => `${(o.iso || '').toUpperCase()}-delete` !== isoKey)
        .concat([{ iso: c.iso, _delete: true }]);
      save(next);
    } else {
      const key = `${c.iso || ''}-${c.code}`;
      save(overrides.filter((o) =>
        `${o.iso || ''}-${o.code}` !== key));
    }
  }
  async function resetAll() {
    if (!window.confirm('Reset to the bundled defaults? '
      + 'Every admin override and addition will be removed.')) return;
    save([]);
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Country dial codes
          </h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Manage the +country list every phone-number field across
            the platform uses. Changes propagate instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEdit({ iso: '', name: '',
            code: '+' }); setNewOpen(true); }}
            className="rounded-full bg-primary px-4 py-2 text-xs
              font-bold text-white">
            + Add country
          </button>
          <button onClick={resetAll} disabled={busy}
            className="rounded-full bg-bg-light px-4 py-2 text-xs
              font-bold text-sub-text hover:bg-gray-200
              disabled:opacity-50">
            Reset to defaults
          </button>
        </div>
      </div>

      <div className="surface mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-9 w-9 place-items-center
            rounded-full bg-bg-light">{'\u{1F50D}'}</span>
          <input className="flex-1 min-w-[200px] bg-transparent
            text-sm outline-none placeholder:text-gray-400"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by country, ISO or dial code" />
          <span className="text-[11px] text-sub-text">
            {filtered.length} of {merged.length} shown
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white
        shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-light/50 text-left text-[11px]
            uppercase tracking-wider text-sub-text">
            <tr>
              <th className="px-4 py-3">Flag</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">ISO</th>
              <th className="px-4 py-3">Dial code</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6}
                className="px-4 py-6 text-center text-sub-text">
                No country matches that search.
              </td></tr>
            ) : filtered.map((c) => (
              <tr key={`${c.iso}-${c.code}`}
                className="border-t border-gray-100 hover:bg-bg-light/40">
                <td className="px-4 py-3 text-xl">{c.flag}</td>
                <td className="px-4 py-3 font-semibold text-dark-text">
                  {c.name}
                </td>
                <td className="px-4 py-3 font-mono text-[12px]
                  text-sub-text">{c.iso}</td>
                <td className="px-4 py-3 font-mono text-[12px]
                  text-dark-text">{c.code}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px]
                    font-bold uppercase tracking-wider ${c.source
                      === 'admin'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-bg-light text-sub-text'}`}>
                    {c.source}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEdit({ iso: c.iso,
                    name: c.name, code: c.code, original: c })}
                    className="rounded-full px-3 py-1 text-[11px]
                      font-bold text-primary hover:bg-primary/10">
                    Edit
                  </button>
                  <button onClick={() => softDelete(c)} disabled={busy}
                    className="rounded-full px-3 py-1 text-[11px]
                      font-bold text-danger hover:bg-danger/10
                      disabled:opacity-50">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(edit && (newOpen || edit.original)) && (
        <EditModal
          entry={edit} newOpen={newOpen}
          onClose={() => { setEdit(null); setNewOpen(false); }}
          onSave={(next) => {
            upsertOverride(next);
            setEdit(null); setNewOpen(false);
          }} />
      )}
    </Layout>
  );
}

function EditModal({ entry, newOpen, onClose, onSave }) {
  const [iso, setIso] = useState(entry.iso || '');
  const [name, setName] = useState(entry.name || '');
  const [code, setCode] = useState(entry.code || '+');
  const isNew = !entry.original;
  function submit() {
    const isoUp = String(iso || '').toUpperCase().slice(0, 2);
    const nm = String(name || '').trim();
    const cd = String(code || '').trim();
    if (!cd.startsWith('+') || cd.length < 2) {
      window.alert('Dial code must start with + and have at least one digit.');
      return;
    }
    if (!nm) {
      window.alert('Country name is required.');
      return;
    }
    onSave({ iso: isoUp, name: nm, code: cd });
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-card bg-white p-5
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">
          {isNew ? 'Add country' : 'Edit country'}
        </h3>
        <div className="mt-3 space-y-2">
          <Lbl text="ISO 3166 alpha-2 (e.g. IN, US, GB)">
            <input className="input mt-1 uppercase" maxLength={2}
              value={iso}
              onChange={(e) => setIso(e.target.value
                .replace(/[^a-zA-Z]/g, '').toUpperCase())} />
          </Lbl>
          <Lbl text="Country name">
            <input className="input mt-1" value={name}
              onChange={(e) => setName(e.target.value)} />
          </Lbl>
          <Lbl text="Dial code (e.g. +91)">
            <input className="input mt-1 font-mono" value={code}
              onChange={(e) => setCode(e.target.value)} />
          </Lbl>
          {iso && (
            <div className="rounded-card border border-gray-200
              bg-bg-light/30 p-2 text-sm">
              Preview: <b>{flagOf(iso)}</b> {name || '(name)'}{' '}
              <span className="font-mono">{code}</span>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded-full bg-bg-light px-4 py-2 text-sm
              font-semibold">Cancel</button>
          <button onClick={submit}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white">
            {isNew ? 'Add country' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
function Lbl({ text, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-sub-text">{text}</span>
      {children}
    </label>
  );
}
