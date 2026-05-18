import { useEffect, useState } from 'react';
import { db, adminService, horoscopeService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Upload one CSV with every sign for every date of the month. The apps
// read the row for the current date automatically each day, so a single
// upload auto-updates the daily horoscope all month. A blank template
// (every sign x next 31 days) can be downloaded to fill in.
export default function AdminHoroscope() {
  const { loading } = useRequireAdmin();
  const [count, setCount] = useState(null);   // existing rows
  const [report, setReport] = useState(null); // last upload result
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'horoscope')).then((s) => {
      const e = (s.exists() && s.data().entries) || {};
      setCount(Object.keys(e).length);
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
      await adminService.updateSettings('horoscope', {
        entries: res.entries, updatedAt: Date.now(),
      });
      setReport({ ok: true,
        msg: `${res.count} rows saved - live now, applies by date `
          + 'automatically each day.',
        errors: res.errors });
      setCount((c) => (c || 0) + res.count);
      flash('Horoscope CSV saved - live');
    } catch (e) {
      setReport({ ok: false, msg: e.message || 'upload failed' });
    } finally { setBusy(false); }
  }

  if (loading || count === null) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Horoscope (CSV)</h1>
      <p className="mb-4 text-sm text-sub-text">
        Upload the monthly horoscope for every sign. The app shows each
        date&apos;s row automatically - one upload covers the whole
        month and updates daily on its own. Missing dates fall back to
        the built-in reading.
      </p>

      <div className="card space-y-3">
        <div className="text-sm">
          Currently stored rows: <b>{count}</b>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTemplate}
            className="rounded-card border border-primary px-4 py-2
              text-sm font-semibold text-primary">
            Download CSV template
          </button>
          <label className="cursor-pointer rounded-card bg-primary px-4
            py-2 text-sm font-semibold text-white">
            {busy ? 'Uploading...' : 'Upload filled CSV'}
            <input type="file" accept=".csv,text/csv" hidden
              onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
        <p className="text-xs text-sub-text">
          Columns: {horoscopeService.HOROSCOPE_CSV_COLUMNS.join(', ')}.
          Date format YYYY-MM-DD. Re-uploading adds / overwrites rows.
        </p>
      </div>

      {report && (
        <div className={`card mt-4 ${report.ok
          ? 'bg-success/10' : 'bg-danger/10'}`}>
          <div className={`text-sm font-semibold ${report.ok
            ? 'text-success' : 'text-danger'}`}>
            {report.msg}
          </div>
          {report.errors && report.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-sub-text">
              {report.errors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Layout>
  );
}
