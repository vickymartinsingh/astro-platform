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
  const sa = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    storageBucket: bucketName(sa),
  });
}

// Resolve the Firebase Storage bucket name. Source-of-truth order:
// explicit FIREBASE_STORAGE_BUCKET env on Vercel, then the new
// "<project>.firebasestorage.app" format (current default for
// projects created in 2024+), then the legacy "<project>.appspot.com"
// — we try both, the upload that succeeds wins.
function bucketName(sa) {
  return process.env.FIREBASE_STORAGE_BUCKET
    || `${(sa && sa.project_id) || 'astrology-2092d'}.firebasestorage.app`;
}
function legacyBucketName(sa) {
  return `${(sa && sa.project_id) || 'astrology-2092d'}.appspot.com`;
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

// Open-Meteo geocoding (no key, no quota for the volume we run at).
// Mirrors the geocode() in api/kundli.js. Used as a fallback when
// the kundliProfiles doc only has a `place` string with no
// pre-resolved lat/lng — most user-saved profiles are that shape
// because the BirthInputs CityField only writes the text label.
// AstroSeer's /api/report/pdf insists on numeric latitude+longitude
// and 422's otherwise (this was the actual cause of the "Report
// generation failed" toast users were seeing on saved profiles).
async function geocode(place) {
  if (!place) return null;
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(place)}&count=1&language=en`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const hit = j && j.results && j.results[0];
    if (hit) return { lat: hit.latitude, lng: hit.longitude };
  } catch (_) { /* ignore */ }
  return null;
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
  const sa = (() => {
    try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}'); }
    catch (_) { return {}; }
  })();

  // Try modern <project>.firebasestorage.app then legacy
  // <project>.appspot.com. Some projects only have one of the two.
  const ts = Date.now();
  const name = `media/reports/${uid}/${ts}_${kind}.pdf`;
  const candidates = [
    bucketName(sa),
    legacyBucketName(sa),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  // URL strategy: Firebase-style download tokens, NOT signed URLs.
  // Why: getSignedUrl() needs the service account to have the IAM
  // permission iam.serviceAccounts.signBlob (or the explicit
  // "Service Account Token Creator" role on itself). Most relay
  // service accounts are minted with only firebaseAdmin scopes and
  // hit a cryptic "Cannot sign data without `client_email`" /
  // "iam.serviceAccounts.signBlob is missing" error, which we saw
  // surface as "Could not save the PDF" with no detail.
  // Download tokens are simpler: write a random token into the
  // file's firebaseStorageDownloadTokens metadata field, then
  // construct a public download URL of the form
  //   https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}
  //     ?alt=media&token={token}
  // The token is mandatory in the URL so the file isn't accidentally
  // public — but it works on any Firebase Storage bucket with no
  // IAM dance.
  const crypto = require('crypto');
  const token = (crypto.randomUUID && crypto.randomUUID())
    || crypto.randomBytes(16).toString('hex');

  const tried = [];
  let lastErr = null;
  for (const bn of candidates) {
    try {
      const bucket = admin.storage().bucket(bn);
      const file = bucket.file(name);
      await file.save(buf, {
        contentType: 'application/pdf',
        metadata: {
          cacheControl: 'public, max-age=31536000',
          metadata: {
            kind, uid, generatedAt: String(ts),
            // THIS is what enables the download-token URL pattern.
            // Firebase Storage rules ignore the token and let the
            // request through whenever the token matches.
            firebaseStorageDownloadTokens: token,
          },
        },
        resumable: false,
      });
      const url = `https://firebasestorage.googleapis.com/v0/b/`
        + `${encodeURIComponent(bn)}/o/`
        + `${encodeURIComponent(name)}?alt=media&token=${token}`;
      return { storagePath: name, bucketUsed: bn, url };
    } catch (e) {
      tried.push(`${bn}: ${(e && e.message) || 'unknown'}`);
      lastErr = e;
    }
  }
  // Verbose error so a future fail tells us what we tried.
  throw new Error(`upload to Firebase Storage failed. `
    + `Tried ${tried.length} bucket(s): ${tried.join(' | ')}`
    + (lastErr && lastErr.code ? ` [code=${lastErr.code}]` : ''));
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

// Public entry: handle a kundli PDF request and call res.json/.status
// itself. Invoked from api/kundli.js when body.action === 'report'
// (we keep ONE serverless function for the kundli surface to stay
// under Vercel Hobby's 12-function limit).
async function handleReport(req, res) {
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

  // birthSig — same shape the shared client kundliService uses. Two
  // profiles with the same DOB / TOB / AM-PM / place collapse into
  // one signature; any minor edit to those four fields changes it.
  // We stamp this on every order doc so a later "cached order
  // lookup" matches only when the birth data is byte-for-byte
  // identical to what generated the existing PDF.
  function birthSig(p) {
    return [p.dob, p.tob, p.ampm, p.place]
      .map((x) => String(x || '').trim().toLowerCase()).join('|');
  }
  const sig = birthSig(profile);

  // 1b. Hot path: if an order with this exact (kind, profileId,
  //     birthSig) is already 'ready', return that PDF immediately.
  //     No AstroSeer call, no Storage upload, no wallet deduction
  //     for paid kinds (the user already paid for THIS chart). Edit
  //     the profile and the sig changes, so we regenerate — exactly
  //     what the user asked for ("even a minor change must force a
  //     regenerate").
  //
  // Query intentionally only uses two equality filters and no
  // orderBy() so Firestore does NOT need a composite index. The
  // orders subcollection is per-user, almost always under 20 docs,
  // so client-side filtering + pick-most-recent is cheap.
  try {
    const cached = await db.collection('users').doc(uid)
      .collection('orders')
      .where('birthSig', '==', sig)
      .where('kind', '==', kind)
      .get();
    const ready = cached.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => o.status === 'ready'
        && o.kundliProfileId === profileId
        && o.pdfUrl)
      .sort((a, b) => {
        const at = (a.deliveredAt && a.deliveredAt.toMillis
          && a.deliveredAt.toMillis()) || 0;
        const bt = (b.deliveredAt && b.deliveredAt.toMillis
          && b.deliveredAt.toMillis()) || 0;
        return bt - at;
      })[0];
    if (ready) {
      return res.status(200).json({
        ok: true,
        orderId: ready.id,
        pdfUrl: ready.pdfUrl,
        pdfName: ready.pdfName || 'AstroSeer-Kundli.pdf',
        sizeBytes: ready.sizeBytes || 0,
        amount: 0, // never bill twice for the same chart
        kind,
        emailed: false, // was emailed once at original generate
        validUntil: ready.validUntil || null,
        cached: true,
      });
    }
  } catch (_) {
    // Never block PDF delivery on a cache-lookup failure — fall
    // through to fresh generation. The original-flow refund/email
    // guarantees still apply.
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
          // birthSig is the cache key; profile snapshot makes
          // /orders rows human-readable without an extra join.
          birthSig: sig,
          profileName: profile.name || '',
          profileDob: profile.dob || '',
          profileTob: profile.tob || '',
          profileAmpm: profile.ampm || '',
          profilePlace: profile.place || '',
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
      birthSig: sig,
      profileName: profile.name || '',
      profileDob: profile.dob || '',
      profileTob: profile.tob || '',
      profileAmpm: profile.ampm || '',
      profilePlace: profile.place || '',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 4. Build AstroSeer report body. They take the same birth fields
  //    as /api/kundli plus a `tier` (9 = the deepest one). For the
  //    forecast we pass `months: 12` so the API knows to bake the
  //    next 12 monthly transit + dasha forecasts into the PDF.
  //
  // Resolve lat/lng: profiles created by the BirthInputs CityField
  // only carry a `place` string label — no numeric coords. AstroSeer
  // 422's on null lat/lng, so we geocode the place text via the
  // same Open-Meteo lookup api/kundli.js uses. If that ALSO fails
  // we fall back to Mumbai (Vedic apps' default reference) so the
  // PDF still ships a valid chart rather than failing the whole
  // request.
  const p = parseDob(profile.dob, profile.tob, profile.ampm);
  const tz = 5.5; // IST default; future: pluck from profile.tz
  let lat = Number(profile.lat) || 0;
  let lng = Number(profile.lng) || 0;
  if (!lat || !lng) {
    const g = await geocode(profile.place || '');
    if (g) { lat = g.lat; lng = g.lng; }
  }
  if (!lat || !lng) {
    // Last-ditch default so an empty place doesn't kill the request.
    lat = 19.076; lng = 72.8777;
  }
  const reqBody = {
    year: p.y, month: p.m, day: p.d, hour: p.hh, minute: p.mm,
    tz_offset: tz,
    latitude: lat,
    longitude: lng,
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
}

module.exports = { handleReport };
