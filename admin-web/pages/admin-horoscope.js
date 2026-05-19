import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  db, adminService, horoscopeService, ZODIAC,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const FIELDS = ['general', 'love', 'career', 'health',
  'luckyNumber', 'luckyColor'];

function fmt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminHoroscope() {
  const { loading } = useRequireAdmin();
  const [entries, setEntries] = useState({});   // live editable copy
  const [uploads, setUploads] = useState([]);   // [{ref,at,count}]
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  // filters
  const [fSign, setFSign] = useState('');
  const [fDate, setFDate] = useState('');
  const [fRef, setFRef] = useState('');
  const [fText, setFText] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'horoscope')).then((s) => {
      const d = s.exists() ? s.data() : {};
      setEntries(d.entries || {});
      setUploads(Array.isArray(d.uploads) ? d.uploads : []);
      setReady(true);
    });
  }, []);

  function downloadTemplate() {
    const csv = horoscopeService.horoscopeCSVTemplate(31);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'horoscope-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onFile(file) {
    if (!file) return;
    setBusy(true); setReport(null);
    try {
      const text = await file.text();
      const res = horoscopeService.parseHoroscopeCSV(text);
      if (!res.count) {
        setReport({ ok: false, msg: 'No valid rows found.',
          errors: res.errors });
        return;
      }
      const ref = horoscopeService.genHoroscopeRef(
        uploads.map((u) => u.ref));
      const tagged = {};
      Object.entries(res.entries).forEach(([k, v]) => {
        tagged[k] = { ...v, ref };
      });
      const merged = { ...entries, ...tagged };
      const ups = [...uploads,
        { ref, at: Date.now(), count: res.count }];
      await adminService.updateSettings('horoscope', {
        entries: merged, uploads: ups, updatedAt: Date.now(),
      });
      setEntries(merged); setUploads(ups); setDirty(false);
      setReport({ ok: true,
        msg: `${res.count} rows saved under ref #${ref} - live now, `
          + 'applies by date automatically each day.',
        errors: res.errors });
      flash(`Horoscope CSV #${ref} saved - live`);
    } catch (e) {
      setReport({ ok: false, msg: e.message || 'upload failed' });
    } finally { setBusy(false); }
  }

  async function revoke(ref) {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Revoke CSV #${ref}? All its rows will be removed `
      + 'and the app falls back to built-in readings for those dates.'
    )) return;
    setBusy(true);
    try {
      const next = {};
      Object.entries(entries).forEach(([k, v]) => {
        if (String(v.ref) !== String(ref)) next[k] = v;
      });
      const ups = uploads.filter((u) => String(u.ref) !== String(ref));
      await adminService.updateSettings('horoscope', {
        entries: next, uploads: ups, updatedAt: Date.now(),
      });
      setEntries(next); setUploads(ups);
      flash(`CSV #${ref} revoked`);
    } finally { setBusy(false); }
  }

  function editCell(key, field, val) {
    setEntries((e) => ({ ...e, [key]: { ...e[key], [field]: val } }));
    setDirty(true);
  }
  function delRow(key) {
    setEntries((e) => {
      const n = { ...e }; delete n[key]; return n;
    });
    setDirty(true);
  }
  async function saveEdits() {
    setBusy(true);
    try {
      await adminService.updateSettings('horoscope', {
        entries, updatedAt: Date.now(),
      });
      setDirty(false);
      flash('Changes saved - live');
    } finally { setBusy(false); }
  }

  if (loading || !ready) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const rows = Object.entries(entries).map(([key, v]) => {
    const [sign, date] = key.split('|');
    return { key, sign, date, ...v };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
    : a.sign.localeCompare(b.sign)));

  const ft = fText.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!fSign || r.sign === fSign)
    && (!fDate || r.date === fDate)
    && (!fRef || String(r.ref) === fRef)
    && (!ft || FIELDS.some((f) =>
      String(r[f] || '').toLowerCase().includes(ft))));
  const cap = shown.slice(0, 300);

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Horoscope (CSV)</h1>
      <p className="mb-4 text-sm text-sub-text">
        Upload monthly readings, then view / filter / edit / revoke any
        upload. Each CSV gets a unique 6-digit reference.
      </p>

      <div className="card mb-4 flex flex-wrap items-center gap-2">
        <button onClick={downloadTemplate}
          className="rounded-card border border-primary px-4 py-2
            text-sm font-semibold text-primary">
          Download CSV template
        </button>
        <label className="cursor-pointer rounded-card bg-primary px-4
          py-2 text-sm font-semibold text-white">
          {busy ? 'Working...' : 'Upload now'}
          <input type="file" accept=".csv,text/csv" hidden
            onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <span className="text-xs text-sub-text">
          Columns: {horoscopeService.HOROSCOPE_CSV_COLUMNS.join(', ')} -
          date YYYY-MM-DD
        </span>
      </div>

      {report && (
        <div className={`card mb-4 ${report.ok
          ? 'bg-success/10' : 'bg-danger/10'}`}>
          <div className={`text-sm font-semibold ${report.ok
            ? 'text-success' : 'text-danger'}`}>{report.msg}</div>
          {report.errors && report.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-sub-text">
              {report.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide
        text-sub-text">Uploads ({uploads.length})</h2>
      <div className="mb-5 space-y-2">
        {uploads.length === 0 ? (
          <div className="card text-sm text-sub-text">
            No CSV uploaded yet.
          </div>
        ) : uploads.slice().reverse().map((u) => (
          <div key={u.ref}
            className="card flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Ref #{u.ref}</div>
              <div className="text-xs text-sub-text">
                {u.count} rows - {fmt(u.at)}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setFRef(String(u.ref)); }}
                className="rounded-card border border-gray-200 px-3 py-1.5
                  text-xs">View rows</button>
              <button onClick={() => revoke(u.ref)} disabled={busy}
                className="rounded-card border border-danger px-3 py-1.5
                  text-xs text-danger">Revoke</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between
        gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide
          text-sub-text">All data ({shown.length})</h2>
        <button onClick={saveEdits} disabled={!dirty || busy}
          className={`rounded-card px-4 py-2 text-sm font-semibold
            ${dirty ? 'bg-primary text-white'
              : 'bg-bg-light text-sub-text'}`}>
          {busy ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
      <div className="card mb-3 flex flex-wrap gap-2">
        <select className="input !min-h-0 w-auto py-1.5" value={fSign}
          onChange={(e) => setFSign(e.target.value)}>
          <option value="">All signs</option>
          {ZODIAC.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <input type="date" className="input !min-h-0 w-auto py-1.5"
          value={fDate} onChange={(e) => setFDate(e.target.value)} />
        <select className="input !min-h-0 w-auto py-1.5" value={fRef}
          onChange={(e) => setFRef(e.target.value)}>
          <option value="">All refs</option>
          {uploads.map((u) => (
            <option key={u.ref} value={String(u.ref)}>#{u.ref}</option>
          ))}
        </select>
        <input className="input !min-h-0 flex-1 py-1.5"
          placeholder="Search text..." value={fText}
          onChange={(e) => setFText(e.target.value)} />
        <button onClick={() => { setFSign(''); setFDate('');
          setFRef(''); setFText(''); }}
          className="rounded-card border border-gray-200 px-3 py-1.5
            text-xs">Clear</button>
      </div>

      {shown.length === 0 ? (
        <div className="card text-sm text-sub-text">
          No rows match the filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-1">Sign</th><th className="p-1">Date</th>
                <th className="p-1">Ref</th>
                {FIELDS.map((f) => (
                  <th key={f} className="p-1 capitalize">{f}</th>
                ))}
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {cap.map((r) => (
                <tr key={r.key} className="border-t align-top">
                  <td className="p-1 font-semibold">{r.sign}</td>
                  <td className="p-1 whitespace-nowrap">{r.date}</td>
                  <td className="p-1 text-sub-text">
                    {r.ref ? `#${r.ref}` : '-'}
                  </td>
                  {FIELDS.map((f) => (
                    <td key={f} className="p-1">
                      <textarea
                        className="w-40 rounded border border-gray-200
                          p-1"
                        rows={2} value={r[f] || ''}
                        onChange={(e) =>
                          editCell(r.key, f, e.target.value)} />
                    </td>
                  ))}
                  <td className="p-1">
                    <button onClick={() => delRow(r.key)}
                      className="text-danger">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > cap.length && (
            <p className="mt-2 text-xs text-sub-text">
              Showing first {cap.length} of {shown.length}. Narrow the
              filters to see the rest.
            </p>
          )}
        </div>
      )}
    </Layout>
  );
}
