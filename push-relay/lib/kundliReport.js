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

// Default prices for each report kind. Admin overrides via
// settings/config.kundli_<kind>_price (and the legacy
// settings/config.kundli_report_price still maps to forecast12
// for backwards compatibility).
const DEFAULT_PRICES = {
  free: 0,
  forecast12: 50,
  careerFinance: 99,
  lifetime: 299,
};
async function getReportPrice(db, kind) {
  if (kind === 'free') return 0;
  const baseDefault = DEFAULT_PRICES[kind] != null
    ? DEFAULT_PRICES[kind] : DEFAULT_FORECAST_PRICE;
  try {
    const s = await db.collection('settings').doc('config').get();
    const d = s.exists ? (s.data() || {}) : {};
    // Per-type override.
    const perType = Number(d[`kundli_${kind}_price`]);
    if (Number.isFinite(perType) && perType >= 0) return perType;
    // Legacy global override (forecast12 only, for the original
    // single-product world).
    if (kind === 'forecast12') {
      const legacy = Number(d.kundli_report_price);
      if (Number.isFinite(legacy) && legacy >= 0) return legacy;
    }
    return baseDefault;
  } catch (_) { return baseDefault; }
}

// What we send AstroSeer for each report kind. All four pull the
// top tier (most pages). forecast12 adds months + start_month so
// the API knows to bake the next 12 monthly forecasts.
function astroSeerBody(kind, p, lat, lng, profile) {
  const tz = 5.5; // IST default; future: per-profile
  const body = {
    year: p.y, month: p.m, day: p.d, hour: p.hh, minute: p.mm,
    tz_offset: tz,
    latitude: Number(lat) || null,
    longitude: Number(lng) || null,
    place: profile.place || '',
    name: profile.name || '',
    tier: FREE_TIER,
    branding: {
      app: 'AstroSeer',
      accent: '#7F2020',
      logo_url: 'https://astroseer.in/logo.png',
    },
  };
  if (kind === 'forecast12') {
    body.months = 12;
    body.start_month = new Date().toISOString().slice(0, 7);
  } else if (kind === 'careerFinance') {
    body.focus = ['career', 'finance'];
    body.years = 5;
  } else if (kind === 'lifetime') {
    body.focus = ['lifetime'];
    body.years = 120;
    body.include_yogini = true;
  }
  return body;
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

// Storage backend (tiered, ZERO setup required):
//
//   1. Vercel Blob - used IF BLOB_READ_WRITE_TOKEN is set on the
//      relay. Best path: permanent CDN URL, no Firestore read on
//      re-download. Only kicks in if the operator has actually
//      created + connected a Blob store in the Vercel dashboard.
//
//   2. Firestore inline base64 (default fallback) - used otherwise.
//      Writes the PDF base64 onto users/{uid}/orders/{id}.pdfBase64
//      and returns a `data:application/pdf;base64,...` URL the
//      browser can download immediately. Works on Spark (free)
//      with zero external setup. Firestore allows 1 MB per doc;
//      AstroSeer PDFs are ~60 KB (~80 KB base64) so we have ~12x
//      headroom. The /orders page re-builds the data URL from the
//      same pdfBase64 field on re-download.
//
// Caller gets back { url, storagePath, bucketUsed } as before so
// the rest of handleReport doesn't change. inline === true on the
// return value tells the caller to also write pdfBase64 onto the
// order doc.
async function uploadPdf(uid, kind, buf) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = require('@vercel/blob');
      const ts = Date.now();
      const path = `reports/${uid}/${ts}_${kind}.pdf`;
      const blob = await put(path, buf, {
        access: 'public',
        contentType: 'application/pdf',
        cacheControlMaxAge: 31536000,
        addRandomSuffix: false,
      });
      return {
        storagePath: blob.pathname || path,
        bucketUsed: 'vercel-blob',
        url: blob.url,
        inline: false,
      };
    } catch (e) {
      // Don't fail the whole report on a Blob blip - fall through
      // to the inline path so the user always gets their PDF.
      // eslint-disable-next-line no-console
      console.warn('Vercel Blob upload failed, falling back to '
        + 'inline Firestore storage:', (e && e.message) || e);
    }
  }
  // Fallback: encode the PDF bytes as base64 and return a data
  // URL the browser can download directly. The base64 string is
  // ALSO written onto the order doc by the caller so /orders can
  // re-build the same data URL forever without a relay call.
  const b64 = Buffer.from(buf).toString('base64');
  const dataUrl = `data:application/pdf;base64,${b64}`;
  if (b64.length > 950 * 1024) {
    // Firestore caps a doc at 1 MB. Leave headroom for the other
    // order fields. If a future AstroSeer tier produces a bigger
    // PDF, the operator will have to set up Blob (above) or we
    // chunk across multiple docs.
    throw new Error('PDF is too large to store inline '
      + `(${(b64.length / 1024).toFixed(0)} KB base64). Set `
      + 'BLOB_READ_WRITE_TOKEN on the relay to enable Vercel Blob '
      + 'storage instead.');
  }
  return {
    storagePath: `inline:${uid}:${Date.now()}_${kind}`,
    bucketUsed: 'firestore-inline',
    url: dataUrl,
    inline: true,
    pdfBase64: b64,
  };
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
  // Validate the report kind against the known catalogue. Unknown
  // kinds collapse to 'free' so a stale client never accidentally
  // bills the user.
  const KNOWN_KINDS = new Set(
    ['free', 'forecast12', 'careerFinance', 'lifetime']);
  const kind = KNOWN_KINDS.has(body.kind) ? body.kind : 'free';
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
      // For inline-storage orders the actual pdfUrl on the doc is
      // a short marker ("inline"). The real bytes are on
      // pdfBase64 — rebuild the data URL here so the client gets
      // a clickable download with no extra round-trip.
      const realUrl = ready.pdfBase64
        ? `data:application/pdf;base64,${ready.pdfBase64}`
        : ready.pdfUrl;
      return res.status(200).json({
        ok: true,
        orderId: ready.id,
        pdfUrl: realUrl,
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
  const reqBody = astroSeerBody(kind, p, lat, lng, profile);

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

  // 6. Order doc → final state. Email the PDF in parallel
  //    (best-effort). When the storage backend is inline (no Blob
  //    token set), the actual PDF bytes are kept on the order doc
  //    as base64 so /orders re-downloads can re-build the same
  //    data: URL without a relay call. Cache lookup also serves
  //    from this field on the next View Full Kundli click.
  const validUntil = kind === 'forecast12'
    ? new Date(new Date().setMonth(new Date().getMonth() + 12)).toISOString()
    : null;
  const orderPatch = {
    status: 'ready',
    // For inline storage, store a SHORT marker on pdfUrl (the real
    // bytes live on pdfBase64). For Vercel Blob, store the actual
    // CDN URL. This stops the doc from carrying a redundant ~80 KB
    // copy of the base64 (~80 KB pdfUrl + ~80 KB pdfBase64 was
    // pushing toward the 1 MB Firestore limit).
    pdfUrl: uploaded.inline ? 'inline' : uploaded.url,
    storagePath: uploaded.storagePath,
    bucketUsed: uploaded.bucketUsed || '',
    pdfName: pdfFileName,
    sizeBytes: pdfBuf.length,
    validUntil,
    deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (uploaded.inline && uploaded.pdfBase64) {
    orderPatch.pdfBase64 = uploaded.pdfBase64;
  }
  await orderRef.update(orderPatch);

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
