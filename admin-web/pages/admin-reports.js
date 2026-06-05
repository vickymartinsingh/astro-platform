import { useEffect, useState } from 'react';
import {
  REPORTS, buildReport, generateReportHTML,
  downloadReportPdf, downloadReportCsv, emailReport,
} from '@astro/shared/services/reportService.js';
import { db } from '@astro/shared';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useAuth, useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin Reports.
//
// Curated catalogue of reports (user / revenue / session). Each has
// a known column set; admin toggles which columns to render via
// chip strip. Defaults are saved per-browser AND can be pushed as
// system defaults in settings/config.report_defaults so every admin
// lands on the same view.
//
// PDF generation is client-side via a print window so it works on
// Spark - the old "PDF generation failed: internal" was a missing
// Cloud Function dep.
//
// Email opens a centered modal with the recipient prefilled. BCC
// list is loaded from settings/config.bcc_emails and threaded
// through the relay so every email this system sends carbon-copies
// the admin's configured list on top of the existing compliance
// archive.
const PREF_KEY = 'adminReportPrefs';

export default function AdminReports() {
  const { loading } = useRequireAdmin();
  const { user } = useAuth();
  const [type, setType] = useState('user');
  const [cols, setCols] = useState(REPORTS.user.defaultOn);
  const [limit, setLimit] = useState(500);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [bccList, setBccList] = useState([]);
  const [adminDefaultCols, setAdminDefaultCols] = useState({});

  useEffect(() => {
    if (loading) return;
    try {
      const raw = window.localStorage.getItem(PREF_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.type && REPORTS[o.type]) setType(o.type);
        if (o && Array.isArray(o.cols)) setCols(o.cols);
      }
    } catch (_) {}
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'config'));
        const d = s.exists() ? s.data() : {};
        if (Array.isArray(d.bcc_emails)) setBccList(d.bcc_emails);
        if (d.report_defaults
          && typeof d.report_defaults === 'object') {
          setAdminDefaultCols(d.report_defaults);
        }
      } catch (_) { /* ok */ }
    })();
  }, [loading]);

  useEffect(() => {
    setReport(null);
    try {
      const raw = window.localStorage.getItem(PREF_KEY);
      const o = raw ? JSON.parse(raw) : {};
      if (o && o.type === type && Array.isArray(o.cols)) return;
    } catch (_) {}
    const sysDefault = adminDefaultCols[type];
    setCols(Array.isArray(sysDefault) && sysDefault.length
      ? sysDefault : REPORTS[type].defaultOn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, adminDefaultCols]);

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }
  const def = REPORTS[type];

  function toggleCol(key) {
    setCols((c) => c.includes(key)
      ? c.filter((x) => x !== key) : [...c, key]);
  }
  function saveAsDefaultLocal() {
    if (!window.confirm('Save this view as YOUR default columns for '
      + `the ${def.label}? Stored in this browser only.`)) return;
    try {
      window.localStorage.setItem(PREF_KEY,
        JSON.stringify({ type, cols }));
      flash('Saved as your default columns.', 'success');
    } catch (_) { flash('Could not save locally.', 'error'); }
  }
  async function saveAsSystemDefault() {
    if (!window.confirm('Save these columns as the SYSTEM default '
      + `for the ${def.label}? Every admin will land on this view.`)) {
      return;
    }
    try {
      const cur = await getDoc(doc(db, 'settings', 'config'));
      const d = cur.exists() ? (cur.data() || {}) : {};
      const next = { ...(d.report_defaults || {}), [type]: cols };
      await setDoc(doc(db, 'settings', 'config'),
        { report_defaults: next }, { merge: true });
      setAdminDefaultCols(next);
      flash(`System default for ${def.label} saved.`, 'success');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    }
  }
  function resetCols() {
    setCols(def.defaultOn);
    try { window.localStorage.removeItem(PREF_KEY); } catch (_) {}
    flash('Reset to factory defaults.', 'success');
  }

  async function runBuild() {
    setBusy('build');
    try {
      const r = await buildReport(type, { columns: cols,
        limit: Number(limit) || 500 });
      setReport(r);
    } catch (e) {
      flash(`Build failed: ${e.message || e}`, 'error');
    } finally { setBusy(''); }
  }
  async function doDownload() {
    setBusy('pdf');
    try {
      const r = report || await buildReport(type, { columns: cols,
        limit: Number(limit) || 500 });
      if (!report) setReport(r);
      downloadReportPdf(r);
    } catch (e) {
      flash(`PDF failed: ${e.message || e}`, 'error');
    } finally { setBusy(''); }
  }
  async function doCsv() {
    try {
      const r = report || await buildReport(type, { columns: cols,
        limit: Number(limit) || 500 });
      if (!report) setReport(r);
      downloadReportCsv(r);
    } catch (e) {
      flash(`CSV failed: ${e.message || e}`, 'error');
    }
  }
  async function saveBccList(next) {
    try {
      await setDoc(doc(db, 'settings', 'config'),
        { bcc_emails: next }, { merge: true });
      setBccList(next);
      flash('BCC list saved. Every email from now on will carbon-'
        + 'copy these addresses.', 'success');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    }
  }

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">PDF Report System</h1>
      <p className="mb-4 text-sm text-sub-text">
        Build, preview, download (as PDF / CSV) or email the
        built-in admin reports. Use the chip strip to pick columns,
        save as your personal or system-wide default.
      </p>

      <div className="surface mb-3 flex flex-wrap items-center
        gap-2 p-3">
        <select className="input w-48" value={type}
          onChange={(e) => setType(e.target.value)}>
          {Object.entries(REPORTS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input type="number" className="input w-24" min="10"
          max="5000" value={limit}
          onChange={(e) => setLimit(e.target.value)}
          title="Row limit" />
        <button onClick={runBuild} disabled={busy === 'build'}
          className="rounded-full bg-bg-light px-4 py-2 text-sm
            font-bold text-dark-text">
          {busy === 'build' ? 'Building...' : 'Preview'}
        </button>
        <button onClick={doDownload} disabled={busy === 'pdf'}
          className="rounded-full bg-primary px-4 py-2 text-sm
            font-bold text-white">
          {busy === 'pdf' ? 'Generating...' : 'Download PDF'}
        </button>
        <button onClick={doCsv}
          className="rounded-full bg-bg-light px-4 py-2 text-sm
            font-bold text-dark-text">
          CSV
        </button>
        <button onClick={() => setEmailOpen(true)}
          className="rounded-full bg-bg-light px-4 py-2 text-sm
            font-bold text-dark-text">
          Email Report
        </button>
      </div>

      <div className="surface mb-3 p-3">
        <div className="mb-2 flex flex-wrap items-center
          justify-between gap-2">
          <div className="text-[11px] font-bold uppercase tracking-wider
            text-sub-text">Columns</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={saveAsDefaultLocal}
              className="rounded-full bg-bg-light px-3 py-1
                text-[11px] font-bold">
              Save as my default
            </button>
            <button onClick={saveAsSystemDefault}
              className="rounded-full bg-primary px-3 py-1
                text-[11px] font-bold text-white">
              Save as system default
            </button>
            <button onClick={resetCols}
              className="rounded-full bg-bg-light px-3 py-1
                text-[11px] font-bold text-sub-text">
              Reset
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {def.columns.map(([key, lbl]) => {
            const on = cols.includes(key);
            return (
              <button key={key} onClick={() => toggleCol(key)}
                className={`rounded-full px-2.5 py-1 text-[11.5px]
                  font-bold transition ${on
                    ? 'bg-primary text-white'
                    : 'bg-bg-light text-sub-text'}`}>
                {on ? '✓ ' : ''}{lbl}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[10.5px] text-sub-text">
          {cols.length} of {def.columns.length} columns selected ·
          row limit {limit}
        </div>
      </div>

      <div className="surface mb-3 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wider
          text-sub-text">
          Admin BCC list (extra carbon-copy on every email)
        </div>
        <p className="mt-1 text-[11px] text-sub-text">
          Every email this report system sends (and every OTP,
          welcome mail, dispute reply etc.) carbon-copies the
          mandatory compliance address. Adding emails here adds
          them ON TOP, so they receive every email the platform
          sends.
        </p>
        <BccEditor list={bccList} onSave={saveBccList} />
      </div>

      {report && (
        <div className="surface overflow-x-auto p-2">
          <div className="mb-2 text-[11px] font-bold uppercase
            tracking-wider text-sub-text">
            Preview · {report.rowCount} rows shown
          </div>
          <div className="rounded-lg border border-gray-200 bg-white
            p-3" dangerouslySetInnerHTML={{
              __html: generateReportHTML(report) }} />
        </div>
      )}

      {emailOpen && (
        <EmailReportModal
          defaultTo={user?.email || ''}
          bccList={bccList}
          buildAndSend={async ({ to, bcc }) => {
            const r = report || await buildReport(type,
              { columns: cols, limit: Number(limit) || 500 });
            if (!report) setReport(r);
            await emailReport(r, { to, bcc });
          }}
          onClose={() => setEmailOpen(false)} />
      )}
    </Layout>
  );
}

function BccEditor({ list, onSave }) {
  const [draft, setDraft] = useState((list || []).join(', '));
  useEffect(() => { setDraft((list || []).join(', ')); }, [list]);
  function save() {
    const next = String(draft || '').split(/[,\n]/)
      .map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
    if (!window.confirm(`Save ${next.length} BCC address`
      + `${next.length === 1 ? '' : 'es'}? Every outgoing email `
      + 'will carbon-copy these from now on.')) return;
    onSave(next);
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <textarea rows={2} className="input flex-1 min-w-[200px]"
        value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. ops@astroseer.in, alerts@yourdomain.com" />
      <button onClick={save}
        className="rounded-full bg-primary px-4 py-2 text-xs
          font-bold text-white">
        Save BCC list
      </button>
    </div>
  );
}

function EmailReportModal({ defaultTo, bccList, buildAndSend,
  onClose }) {
  const [to, setTo] = useState(defaultTo);
  const [bccDraft, setBccDraft] = useState((bccList || [])
    .join(', '));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setErr('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      setErr('Enter a valid recipient email.'); return;
    }
    setBusy(true);
    try {
      const bcc = bccDraft.split(/[,\n]/).map((s) => s.trim())
        .filter((s) => /.+@.+\..+/.test(s));
      await buildAndSend({ to: to.trim(), bcc });
      setSent(true);
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center
      justify-center bg-black/55 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl
          bg-white shadow-2xl">
        {sent ? (
          <div className="p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center
              rounded-full bg-emerald-100 text-emerald-700">
              <svg width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="mt-3 text-lg font-bold">
              Email sent successfully
            </h3>
            <p className="mt-1 text-sm text-sub-text">
              Report delivered to <b>{to}</b>. BCC stack carbon-copies
              the compliance archive plus your configured list.
            </p>
            <button onClick={onClose}
              className="mt-4 rounded-full bg-primary px-5 py-2
                text-sm font-bold text-white">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="bg-primary px-5 py-4 text-white">
              <div className="text-[11px] font-bold uppercase
                tracking-widest opacity-80">Email report</div>
              <div className="mt-0.5 text-lg font-bold">
                Send PDF report
              </div>
            </div>
            <div className="space-y-3 p-5">
              <label className="block">
                <span className="text-xs font-semibold text-sub-text">
                  Recipient
                </span>
                <input type="email" className="input mt-1 w-full"
                  value={to} onChange={(e) => setTo(e.target.value)}
                  placeholder="name@example.com" autoFocus />
                <div className="mt-1 text-[10.5px] text-sub-text">
                  Prefilled with your admin email. Edit if needed.
                </div>
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-sub-text">
                  BCC (optional, comma-separated)
                </span>
                <textarea rows={2} className="input mt-1 w-full"
                  value={bccDraft}
                  onChange={(e) => setBccDraft(e.target.value)}
                  placeholder="ops@astroseer.in" />
                <div className="mt-1 text-[10.5px] text-sub-text">
                  Pre-populated from settings/config.bcc_emails.
                </div>
              </label>
              {err && (
                <div className="rounded-card bg-danger/10 p-2
                  text-xs font-semibold text-danger">{err}</div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} disabled={busy}
                  className="rounded-full bg-bg-light px-4 py-2
                    text-sm font-semibold">
                  Cancel
                </button>
                <button onClick={go} disabled={busy}
                  className="rounded-full bg-primary px-5 py-2
                    text-sm font-bold text-white
                    disabled:opacity-50">
                  {busy ? 'Sending...' : 'Send email'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
