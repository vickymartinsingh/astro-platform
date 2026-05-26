// reportService, blueprint 8.2 & 6.24
// HTML is built client-side for the preview modal; PDF generation + email
// happen server-side in the generatePDFReport / emailReport Cloud Functions.
import { httpsCallable } from 'firebase/functions';
import { getFunctionsLazy } from '../firebase.js';

async function callable(name) {
  const fns = await getFunctionsLazy();
  if (!fns) throw new Error('Cloud Functions unavailable.');
  return httpsCallable(fns, name);
}
import { getAllUsers, getAllTransactions } from './adminService.js';

export async function fetchReportData(type, filters = {}) {
  switch (type) {
    case 'user':
      return { type, rows: await getAllUsers(filters) };
    case 'revenue':
    case 'session': {
      const tx = await getAllTransactions({ type: 'debit', ...filters });
      return { type, rows: tx };
    }
    default:
      return { type, rows: [] };
  }
}

export function generateReportHTML(data) {
  const rows = (data.rows || []).slice(0, 200);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${headers.map((h) =>
      `<td>${String(r[h] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">
    <style>body{font-family:Arial;color:#1A1A2E}
    h1{color:#7F2020}table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #E6DEC9;padding:6px;font-size:12px;text-align:left}
    th{background:#FBF7EE;color:#7F2020}</style></head><body>
    <h1>${(data.type || 'Custom').toUpperCase()} REPORT</h1>
    <p>Generated ${new Date().toLocaleString()}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
}

export async function generatePDF(type, filters) {
  const fn = await callable('generatePDFReport');
  return (await fn({ type, filters })).data; // { url }
}

export async function emailReport(reportUrl, email) {
  const fn = await callable('emailReport');
  return (await fn({ reportUrl, email })).data;
}
