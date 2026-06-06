import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  kundliService, userService, db, emailService, pushService,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin-side view of every kundli PDF order across every customer.
// Filterable by status + report kind + search-by-name/email. Each row
// drills down to the customer profile and shows the PDF status,
// download link, and amount paid.

// Render a structured place ({label, city, state, country, ...})
// as a plain string. Older orders stored the place as a string,
// newer ones store the full object - both must render cleanly
// instead of "[object Object]".
function placeStr(p) {
  if (!p) return '';
  if (typeof p === 'string') return p;
  if (typeof p === 'object') {
    return p.label || p.place || p.name
      || [p.city, p.state, p.country].filter(Boolean).join(', ');
  }
  return '';
}

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : Number(ts) || 0;
    if (!ms) return '·';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '·'; }
}

const STATUS_CHIP = {
  ready: 'bg-success/10 text-success',
  paid_generating: 'bg-warning/10 text-warning',
  free_generating: 'bg-warning/10 text-warning',
  failed: 'bg-danger/10 text-danger',
  failed_refunded: 'bg-danger/10 text-danger',
};
const STATUS_LABEL = {
  ready: 'Ready',
  paid_generating: 'Generating…',
  free_generating: 'Generating…',
  failed: 'Failed',
  failed_refunded: 'Failed (refunded)',
};

const KIND_LABEL = {
  free: 'Free Vedic Kundli',
  forecast12: '12-Month Forecast',
  careerFinance: 'Career & Finance',
  lifetime: 'Lifetime Report',
};

export default function AdminOrders() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [usersById, setUsersById] = useState({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  useEffect(() => {
    (async () => {
      const list = await kundliService.listAllOrdersAdmin();
      setRows(list);
      // Fetch each unique customer once for the display row + drilldown.
      const uniq = [...new Set(list.map((o) => o.userId).filter(Boolean))];
      const fetched = {};
      await Promise.all(uniq.map(async (uid) => {
        try {
          const s = await getDoc(doc(db, 'users', uid));
          if (s.exists()) fetched[uid] = { id: s.id, ...s.data() };
        } catch (_) {}
      }));
      setUsersById(fetched);
    })();
  }, []);

  // Direct lookup by Order ID. When the search box contains an
  // 8-digit number (the new mintOrderId format) we fire a
  // collectionGroup query against orders and merge any hit into
  // the displayed rows. Lets admin find an order by its receipt
  // number even when it falls outside the 500-row default page.
  const [extra, setExtra] = useState([]);
  useEffect(() => {
    const term = search.trim();
    if (!/^\d{8,}$/.test(term)) { setExtra([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { collectionGroup, query, where, getDocs, limit }
          = await import('firebase/firestore');
        // Firestore doesn't expose direct collectionGroup lookup
        // by document id without a `where('__name__', ...)` clause
        // which has its own path requirements. Easier path: scan
        // collectionGroup with a small limit, then filter to the
        // exact id. Sufficient for an 8-digit needle in a small
        // haystack until we have millions of orders.
        const snap = await getDocs(query(collectionGroup(db,
          'orders'), limit(1000)));
        const match = snap.docs.find((d) => d.id === term);
        if (match && !cancelled) {
          const p = match.ref.parent.parent;
          setExtra([{ id: match.id, userId: p ? p.id : '',
            ...match.data() }]);
        } else if (!cancelled) {
          setExtra([]);
        }
        // Fetch the customer doc for the matched order so the
        // table row shows their name + email.
        if (match && !cancelled) {
          const p = match.ref.parent.parent;
          if (p && !usersById[p.id]) {
            const s = await getDoc(doc(db, 'users', p.id));
            if (s.exists()) {
              setUsersById((u) => ({ ...u,
                [p.id]: { id: s.id, ...s.data() } }));
            }
          }
        }
      } catch (_) { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [search]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = search.trim().toLowerCase();
    // Merge in any direct-lookup hits that aren't already in the
    // loaded page, then de-duplicate by id.
    const all = rows.slice();
    if (extra && extra.length) {
      const have = new Set(all.map((o) => o.id));
      extra.forEach((o) => { if (!have.has(o.id)) all.push(o); });
    }
    return all.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (kindFilter && o.kind !== kindFilter) return false;
      if (!term) return true;
      const u = usersById[o.userId] || {};
      return (
        (u.name || '').toLowerCase().includes(term)
        || (u.email || '').toLowerCase().includes(term)
        || (o.profileName || '').toLowerCase().includes(term)
        || String(o.id || '').toLowerCase().includes(term)
        || String(o.userId || '').toLowerCase().includes(term)
      );
    });
  }, [rows, extra, search, statusFilter, kindFilter, usersById]);

  if (loading || !rows) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const totalRevenue = rows
    .filter((o) => o.status === 'ready' && o.amount > 0)
    .reduce((s, o) => s + Number(o.amount || 0), 0);
  const totalFree = rows.filter((o) => o.amount === 0
    && (o.status === 'ready' || o.kind === 'free')).length;
  const totalFailed = rows.filter((o) =>
    o.status === 'failed' || o.status === 'failed_refunded').length;

  return (
    <Layout>
      <h1 className="mb-1 text-2xl font-bold">Order Management</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every kundli PDF order across the customer base. Click any row
        to drill into the customer profile, regenerate or refund.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total orders" value={rows.length} />
        <Stat label="Revenue (₹)" value={totalRevenue.toFixed(0)}
          highlight />
        <Stat label="Free reports" value={totalFree} />
        <Stat label="Failed" value={totalFailed}
          danger={totalFailed > 0} />
      </div>

      <div className="surface mb-3 grid gap-2 p-3 sm:grid-cols-3">
        <input className="input" placeholder="Search by name, email,
          profile, or paste 8-digit Order ID (e.g. 10000023)..."
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="paid_generating">Generating (paid)</option>
          <option value="free_generating">Generating (free)</option>
          <option value="failed">Failed</option>
          <option value="failed_refunded">Failed (refunded)</option>
        </select>
        <select className="input" value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">All report types</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="surface p-4 text-center text-sub-text">
          No orders match your filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const u = usersById[o.userId] || {};
            const at = o.paidAt && o.paidAt.toDate
              ? o.paidAt.toDate() : null;
            const href = o.pdfBase64
              ? `data:application/pdf;base64,${o.pdfBase64}`
              : (o.pdfUrl && o.pdfUrl !== 'inline' ? o.pdfUrl : '');
            return (
              <div key={o.id} className="surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {KIND_LABEL[o.kind] || o.kind || 'Report'}
                    </div>
                    <div className="text-xs text-sub-text">
                      Order <span className="font-mono">{o.id}</span>
                      {at ? ` · ${fmt(o.paidAt)}` : ''}
                    </div>
                    {/* Customer block */}
                    <div className="mt-2 rounded-card bg-bg-light p-2
                      text-xs">
                      <div className="font-bold">
                        {u.name || '(unknown customer)'}
                        {u.email && (
                          <span className="ml-1 text-sub-text">
                            ({u.email})
                          </span>
                        )}
                      </div>
                      <div className="text-sub-text">
                        UID <span className="font-mono">{o.userId}</span>
                        {u.phone ? ` · ${u.phone}` : ''}
                        {u.wallet != null ? ` · ₹${u.wallet} wallet`
                          : ''}
                      </div>
                      {(u.lastIp || u.lastUserAgent) && (
                        <div className="mt-0.5 text-sub-text">
                          Last seen: {u.lastIp || '·'}
                          {u.lastUserAgent
                            ? ` · ${(u.lastUserAgent).slice(0, 60)}…`
                            : ''}
                        </div>
                      )}
                      <Link
                        href={`/admin-user-profile/${o.userId}`}
                        className="mt-1 inline-block font-bold
                          text-primary underline">
                        Open full customer profile →
                      </Link>
                    </div>
                    {/* Profile / chart used to generate the report */}
                    {(o.profileName || o.profileDob) && (
                      <div className="mt-2 text-xs text-sub-text">
                        <b>Chart used:</b> {o.profileName}
                        {o.profileDob ? ` · DOB ${o.profileDob}` : ''}
                        {o.profileTob ? ` · ${o.profileTob}` : ''}
                        {o.profileAmpm ? ` ${o.profileAmpm}` : ''}
                        {placeStr(o.profilePlace)
                          ? ` · ${placeStr(o.profilePlace)}` : ''}
                      </div>
                    )}
                    {o.failureReason && (
                      <div className="mt-2 rounded-card bg-danger/10
                        p-2 text-xs text-danger">
                        Failure: {o.failureReason}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`inline-block rounded-full px-2
                      py-0.5 text-[10px] font-bold ${
                        STATUS_CHIP[o.status] || 'bg-bg-light '
                        + 'text-sub-text'}`}>
                      {STATUS_LABEL[o.status] || o.status || '·'}
                    </span>
                    <div className="mt-1 text-sm font-bold">
                      {o.amount > 0 ? `₹${o.amount}` : 'Free'}
                    </div>
                    {o.status === 'ready' && href && (
                      <>
                        <button type="button"
                          onClick={() =>
                            kundliService.downloadPdfFromUrl(href,
                              o.pdfName || 'AstroSeer-Kundli.pdf')}
                          className="mt-2 block rounded-full
                            bg-primary px-3 py-1 text-[11px]
                            font-bold text-white">
                          Download PDF
                        </button>
                        <ResendButtons o={o} u={u}
                          href={href} />
                      </>
                    )}
                    {/* Regenerate works for ANY order status (Ready,
                        Generating, Failed) - re-runs the same relay
                        path with regenerate:true, which gives admin a
                        one-click way to recover stuck or stale PDFs
                        from inside Order Management. */}
                    <RegenerateButton o={o} u={u} />
                    {/* Manual upload - operator pulls the PDF from
                        AstroSeer manually (when it's marked SENT in
                        the API but our auto-flow couldn't deliver)
                        and attaches it here. If the order was
                        previously refunded, the modal offers to
                        re-debit the wallet in the same submit. */}
                    <ManualUploadButton o={o}
                      onDone={() => setTimeout(() => {
                        try { window.location.reload(); }
                        catch (_) {}
                      }, 700)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* The ManualUploadModal is mounted by the button itself, so
          there is nothing extra to render at the page root. */}
    </Layout>
  );
}

// Inline "Upload PDF" button + the modal it opens. Lives next to the
// Regenerate button on every order row. On submit the modal POSTs to
// /api/kundli?action=manualUploadReport with the operator's Firebase
// token; the relay verifies admin role, stores the PDF in R2 at the
// same rescue key the auto-rescue uses, optionally re-debits the
// wallet, marks the order ready, and emails + pushes the customer.
function ManualUploadButton({ o, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1 block w-full rounded-full border
          border-primary bg-white px-3 py-1 text-[11px]
          font-bold text-primary hover:bg-primary/10">
        Upload PDF
      </button>
      {open && (
        <ManualUploadModal o={o}
          onClose={() => setOpen(false)}
          onSuccess={() => { setOpen(false); onDone && onDone(); }} />
      )}
    </>
  );
}

function ManualUploadModal({ o, onClose, onSuccess }) {
  const amount = Number(o.amount || 0);
  const wasRefunded = o.status === 'failed_refunded';
  const [file, setFile] = useState(null);
  const [redebit, setRedebit] = useState(wasRefunded && amount > 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(null);

  async function submit() {
    if (!file) { setMsg('Please choose a PDF file.'); return; }
    if (file.type !== 'application/pdf'
      && !/\.pdf$/i.test(file.name)) {
      setMsg('File must be a PDF.'); return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setMsg('PDF must be under 25 MB.'); return;
    }
    // Belt + braces: confirm the re-debit decision before charging.
    if (wasRefunded && amount > 0) {
      const confirmed = window.confirm(
        redebit
          ? `Re-debit ${'₹'}${amount} from the customer's wallet `
            + 'now? (They were refunded earlier when the order '
            + 'looked failed.)'
          : 'Upload WITHOUT re-debiting? The customer will receive '
            + 'this report as goodwill (no wallet movement).');
      if (!confirmed) return;
    }
    setBusy(true); setMsg('');
    try {
      const { auth } = await import('@astro/shared');
      const cur = auth && auth.currentUser;
      const idToken = cur && await cur.getIdToken();
      const base = (typeof process !== 'undefined' && process.env
        && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
      const kundliUrl = (base
        || 'https://astro-platform-push-relay.vercel.app/api/sendPush')
        .replace(/\/sendPush\/?$/, '/kundli');
      // Step 1: ask the relay for a presigned R2 PUT URL. This
      // sidesteps Vercel's 4.5 MB function body limit - the PDF
      // never travels through the relay, it goes browser -> R2
      // direct.
      setMsg('Preparing upload...');
      const presignResp = await fetch(
        `${kundliUrl}?action=presignManualUpload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ orderId: o.id }),
        });
      const presignJ = await presignResp.json().catch(() => ({}));
      if (!presignResp.ok || !presignJ.uploadUrl) {
        setMsg(presignJ.error
          || `Could not prepare upload (HTTP ${presignResp.status}).`);
        setBusy(false); return;
      }
      // Step 2: PUT the file to R2 directly. No size limit
      // applies here - this hits Cloudflare R2's edge, not Vercel.
      setMsg(`Uploading ${(file.size / 1024).toFixed(0)} KB to R2...`);
      const putResp = await fetch(presignJ.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      });
      if (!putResp.ok) {
        setMsg(`R2 upload rejected (HTTP ${putResp.status}).`);
        setBusy(false); return;
      }
      // Step 3: tell the relay to finalise the order - mark ready,
      // re-debit if requested, email + push the customer. The body
      // is tiny now; only the orderId / uid / pdfUrl / redebit
      // flags travel through Vercel.
      setMsg('Finalising order...');
      const finalResp = await fetch(
        `${kundliUrl}?action=manualUploadReport`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            orderId: o.id, uid: o.userId,
            pdfUrl: presignJ.publicUrl,
            redebit: !!redebit,
          }),
        });
      const finalJ = await finalResp.json().catch(() => ({}));
      if (!finalResp.ok) {
        setMsg(finalJ.error
          || `Finalise failed (HTTP ${finalResp.status}).`);
        setBusy(false); return;
      }
      setMsg('');
      setDone(finalJ); setBusy(false);
    } catch (e) {
      setMsg(String((e && e.message) || e));
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-card bg-white p-5
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">
          {done ? 'Uploaded' : 'Manual report upload'}
        </h3>
        <p className="mt-1 text-xs text-sub-text">
          Order <span className="font-mono">{o.id}</span>{' '}
          {'·'} {o.kind || 'report'} {'·'}{' '}
          {amount > 0 ? `₹${amount}` : 'free'}{' '}
          {wasRefunded && (
            <span className="font-semibold text-amber-700">
              {'· '}previously refunded
            </span>
          )}
        </p>
        {done ? (
          <div className="mt-4 space-y-2 text-sm">
            <div className="rounded-card bg-emerald-50 p-3
              text-emerald-700">
              <div className="font-bold">
                PDF delivered. Order now Ready.
              </div>
              <div className="mt-1 text-xs">
                <a href={done.pdfUrl} target="_blank"
                  rel="noreferrer" className="underline">
                  Open PDF
                </a>
              </div>
            </div>
            {done.redebited && (
              <div className="rounded-card bg-amber-50 p-3 text-xs
                text-amber-800">
                Re-debited ₹{done.redebitedAmount} from wallet
                (previously refunded).
              </div>
            )}
            <div className="rounded-card border border-gray-200 p-3
              text-xs text-sub-text">
              Customer notification + push fired. Email sent.
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => { onClose(); onSuccess(); }}
                className="rounded-full bg-bg-light px-4 py-2
                  text-sm font-semibold">Done</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className={`rounded-card p-3 text-xs ${wasRefunded
              ? 'bg-amber-50 text-amber-800'
              : 'bg-bg-light/60 text-sub-text'}`}>
              {wasRefunded
                ? `This order was refunded ${'₹'}${amount} earlier. `
                  + 'If the report has been delivered now, tick '
                  + '"Re-debit wallet" to charge the customer again.'
                : 'Order is currently '
                  + (o.status === 'paid_generating'
                    ? 'generating' : o.status)
                  + '. Upload alone will deliver the PDF.'}
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                PDF file (max 25 MB)
              </span>
              <input className="mt-1 block w-full text-sm"
                type="file" accept="application/pdf,.pdf"
                onChange={(e) => setFile(
                  e.target.files && e.target.files[0])} />
              {file && (
                <div className="mt-1 text-[11px] text-sub-text">
                  {file.name} {'·'}{' '}
                  {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </label>
            {wasRefunded && amount > 0 && (
              <label className="flex items-start gap-2 rounded-card
                border border-amber-300 bg-amber-50 p-2">
                <input type="checkbox" checked={redebit}
                  onChange={(e) => setRedebit(e.target.checked)}
                  className="mt-0.5" />
                <span className="text-xs text-amber-900">
                  Re-debit ₹{amount} from the customer's wallet now
                  (refund will be undone). Untick to deliver as
                  goodwill with no wallet movement.
                </span>
              </label>
            )}
            {msg && (
              <div className="rounded-card bg-danger/10 p-2 text-xs
                font-semibold text-danger">{msg}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={busy}
                className="rounded-full bg-bg-light px-4 py-2
                  text-sm font-semibold">Cancel</button>
              <button onClick={submit}
                disabled={busy || !file}
                className="rounded-full bg-primary px-4 py-2 text-sm
                  font-bold text-white disabled:opacity-60">
                {busy ? 'Uploading...' : 'Upload + deliver'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Resend the kundli to the customer via email (with the PDF
// attached) or via push notification. The buttons sit next to the
// Download PDF action and surface success/failure inline so the
// admin can see whether the send actually completed.
function ResendButtons({ o, u, href }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const KIND_LABEL = {
    free: 'Free Vedic Kundli',
    forecast12: '12-Month Vedic Forecast',
    careerFinance: 'Career & Finance Report',
    lifetime: 'Lifetime Vedic Report',
  };
  async function emailIt() {
    if (!u || !u.email) {
      setMsg({ text: 'No email on file for this customer.',
        kind: 'err' });
      return;
    }
    setBusy('email'); setMsg({ text: '', kind: '' });
    try {
      // Base64-encode inline PDF for the attachment.
      let attachment = null;
      if (o.pdfBase64) {
        attachment = {
          filename: o.pdfName || 'AstroSeer-Kundli.pdf',
          contentBase64: o.pdfBase64,
          contentType: 'application/pdf',
        };
      } else if (o.pdfUrl && o.pdfUrl !== 'inline') {
        // Fetch the PDF then base64-encode. Keeps the email
        // self-contained even if the URL expires later.
        try {
          const r = await fetch(o.pdfUrl);
          const buf = await r.arrayBuffer();
          const b64 = btoa(String.fromCharCode(
            ...new Uint8Array(buf)));
          attachment = {
            filename: o.pdfName || 'AstroSeer-Kundli.pdf',
            contentBase64: b64,
            contentType: 'application/pdf',
          };
        } catch (_) { /* attachment-less is acceptable */ }
      }
      await emailService.sendEmail({
        to: u.email,
        kind: 'kundli_report_resend',
        vars: {
          name: u.name || 'there',
          profileName: o.profileName || '',
          kindLabel: KIND_LABEL[o.kind] || 'Vedic Kundli Report',
          ordersUrl: 'https://astroseer.in/orders',
        },
        attachment,
      });
      setMsg({ text: `Emailed to ${u.email}`, kind: 'ok' });
    } catch (e) {
      setMsg({ text: e.message || 'Email send failed.',
        kind: 'err' });
    } finally { setBusy(''); }
  }
  async function pushIt() {
    if (!u || !u.id) {
      setMsg({ text: 'No user record.', kind: 'err' });
      return;
    }
    setBusy('push'); setMsg({ text: '', kind: '' });
    try {
      await pushService.sendPushToUser({
        userId: u.id,
        notification: {
          title: 'Your kundli report is ready',
          body: `Tap to open ${o.profileName || 'your chart'} in My Orders.`,
        },
        data: { type: 'kundli_report', orderId: o.id, deeplink: '/orders' },
      });
      setMsg({ text: 'Push sent.', kind: 'ok' });
    } catch (e) {
      setMsg({ text: e.message || 'Push send failed.', kind: 'err' });
    } finally { setBusy(''); }
  }
  return (
    <div className="mt-2 flex flex-col items-end gap-1">
      <button type="button" onClick={emailIt}
        disabled={busy === 'email'}
        className="rounded-full border border-primary bg-white
          px-3 py-1 text-[11px] font-bold text-primary
          disabled:opacity-50">
        {busy === 'email' ? 'Sending…' : 'Resend via Email'}
      </button>
      <button type="button" onClick={pushIt}
        disabled={busy === 'push'}
        className="rounded-full border border-primary bg-white
          px-3 py-1 text-[11px] font-bold text-primary
          disabled:opacity-50">
        {busy === 'push' ? 'Sending…' : 'Resend via Push'}
      </button>
      {msg.text && (
        <div className={`text-[10px] font-bold ${msg.kind === 'ok'
          ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// One-click regenerate. Calls kundliService.requestReport with the
// SAME relay path the customer uses, plus regenerate:true so the
// cached order is rebuilt from scratch. On success, reloads the page
// to pick up the new pdfUrl + Ready status. Failed orders also use
// this path - it always works because the relay now has the stuck-
// order sweeper that refunds + clears stale "Generating..." rows
// before generating fresh.
function RegenerateButton({ o, u }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  async function regen() {
    if (!o || !o.kundliProfileId || !o.userId) {
      setMsg({ text: 'Missing profile or user id.', kind: 'err' });
      return;
    }
    setBusy(true); setMsg({ text: '', kind: '' });
    try {
      await kundliService.requestReport({
        uid: o.userId,
        kundliProfileId: o.kundliProfileId,
        kind: o.kind || 'free',
        regenerate: true,
      });
      setMsg({ text: 'Regenerated. Refreshing...', kind: 'ok' });
      setTimeout(() => { try { window.location.reload(); }
        catch (_) {} }, 700);
    } catch (e) {
      setMsg({ text: e.message || 'Regenerate failed.', kind: 'err' });
    } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" onClick={regen} disabled={busy}
        className="rounded-full border border-accent bg-white
          px-3 py-1 text-[11px] font-bold text-accent disabled:opacity-50">
        {busy ? 'Regenerating...' : 'Regenerate'}
      </button>
      {msg.text && (
        <div className={`text-[10px] font-bold ${msg.kind === 'ok'
          ? 'text-success' : 'text-danger'}`}>
          {msg.text}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, highlight, danger }) {
  return (
    <div className={`surface p-3 ${danger ? 'border border-danger/30'
      : highlight ? 'border border-primary/30' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide
        text-sub-text">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${danger
        ? 'text-danger' : highlight ? 'text-primary' : ''}`}>
        {value}
      </div>
    </div>
  );
}
