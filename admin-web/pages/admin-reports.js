import { useState } from 'react';
import { reportService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Blueprint 6.24, report builder. PDF generation + email run server-side
// (generatePDFReport / emailReport Cloud Functions); preview is client-side.
const TYPES = [
  ['user', 'User Report'],
  ['revenue', 'Revenue Report'],
  ['session', 'Session Report'],
];

export default function AdminReports() {
  const { loading } = useRequireAdmin();
  const [type, setType] = useState('user');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function preview() {
    setBusy('preview'); setMsg('');
    try {
      const data = await reportService.fetchReportData(type, {});
      setHtml(reportService.generateReportHTML(data));
    } finally { setBusy(''); }
  }
  async function downloadPdf() {
    setBusy('pdf'); setMsg('');
    try {
      const { url } = await reportService.generatePDF(type, {});
      window.open(url, '_blank');
    } catch (e) {
      setMsg('PDF generation failed: ' + (e?.message || 'error'));
    } finally { setBusy(''); }
  }
  async function email() {
    const to = prompt('Send report PDF to email:');
    if (!to) return;
    setBusy('email'); setMsg('');
    try {
      const { url } = await reportService.generatePDF(type, {});
      await reportService.emailReport(url, to);
      setMsg('Report emailed.');
    } catch (e) {
      setMsg('Email failed: ' + (e?.message || 'error'));
    } finally { setBusy(''); }
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">PDF Report System</h1>
      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-48" value={type}
          onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={preview} disabled={busy}
          className="btn-ghost">Preview</button>
        <button onClick={downloadPdf} disabled={busy}
          className="btn-primary">
          {busy === 'pdf' ? 'Generating…' : 'Download PDF'}
        </button>
        <button onClick={email} disabled={busy}
          className="btn-ghost">Email Report</button>
      </div>
      {msg && <div className="card mb-3 bg-bg-light">{msg}</div>}
      {html && (
        <div className="card overflow-auto">
          {/* internal admin-only data rendered for preview */}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </Layout>
  );
}
