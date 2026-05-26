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
    setReports((c) => ({ ...c, [k.id]: 'loading' }));
    try {
      const data = await kundliService.getFullKundli(k);
      setReports((c) => ({ ...c, [k.id]: data || 'err' }));
    } catch (_) { setReports((c) => ({ ...c, [k.id]: 'err' })); }
  }
  async function downloadReport(k) {
    let data = reports[k.id];
    if (!data || typeof data !== 'object') {
      data = await kundliService.getFullKundli(k).catch(() => null);
      if (data) setReports((c) => ({ ...c, [k.id]: data }));
    }
    kundliService.downloadKundliReport(k, data || {});
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
            {u.userCode ? ` · Code ${u.userCode}` : ''}
            {' · ID '}<span className="font-mono">{id}</span>
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

      {/* PROFILE / KUNDLI */}
      <div className="surface mt-4 p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">Profile</h2>
        <Row k="Gender" v={u.gender || '-'} />
        <Row k="DOB" v={u.dob || '-'} />
        <Row k="Birth time" v={u.tob || u.timeOfBirth || '-'} />
        <Row k="Birth place" v={u.placeOfBirth || u.place || '-'} />
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
                      {k.dob} · {k.tob} {k.ampm} · {k.place}
                      {/* Zodiac (sun sign by DOB) intentionally
                          omitted — that's a horoscope concept, not
                          a kundli identifier. Moon sign + Lagna
                          live inside the generated report. */}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => viewReport(k)}
                      className="rounded-full bg-bg-light px-3 py-1.5
                        text-xs font-bold text-primary">
                      View
                    </button>
                    <button onClick={() => downloadReport(k)}
                      className="rounded-full bg-primary px-3 py-1.5
                        text-xs font-bold text-white">
                      ⬇ PDF
                    </button>
                    <EmailKundliButton k={k} u={u}
                      report={reports[k.id]}
                      onLoad={() => viewReport(k)} />
                  </div>
                </div>
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
    </Layout>
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
      if (j.emailed) {
        const linkOnly = j.emailMode === 'link-only';
        setProgress({ step: 'done',
          label: linkOnly
            ? `Email delivered to ${u.email} as a download link `
              + '(SMTP rejected the attachment — usually a size '
              + 'limit). Customer can grab the PDF from My Orders.'
            : `Complimentary kundli PDF emailed to ${u.email}.`,
          mode: j.emailMode || 'with-attachment',
          firstAttemptError: j.emailFirstAttemptError || '',
          messageId: j.messageId || '' });
      } else {
        setProgress({ step: 'failed',
          label: 'PDF generated but the email send failed.',
          error: j.emailError
            || 'No reason returned by the relay.',
          firstAttemptError: j.emailFirstAttemptError || '' });
      }
      setMsg({ text: '', kind: '' }); // inline msg replaced by popup
    } catch (e) {
      clearTimeout(bumpT);
      setProgress({ step: 'failed',
        label: 'Send failed.',
        error: e.message || 'Network or relay error.' });
    } finally { setBusy(false); }
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
    ['done', 'Delivered',
      `Customer received the email at ${email || 'their inbox'}`],
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
            const active = !failed && i === stageIdx;
            const past = !failed && i < stageIdx;
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
              saved on the order — you can also re-trigger the
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
