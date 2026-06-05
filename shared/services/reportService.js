// reportService - clean tabular reports for the admin panel.
//
// Previously called a generatePDFReport Cloud Function that does
// not exist on Spark, so admins always saw "PDF generation failed:
// internal". The preview also dumped every Firestore field as raw
// text including Timestamp objects (Timestamp(seconds=...)) and FCM
// tokens.
//
// This rewrite:
//   - Curated default columns per report type with readable labels.
//   - Smart value formatter (timestamps -> human dates, booleans
//     -> Yes/No, nested objects -> .label/.place, arrays joined).
//   - Client-side PDF via print window (no Cloud Function needed).
//   - Email goes through the existing /api/emailOtp relay so it
//     works on Spark too. Supports optional BCC list.
import { rupees } from '../money.js';
import {
  getAllUsers, getAllTransactions,
} from './adminService.js';
import { sendEmail } from './emailService.js';

// ---------- Catalogue ---------------------------------------------
// Each report has:
//   label      : human label
//   fetch      : async function returning rows
//   columns    : ordered array [key, label, formatter?]
//   defaultOn  : keys visible by default
//   sortKey    : default sort field (desc)
export const REPORTS = {
  user: {
    label: 'User Report',
    async fetch() { return getAllUsers(); },
    columns: [
      ['name', 'Name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['userCode', 'Code'],
      ['role', 'Role'],
      ['wallet', 'Wallet', (v) => rupees(Number(v || 0))],
      ['status', 'Status'],
      ['isOnline', 'Online', fmtBool],
      ['emailVerified', 'Email verified', fmtBool],
      ['createdAt', 'Joined', fmtDate],
      ['lastSeenAt', 'Last seen', fmtDate],
      ['lastIp', 'Last IP'],
      ['lastPlatform', 'Platform'],
      ['lastLanguage', 'Language'],
      ['placeOfBirth', 'Place of birth', fmtPlace],
    ],
    defaultOn: ['name', 'email', 'phone', 'userCode', 'role',
      'wallet', 'status', 'createdAt', 'lastSeenAt'],
    sortKey: 'createdAt',
  },
  revenue: {
    label: 'Revenue Report',
    async fetch() {
      return getAllTransactions({ type: 'debit' });
    },
    columns: [
      ['createdAt', 'When', fmtDate],
      ['userId', 'User UID'],
      ['amount', 'Amount',
        (v) => rupees(Math.abs(Number(v || 0)))],
      ['type', 'Type'],
      ['reason', 'Reason'],
      ['referenceId', 'Reference'],
      ['source', 'Source'],
    ],
    defaultOn: ['createdAt', 'userId', 'amount', 'type', 'reason'],
    sortKey: 'createdAt',
  },
  session: {
    label: 'Session Report',
    async fetch() {
      const { db } = await import('../firebase.js');
      const {
        collection, getDocs, orderBy, query, limit,
      } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'sessions'),
        orderBy('createdAt', 'desc'), limit(500)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    columns: [
      ['id', 'Session ID'],
      ['createdAt', 'When', fmtDate],
      ['type', 'Type'],
      ['userId', 'Customer'],
      ['astroId', 'Astrologer'],
      ['status', 'Status'],
      ['duration', 'Duration (s)'],
      ['cost', 'Cost', (v) => rupees(Number(v || 0))],
    ],
    defaultOn: ['id', 'createdAt', 'type', 'userId', 'astroId',
      'status', 'duration', 'cost'],
    sortKey: 'createdAt',
  },
};

// ---------- Formatters --------------------------------------------
function fmtDate(v) {
  try {
    let ms = 0;
    if (v && v.toMillis) ms = v.toMillis();
    else if (v && v.seconds) ms = v.seconds * 1000;
    else if (typeof v === 'number') ms = v;
    else if (typeof v === 'string' && v) ms = Date.parse(v);
    if (!ms || Number.isNaN(ms)) return '';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return ''; }
}
function fmtBool(v) {
  if (v === true || v === 'true') return 'Yes';
  if (v === false || v === 'false') return 'No';
  return '';
}
function fmtPlace(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    return v.label || v.place
      || [v.city, v.state, v.country].filter(Boolean).join(', ');
  }
  return '';
}
function fmtCell(value, formatter) {
  if (formatter) {
    try { return formatter(value); } catch (_) { return ''; }
  }
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && value.toMillis) return fmtDate(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    return value.label || value.place || value.name
      || JSON.stringify(value).slice(0, 60);
  }
  return String(value);
}

// ---------- Build -------------------------------------------------
// Returns the report ready to render: filtered columns, formatted
// cells, sorted, optionally row-limited.
export async function buildReport(type, options = {}) {
  const def = REPORTS[type] || REPORTS.user;
  const rows = await def.fetch();
  const onSet = new Set(options.columns
    && options.columns.length > 0
    ? options.columns : def.defaultOn);
  const columns = def.columns.filter(([k]) => onSet.has(k));
  const sorted = sortRows(rows, def.sortKey);
  const limited = (options.limit && options.limit > 0)
    ? sorted.slice(0, options.limit) : sorted;
  const cells = limited.map((r) => columns
    .map(([key, , fmt]) => fmtCell(r[key], fmt)));
  return {
    type, label: def.label, columns, cells,
    rowCount: cells.length, totalCount: rows.length,
  };
}
function sortRows(rows, key) {
  if (!key) return rows;
  const list = [...rows];
  list.sort((a, b) => {
    const av = a && a[key];
    const bv = b && b[key];
    const am = av && av.toMillis ? av.toMillis()
      : av && av.seconds ? av.seconds * 1000
      : typeof av === 'number' ? av : 0;
    const bm = bv && bv.toMillis ? bv.toMillis()
      : bv && bv.seconds ? bv.seconds * 1000
      : typeof bv === 'number' ? bv : 0;
    return bm - am;
  });
  return list;
}

// ---------- HTML output -------------------------------------------
// Used for the in-app preview AND the print window. Landscape A4,
// 10.5px tables, header row repeats on every page, footer carries
// page number + generated timestamp.
export function generateReportHTML(report) {
  const head = report.columns.map(([, lbl]) =>
    `<th>${esc(lbl)}</th>`).join('');
  const body = report.cells.map((row) =>
    `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  const generatedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(report.label)} - AstroSeer</title>
<style>
  @page { size: A4 landscape; margin: 14mm 10mm 18mm 10mm; }
  body { font-family: 'Inter', Arial, sans-serif;
    color: #1A1A2E; margin: 0; }
  .head { display: flex; align-items: end;
    justify-content: space-between; border-bottom: 2px solid #7F2020;
    padding-bottom: 8px; margin-bottom: 14px; }
  .head h1 { margin: 0; color: #7F2020;
    font-size: 22px; letter-spacing: -0.3px; }
  .head .meta { font-size: 11px; color: #6B7280; text-align: right; }
  .meta b { color: #1A1A2E; }
  table { width: 100%; border-collapse: collapse;
    font-size: 10.5px; }
  thead { display: table-header-group; }
  th, td { padding: 5px 7px; border-bottom: 1px solid #E6DEC9;
    text-align: left; vertical-align: top; }
  th { background: #FBF7EE; color: #7F2020;
    font-size: 9.5px; text-transform: uppercase;
    letter-spacing: 0.4px; font-weight: 700; }
  tr:nth-child(even) td { background: #FAFBFD; }
  .foot { margin-top: 14px; font-size: 10px;
    color: #6B7280; border-top: 1px solid #E5E7EB;
    padding-top: 6px; display: flex;
    justify-content: space-between; }
  @media print {
    .no-print { display: none !important; }
  }
</style></head><body>
<div class="head">
  <h1>${esc(report.label)}</h1>
  <div class="meta">
    Generated <b>${esc(generatedAt)}</b><br/>
    Rows <b>${report.rowCount}</b>${report.totalCount > report.rowCount
      ? ` of <b>${report.totalCount}</b>` : ''}
  </div>
</div>
<table>
  <thead><tr>${head}</tr></thead>
  <tbody>${body}</tbody>
</table>
<div class="foot">
  <span>AstroSeer admin report</span>
  <span>${esc(generatedAt)}</span>
</div>
</body></html>`;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- PDF (client-side print window) ------------------------
// Opens a new window with the print-styled HTML and triggers the
// browser's print dialog. Admin saves as PDF from there. Works on
// every browser (Chromium, Safari, Firefox) and on Spark plan -
// NO Cloud Function involved. The old "PDF generation failed:
// internal" was the Cloud Function dependency that no longer
// exists.
export function downloadReportPdf(report) {
  const html = generateReportHTML(report);
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('Popup blocked. Allow popups for this domain.');
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    try { w.focus(); w.print(); } catch (_) {}
  }, 400);
}

// ---------- Email -------------------------------------------------
// Sends the report as inline HTML to the chosen email via the
// existing relay /api/emailOtp send action. Optional BCC list is
// threaded through to the relay; caller (admin page) reads bcc
// recipients from settings/config.bcc_emails so the admin can
// configure them in /admin-settings without touching code.
export async function emailReport(report,
  { to, subject, bcc = [] } = {}) {
  if (!to) throw new Error('Recipient email is required.');
  const html = generateReportHTML(report);
  return sendEmail({
    to,
    subject: subject || `${report.label} - AstroSeer`,
    html,
    bcc,
  });
}

// CSV (bonus: useful for spreadsheet pivots).
export function downloadReportCsv(report) {
  const head = report.columns.map(([, lbl]) => csv(lbl)).join(',');
  const body = report.cells
    .map((r) => r.map(csv).join(',')).join('\n');
  const blob = new Blob([head + '\n' + body],
    { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${report.type}-report.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csv(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return `"${s}"`;
}
