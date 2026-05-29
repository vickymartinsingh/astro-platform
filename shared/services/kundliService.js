// kundliService, blueprint 8.2 & 4.13
import {
  doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  getDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { zodiacFromDOB } from '../theme.js';
import { sendMessage } from './chatService.js';

// Cached read of settings/config. Every page that needs admin
// pricing or feature config used to call getDoc(doc(db,
// 'settings', 'config')) on mount - that's 5+ Firestore reads per
// navigation, all returning the SAME data which only changes when
// admin saves config. We now cache for 10 minutes in localStorage,
// dropping that to ~0.1 reads per navigation on average.
let _settingsConfigPromise = null;
export async function readSettingsConfig() {
  const TTL = 10 * 60 * 1000; // 10 min
  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem('settings_config_v2');
      if (raw) {
        const { at, value } = JSON.parse(raw);
        if (Date.now() - at < TTL) return value;
      }
    }
  } catch (_) { /* fall through to refetch */ }
  if (_settingsConfigPromise) return _settingsConfigPromise;
  _settingsConfigPromise = (async () => {
    try {
      const s = await getDoc(doc(db, 'settings', 'config'));
      const value = s.exists() ? s.data() : {};
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('settings_config_v2',
            JSON.stringify({ at: Date.now(), value }));
        }
      } catch (_) { /* */ }
      return value;
    } catch (e) {
      // Firestore quota hit / network blip: return whatever stale
      // copy localStorage has so the page still renders.
      try {
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem('settings_config_v2');
          if (raw) return JSON.parse(raw).value;
        }
      } catch (_) { /* */ }
      return {};
    } finally {
      _settingsConfigPromise = null;
    }
  })();
  return _settingsConfigPromise;
}

function parseZodiac(dob) {
  // dob expected as DD-MM-YYYY (blueprint example "12-05-1998")
  const [d, m] = String(dob || '').split('-').map(Number);
  if (!d || !m) return '';
  return zodiacFromDOB(d, m);
}

// Real kundli via the relay. The relay picks the provider
// (settings/kundliApi.provider in Firestore - astroseer / prokerala /
// etc); the actual provider key stays server-side.
// Endpoint derives from the push relay URL, or NEXT_PUBLIC_KUNDLI_ENDPOINT.
// Returns null if not configured / on any failure (caller shows the
// basic zodiac instead - never throws).
function kundliEndpoint() {
  // Reference process.env.NEXT_PUBLIC_* DIRECTLY: Next.js only inlines
  // the literal expression at build time, so an aliased read is
  // undefined in the static / APK build (this is why Kundli appeared
  // "not working" in the app even though the relay was fine).
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_KUNDLI_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  if (push) return push.replace(/\/sendPush\/?$/, '/kundli');
  // Hardcoded fallback - same pattern as authService / pushService.
  // Lets localhost / env-less builds talk to the live relay so
  // Kundli generation never silently no-ops because of a missing
  // .env.local entry. Override either NEXT_PUBLIC_KUNDLI_ENDPOINT
  // or NEXT_PUBLIC_PUSH_ENDPOINT to point at a different relay
  // (staging, local relay dev server, etc).
  return 'https://astro-platform-push-relay.vercel.app/api/kundli';
}

// Request a PDF report (free or paid 12-month forecast). On success
// the server has already:
//   - charged the user's wallet (paid kinds; reverted on any
//     downstream failure so we never bill for a missing PDF)
//   - uploaded the PDF to Firebase Storage and minted a long-lived
//     signed URL
//   - written users/{uid}/orders/{orderId} so /orders has the
//     re-download link forever
//   - emailed the PDF as an attachment to the user
// Routes through the same /api/kundli endpoint with action:'report'
// so the relay stays under Vercel Hobby's 12-function limit.
// Throws Error(msg) on 4xx/5xx so the caller can surface a clear
// toast (insufficient wallet etc).
// Pre-warm the AstroSeer Render dyno. Customer should call this on
// the /kundli page so the dyno is hot by the time they click Buy /
// Generate. Fire-and-forget - never blocks the UI.
export async function wakeAstroSeer() {
  try {
    const url = kundliEndpoint();
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'wake' }),
      keepalive: true,
    });
  } catch (_) { /* swallow */ }
}

// Server-side sweep: tells the relay to walk every *_generating
// order across all customers, poll AstroSeer's status endpoint
// for each, and flip our Firestore docs to 'ready' (+ fetch PDF
// + email customer) once AstroSeer reports the job done.
// Fire-and-forget from the customer side - the relay does all
// the heavy lifting. Returns the summary { ok, checked, ready,
// failed, stillGenerating } for callers that care.
export async function triggerSweepPending() {
  try {
    const url = kundliEndpoint();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sweepPending' }),
      keepalive: true,
    });
    return r.json().catch(() => ({ ok: false }));
  } catch (_) { return { ok: false }; }
}

// Poll the relay's reportStatus action. The relay handles the
// AstroSeer round-trip, the PDF upload to storage on first 'sent',
// and the email. Returns the same shape regardless of where the
// flow is in its lifecycle:
//   { ok, orderId, status: 'generating'|'ready'|'failed'|'failed_refunded',
//     pdfUrl, pdfName, retryCount, warning, error, refunded }
export async function getReportStatus({ uid, orderId }) {
  const url = kundliEndpoint();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reportStatus', uid, orderId }),
  });
  return r.json().catch(() => ({ ok: false, status: 'failed',
    error: 'Status check returned no JSON.' }));
}

// Poll until the order is ready / failed, or the timeout elapses.
// onTick gets every intermediate status so the UI can show
// "Generating... retry 2" / "Resuming..." etc.
//
// Default: poll every 5s, max 60 polls (5 minutes total).
export async function pollReportUntilReady({ uid, orderId,
  onTick, intervalMs = 5000, maxAttempts = 60 } = {}) {
  for (let i = 0; i < maxAttempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const s = await getReportStatus({ uid, orderId });
    if (typeof onTick === 'function') {
      try { onTick(s, i + 1, maxAttempts); } catch (_) { /* */ }
    }
    if (s && (s.status === 'ready' || s.status === 'failed'
      || s.status === 'failed_refunded')) {
      return s;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((rs) => setTimeout(rs, intervalMs));
  }
  return { ok: false, orderId, status: 'pending',
    timedOut: true,
    error: 'Your report is taking longer than usual. It will keep '
      + 'generating in the background; check back in a few minutes '
      + 'or watch your email.' };
}

export async function requestReport({
  uid, kundliProfileId, kind, complimentary, senderNote, regenerate,
  autoGenerated, skipEmail, prepayForAll, email,
}) {
  const url = kundliEndpoint();
  // Two-attempt fetch with backoff so a transient browser-side
  // network blip (Wi-Fi handoff, brief DNS resolver hiccup) does
  // not surface as a hard error to the customer. First attempt
  // 70s, retry attempt 30s (relay returns in <2s once warm).
  async function doFetch(timeoutMs) {
    const ac = (typeof AbortController !== 'undefined')
      ? new AbortController() : null;
    const tid = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          uid, kundliProfileId, kind: kind || 'free',
          complimentary: !!complimentary,
          senderNote: senderNote || '',
          autoGenerated: !!autoGenerated,
          skipEmail: !!skipEmail,
          prepayForAll: !!prepayForAll,
          email: !!email,
          regenerate: !!regenerate,
        }),
        signal: ac ? ac.signal : undefined,
        // Explicit credentials mode - some browser extensions
        // (uBlock Origin, Brave Shield, corporate WPAD proxies)
        // block POST with default credentials. Sending 'omit' is
        // safe because the relay does not rely on cookies.
        credentials: 'omit',
        // Cache-bust so a stale cached error response from a
        // previous timeout does not get served back.
        cache: 'no-store',
      });
    } finally { if (tid) clearTimeout(tid); }
  }
  let r;
  let lastErr;
  try {
    r = await doFetch(70000);
  } catch (e) {
    lastErr = e;
    // Retry once on a non-abort network failure. AbortError means
    // we genuinely waited 70s for the relay, so retrying with
    // another 30s would just waste another 30s.
    const isAbort = e && (e.name === 'AbortError' || /abort/i
      .test(String(e.message || '')));
    if (!isAbort) {
      try {
        // Brief backoff so we don't hammer.
        await new Promise((rs) => setTimeout(rs, 1500));
        r = await doFetch(30000);
        lastErr = null;
      } catch (e2) { lastErr = e2; }
    }
  }
  if (!r) {
    const e = lastErr || new Error('unknown');
    const isAbort = e.name === 'AbortError'
      || /abort/i.test(String(e.message || ''));
    // Surface the real underlying error so the customer (or admin
    // looking at the screenshot) can see if it was a DNS issue, a
    // browser-extension block, mixed-content, etc - not just a
    // generic "could not reach" toast that tells us nothing.
    const detail = String((e && e.message) || e || '')
      .slice(0, 120);
    const err = new Error(isAbort
      ? 'Server timed out while preparing your report. The PDF '
        + 'service may be cold-starting - please retry in a minute.'
      : `Could not reach the report service (${detail}). Hard-`
        + 'refresh the page (Ctrl+Shift+R) or disable any ad / '
        + 'privacy extension and try again.');
    err.code = 'network';
    err.detail = detail;
    err.url = url;
    throw err;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Surface the relay's `detail` field too so the UI can show
    // the real upload error (bucket missing, IAM permission etc)
    // instead of the generic "Could not save the PDF" toast that
    // told the user nothing actionable.
    const msg = j.detail
      ? `${j.error || 'Report failed'}: ${j.detail}`
      : j.error || `Report failed (HTTP ${r.status}).`;
    const err = new Error(msg);
    err.code = j.wallet != null ? 'insufficient_wallet' : 'report_error';
    err.wallet = j.wallet;
    err.price = j.price;
    err.refunded = j.refunded;
    err.detail = j.detail || '';
    throw err;
  }
  return j; // { ok, orderId, pdfUrl, pdfName, amount, kind, emailed }
}

// Admin: list every PDF order across every customer. Uses a
// collection-group query on the per-user `orders` subcollections so
// nothing is missed. Returns most-recent first. The doc id is
// included plus userId pulled from the parent path so the admin
// UI can drill into the customer profile.
export async function listAllOrdersAdmin({ limit: lim = 500 } = {}) {
  const {
    collectionGroup, query, orderBy, limit, getDocs,
  } = await import('firebase/firestore');
  try {
    const q = query(
      collectionGroup(db, 'orders'),
      orderBy('paidAt', 'desc'),
      limit(lim));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const p = d.ref.parent.parent;
      return {
        id: d.id, userId: p ? p.id : '',
        ...d.data(),
      };
    });
  } catch (_) {
    // Fallback (composite index missing): unsorted, capped.
    try {
      const q2 = query(collectionGroup(db, 'orders'), limit(lim));
      const snap = await getDocs(q2);
      return snap.docs.map((d) => {
        const p = d.ref.parent.parent;
        return { id: d.id, userId: p ? p.id : '', ...d.data() };
      }).sort((a, b) => (
        ((b.paidAt && b.paidAt.toMillis && b.paidAt.toMillis()) || 0)
        - ((a.paidAt && a.paidAt.toMillis && a.paidAt.toMillis()) || 0)
      ));
    } catch (_2) { return []; }
  }
}

// List the user's PDF orders (paid + free), most recent first.
// Used by /orders and the Orders tab on /kundli.
export async function listOrders(uid) {
  if (!uid) return [];
  const { collection, query, orderBy, getDocs } = await import(
    'firebase/firestore');
  try {
    const q = query(
      collection(db, 'users', uid, 'orders'),
      orderBy('paidAt', 'desc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) { return []; }
}

// Programmatic PDF download that handles BOTH:
//   - data: URLs (inline-stored PDFs) - Chrome blocks navigation to
//     large data: URLs since 2021; clicking the link opens
//     about:blank with no download. Convert to a Blob first.
//   - http(s) URLs (Vercel Blob, Firebase Storage etc.) - direct
//     anchor click with download attribute.
// Either way the user sees a real "saving file" prompt with the
// right filename, not a blank tab.
// Returns true if we are running inside a Capacitor native app shell
// (iOS / Android). The web build always returns false.
function isNativeApp() {
  return typeof window !== 'undefined'
    && !!window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();
}

// Download the kundli PDF to the user's device, working on:
//   - desktop / mobile browsers : <a download> click
//   - iOS Capacitor             : open in system Safari, which shows
//                                 the native "Open in Files / Books /
//                                 Share" sheet for PDFs
//   - Android Capacitor         : open in system browser, which fires
//                                 the OS download manager
//   - data: URLs (inline base64): convert to a Blob URL first so
//                                 navigation actually works (iOS
//                                 WKWebView blocks data: navigation)
// Returns true on a best-effort attempt, false only on an exception
// CHUNKED FIRESTORE STORAGE: when the relay couldn't reach Vercel
// Blob OR Firebase Storage, it writes the PDF base64 as N x 800 KB
// docs at users/{uid}/orders/{orderId}/pdfChunks/{idx}. The order
// doc carries pdfChunkCount + pdfChunked:true so we know to read
// the subcollection here, join the chunks in idx order, and
// rebuild the data URL. Returns 'data:application/pdf;base64,...'.
export async function loadChunkedPdfUrl(uid, orderId, expectedCount) {
  const {
    collection, query, orderBy, getDocs,
  } = await import('firebase/firestore');
  const ref = collection(db, 'users', uid, 'orders', orderId,
    'pdfChunks');
  const q = query(ref, orderBy('idx'));
  const snap = await getDocs(q);
  if (!snap.size) return null;
  if (expectedCount && snap.size !== expectedCount) {
    // Some chunks missing; treat as not-yet-ready instead of
    // returning a corrupted PDF.
    return null;
  }
  const parts = snap.docs.map((d) => d.data().data || '');
  return `data:application/pdf;base64,${parts.join('')}`;
}

// Resolves an order doc's effective downloadable PDF URL. Handles
// every storage tier the relay might have used:
//   - direct pdfUrl (Vercel Blob, Cloudflare R2, Firebase Storage)
//   - dual-write backup pdfBackupUrl (used if pdfUrl is unreachable)
//   - inline pdfBase64
//   - chunked Firestore subcollection (pdfChunked + pdfChunkCount)
// Returns the URL string or null if nothing usable is on the doc.
//
// DUAL-WRITE FAILOVER: when both Vercel Blob and Cloudflare R2 are
// configured, the relay writes to BOTH and saves the secondary on
// pdfBackupUrl. We HEAD-probe the primary first; if it 4xx/5xx /
// network errors, we return the backup URL automatically. This
// guards against a future Vercel outage or a deleted blob without
// any operator intervention.
async function _isUrlAlive(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return true;
  try {
    const r = await fetch(url, { method: 'HEAD',
      mode: 'cors', cache: 'no-store' });
    return r.ok;
  } catch (_) { return false; }
}

// FIRESTORE-FREE RESCUE: when the order doc says *_generating but
// the PDF actually exists on AstroSeer, this asks the relay to
// pull it straight to R2 (no Firestore involved) and return the
// URL. Triggered automatically by ApiPdfHero when the order has
// been generating for more than a couple of minutes - covers the
// case where Firebase quota / outage blocks the normal flip path.
// Compute a deterministic 8-digit "order id" from a kundli profile.
// Same profile + same birth details -> same orderId forever, so the
// rescue endpoint can cache the PDF at rescued/<orderId>.pdf on R2
// and every future View / Download click is an instant CDN hit.
// First digit forced non-zero so the id is exactly 8 digits.
export function profileOrderId(profile) {
  if (!profile) return '10000000';
  const seed = [profile.id || '', profile.userId || '',
    profile.dob || '', profile.tob || '', profile.ampm || '',
    (profile.place || '').toLowerCase()].join('|') || 'x';
  let h = 5381;                                      // djb2 hash
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;   // unsigned 32-bit
  }
  let s = String(h).padStart(10, '0').slice(-8);
  if (s[0] === '0') s = '1' + s.slice(1);
  return s;
}

// FIRE-AND-FORGET: prepare the kundli PDF on R2 the moment a profile
// is saved (or viewed). Bypasses Firestore entirely - uses the
// Firestore-free rescue endpoint with a deterministic orderId so
// the next View / Download click is an instant R2 cache hit.
export async function ensureKundliPdfReady(profile,
  { kind = 'free' } = {}) {
  if (!profile) return null;
  const orderId = profileOrderId(profile);
  return rescuePdfByOrderId(orderId, {
    profile, uid: profile.userId, kind,
  });
}

// Optionally pass birth details so the rescue path can REGENERATE
// from scratch if AstroSeer has lost the order (Render free-tier
// ephemeral disk wipes its SQLite on every restart). The customer's
// app passes the kundli profile it already has loaded.
export async function rescuePdfByOrderId(orderId, opts = {}) {
  if (!orderId) return null;
  const base = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_KUNDLI_ENDPOINT) || '';
  const url = base ? base.replace(/\/api\/kundli$/, '/api/kundli')
    : '/api/kundli';
  const payload = { action: 'rescueByOrderId',
    orderId: String(orderId) };
  if (opts.profile) {
    const p = opts.profile;
    payload.birth = {
      name: p.name || '',
      dob: p.dob || '',
      tob: p.tob || '',
      ampm: p.ampm || '',
      place: p.place || '',
      lat: p.lat,
      lng: p.lng,
      tz: p.tz,
      kind: opts.kind || 'free',
    };
  }
  if (opts.uid) payload.uid = String(opts.uid);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) return j; // surface error shape too
    return {
      pdfUrl: j.pdfUrl,
      status: j.status,
      pdfReady: !!j.pdfUrl,
      rescue: !!j.rescue,
      recreated: !!j.recreated,
      hint: j.hint || null,
      source: j.source || null,
    };
  } catch (_) { return null; }
}

export async function resolveOrderPdfUrl(uid, order) {
  if (!order) return null;
  // Chunked path - reassembly from Firestore subcollection.
  if (order.pdfChunked && order.pdfChunkCount > 0 && order.id) {
    const url = await loadChunkedPdfUrl(uid, order.id,
      order.pdfChunkCount).catch(() => null);
    if (url) return url;
  }
  if (order.pdfBase64) {
    return `data:application/pdf;base64,${order.pdfBase64}`;
  }
  // Direct URL with optional backup failover.
  if (order.pdfUrl && order.pdfUrl !== 'inline'
      && order.pdfUrl !== 'chunked') {
    if (order.pdfBackupUrl) {
      // Both configured - probe primary, fall back to backup if dead.
      const aliveP = await _isUrlAlive(order.pdfUrl);
      if (aliveP) return order.pdfUrl;
      // eslint-disable-next-line no-console
      console.warn('Primary PDF URL is dead, falling back to backup',
        order.pdfUrl, '->', order.pdfBackupUrl);
      const aliveB = await _isUrlAlive(order.pdfBackupUrl);
      if (aliveB) return order.pdfBackupUrl;
      // Both dead - return primary anyway so the user sees the
      // error from the browser instead of a silent null.
      return order.pdfUrl;
    }
    return order.pdfUrl;
  }
  // Last resort: just the backup URL if that's all we have.
  if (order.pdfBackupUrl) return order.pdfBackupUrl;
  return null;
}

// (typically a popup blocker). The popup the kundli flow uses
// continues to show "Open in My Orders" as a fallback for either case.
export function downloadPdfFromUrl(url, filename) {
  if (typeof window === 'undefined' || !url) return false;
  let href = url;
  let isBlob = false;
  try {
    // Inline data: URL -> Blob URL so Safari / system browser can
    // actually open it. iOS WKWebView refuses data: navigation
    // outright, which is why the old <a download> path failed
    // silently on the app.
    if (typeof url === 'string' && url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      const meta = url.slice(5, commaIdx); // "application/pdf;base64"
      const mime = (meta.split(';')[0] || 'application/pdf').trim();
      const b64 = url.slice(commaIdx + 1);
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      href = URL.createObjectURL(blob);
      isBlob = true;
    }

    // NATIVE APP path. Capacitor's URLOpener intercepts window.open
    // with target '_system' and routes the URL out to the OS
    // browser, which then offers the user a "Save to Files" /
    // download-manager flow. The <a download> approach used to
    // silently no-op inside WKWebView.
    if (isNativeApp()) {
      let opened = null;
      try { opened = window.open(href, '_system'); } catch (_) { /* */ }
      // Some Capacitor versions only honour target='_blank' for
      // _system routing. Try both so iOS + Android both work.
      if (!opened) {
        try { opened = window.open(href, '_blank'); } catch (_) { /* */ }
      }
      if (!opened) {
        // Last-ditch: navigate the WebView itself. iOS will refuse
        // for data: URLs (we have a Blob URL by now, so OK), and
        // Android's WebView triggers the download manager.
        try { window.location.assign(href); } catch (_) { /* */ }
      }
      if (isBlob) {
        // Give the OS browser a moment to grab the bytes before we
        // revoke the Blob URL.
        setTimeout(() => {
          try { URL.revokeObjectURL(href); } catch (_) { /* */ }
        }, 8000);
      }
      return true;
    }

    // WEB path. The classic <a download> click works in every
    // desktop / mobile browser.
    const a = document.createElement('a');
    a.href = href;
    a.download = filename || 'AstroSeer-Kundli.pdf';
    // Some browsers won't trigger the download unless the anchor
    // is actually attached to the DOM first.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) { /* ignore */ }
      if (isBlob) {
        try { URL.revokeObjectURL(href); } catch (_) { /* ignore */ }
      }
    }, 250);
    return true;
  } catch (e) {
    return false;
  }
}

export async function getProkeralaKundli(birth) {
  const url = kundliEndpoint();
  if (!url || !birth || !birth.dob) return null;
  const body = {
    dob: birth.dob, tob: birth.tob, ampm: birth.ampm,
    place: birth.place,
  };
  if (birth.lat != null && Number(birth.lat) !== 0) {
    body.lat = Number(birth.lat);
  }
  if (birth.lng != null && Number(birth.lng) !== 0) {
    body.lng = Number(birth.lng);
  }
  if (birth.tz != null && Number.isFinite(Number(birth.tz))) {
    body.tz = Number(birth.tz);
  }
  // RESILIENT FETCH: up to 3 attempts with a wake ping between each.
  // The first attempt usually hits a warm Render dyno (kept warm by
  // the keep-alive ping in _app.js); if AstroSeer cold-started or
  // crashed mid-request, we wake it and retry. Each attempt has a
  // generous 75s budget so a cold-start (30-40s) plus full kundli
  // generation (15-25s) still fits.
  async function attempt(timeoutMs) {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j && !j.error ? j : null;
    } finally { clearTimeout(tid); }
  }
  for (let i = 0; i < 3; i += 1) {
    try {
      const result = await attempt(i === 0 ? 75000 : 60000);
      if (result) return result;
    } catch (_) { /* fall through to retry */ }
    // Between attempts: fire a wake ping so the dyno is hot for the
    // next try. Don't await; the next attempt's own timeout covers
    // any residual cold-start latency.
    if (i < 2) {
      try { wakeAstroSeer(); } catch (_) { /* */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

// Signature of the birth inputs - the report is regenerated ONLY when
// one of these changes (saves the Prokerala API quota).
export function birthSig(b) {
  return [b && b.dob, b && b.tob, b && b.ampm, b && b.place]
    .map((x) => String(x || '').trim().toLowerCase()).join('|');
}

const SIGN_TRAITS = {
  Aries: { p: 'bold, energetic and a natural pioneer who leads from the front',
    c: 'thrives in leadership, defence, sport, entrepreneurship and any fast-moving field',
    h: 'strong vitality; watch the head, stress and a tendency to overexert',
    l: 'passionate and direct in love; values honesty and excitement' },
  Taurus: { p: 'patient, dependable and grounded with a love of comfort and beauty',
    c: 'excels in finance, real estate, food, arts and steady long-term work',
    h: 'robust constitution; mind the throat, neck and weight balance',
    l: 'loyal and sensual; seeks security and lasting commitment' },
  Gemini: { p: 'curious, witty and adaptable with a quick, communicative mind',
    c: 'shines in media, writing, sales, teaching, IT and travel',
    h: 'generally agile; protect the lungs, nerves and sleep routine',
    l: 'playful and intellectual; needs mental connection and variety' },
  Cancer: { p: 'caring, intuitive and protective with deep emotional intelligence',
    c: 'does well in care-giving, hospitality, real estate and family business',
    h: 'sensitive digestion and emotions; nurture rest and diet',
    l: 'devoted and nurturing; family and emotional safety matter most' },
  Leo: { p: 'confident, warm and creative with natural charisma and pride',
    c: 'born for leadership, entertainment, politics and the limelight',
    h: 'strong heart energy; guard the heart, back and over-confidence',
    l: 'generous and loyal; loves admiration and grand romance' },
  Virgo: { p: 'analytical, precise and service-minded with an eye for detail',
    c: 'great in health, analysis, editing, accounts and quality work',
    h: 'careful digestion and nerves; routine and clean diet help',
    l: 'thoughtful and devoted; shows love through practical care' },
  Libra: { p: 'balanced, charming and fair with a strong sense of harmony',
    c: 'suited to law, design, diplomacy, partnerships and the arts',
    h: 'watch kidneys and lower back; balance work and rest',
    l: 'romantic and partnership-oriented; seeks an equal companion' },
  Scorpio: { p: 'intense, determined and deeply perceptive with strong willpower',
    c: 'powerful in research, finance, medicine, investigation and strategy',
    h: 'strong recovery; manage stress and reproductive health',
    l: 'passionate and loyal; bonds deeply and values trust' },
  Sagittarius: { p: 'optimistic, free-spirited and philosophical, always seeking truth',
    c: 'excels in teaching, law, travel, publishing and consulting',
    h: 'active body; mind the hips, thighs and over-indulgence',
    l: 'honest and adventurous; needs freedom with loyalty' },
  Capricorn: { p: 'disciplined, ambitious and patient, building success steadily',
    c: 'a natural in management, government, engineering and long-term ventures',
    h: 'strong stamina; care for bones, knees and joints',
    l: 'committed and steady; shows love through reliability' },
  Aquarius: { p: 'original, humane and visionary with an independent mind',
    c: 'innovates in technology, science, social work and networks',
    h: 'guard circulation and ankles; avoid irregular routines',
    l: 'friendly and unconventional; values mental freedom' },
  Pisces: { p: 'compassionate, imaginative and spiritual with deep empathy',
    c: 'gifted in arts, healing, spirituality, music and charity',
    h: 'sensitive feet and immunity; needs emotional grounding',
    l: 'tender and selfless; seeks a soulful, understanding bond' },
};

// Build a full, readable report from the Prokerala data. Deterministic
// so it always has rich content even if a text endpoint is unavailable.
export function generateNarrative(r) {
  if (!r) return null;
  // Vedic reading is primarily LAGNA (ascendant) based.
  const asc = r.ascendant && r.ascendant.sign;
  const sign = asc || r.zodiac || r.soorya_rasi || '';
  const t = SIGN_TRAITS[sign] || {
    p: 'a unique blend of strengths', c: 'a wide range of fields',
    h: 'balanced wellbeing with mindful habits',
    l: 'a sincere and caring approach to relationships' };
  const ai = r.additional_info || {};
  const moon = r.chandra_rasi ? `Moon in ${r.chandra_rasi}` : '';
  const nak = r.nakshatra
    ? `${r.nakshatra}${r.nakshatra_pada ? ` (pada ${r.nakshatra_pada})` : ''}`
    : '';
  return {
    personality: `${asc ? `Your Lagna (ascendant) is ${asc}. ` : ''}`
      + `As a ${sign || 'native'} ascendant, you are ${t.p}. `
      + `${moon ? `${moon} colours your emotional nature. ` : ''}`
      + `${nak ? `Your birth star ${nak} adds its own signature to your `
        + 'temperament and instincts.' : ''}`,
    career: `Career: you thrive in ${t.c}. ${ai.planet
      ? `Your ruling planet ${ai.planet} supports focused growth when `
        + 'you align effort with timing.' : ''}`,
    health: `Health: ${t.h}. ${ai.nadi
      ? `Ayurvedic constitution leans ${ai.nadi}; favour foods and a `
        + 'routine that balance it.' : ''}`,
    love: `Love & relationships: you are ${t.l}. `
      + `${ai.animal_sign ? `Your yoni (${ai.animal_sign}) influences `
        + 'compatibility and bonding style.' : ''}`,
    life: `Life path: with ${nak || 'your birth star'} and ${sign
      || 'your sign'}, your journey rewards patience, dharma and using `
      + 'your natural gifts in service of clear goals. Favourable '
      + `direction ${ai.best_direction || 'as per chart'}, lucky colour `
      + `${ai.color || '-'}, birth stone ${ai.birth_stone || '-'}.`,
    lucky: {
      deity: ai.deity || '-',
      color: ai.color || '-',
      stone: ai.birth_stone || '-',
      direction: ai.best_direction || '-',
      syllables: ai.syllables || '-',
    },
  };
}

// ---------------------------------------------------------------------
// FULL PRINTABLE REPORT (free, multi-page "Save as PDF").
// Builds a long, richly-sectioned HTML document from the kundli data +
// narrative. Each major section starts on a new page (CSS page-break) so
// the browser / Android print dialog produces a complete multi-page PDF
// the customer, astrologer and admin can all download for free.
// ---------------------------------------------------------------------
const PLANET_TRAITS = {
  Sun: 'the soul, ego, vitality, father, authority and government. A '
    + 'strong Sun gives confidence, leadership and good health; a weak '
    + 'Sun can bring self-doubt or friction with authority.',
  Moon: 'the mind, emotions, mother and inner peace. The Moon governs '
    + 'how you feel and nurture; a well-placed Moon brings calm, '
    + 'popularity and emotional strength.',
  Mars: 'energy, courage, siblings, land and drive. Mars fuels ambition '
    + 'and action; when afflicted it can show impatience or conflict.',
  Mercury: 'intellect, speech, business, learning and communication. '
    + 'A strong Mercury sharpens analysis, trade and expression.',
  Jupiter: 'wisdom, fortune, children, teachers and dharma. Jupiter is '
    + 'the great benefic, expanding whatever it touches with knowledge '
    + 'and grace.',
  Venus: 'love, marriage, luxury, art and comforts. Venus governs '
    + 'relationships and refinement, vehicles and material pleasures.',
  Saturn: 'discipline, karma, longevity, labour and patience. Saturn '
    + 'rewards honest, sustained effort and teaches through delay.',
  Rahu: 'ambition, foreign matters, technology and sudden gains. Rahu '
    + 'amplifies worldly desire and unconventional paths.',
  Ketu: 'detachment, spirituality, past-life karma and liberation. '
    + 'Ketu turns the mind inward toward moksha.',
};
const HOUSE_MEANINGS = [
  ['First House (Lagna)', 'self, body, personality, vitality and the '
    + 'overall direction of life.'],
  ['Second House', 'wealth, family, speech, food and accumulated assets.'],
  ['Third House', 'courage, siblings, communication, short journeys and '
    + 'self-effort.'],
  ['Fourth House', 'mother, home, property, vehicles and inner happiness.'],
  ['Fifth House', 'intelligence, children, romance, creativity and past '
    + 'merit (purva punya).'],
  ['Sixth House', 'health, enemies, debts, service and daily work.'],
  ['Seventh House', 'marriage, partnerships, spouse and business '
    + 'relationships.'],
  ['Eighth House', 'longevity, transformation, inheritance and hidden '
    + 'matters.'],
  ['Ninth House', 'fortune, dharma, father, higher learning and long '
    + 'journeys.'],
  ['Tenth House', 'career, status, authority and karma in the world.'],
  ['Eleventh House', 'gains, income, friends, ambitions and fulfilment '
    + 'of desires.'],
  ['Twelfth House', 'expenses, losses, foreign lands, isolation and '
    + 'spiritual liberation.'],
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the complete printable report as a standalone HTML document.
export function buildKundliReportHtml(kundli, report) {
  const k = kundli || {};
  const r = report || {};
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  // Ascendant (Lagna) is the rising sign at birth and ONLY comes from
  // real chart data (Prokerala). Do NOT fall back to the sun sign /
  // zodiac sign here - they are different things and using one as the
  // other would mislead the customer. Show the sun (zodiac) sign as its
  // own row below.
  const asc = (r.ascendant && r.ascendant.sign) || '-';
  const zodiacSign = r.zodiac || k.zodiac || '-';
  const planets = Array.isArray(r.planets) ? r.planets : [];
  const dasha = Array.isArray(r.dasha) ? r.dasha : [];
  const byHouse = {};
  planets.forEach((p) => {
    const h = Number(p.house) || 0;
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(p.name);
  });
  const today = new Date().toISOString().slice(0, 10);

  const page = (inner) => `<section class="page">${inner}</section>`;
  const sec = (title, body) => `<h2>${esc(title)}</h2>${body}`;
  const para = (t) => `<p>${esc(t)}</p>`;

  // Cover
  let html = page(`
    <div class="cover">
      <div class="brand">AstroSeer</div>
      <h1>Vedic Birth Chart Report</h1>
      <div class="kundli-name">${esc(k.name || 'Native')}</div>
      <table class="birth">
        <tr><td>Date of birth</td><td>${esc(k.dob || '-')}</td></tr>
        <tr><td>Time of birth</td><td>${esc(k.tob || '-')} ${
  esc(k.ampm || '')}</td></tr>
        <tr><td>Place of birth</td><td>${esc(k.place || '-')}</td></tr>
        <tr><td>Zodiac sign (from DOB)</td><td>${esc(zodiacSign)}</td></tr>
        <tr><td>Ascendant (Lagna)</td><td>${esc(asc)}</td></tr>
        <tr><td>Moon sign (Rasi)</td><td>${esc(r.chandra_rasi || '-')}</td></tr>
        <tr><td>Sun sign</td><td>${esc(r.soorya_rasi || '-')}</td></tr>
        <tr><td>Nakshatra</td><td>${esc(r.nakshatra || '-')}${
  r.nakshatra_pada ? ` (pada ${esc(r.nakshatra_pada)})` : ''}</td></tr>
      </table>
      <div class="generated">Generated ${esc(today)} · Free full report</div>
    </div>`);

  // Personality & life overview
  html += page(sec('Personality & Nature',
    para(n.personality || `As a ${asc} ascendant native, your chart `
      + 'reflects a unique blend of strengths and lessons.'))
    + sec('Life Path', para(n.life || '')));

  // Career, health, love
  html += page(sec('Career & Profession', para(n.career || ''))
    + sec('Health & Wellbeing', para(n.health || ''))
    + sec('Love & Relationships', para(n.love || '')));

  // Lucky factors
  html += page(sec('Auspicious & Lucky Factors', `
    <table class="kv">
      <tr><td>Ruling deity</td><td>${esc(lucky.deity || '-')}</td></tr>
      <tr><td>Lucky colour</td><td>${esc(lucky.color || '-')}</td></tr>
      <tr><td>Birth stone</td><td>${esc(lucky.stone || '-')}</td></tr>
      <tr><td>Favourable direction</td><td>${
  esc(lucky.direction || '-')}</td></tr>
      <tr><td>Lucky syllables</td><td>${esc(lucky.syllables || '-')}</td></tr>
    </table>`));

  // Planet positions table
  html += page(sec('Planetary Positions', `
    <table class="grid">
      <tr><th>Planet</th><th>Sign</th><th>House</th><th>Degree</th>
        <th>Motion</th></tr>
      ${planets.length ? planets.map((p) => `<tr><td>${esc(p.name)}</td>`
    + `<td>${esc(p.sign || '-')}</td><td>${esc(p.house ?? '-')}</td>`
    + `<td>${esc(p.degree ?? '-')}</td>`
    + `<td>${p.retrograde ? 'Retrograde' : 'Direct'}</td></tr>`).join('')
    : '<tr><td colspan="5">Planetary detail unavailable on the '
      + 'current data plan.</td></tr>'}
    </table>`));

  // Per-planet detailed analysis (one page each)
  const planetByName = {};
  planets.forEach((p) => { planetByName[p.name] = p; });
  Object.keys(PLANET_TRAITS).forEach((name) => {
    const p = planetByName[name];
    const where = p ? `In your chart ${name} is placed in ${
      esc(p.sign || 'its sign')}${p.house ? `, in the ${p.house}th house`
      : ''}${p.retrograde ? ', and is retrograde' : ''}. `
      : `${name} is a key influence in every chart. `;
    html += page(sec(`${name}: Significance & Placement`,
      para(`${name} represents ${PLANET_TRAITS[name]}`)
      + para(`${where}This colours the related areas of life and should be `
        + 'strengthened through the recommended remedies and conscious '
        + 'effort.')));
  });

  // Per-house analysis (one page each)
  HOUSE_MEANINGS.forEach(([title, meaning], i) => {
    const occ = byHouse[i + 1] || [];
    html += page(sec(`${title}`, para(`The ${title} governs ${meaning}`)
      + para(occ.length
        ? `Planets occupying this house: ${esc(occ.join(', '))}. Their `
          + 'energies directly shape these matters in your life.'
        : 'No planet occupies this house, so its results flow mainly '
          + 'through its lord and the planets aspecting it.')));
  });

  // Dasha timeline
  html += page(sec('Vimshottari Dasha: Planetary Periods',
    (r.currentDasha
      ? `<p class="cur">Current Maha Dasha: <b>${
        esc(r.currentDasha.planet)}</b> (${
        esc(String(r.currentDasha.start || '').slice(0, 10))} to ${
        esc(String(r.currentDasha.end || '').slice(0, 10))})</p>`
      : '')
    + (dasha.length ? `<table class="grid"><tr><th>Mahadasha</th>`
      + `<th>From</th><th>To</th></tr>${dasha.map((d) => `<tr><td>${
        esc(d.planet)}${d.current ? ' (current)' : ''}</td><td>${
        esc(String(d.start || '').slice(0, 10))}</td><td>${
        esc(String(d.end || '').slice(0, 10))}</td></tr>`).join('')}</table>`
      : '<p>Dasha detail unavailable on the current data plan.</p>')));

  // Remedies / disclaimer
  html += page(sec('General Remedies & Guidance',
    para('Strengthen benefic planets through their gemstones, mantras, '
      + 'charity (daan) on the planet’s day, and a disciplined, '
      + 'dharmic routine. Favour your lucky colour and direction for '
      + 'important beginnings, and offer prayers to your ruling deity.')
    + para('This report is generated from your birth details for guidance '
      + 'and self-reflection. For personalised predictions, consult an '
      + 'astrologer on AstroSeer.')));

  // Royal palette ONLY (Maroon #7F2020 / Amber #D4A12A / Cream #FBF7EE).
  // Purple was strictly prohibited and has been fully removed from the
  // brand cover + headings + accent strip.
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<title>${esc(k.name || 'Kundli')} Vedic Report</title><style>`
    + `*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',`
    + `serif;color:#1A1A2E;margin:0;line-height:1.55;background:#FBF7EE}`
    + `.page{padding:48px 56px;min-height:100vh;page-break-after:always;`
    + `border-bottom:1px solid #E6DEC9;background:#FFFFFF}`
    + `h1{font-size:30px;color:#7F2020;margin:8px 0}`
    + `h2{font-size:20px;color:#7F2020;border-bottom:2px solid #D4A12A;`
    + `padding-bottom:6px;margin:0 0 12px}`
    + `p{font-size:14px;margin:0 0 12px;text-align:justify;color:#1A1A2E}`
    + `.cover{text-align:center;padding-top:80px}`
    + `.brand{letter-spacing:3px;color:#D4A12A;font-weight:bold;`
    + `text-transform:uppercase}`
    + `.kundli-name{font-size:22px;font-weight:bold;margin:6px 0 24px;`
    + `color:#7F2020}`
    + `table{width:100%;border-collapse:collapse;margin:0 auto 12px}`
    + `.birth{max-width:420px}.birth td,.kv td{padding:7px 10px;`
    + `border:1px solid #E6DEC9;text-align:left;font-size:14px}`
    + `.birth td:first-child,.kv td:first-child{color:#5A6E32;width:45%;`
    + `font-weight:600}`
    + `.grid th,.grid td{border:1px solid #E6DEC9;padding:6px 8px;`
    + `font-size:13px;text-align:left}.grid th{background:#FBF7EE;`
    + `color:#7F2020}`
    + `.generated{margin-top:36px;color:#5A6E32;font-size:12px}`
    + `.cur{background:#7F2020;color:#fff;padding:10px 12px;`
    + `border-radius:8px}`
    + `@media print{.page{border:none}}`
    + `</style></head><body>${html}</body></html>`;
}

// Open the printable report in a new window and trigger the print /
// "Save as PDF" dialog. Free, no page limit, works on web + Android.
// Window-guarded so importing this module never breaks SSR / the bundle.
export function downloadKundliReport(kundli, report) {
  if (typeof window === 'undefined') return false;
  const html = buildKundliReportHtml(kundli, report);
  const w = window.open('', '_blank');
  if (!w) {
    // Popup blocked (e.g. inside the app WebView): fall back to a data
    // URL navigation in the same tab so the user still gets the report.
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
    return true;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the layout a moment, then open the print dialog.
  w.onload = () => { try { w.focus(); w.print(); } catch (_) {} };
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 600);
  return true;
}

// Defensive: every provider's response gets normalised here so the
// rendering page can ALWAYS render strings/arrays without crashing.
// AstroSeer (our Render API) returns objects for nakshatra / moon_sign
// / sun_sign (rich detail with pada/lord/yoni/gana/nadi); rendering
// the object directly throws "Objects are not valid as a React child"
// on the /kundli overview tab. Prokerala already returns strings, so
// this is a no-op for it.
function flatName(x) {
  if (!x) return null;
  if (typeof x === 'string') return x;
  return x.name || x.sign || null;
}
function normaliseReport(r) {
  if (!r || typeof r !== 'object') return r;
  const out = { ...r };
  // 1. Top-level scalar fields the page reads directly.
  if (out.nakshatra && typeof out.nakshatra === 'object') {
    out.nakshatraDetail = out.nakshatra;
    out.nakshatra = flatName(out.nakshatra);
  }
  if (out.chandra_rasi && typeof out.chandra_rasi === 'object') {
    out.moonSign = out.chandra_rasi;
    out.chandra_rasi = flatName(out.chandra_rasi);
  }
  if (out.soorya_rasi && typeof out.soorya_rasi === 'object') {
    out.sunSign = out.soorya_rasi;
    out.soorya_rasi = flatName(out.soorya_rasi);
  }
  // Fallbacks for AstroSeer where the relay didn't pre-flatten - // pull from the raw moon_sign / sun_sign objects if present.
  if (!out.chandra_rasi && r.raw && r.raw.moon_sign) {
    out.chandra_rasi = flatName(r.raw.moon_sign);
  }
  if (!out.soorya_rasi && r.raw && r.raw.sun_sign) {
    out.soorya_rasi = flatName(r.raw.sun_sign);
  }
  // 2. Planets: ensure each row has a string `degree` field for the
  //    <table> render. AstroSeer ships degree_display + degree_in_sign
  //    but no `degree`.
  if (Array.isArray(out.planets)) {
    out.planets = out.planets.map((p) => {
      if (!p || typeof p !== 'object') return p;
      const degree = p.degree
        || p.degree_display
        || (typeof p.degree_in_sign === 'number'
          ? p.degree_in_sign.toFixed(2) : null);
      return {
        ...p,
        degree,
        // Some adapters ship the nakshatra-per-planet as an object too.
        nakshatra: typeof p.nakshatra === 'object'
          ? flatName(p.nakshatra) : p.nakshatra,
        retrograde: !!(p.retrograde || p.isRetro),
      };
    });
  }
  return out;
}

// Full kundli with CACHING. The report is stored on the profile doc
// and returned as-is unless dob / time / place changed (signature
// differs), which avoids re-hitting the Prokerala / AstroSeer API
// every time.
// Provider stamp ('astroseer' vs 'prokerala' etc) is included in the
// signature so a cached buggy-shape report from an older relay
// release is regenerated under the current provider.
export async function getFullKundli(profile) {
  if (!profile) return null;
  const sig = birthSig(profile);
  if (profile.report && profile.reportSig === sig) {
    // Detect the legacy buggy-shape cache (nakshatra still an object
    // from a pre-fix relay) and force a refetch so the user doesn't
    // stay stuck on the cached crash.
    // A cached report is "stale" when:
    //   1. nakshatra is still the old object shape (pre-flatten bug)
    //   2. ascendant.sign is missing - happens when AstroSeer 401'd
    //      during the original generate and we cached a near-empty
    //      payload. Now that the relay falls back to unauth on 401,
    //      a re-fetch will populate everything.
    //   3. planets[] is empty - same root cause as (2).
    // Any of the three forces a fresh fetch.
    const rep = profile.report || {};
    const stale = (rep.nakshatra && typeof rep.nakshatra === 'object')
      || !(rep.ascendant && rep.ascendant.sign)
      || !(Array.isArray(rep.planets) && rep.planets.length > 0);
    if (!stale) {
      return { ...normaliseReport(profile.report), cached: true };
    }
  }
  const data = await getProkeralaKundli(profile);
  if (!data) return null;
  const normalised = normaliseReport(data);
  const report = { ...normalised, narrative: generateNarrative(normalised) };
  if (profile.id) {
    try {
      await updateDoc(doc(db, 'kundliProfiles', profile.id), {
        report, reportSig: sig, reportAt: serverTimestamp(),
      });
    } catch (_) { /* still return it even if cache write fails */ }
  }
  return { ...report, cached: false };
}

export async function saveKundli(uid, data) {
  const ref = doc(collection(db, 'kundliProfiles'));
  await setDoc(ref, {
    userId: uid,
    name: data.name || '',
    dob: data.dob || '',
    tob: data.tob || '',
    ampm: data.ampm || 'AM',
    place: data.place || '',
    // Locked geo data captured from the CityField autocomplete.
    // Without these the relay can't geocode reliably and the kundli
    // ends up at coordinates 0,0 / GMT+0 (the bug the user hit).
    lat: data.lat != null ? Number(data.lat) : null,
    lng: data.lng != null ? Number(data.lng) : null,
    tz: data.tz != null ? Number(data.tz) : null,
    city: data.city || '',
    state: data.state || '',
    country: data.country || '',
    countryCode: data.countryCode || '',
    zodiac: parseZodiac(data.dob),
    isDefault: !!data.isDefault,
    createdAt: serverTimestamp(),
  });
  if (data.isDefault) await setDefaultKundli(uid, ref.id);
  return ref.id;
}

// Update an existing kundli profile in place. Touching dob/tob/place
// changes birthSig, so the cached report auto-invalidates on the
// next View Full Kundli call and a fresh AstroSeer fetch lands - // no manual cache bust needed.
export async function updateKundli(uid, kundliId, data) {
  if (!kundliId) throw new Error('kundliId required');
  const ref = doc(db, 'kundliProfiles', kundliId);
  // Wipe the cached report when birth fields change so the next
  // view re-fetches against the new values (saves the user from
  // staring at stale planets).
  const cur = await getDoc(ref);
  const old = cur.exists() ? cur.data() : {};
  const birthChanged = old.userId === uid
    && (String(old.dob) !== String(data.dob)
      || String(old.tob) !== String(data.tob)
      || String(old.ampm) !== String(data.ampm)
      || String(old.place) !== String(data.place));
  const patch = {
    name: data.name || '',
    dob: data.dob || '',
    tob: data.tob || '',
    ampm: data.ampm || 'AM',
    place: data.place || '',
    // Locked geo (lat/lng/tz) - re-saved on every edit so a user
    // who re-picks their city in the form gets the fresh values.
    lat: data.lat != null ? Number(data.lat) : null,
    lng: data.lng != null ? Number(data.lng) : null,
    tz: data.tz != null ? Number(data.tz) : null,
    city: data.city || '',
    state: data.state || '',
    country: data.country || '',
    countryCode: data.countryCode || '',
    zodiac: parseZodiac(data.dob),
    isDefault: !!data.isDefault,
    updatedAt: serverTimestamp(),
  };
  if (birthChanged) {
    // Use deleteField() so the cached report goes away cleanly.
    const { deleteField } = await import('firebase/firestore');
    patch.report = deleteField();
    patch.reportSig = deleteField();
    patch.reportAt = deleteField();
  }
  await updateDoc(ref, patch);
  if (data.isDefault) await setDefaultKundli(uid, kundliId);
  return kundliId;
}

export async function getKundliProfiles(uid) {
  const q = query(collection(db, 'kundliProfiles'), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDefaultKundli(uid) {
  const list = await getKundliProfiles(uid);
  return list.find((k) => k.isDefault) || list[0] || null;
}

// Only one default per user, clears the flag on every other profile.
export async function setDefaultKundli(uid, kundliId) {
  const list = await getKundliProfiles(uid);
  const batch = writeBatch(db);
  list.forEach((k) =>
    batch.update(doc(db, 'kundliProfiles', k.id), { isDefault: k.id === kundliId }));
  await batch.commit();
}

export async function deleteKundli(id) {
  await deleteDoc(doc(db, 'kundliProfiles', id));
}

// Auto-shared as the first chat message when a session starts (blueprint 4.8).
export async function autoSendKundliToChat(chatId, systemSenderId, kundli) {
  if (!kundli) return;
  const lines = [
    kundli.name,
    `DOB: ${kundli.dob}`,
    `Time of birth: ${kundli.tob || '--'} ${kundli.ampm || ''}`.trim(),
    `Place of birth: ${kundli.place || '--'}`,
  ];
  // Label as "Zodiac sign" (sun sign computed from DOB) - never as
  // "Ascendant" since that requires real chart data and is different.
  if (kundli.zodiac) lines.push(`Zodiac sign: ${kundli.zodiac}`);
  await sendMessage(chatId, systemSenderId, lines.join('\n'));
}
