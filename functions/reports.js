// PDF reports + email (blueprint 6.24 / 8.4). pdfkit -> Storage -> URL.
const functions = require('firebase-functions');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { admin, db } = require('./lib/admin');
const { requireAdmin } = require('./lib/utils');

async function collectRows(type, filters) {
  if (type === 'user') {
    const s = await db.collection('users').limit(500).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  if (type === 'revenue' || type === 'session') {
    let q = db.collection('transactions').where('type', '==', 'debit');
    const s = await q.limit(500).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return [];
}

exports.generatePDFReport = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { type = 'custom', filters = {} } = data || {};
  const rows = await collectRows(type, filters);

  const buffers = [];
  const docPdf = new PDFDocument({ margin: 40 });
  docPdf.on('data', (b) => buffers.push(b));
  const done = new Promise((res) => docPdf.on('end', res));

  // Royal palette (Maroon). Purple is strictly prohibited.
  docPdf.fontSize(20).fillColor('#7F2020')
    .text(`${type.toUpperCase()} REPORT`, { align: 'left' });
  docPdf.moveDown(0.3).fontSize(10).fillColor('#555555')
    .text(`Generated ${new Date().toLocaleString()}`);
  docPdf.moveDown();
  docPdf.fillColor('#1A1A2E').fontSize(11);
  rows.slice(0, 120).forEach((r, i) => {
    docPdf.text(`${i + 1}. ${JSON.stringify(r).slice(0, 240)}`);
  });
  docPdf.end();
  await done;

  const buffer = Buffer.concat(buffers);
  const bucket = admin.storage().bucket();
  const path = `reports/report_${type}_${Date.now()}.pdf`;
  const file = bucket.file(path);
  await file.save(buffer, { contentType: 'application/pdf' });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  await db.collection('reports').add({
    type, filters,
    generatedBy: context.auth.uid,
    fileUrl: url,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { url };
});

exports.emailReport = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { reportUrl, email } = data || {};
  const cfgSnap = await db.collection('settings').doc('email').get();
  const e = cfgSnap.exists ? cfgSnap.data() : {};
  if (!e.smtp_host) {
    throw new functions.https.HttpsError(
      'failed-precondition', 'SMTP not configured in settings/email');
  }
  const transporter = nodemailer.createTransport({
    host: e.smtp_host,
    port: Number(e.smtp_port || 587),
    secure: Number(e.smtp_port) === 465,
    auth: { user: e.smtp_email, pass: e.smtp_password },
  });
  await transporter.sendMail({
    from: e.smtp_email,
    to: email,
    subject: 'Your requested report',
    html: `<p>Your report is ready.</p><p><a href="${reportUrl}">Download PDF</a></p>`,
  });
  return { sent: true };
});
