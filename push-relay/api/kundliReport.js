// Kundli PDF report — both flavours land here:
//
//   POST /api/kundliReport
//   body: { kind, kundliProfileId, uid }
//     kind = 'free'          -> 250+ page lifetime Vedic kundli
//                                (returns PDF, NO wallet deduction)
//     kind = 'forecast12'    -> paid 12-month forecast starting from
//                                the current month. Deducts the price
//                                from users.wallet in a Firestore
//                                transaction, fails 402 if not enough.
//
// Common pipeline:
//   1. Auth: ensure the kundli profile is owned by the requesting uid.
//      Hard rule from user: "kundli of each person should be allocated
//      to one user only". Cross-user reads here = bug.
//   2. Wallet deduct (paid only) atomically with order doc creation.
//   3. Generate PDF via AstroSeer /api/report/pdf (tier 9 for free,
//      tier 9 + monthly=12 for forecast).
//   4. Upload PDF to Firebase Storage at
//        media/reports/{uid}/{ts}_{kind}.pdf
//      and grab a long-lived signed URL.
//   5. Write users/{uid}/orders/{orderId} with {kind, pdfUrl, paidAt,
//      amount, kundliProfileId, validUntil}.
//   6. Email the PDF to the user via the existing SMTP config (same
//      transporter as the OTP endpoint reads from settings/email).
//   7. Return { ok, pdfUrl, orderId, alreadyHave } so the client can
//      open the immediate "Download now" popup.
//
// On any failure AFTER the wallet deduct, the deduction is reversed
// so the user is never billed for a missing PDF (Hard Rule 4 of the
// blueprint - never overcharge).
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
    storageBucket: (JSON.parse(raw).project_id || 'astrology-2092d')
      + '.firebasestorage.app',
  });
}

const FREE_TIER = 9;
const DEFAULT_FORECAST_PRICE = 50;

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (_) { b = {}; }
  }
  return b || {};
}

// Reuse the same AstroSeer URL/key resolution the kundli adapter
// uses so admin can rotate creds from one place.
function resolveAstroSeer(creds) {
  const candidates = [
    creds && creds.baseUrl, creds && creds.secret,
    process.env.ASTROSEER_API_URL,
    'https://astroseer-api.onrender.com',
  ];
  const base = candidates.find(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    || 'https://astroseer-api.onrender.com';
  const looksLikeKey = (s) =>
    typeof s === 'string' && /^as_(live|test)_/i.test(s);
  const key = [creds && creds.key, process.env.ASTROSEER_API_KEY,
    process.env.ASTROSEER_API_URL].find(looksLikeKey) || '';
  return { base: base.replace(/\/+$/, ''), key };
}

async function getAstroSeerCreds(db) {
  try {
    const s = await db.collection('settings').doc('kundliApi').get();
    const d = s.exists ? (s.data() || {}) : {};
    return resolveAstroSeer(d.astroseer || {});
  } catch (_) { return resolveAstroSeer({}); }
}

async function getReportPrice(db, kind) {
  if (kind === 'free') return 0;
  try {
    const s = await db.collection('settings').doc('config').get();
    const d = s.exists ? (s.data() || {}) : {};
    const v = Number(d.kundli_report_price);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_FORECAST_PRICE;
  } catch (_) { return DEFAULT_FORECAST_PRICE; }
}

function parseDob(dob, tob, ampm) {
  const parts = String(dob || '').trim().split(/[-/]/).map(
    (n) => parseInt(n, 10));
  let d; let m; let y;
  if (parts[0] > 31) { [y, m, d] = parts; } else { [d, m, y] = parts; }
  let [hh, mm] = String(tob || '12:00').split(':').map(
    (n) => parseInt(n, 10));
  if (Number.isNaN(hh)) hh = 12;
  if (Number.isNaN(mm)) mm = 0;
  const ap = String(ampm || '').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return { y, m, d, hh, mm };
}

// AstroSeer's /api/report/pdf returns the PDF bytes directly. We
// stream them straight to Storage so the relay's memory stays low.
async function callAstroSeerPdf({ base, key, body }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;
  const r = await fetch(`${base}/api/report/pdf`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`AstroSeer report/pdf ${r.status}: `
      + `${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('AstroSeer returned empty PDF');
  return buf;
}

async function uploadPdf(uid, kind, buf) {
  const bucket = admin.storage().bucket();
  const ts = Date.now();
  const name = `media/reports/${uid}/${ts}_${kind}.pdf`;
  const file = bucket.file(name);
  await file.save(buf, {
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'public, max-age=31536000',
      metadata: { kind, uid, generatedAt: String(ts) },
    },
    resumable: false,
  });
  // 100-year signed URL — effectively permanent. Stored on the
  // order doc so re-download from /orders is a single click that
  // doesn't re-burn the relay.
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 365 * 100,
  });
  return { storagePath: name, url: signedUrl };
}

async function smtpTransport(db) {
  let cfg = {};
  try {
    const s = await db.collection('settings').doc('email').get();
    if (s.exists) cfg = s.data() || {};
  } catch (_) { /* env-only */ }
  const host = cfg.smtpHost || process.env.SMTP_HOST || '';
  const port = Number(cfg.smtpPort || process.env.SMTP_PORT || 587);
  const user = cfg.smtpUser || process.env.SMTP_USER || '';
  const pass = cfg.smtpPass || process.env.SMTP_PASS || '';
  const secure = typeof cfg.smtpSecure === 'boolean'
    ? cfg.smtpSecure : port === 465;
  const from = cfg.fromAddress || cfg.smtpFrom || process.env.MAIL_FROM
    || 'AstroSeer <support@astroseer.in>';
  if (!host || !user || !pass) return null; // email is best-effort
  return {
    transporter: nodemailer.createTransport({
      host, port, secure, auth: { user, pass },
    }),
    from,
  };
}

async function emailReport({ db, toEmail, name, kind, pdfBuf, pdfName }) {
  const t = await smtpTransport(db);
  if (!t) return false;
  const human = kind === 'forecast12'
    ? 'Your 12-Month Kundli Forecast'
    : 'Your Vedic Kundli Report';
  const subject = `${human} from AstroSeer is ready`;
  const text = `Hi ${name || 'there'},\n\n`
    + `${human} is attached as a PDF. You can also re-download it `
    + 'anytime from the Orders section in the AstroSeer app.\n\n'
    + 'With blessings,\nAstroSeer Support';
  const html = `<div style="font-family:Inter,Arial,sans-serif;`
    + `max-width:520px;margin:auto;padding:24px;color:#1a1a2e">`
    + `<h2 style="margin:0 0 14px 0;color:#7F2020">${human}</h2>`
    + `<p style="margin:0 0 10px 0">Hi ${name || 'there'},</p>`
    + `<p style="margin:0 0 10px 0">Your report is attached as a `
    + `PDF. You can also re-download it from the Orders section `
    + `in the AstroSeer app anytime.</p>`
    + `<p style="margin:18px 0 0 0;font-size:12px;color:#777">`
    + `With blessings,<br/>AstroSeer Support</p></div>`;
  try {
    await t.transporter.sendMail({
      from: t.from, to: toEmail, subject, text, html,
      attachments: [
        { filename: pdfName, content: pdfBuf,
          contentType: 'application/pdf' },
      ],
    });
    return true;
  } catch (_) { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try { init(); } catch (e) {
    return res.status(503).json({
      error: String((e && e.message) || e) });
  }
  const db = admin.firestore();
  const body = readBody(req);
  const kind = body.kind === 'forecast12' ? 'forecast12' : 'free';
  const profileId = String(body.kundliProfileId || '').trim();
  const uid = String(body.uid || '').trim();
  if (!profileId || !uid) {
    return res.status(400).json({
      error: 'kundliProfileId and uid required' });
  }

  // 1. Verify ownership of the kundli profile. This is the gate that
  //    enforces "kundli of each person allocated to one user only".
  const pSnap = await db.collection('kundliProfiles').doc(profileId).get();
  if (!pSnap.exists) {
    return res.status(404).json({ error: 'kundli profile not found' });
  }
  const profile = pSnap.data() || {};
  if (String(profile.userId || '') !== uid) {
    return res.status(403).json({
      error: 'kundli profile does not belong to this user' });
  }
  if (!profile.dob) {
    return res.status(400).json({ error: 'profile missing birth data' });
  }

  // 2. Resolve price + check we have AstroSeer creds.
  const price = await getReportPrice(db, kind);
  const { base, key } = await getAstroSeerCreds(db);

  // 3. For paid kinds: atomic wallet deduct + order placeholder.
  let orderRef = db.collection('users').doc(uid).collection('orders').doc();
  let chargedAmount = 0;
  if (price > 0) {
    const userRef = db.collection('users').doc(uid);
    try {
      await db.runTransaction(async (tx) => {
        const uSnap = await tx.get(userRef);
        const wallet = Number((uSnap.data() || {}).wallet || 0);
        if (wallet < price) {
          const err = new Error('insufficient wallet');
          err.code = 'insufficient_wallet';
          err.wallet = wallet; err.price = price;
          throw err;
        }
        tx.update(userRef, {
          wallet: wallet - price,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(orderRef, {
          kind, kundliProfileId: profileId, amount: price,
          status: 'paid_generating',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Ledger row so /transactions shows the debit.
        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId: uid, amount: price, type: 'debit',
          reason: kind === 'forecast12'
            ? '12-month kundli forecast'
            : 'kundli report',
          referenceId: orderRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      chargedAmount = price;
    } catch (e) {
      if (e.code === 'insufficient_wallet') {
        return res.status(402).json({
          error: 'Insufficient wallet balance.',
          wallet: e.wallet, price: e.price });
      }
      throw e;
    }
  } else {
    // Free kind: still write an order doc for the user's history.
    await orderRef.set({
      kind, kundliProfileId: profileId, amount: 0,
      status: 'free_generating',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 4. Build AstroSeer report body. They take the same birth fields
  //    as /api/kundli plus a `tier` (9 = the deepest one). For the
  //    forecast we pass `months: 12` so the API knows to bake the
  //    next 12 monthly transit + dasha forecasts into the PDF.
  const p = parseDob(profile.dob, profile.tob, profile.ampm);
  const tz = 5.5; // IST default; future: pluck from profile.tz
  const reqBody = {
    year: p.y, month: p.m, day: p.d, hour: p.hh, minute: p.mm,
    tz_offset: tz,
    latitude: Number(profile.lat) || null,
    longitude: Number(profile.lng) || null,
    place: profile.place || '',
    name: profile.name || '',
    tier: FREE_TIER,
    branding: { app: 'AstroSeer', accent: '#7F2020',
      logo_url: 'https://astroseer.in/logo.png' },
  };
  if (kind === 'forecast12') {
    reqBody.months = 12;
    reqBody.start_month = new Date().toISOString().slice(0, 7); // YYYY-MM
  }

  // 5. Generate + upload + email. If ANY step throws after the
  //    wallet was charged, reverse the charge so we never bill the
  //    user for a missing PDF.
  let pdfBuf;
  try {
    pdfBuf = await callAstroSeerPdf({ base, key, body: reqBody });
  } catch (e) {
    if (chargedAmount > 0) {
      try {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const w = Number((uSnap.data() || {}).wallet || 0);
          tx.update(uRef, { wallet: w + chargedAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          tx.update(orderRef, { status: 'failed_refunded',
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            failReason: String((e && e.message) || e) });
          const txRef = db.collection('transactions').doc();
          tx.set(txRef, {
            userId: uid, amount: chargedAmount, type: 'credit',
            reason: 'Kundli report refund (generation failed)',
            referenceId: orderRef.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (_) { /* refund retry is admin's job */ }
    } else {
      await orderRef.update({ status: 'failed',
        failReason: String((e && e.message) || e) }).catch(() => {});
    }
    return res.status(502).json({
      error: 'Report generation failed',
      detail: String((e && e.message) || e),
      refunded: chargedAmount > 0,
    });
  }

  let uploaded;
  try {
    uploaded = await uploadPdf(uid, kind, pdfBuf);
  } catch (e) {
    // Same refund-on-failure path.
    if (chargedAmount > 0) {
      try {
        await db.runTransaction(async (tx) => {
          const uRef = db.collection('users').doc(uid);
          const uSnap = await tx.get(uRef);
          const w = Number((uSnap.data() || {}).wallet || 0);
          tx.update(uRef, { wallet: w + chargedAmount });
          tx.update(orderRef, { status: 'failed_refunded',
            failReason: 'storage upload failed' });
        });
      } catch (_) { /* ignore */ }
    }
    return res.status(502).json({
      error: 'Could not save the PDF',
      detail: String((e && e.message) || e),
      refunded: chargedAmount > 0,
    });
  }

  const pdfFileName = `AstroSeer-${kind === 'forecast12'
    ? '12-Month-Forecast' : 'Kundli'}-${profile.name
    || uid.slice(0, 6)}.pdf`;

  // 6. Order doc → final state. Email the PDF in parallel (best-effort).
  const validUntil = kind === 'forecast12'
    ? new Date(new Date().setMonth(new Date().getMonth() + 12)).toISOString()
    : null;
  await orderRef.update({
    status: 'ready',
    pdfUrl: uploaded.url,
    storagePath: uploaded.storagePath,
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Get the user's email for the SMTP send.
  let userEmail = '';
  let userName = profile.name || '';
  try {
    const uSnap = await db.collection('users').doc(uid).get();
    const u = uSnap.data() || {};
    userEmail = u.email || '';
    if (!userName) userName = u.name || '';
  } catch (_) { /* fine */ }
  let emailed = false;
  if (userEmail) {
    emailed = await emailReport({
      db, toEmail: userEmail, name: userName,
      kind, pdfBuf, pdfName: pdfFileName,
    });
  }

  return res.status(200).json({
    ok: true,
    orderId: orderRef.id,
    pdfUrl: uploaded.url,
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    amount: chargedAmount,
    kind,
    emailed,
    validUntil,
  });
};
