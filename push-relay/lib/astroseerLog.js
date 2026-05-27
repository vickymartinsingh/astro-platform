// astroseerLog.js
//
// Fire-and-forget logger for the AstroSeer API central activity
// feed. Every report-lifecycle event (created / delivered / failed)
// fans out to POST {ASTROSEER_API_URL}/api/orders/log so the rows
// also show up at https://astroseer-api.onrender.com/admin/dashboard
// under the Activity tab.
//
// Design notes (per the AstroSeer integration spec the API team
// shared on 27-May-2026):
//   - The endpoint upserts by order_id, so the same id can transit
//     through generating -> sent / failed and only ONE row appears
//     on the AstroSeer feed.
//   - Calls are fire-and-forget. We never await + never let a
//     network blip break PDF generation for the customer.
//   - report_type is the AstroSeer enum, not our internal `kind`
//     value. KIND_TO_REPORT_TYPE maps between them.
//   - The URL is read from settings/kundliApi.astroseer.baseUrl
//     (same source the kundli generate path uses) so admin can
//     point at staging vs production with a single Firestore edit.

const KIND_TO_REPORT_TYPE = {
  free: 'basic',              // 250+ page free vedic kundli
  forecast12: 'yearly',       // 12-month forecast
  careerFinance: 'career',
  lifetime: 'full_life',
};

function pickBaseUrl(creds) {
  const candidates = [
    creds && creds.baseUrl,
    creds && creds.secret,
    process.env.ASTROSEER_API_URL,
    'https://astroseer-api.onrender.com',
  ];
  return candidates.find(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    || 'https://astroseer-api.onrender.com';
}

// Sole exported function. Pass it whatever subset of the event
// fields you have at the call-site - undefined keys are stripped
// before the POST so the AstroSeer endpoint sees a clean payload.
//
// event: {
//   creds,                    // { baseUrl } from getAstroSeerCreds
//   orderId, status, kind,
//   userName, userEmail, userId,
//   amount, birthSummary, place,
//   bytesOut, pageCount, error,
// }
//
// Returns: nothing. Never throws. Never blocks.
function logAstroSeerEvent(event) {
  try {
    if (!event || !event.orderId || !event.status) return;
    const base = pickBaseUrl(event.creds);
    const reportType = KIND_TO_REPORT_TYPE[event.kind]
      || 'basic';
    const payload = {
      order_id: event.orderId,
      status: event.status,            // generating / sent / failed
      report_type: reportType,
    };
    if (event.userName) payload.customer_name = event.userName;
    if (event.userEmail) payload.customer_email = event.userEmail;
    if (event.userId) payload.customer_uid = event.userId;
    if (event.amount != null) payload.amount = Number(event.amount);
    if (event.birthSummary) payload.birth_summary = event.birthSummary;
    if (event.place) payload.place = event.place;
    if (event.bytesOut != null) payload.bytes_out = event.bytesOut;
    if (event.pageCount != null) payload.page_count = event.pageCount;
    if (event.error) payload.error = String(event.error).slice(0, 500);

    // Fire-and-forget. We deliberately do NOT await: the customer
    // PDF flow must never depend on the central log being up. The
    // catch swallows network / DNS / 5xx so this can never
    // propagate as a Vercel function crash.
    const ctrl = (typeof AbortController !== 'undefined')
      ? new AbortController() : null;
    const tid = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
    Promise.resolve(fetch(`${base}/api/orders/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    })).catch(() => { /* swallow */ }).finally(() => {
      if (tid) clearTimeout(tid);
    });
  } catch (_) { /* never throw from a logger */ }
}

// Helper: compose the birth_summary string the way the AstroSeer
// Activity feed expects ("01-11-1995 00:21"). Pulls from the
// kundliProfiles doc shape used throughout the relay.
function birthSummaryFromProfile(profile) {
  if (!profile) return '';
  const dob = String(profile.dob || '').trim();
  const tob = String(profile.tob || '').trim();
  const ampm = String(profile.ampm || '').trim();
  let hhmm = tob;
  // Convert "07:50 AM" into 24-hour "07:50" for compactness.
  const m = /^(\d{1,2}):(\d{2})$/.exec(tob);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = m[2];
    if (/^pm$/i.test(ampm) && h < 12) h += 12;
    if (/^am$/i.test(ampm) && h === 12) h = 0;
    hhmm = `${String(h).padStart(2, '0')}:${mm}`;
  }
  return [dob, hhmm].filter(Boolean).join(' ').trim();
}

module.exports = { logAstroSeerEvent, birthSummaryFromProfile };
