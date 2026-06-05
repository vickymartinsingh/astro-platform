import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  userService, sessionService, astrologerService, kundliService, db,
  emailService,
} from '@astro/shared';
import {
  collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';
import Layout from '../../components/Layout';
import ResetAccountPanel from '../../components/ResetAccountPanel';
import ComplianceActivity from '../../components/ComplianceActivity';
import ActivityHistory from '../../components/ActivityHistory';
import UserActionBar from '../../components/UserActionBar';
import UserRecordingsPanel from '../../components/UserRecordingsPanel';
import { useRequireAdmin } from '../../lib/useAuth';

const { sessionRefNo } = sessionService;
const TYPE_ICON = { chat: '💬', call: '📞', video: '📹' };

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDate(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '-';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
function fmtDur(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return '0m';
  const m = Math.floor(s / 60); const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m${r ? ` ${r}s` : ''}` : `${r}s`;
}
// Birth place can be either a raw string (legacy) or the structured
// city object the CityField widget now writes, shaped roughly as
// { label, place, city, state, country, lat, lng, tz, id }.
// React explodes if we try to render the object directly, so we
// normalize to a readable label string here.
function placeLabel(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    return v.label || v.place
      || [v.city, v.state, v.country].filter(Boolean).join(', ')
      || '';
  }
  return String(v);
}

export default function AdminUserProfile() {
  const router = useRouter();
  const { id } = router.query;
  const { loading } = useRequireAdmin();
  const [u, setU] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [txns, setTxns] = useState([]);
  const [astroNames, setAstroNames] = useState({});
  const [kundlis, setKundlis] = useState([]);
  const [reports, setReports] = useState({}); // { [kundliId]: data|'loading'|'err' }

  useEffect(() => {
    if (loading || !id) return;
    (async () => {
      try {
        const fetched = await userService.getUser(id);
        // Account may be deleted/purged; keep the page alive with a
        // stub so compliance logs (Activity History, Device Sessions,
        // Audit) still render for the same uid.
        setU(fetched || { id, deleted: true,
          name: '(deleted account)', email: '', phone: '' });
      } catch (_) {
        setU({ id, deleted: true, name: '(deleted account)',
          email: '', phone: '' });
      }
      try {
        const list = await sessionService.getUserSessions(id);
        setSessions(list || []);
        const ids = [...new Set((list || []).map((s) => s.astroId)
          .filter(Boolean))].slice(0, 30);
        const pairs = await Promise.all(ids.map(async (a) => {
          try {
            const x = await astrologerService.getAstrologer(a);
            return [a, (x && (x.name || x.displayName)) || 'Astrologer'];
          } catch (_) { return [a, 'Astrologer']; }
        }));
        setAstroNames(Object.fromEntries(pairs));
      } catch (_) { /* ignore */ }
      try {
        const snap = await getDocs(query(
          collection(db, 'transactions'),
          where('userId', '==', id), orderBy('createdAt', 'desc'),
          limit(30)));
        setTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (_) { /* ignore (index may be missing - non-fatal) */ }
      try {
        setKundlis(await kundliService.getKundliProfiles(id) || []);
      } catch (_) { /* ignore */ }
    })();
  }, [loading, id]);

  async function viewReport(k) {
    // (Legacy) Fetch the JSON kundli + render the lightweight
    // KundliSummary inline below the row. Kept so the in-page
    // panel still shows the standard summary; the user-requested
    // "open the API-generated PDF" lives behind the NEW "View PDF"
    // button (handleViewApiPdf) below, which opens the same
    // PdfViewerPopup the customer sees.
    setReports((c) => ({ ...c, [k.id]: 'loading' }));
    try {
      const data = await kundliService.getFullKundli(k);
      setReports((c) => ({ ...c, [k.id]: data || 'err' }));
    } catch (_) { setReports((c) => ({ ...c, [k.id]: 'err' })); }
  }

  // NEW: ALL three admin buttons (View PDF / Download PDF /
  // Regenerate) now go through kundliService.requestReport - the
  // SAME relay path the customer dashboard uses. That guarantees
  // admin and customer see byte-for-byte identical PDF content.
  // Per user request: "i am clicking it must show the generated
  // by the API because that is as per my need".
  const [pdfState, setPdfState] = useState({});   // { [k.id]: 'loading'|result|error-string }
  const [viewer, setViewer] = useState(null);     // { url, name } | null

  // Compute the same birthSig the relay uses (push-relay/lib/
  // kundliReport.js line 713) so we can locate the matching
  // cached order without hitting the relay function at all.
  // Includes name + dob + tob + ampm + place, lowercased + trimmed.
  function birthSigOf(k) {
    return [k.name, k.dob, k.tob, k.ampm, k.place]
      .map((x) => String(x || '').trim().toLowerCase()).join('|');
  }

  // Read Firestore DIRECTLY for an already-generated, status:'ready'
  // order matching the kundli profile's current birthSig. Avoids
  // waking the relay function + waiting for the AstroSeer round-
  // trip when a cached PDF is sitting right there in the customer's
  // orders subcollection. Returns the same shape the relay would
  // have returned on a cache hit, or null on miss.
  async function findCachedOrder(k, kind) {
    if (!k || !k.id || !k.userId) return null;
    try {
      const { collection, query, where, getDocs } = await import(
        'firebase/firestore');
      const q = query(
        collection(db, 'users', k.userId, 'orders'),
        where('kundliProfileId', '==', k.id),
        where('kind', '==', kind || 'free'),
        where('status', '==', 'ready'),
      );
      const snap = await getDocs(q);
      const sig = birthSigOf(k);
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => !d.birthSig || d.birthSig === sig)
        .sort((a, b) => {
          const at = (a.deliveredAt && a.deliveredAt.toMillis
            && a.deliveredAt.toMillis()) || 0;
          const bt = (b.deliveredAt && b.deliveredAt.toMillis
            && b.deliveredAt.toMillis()) || 0;
          return bt - at;
        });
      const ready = docs[0];
      if (!ready || (!ready.pdfUrl && !ready.pdfBase64)) return null;
      return {
        ok: true,
        cached: true,
        orderId: ready.id,
        pdfUrl: ready.pdfBase64
          ? `data:application/pdf;base64,${ready.pdfBase64}`
          : ready.pdfUrl,
        pdfName: ready.pdfName || 'AstroSeer-Kundli.pdf',
        sizeBytes: ready.sizeBytes || 0,
        kind: ready.kind || kind || 'free',
      };
    } catch (_) { return null; }
  }

  // Three-step PDF fetch:
  //   1. Check Firestore for a cached 'ready' order matching the
  //      current profile birthSig - instant, no relay call.
  //   2. If miss, ask the relay to start async generation.
  //   3. Poll reportStatus every 5s for up to 5 min until 'ready'.
  // After 2026-05-28 async refactor the relay returns
  // status:'generating' on a fresh request, so polling is required.
  async function fetchApiPdf(k, { force = false } = {}) {
    if (!k || !k.id || !k.userId) return null;
    setPdfState((c) => ({ ...c, [k.id]: 'loading' }));
    try {
      // 1) Cache hit straight from Firestore (unless admin
      // explicitly clicked Regenerate which sets force:true).
      if (!force) {
        const direct = await findCachedOrder(k, 'free');
        if (direct && direct.pdfUrl) {
          setPdfState((c) => ({ ...c, [k.id]: direct }));
          return direct;
        }
      }

      // 2) Start generation via relay.
      const initial = await kundliService.requestReport({
        uid: k.userId,
        kundliProfileId: k.id,
        kind: 'free',
        regenerate: !!force,
      });

      // 2a) Relay returned cached PDF directly (relay also checks
      // its own cache, so this is fast when birthSig matches a
      // recent order). Skip polling.
      if (initial && initial.ok && initial.pdfUrl) {
        setPdfState((c) => ({ ...c, [k.id]: initial }));
        return initial;
      }

      // 2b) Async flow - poll until ready.
      if (initial && initial.orderId) {
        const ready = await kundliService.pollReportUntilReady({
          uid: k.userId,
          orderId: initial.orderId,
          onTick: (s, i) => {
            setPdfState((c) => ({ ...c,
              [k.id]: `Generating PDF... (${i * 5}s)` }));
          },
        });
        if (ready && ready.ok && ready.pdfUrl) {
          setPdfState((c) => ({ ...c, [k.id]: ready }));
          return ready;
        }
        const msg = (ready && (ready.error || ready.warning))
          || 'PDF generation did not complete in 5 min. '
            + 'Check back later or click Regenerate.';
        setPdfState((c) => ({ ...c, [k.id]: msg }));
        return null;
      }

      const msg = (initial && initial.error) || 'PDF unavailable.';
      setPdfState((c) => ({ ...c, [k.id]: msg }));
      return null;
    } catch (e) {
      setPdfState((c) => ({ ...c, [k.id]: (e && e.message)
        || 'PDF request failed.' }));
      return null;
    }
  }
  async function handleViewApiPdf(k) {
    const cached = pdfState[k.id];
    let result = (cached && typeof cached === 'object'
      && cached.pdfUrl) ? cached : null;
    if (!result) result = await fetchApiPdf(k);
    if (result && result.pdfUrl) {
      setViewer({ url: result.pdfUrl,
        name: result.pdfName || 'AstroSeer-Kundli.pdf' });
    }
  }
  async function downloadReport(k) {
    // PDF download: pull the API-generated PDF (same one the
    // customer sees) and route through downloadPdfFromUrl, which
    // handles data: URLs + Capacitor native shells.
    const cached = pdfState[k.id];
    let result = (cached && typeof cached === 'object'
      && cached.pdfUrl) ? cached : null;
    if (!result) result = await fetchApiPdf(k);
    if (result && result.pdfUrl) {
      kundliService.downloadPdfFromUrl(result.pdfUrl,
        result.pdfName || 'AstroSeer-Kundli.pdf');
    }
  }
  async function regenerateReport(k) {
    // Same path with regenerate:true so the relay rebuilds the PDF
    // and the cached order is replaced. Admin can refresh content
    // without manually clearing the cache.
    const result = await fetchApiPdf(k, { force: true });
    if (result && result.pdfUrl) {
      setViewer({ url: result.pdfUrl,
        name: result.pdfName || 'AstroSeer-Kundli.pdf' });
    }
  }

  // We still mount the full page when the users/{uid} doc no longer
  // exists (account deleted / purged). The effect above writes a
  // stub user object in that case so every panel below (Activity
  // History, Device Sessions, Audit, Orders) keeps rendering and
  // admin can pull compliance data even for purged accounts.
  if (loading || !u) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const ended = sessions.filter((s) => s.status === 'ended');
  const totalSpent = ended.reduce((a, s) => a + Number(s.cost || 0), 0);
  const totalMinutes = ended.reduce(
    (a, s) => a + Math.round(Number(s.duration || 0) / 60), 0);
  const refunded = sessions.filter((s) => s.refundRequest
    && s.refundRequest.status === 'processed');
  const totalRefunded = refunded.reduce(
    (a, s) => a + Number(s.refundedAmount || 0), 0);

  return (
    <Layout>
      <button onClick={() => router.back()}
        className="mb-3 text-sm font-semibold text-primary">
        ← Back
      </button>

      {/* HEADER */}
      <div className="surface flex flex-wrap items-start gap-4 p-4">
        {u.profileImage ? (
          <img src={u.profileImage} alt={u.name}
            className="h-24 w-24 rounded-full object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center
            rounded-full bg-primary/15 text-3xl font-bold text-primary">
            {(u.name || u.email || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{u.name || 'Customer'}</h1>
            {u.deleted ? (
              <span className="rounded-full bg-danger/10 px-2 py-0.5
                text-[10px] font-bold uppercase text-danger">
                Deleted · compliance view
              </span>
            ) : (
              <span className={`rounded-full px-2 py-0.5 text-[10px]
                font-bold capitalize ${
                u.status === 'blocked' ? 'bg-red-100 text-red-700'
                : 'bg-emerald-100 text-emerald-700'}`}>
                {u.status || 'active'}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5
              text-[10px] font-bold uppercase text-gray-700">
              {u.role || 'client'}
            </span>
          </div>
          <div className="mt-1 text-sm text-sub-text">
            {u.email || '-'}{u.phone ? ` · ${u.phone}` : ''}
          </div>
          <div className="mt-1 text-xs text-sub-text">
            Joined: <b>{fmtDate(u.createdAt)}</b>
            {u.userCode
              ? <> · Code <span className="font-mono">
                  {u.userCode}</span></>
              : <> · Code <span className="font-mono">
                  {String(id).slice(0, 6).toUpperCase()}</span></>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center
            sm:grid-cols-4">
            <Stat label="Wallet" value={`₹${u.wallet || 0}`} />
            <Stat label="Sessions" value={ended.length} />
            <Stat label="Minutes" value={totalMinutes} />
            <Stat label="Spent" value={`₹${totalSpent}`} />
          </div>
          {refunded.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              ⚠ {refunded.length} refund(s) processed · total ₹
              {totalRefunded}
            </p>
          )}
        </div>
      </div>

      {/* ADMIN ACTIONS (balance, bonus, gift card, voucher, edit,
          block, delete). Each opens a confirmation modal so a misclick
          on Delete never wipes an account. */}
      {!u.deleted && (
        <UserActionBar uid={id} user={u}
          onChange={(patch) => setU((cur) => ({ ...cur,
            ...(patch && typeof patch === 'object' ? patch : {}) }))} />
      )}

      {/* CALL RECORDINGS for this customer (audio + video). Each
          recording is playable inline; download link opens the R2
          URL in a new tab for archive. */}
      <UserRecordingsPanel uid={id} kind="customer" />

      {/* PROFILE / KUNDLI */}
      <div className="surface mt-4 p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">Profile</h2>
        <Row k="Gender" v={u.gender || '-'} />
        <Row k="DOB" v={u.dob || '-'} />
        <Row k="Birth time" v={u.tob || u.timeOfBirth || '-'} />
        <Row k="Birth place" v={placeLabel(u.placeOfBirth
          || u.place) || '-'} />
        <Row k="Language" v={u.language || '-'} />
        <Row k="Referral" v={u.referralCode || u.referredBy || '-'} />
        <Row k="Last seen"
          v={fmt(u.lastSeenAt || u.lastSeen || u.updatedAt)} />
      </div>

      {/* DEVICE + LOGIN SESSIONS (real-time IP + UA + history). */}
      <DeviceSessionsPanel uid={id} u={u} />

      {/* Aggregated activity history with date filter + PDF export. */}
      <ActivityHistory uid={id} user={u} />

      {/* KUNDLI PROFILES */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Kundli profiles ({kundlis.length})
        </h2>
        {kundlis.length === 0 ? (
          <div className="text-sm text-sub-text">
            No saved kundli for this customer.
          </div>
        ) : (
          <div className="space-y-2">
            {kundlis.map((k) => (
              <div key={k.id} className="rounded-card border
                border-gray-200 p-2">
                <div className="flex flex-wrap items-center
                  justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">
                      {k.name || 'Native'}
                      {k.isDefault && (
                        <span className="ml-1 rounded-full bg-bg-light
                          px-1.5 py-0.5 text-[10px] font-bold
                          text-primary">Default</span>
                      )}
                    </div>
                    <div className="text-xs text-sub-text">
                      {k.dob} · {k.tob} {k.ampm} · {placeLabel(k.place)}
                      {/* Zodiac (sun sign by DOB) intentionally
                          omitted - that's a horoscope concept, not
                          a kundli identifier. Moon sign + Lagna
                          live inside the generated report. */}
                    </div>
                    {/* Inline editor for admin to correct birth
                        details. The user often needs admin to fix
                        a typo in DOB / TOB / place and force a
                        regenerate without bothering the customer. */}
                    <AdminEditKundli k={k}
                      onSaved={async () => {
                        const fresh = await kundliService
                          .getKundliProfiles(id).catch(() => null);
                        if (fresh) setKundlis(fresh);
                      }} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* "View" - the in-page JSON summary panel
                        (legacy quick read) */}
                    <button onClick={() => viewReport(k)}
                      className="rounded-full bg-bg-light px-3 py-1.5
                        text-xs font-bold text-primary">
                      View
                    </button>
                    {/* NEW: opens the SAME API-generated PDF the
                        customer sees, inside the same popup viewer
                        used on /kundli (close + download + open-in
                        -browser). */}
                    <button onClick={() => handleViewApiPdf(k)}
                      disabled={pdfState[k.id] === 'loading'}
                      className="rounded-full border border-primary
                        bg-white px-3 py-1.5 text-xs font-bold
                        text-primary disabled:opacity-60">
                      {pdfState[k.id] === 'loading'
                        ? 'Loading PDF...' : 'View PDF'}
                    </button>
                    <button onClick={() => downloadReport(k)}
                      disabled={pdfState[k.id] === 'loading'}
                      className="rounded-full bg-primary px-3 py-1.5
                        text-xs font-bold text-white disabled:opacity-60">
                      Download PDF
                    </button>
                    {/* Force-regenerate. Calls the relay with
                        regenerate:true so the cached order is
                        replaced - admin uses this when underlying
                        chart data changes. */}
                    <button onClick={() => regenerateReport(k)}
                      disabled={pdfState[k.id] === 'loading'}
                      className="rounded-full border border-accent
                        bg-white px-3 py-1.5 text-xs font-bold
                        text-accent disabled:opacity-60">
                      Regenerate
                    </button>
                    <EmailKundliButton k={k} u={u}
                      report={reports[k.id]}
                      onLoad={() => viewReport(k)} />
                  </div>
                </div>
                {typeof pdfState[k.id] === 'string'
                  && pdfState[k.id] !== 'loading' && (
                  <div className="mt-1 text-[11px] text-danger">
                    {pdfState[k.id]}
                  </div>
                )}
                {reports[k.id] === 'loading' && (
                  <div className="mt-2 text-xs text-sub-text">
                    Generating kundli…
                  </div>
                )}
                {reports[k.id] === 'err' && (
                  <div className="mt-2 text-xs text-danger">
                    Kundli service unavailable (set Prokerala keys on the
                    relay).
                  </div>
                )}
                {reports[k.id] && typeof reports[k.id] === 'object' && (
                  <KundliSummary r={reports[k.id]} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SESSIONS */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent consultations ({sessions.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">Astrologer</th>
                <th className="p-2">Dur</th>
                <th className="p-2">Cost</th>
                <th className="p-2">Status</th>
                <th className="p-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 30).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">
                    {fmt(s.startTime || s.createdAt)}
                  </td>
                  <td className="p-2">
                    {TYPE_ICON[s.type] || '✨'} {s.type}
                  </td>
                  <td className="p-2">
                    {astroNames[s.astroId] || '-'}
                  </td>
                  <td className="p-2">{fmtDur(s.duration)}</td>
                  <td className="p-2">₹{s.cost || 0}</td>
                  <td className="p-2 capitalize">
                    {s.status}
                    {s.refundRequest && s.refundRequest.status
                      === 'processed' && (
                      <span className="ml-1 rounded-full bg-emerald-100
                        px-1.5 py-0.5 text-[9px] font-bold
                        text-emerald-700">refunded</span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    #{sessionRefNo(s)}
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr><td colSpan={7} className="p-3 text-center
                  text-sub-text">No consultations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TRANSACTIONS */}
      <div className="surface mt-4 p-3">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Recent transactions ({txns.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Type</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{fmt(t.createdAt)}</td>
                  <td className="p-2 capitalize">{t.type || '-'}</td>
                  <td className="p-2 capitalize">{t.reason || '-'}</td>
                  <td className={`p-2 font-semibold ${t.amount >= 0
                    ? 'text-emerald-700' : 'text-red-700'}`}>
                    {t.amount >= 0 ? '+' : ''}₹{t.amount}
                  </td>
                </tr>
              ))}
              {txns.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-center
                  text-sub-text">No transactions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* COMPLIANCE: admin-only device + IP + activity log */}
      <ComplianceActivity uid={id} profile={u} />

      {/* DANGER ZONE: reset account */}
      <ResetAccountPanel uid={id}
        role={(u.role === 'astrologer') ? 'astrologer' : 'client'}
        name={u.name || u.email}
        onDone={() => router.reload()} />

      {/* Full-screen PDF viewer overlay, opens when admin clicks
          View PDF / Regenerate. Same component shape used in the
          customer kundli tab (kept local here to avoid dragging
          client-web into admin-web). */}
      {viewer && (
        <AdminPdfViewerPopup url={viewer.url} name={viewer.name}
          onClose={() => setViewer(null)} />
      )}
    </Layout>
  );
}

// Inline admin editor for a kundli profile. Lets admin correct
// DOB / TOB / AM-PM / place WITHOUT bothering the customer, then
// the user can hit Regenerate to rebuild the PDF from the new birth
// data. Writes straight to kundliProfiles/{id} - the cache-hit
// branch in push-relay sees the new birthSig and recomputes.
function AdminEditKundli({ k, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: k.name || '', dob: k.dob || '', tob: k.tob || '',
    ampm: k.ampm || 'AM', place: placeLabel(k.place) || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }
  async function save() {
    setBusy(true); setMsg({ text: '', kind: '' });
    try {
      const { doc, updateDoc, serverTimestamp } = await import(
        'firebase/firestore');
      await updateDoc(doc(db, 'kundliProfiles', k.id), {
        name: form.name, dob: form.dob, tob: form.tob,
        ampm: form.ampm, place: form.place,
        editedByAdminAt: serverTimestamp(),
      });
      setMsg({ text: 'Saved. Click Regenerate to rebuild the PDF.',
        kind: 'ok' });
      if (onSaved) onSaved();
    } catch (e) {
      setMsg({ text: (e && e.message) || 'Save failed.',
        kind: 'err' });
    } finally { setBusy(false); }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1 text-[11px] font-bold text-primary
          underline hover:text-accent">
        Edit birth details
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-card border border-primary/30
      bg-bg-light/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[10px] font-bold uppercase
            tracking-wide text-sub-text">Name</span>
          <input type="text" value={form.name}
            onChange={(e) => set('name', e.target.value)}
            className="mt-1 w-full rounded-card border border-gray-200
              bg-white px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-bold uppercase
            tracking-wide text-sub-text">
            Date of birth (DD-MM-YYYY)
          </span>
          <input type="text" value={form.dob}
            placeholder="DD-MM-YYYY"
            onChange={(e) => set('dob', e.target.value)}
            className="mt-1 w-full rounded-card border border-gray-200
              bg-white px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-bold uppercase
            tracking-wide text-sub-text">Time of birth (HH:MM)</span>
          <input type="text" value={form.tob}
            placeholder="HH:MM"
            onChange={(e) => set('tob', e.target.value)}
            className="mt-1 w-full rounded-card border border-gray-200
              bg-white px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-bold uppercase
            tracking-wide text-sub-text">AM / PM</span>
          <select value={form.ampm}
            onChange={(e) => set('ampm', e.target.value)}
            className="mt-1 w-full rounded-card border border-gray-200
              bg-white px-2 py-1 text-sm">
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-[10px] font-bold uppercase
            tracking-wide text-sub-text">Place of birth</span>
          <input type="text" value={form.place}
            onChange={(e) => set('place', e.target.value)}
            className="mt-1 w-full rounded-card border border-gray-200
              bg-white px-2 py-1 text-sm" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy}
          className="rounded-full bg-primary px-3 py-1 text-xs
            font-bold text-white disabled:opacity-60">
          {busy ? 'Saving...' : 'Save changes'}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded-full border border-gray-300 bg-white
            px-3 py-1 text-xs font-bold text-dark-text">
          Cancel
        </button>
        {msg.text && (
          <span className={`text-[11px] font-bold ${msg.kind === 'ok'
            ? 'text-success' : 'text-danger'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

// Local PdfViewerPopup so admin and customer show the SAME viewer
// surface (close + download + open-in-browser + iframe). Keep in
// sync with client-web/pages/kundli.js -> PdfViewerPopup.
function AdminPdfViewerPopup({ url, name, onClose }) {
  function download() {
    kundliService.downloadPdfFromUrl(url,
      name || 'AstroSeer-Kundli.pdf');
  }
  function openExternal() {
    try { window.open(url, '_blank'); } catch (_) { /* */ }
  }
  return (
    <div className="fixed inset-0 z-[2147483647] flex flex-col
      bg-black/80">
      <div className="flex items-center justify-between gap-2
        bg-primary px-3 py-2 text-white">
        <div className="min-w-0 flex-1 truncate text-sm font-bold">
          {name || 'Kundli PDF'}
        </div>
        <button type="button" onClick={download}
          className="rounded-full bg-white/20 px-3 py-1 text-[11px]
            font-bold hover:bg-white/30">
          Download
        </button>
        <button type="button" onClick={openExternal}
          className="rounded-full bg-white/20 px-3 py-1 text-[11px]
            font-bold hover:bg-white/30">
          Open in browser
        </button>
        <button type="button" onClick={onClose} aria-label="Close"
          className="ml-1 grid h-8 w-8 place-items-center rounded-full
            bg-white/20 text-base font-bold hover:bg-white/30">
          ×
        </button>
      </div>
      <div className="flex-1 bg-white">
        <iframe src={url} title={name || 'Kundli PDF'}
          className="h-full w-full border-0"
          style={{ minHeight: '60vh' }} />
      </div>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div className="rounded-card bg-bg-light p-2">
    <div className="text-xs text-sub-text">{label}</div>
    <div className="text-sm font-bold">{value}</div>
  </div>
);
const Row = ({ k, v }) => (
  <div className="flex flex-wrap gap-1 py-0.5 text-sm">
    <span className="w-32 shrink-0 text-sub-text">{k}</span>
    <span className="flex-1 font-semibold">{v}</span>
  </div>
);

// "Email this kundli to the customer" button. Generates the
// downloadable kundli PDF the same way the customer would (so the
// attachment matches what /orders serves), base64-encodes it, and
// queues a kundli_report_resend send via the relay's /api/emailOtp
// action:'send' endpoint. Polished AstroSeer template + signature.
function EmailKundliButton({ k, u, report, onLoad }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  // Progress modal state. step:
  //   'starting'   -> request just fired, waiting on the relay
  //   'generating' -> AstroSeer is rendering the PDF
  //   'emailing'   -> PDF uploaded, SMTP send in progress
  //   'done'       -> emailed:true, customer got the PDF
  //   'failed'     -> something blew up; `error` has the details
  // The relay returns a single JSON, so we drive 'starting' ->
  // 'emailing' optimistically off a short timer and finalize when
  // the response lands. The popup stays open until admin closes.
  const [progress, setProgress] = useState(null);
  async function send() {
    if (!u || !u.email) {
      setMsg({ text: 'No email on file for this customer.',
        kind: 'err' });
      return;
    }
    if (!k || !k.id || !k.userId) {
      setMsg({ text: 'Cannot resolve this kundli profile.',
        kind: 'err' });
      return;
    }
    setMsg({ text: '', kind: '' });
    setBusy(true);
    setProgress({ step: 'generating',
      label: 'Generating the kundli PDF on AstroSeer…' });
    // Optimistic stage bump: most kundli generations land in 8-15s;
    // flip the label so admin sees movement even before the relay
    // returns.
    const bumpT = setTimeout(() => {
      setProgress((p) => (p && p.step === 'generating'
        ? { step: 'emailing',
          label: 'PDF ready, attaching and emailing…' }
        : p));
    }, 8000);
    try {
      // Ask the relay to generate the free kundli PDF for this
      // profile + email it as a complimentary attachment. The relay
      // already handles auth (uid must own the profile), AstroSeer
      // tier-9 PDF generation, Firestore order record, AND SMTP
      // send with the polished AstroSeer signature card. We pass
      // complimentary:true so the email body reads as a gift, not a
      // routine delivery.
      const endpoint = (typeof process !== 'undefined'
        && process.env && process.env.NEXT_PUBLIC_PUSH_ENDPOINT)
        ? process.env.NEXT_PUBLIC_PUSH_ENDPOINT
          .replace(/\/sendPush\/?$/, '/kundli')
        : 'https://astro-platform-push-relay.vercel.app/api/kundli';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          kind: 'free',
          kundliProfileId: k.id,
          uid: k.userId,
          complimentary: true,
          senderNote: 'Sent to you with our compliments by the '
            + 'AstroSeer team.',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error
          || `Send failed (HTTP ${r.status}).`);
      }
      clearTimeout(bumpT);
      // After the 2026-05-27 async refactor, the relay's
      // action:'report' now returns immediately with
      // { status:'generating', orderId } when the PDF is being
      // generated in the background. The email gets sent
      // automatically when polling detects the generation
      // completed. Poll here on the admin side too so we can
      // show the final delivered state in the popup.
      if (j.status === 'generating' && j.orderId) {
        await pollComplimentaryUntilSent(j.orderId, k.userId,
          (tick, elapsedS) => {
            setProgress({ step: 'emailing',
              label: `Generating PDF, then emailing... (${elapsedS}s)`,
            });
          })
          .then((finalState) => {
            if (finalState && finalState.status === 'ready') {
              setProgress({ step: 'done',
                label: `Complimentary kundli PDF emailed to `
                  + `${u.email}.`,
                mode: 'with-attachment',
                messageId: finalState.messageId || '' });
            } else if (finalState
              && finalState.status === 'failed_refunded') {
              setProgress({ step: 'failed',
                label: 'Generation failed; wallet auto-refunded.',
                error: finalState.error
                  || 'AstroSeer reported failed.' });
            } else if (finalState && finalState.timedOut) {
              setProgress({ step: 'done',
                label: `PDF generation is taking longer than `
                  + `usual. The email will be sent to ${u.email} `
                  + `automatically when ready (no action needed).`,
                mode: 'pending' });
            } else {
              setProgress({ step: 'failed',
                label: 'Send did not complete.',
                error: (finalState && finalState.error)
                  || 'Unknown poll result.' });
            }
          });
      } else if (j.emailed) {
        // Legacy sync path (cached order returned immediately
        // with PDF + email already sent).
        const mode = j.emailMode || 'link-only';
        let label;
        if (mode === 'both') {
          label = `Two emails delivered to ${u.email}: a download `
            + 'link AND the PDF attached.';
        } else if (mode === 'with-attachment') {
          label = `Complimentary kundli PDF emailed to ${u.email}.`;
        } else {
          label = `Email delivered to ${u.email} as a download `
            + 'link. The PDF attachment was rejected by SMTP '
            + '(usually a size limit). Customer can download the '
            + 'PDF from My Orders.';
        }
        setProgress({ step: 'done', label,
          mode,
          attachmentError: j.attachmentError || '',
          linkOnlyError: j.linkOnlyError || '',
          messageId: j.messageId || '' });
      } else {
        setProgress({ step: 'failed',
          label: 'Send did not complete.',
          error: j.emailError
            || j.attachmentError
            || j.linkOnlyError
            || j.error
            || 'Relay returned no status. Try again in a minute.',
          attachmentError: j.attachmentError || '',
          linkOnlyError: j.linkOnlyError || '' });
      }
      setMsg({ text: '', kind: '' }); // inline msg replaced by popup
    } catch (e) {
      clearTimeout(bumpT);
      setProgress({ step: 'failed',
        label: 'Send failed.',
        error: e.message || 'Network or relay error.' });
    } finally { setBusy(false); }
  }

  // Polls the relay's reportStatus action every 5s for up to 5 min.
  // Calls onTick(stateObj, elapsedSeconds) every successful poll so
  // the popup can show live elapsed time. Resolves with the final
  // state object whose status is 'ready' / 'failed' / 'failed_
  // refunded', or { timedOut: true } after 5 minutes.
  async function pollComplimentaryUntilSent(orderId, userId, onTick) {
    const startMs = Date.now();
    const endpoint = (typeof process !== 'undefined'
      && process.env && process.env.NEXT_PUBLIC_PUSH_ENDPOINT)
      ? process.env.NEXT_PUBLIC_PUSH_ENDPOINT
        .replace(/\/sendPush\/?$/, '/kundli')
      : 'https://astro-platform-push-relay.vercel.app/api/kundli';
    for (let i = 0; i < 60; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reportStatus',
          uid: userId, orderId }),
      }).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      const s = r ? await r.json().catch(() => ({})) : {};
      const elapsedS = Math.round((Date.now() - startMs) / 1000);
      if (typeof onTick === 'function') {
        try { onTick(s, elapsedS); } catch (_) { /* */ }
      }
      if (s && (s.status === 'ready'
        || s.status === 'failed'
        || s.status === 'failed_refunded')) {
        return s;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 5000));
    }
    return { timedOut: true };
  }
  function closePopup() { setProgress(null); }
  return (
    <div className="flex flex-col items-end">
      <button onClick={send} disabled={busy}
        className="rounded-full border border-primary bg-white
          px-3 py-1.5 text-xs font-bold text-primary
          disabled:opacity-50">
        {busy ? 'Sending…' : 'Email complimentary kundli'}
      </button>
      {msg.text && (
        <span className={`mt-1 text-[10px] font-bold ${msg.kind === 'ok'
          ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </span>
      )}
      {progress && (
        <ComplimentaryProgressPopup p={progress}
          email={(u && u.email) || ''}
          onClose={closePopup}
          onRetry={() => { setProgress(null); send(); }} />
      )}
    </div>
  );
}

// Centered modal that walks through the stages of a complimentary
// kundli send so the admin sees PROGRESS (not just a stuck
// "Sending…" label). Surfaces the real SMTP error when the relay
// returns one, and offers a Retry button for transient failures.
function ComplimentaryProgressPopup({ p, email, onClose, onRetry }) {
  const done = p.step === 'done';
  const failed = p.step === 'failed';
  const STAGES = [
    ['generating', 'Generating PDF',
      'AstroSeer is rendering the kundli'],
    ['emailing', 'Sending email',
      'Attaching PDF and dispatching over SMTP'],
    ['done', 'Sent',
      `Email dispatched to ${email || 'their inbox'}`],
  ];
  const stageIdx = ['generating', 'emailing', 'done']
    .indexOf(p.step);
  return (
    <div className="fixed inset-0 z-[70] flex items-center
      justify-center bg-black/40 px-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-5
        shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-dark-text">
            Complimentary kundli send
          </div>
          {(done || failed) && (
            <button type="button" onClick={onClose}
              aria-label="Close"
              className="rounded-full px-2 text-lg text-sub-text">
              ×
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          {STAGES.map(([key, title, sub], i) => {
            // Once the whole flow finishes (step==='done'), treat EVERY
            // stage as complete -> green. Previously the final 'Sent'
            // step was rendered as 'active' (maroon brand colour),
            // making a successful send visually look like an in-progress
            // step. Now all three rows turn green on success.
            const isComplete = done;
            const active = !failed && !isComplete && i === stageIdx;
            const past = !failed && (isComplete || i < stageIdx);
            const cls = failed && i === stageIdx
              ? 'border-danger bg-danger/5 text-danger'
              : active ? 'border-primary bg-primary/5 text-primary'
                : past ? 'border-success bg-success/5 text-success'
                  : 'border-gray-200 bg-gray-50 text-sub-text';
            return (
              <div key={key} className={`flex items-start gap-3
                rounded-card border p-3 ${cls}`}>
                <span className="grid h-6 w-6 shrink-0
                  place-items-center rounded-full bg-white
                  text-[11px] font-bold">
                  {failed && i === stageIdx ? '!'
                    : past || done ? '✓'
                      : active ? '…' : i + 1}
                </span>
                <div className="min-w-0 text-[12px]">
                  <div className="font-bold">{title}</div>
                  <div className="opacity-80">{sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {failed && p.error && (
          <div className="mt-3 rounded-card border border-danger
            bg-danger/10 p-3 text-[12px] text-danger">
            <div className="font-bold">Why it failed:</div>
            <div className="mt-1 break-all">{p.error}</div>
            <div className="mt-2 text-[11px]">
              Open <b>/admin-email</b> to verify SMTP host / user /
              password. The PDF was generated successfully and is
              saved on the order - you can also re-trigger the
              email after fixing the settings.
            </div>
          </div>
        )}

        {done && (
          <div className="mt-3 rounded-card border border-success
            bg-success/10 p-3 text-[12px] text-success">
            <b>Sent successfully.</b>
            {p.messageId && (
              <div className="mt-1 break-all text-[11px]">
                Message-ID: {p.messageId}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {failed && (
            <button type="button" onClick={onRetry}
              className="rounded-full bg-primary px-3 py-1.5
                text-[12px] font-bold text-white">
              Retry
            </button>
          )}
          {(done || failed) && (
            <button type="button" onClick={onClose}
              className="rounded-full bg-bg-light px-3 py-1.5
                text-[12px] font-bold text-sub-text">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Device + login-session panel. Reads users/{uid} for the latest
// device fingerprint (live since setOnline stamps it on every
// connect) and the users/{uid}/sessions subcollection for history.
function DeviceSessionsPanel({ uid, u }) {
  const [hist, setHist] = useState([]);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'users', uid, 'sessions'),
          orderBy('at', 'desc'),
          limit(20)));
        setHist(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (_) {
        try {
          const snap2 = await getDocs(query(
            collection(db, 'users', uid, 'sessions'),
            limit(20)));
          setHist(snap2.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => ((b.at?.toMillis?.() || 0)
              - (a.at?.toMillis?.() || 0))));
        } catch (_2) { /* sessions collection may not exist yet */ }
      }
    })();
  }, [uid]);
  return (
    <div className="surface mt-4 p-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
        text-sub-text">Device &amp; login history</h2>
      <Row k="Last IP" v={u.lastIp || '-'} />
      <Row k="Last user agent"
        v={(u.lastUserAgent || '-').slice(0, 120)
          + ((u.lastUserAgent || '').length > 120 ? '…' : '')} />
      <Row k="Platform" v={u.lastPlatform || '-'} />
      <Row k="Screen" v={u.lastScreen || '-'} />
      <Row k="Language" v={u.lastLanguage || '-'} />
      <Row k="Last seen" v={fmt(u.lastSeenAt || u.lastSeen)} />
      <div className="mt-3">
        <div className="mb-1 text-[11px] font-bold uppercase
          tracking-wide text-sub-text">
          Login history ({hist.length})
        </div>
        {hist.length === 0 ? (
          <div className="text-xs text-sub-text">
            No login history recorded yet (sessions are stamped on
            every connect once the user opens the app after this
            change is live).
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">IP</th>
                <th className="py-1 pr-3">Platform</th>
                <th className="py-1">User agent</th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id} className="border-t border-white">
                  <td className="py-1 pr-3 font-mono">{fmt(h.at)}</td>
                  <td className="py-1 pr-3 font-mono">{h.ip || '·'}</td>
                  <td className="py-1 pr-3">{h.platform || '·'}</td>
                  <td className="py-1">
                    {(h.ua || '-').slice(0, 80)}
                    {(h.ua || '').length > 80 ? '…' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Compact in-page summary of a generated kundli (full detail is in the
// downloadable PDF). Shows the key Vedic markers + personality snippet.
function KundliSummary({ r }) {
  const n = (r && r.narrative) || {};
  return (
    <div className="mt-2 rounded-card bg-bg-light p-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><span className="text-sub-text">Ascendant</span><br />
          <b>{(r.ascendant && r.ascendant.sign) || r.zodiac || '-'}</b></div>
        <div><span className="text-sub-text">Nakshatra</span><br />
          <b>{r.nakshatra || '-'}</b></div>
        <div><span className="text-sub-text">Moon sign</span><br />
          <b>{r.chandra_rasi || '-'}</b></div>
        <div><span className="text-sub-text">Sun sign</span><br />
          <b>{r.soorya_rasi || '-'}</b></div>
      </div>
      {n.personality && (
        <p className="mt-2 text-dark-text">{n.personality}</p>
      )}
      <p className="mt-1 text-[11px] text-sub-text">
        Download the PDF for the complete multi-page report.
      </p>
    </div>
  );
}
