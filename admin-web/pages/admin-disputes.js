import { useEffect, useState } from 'react';
import {
  adminService, sessionService, userService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { REFUND_REASONS, sessionRefNo } = sessionService;

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function fmtDur(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return '0m';
  const m = Math.floor(s / 60); const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m${r ? ` ${r}s` : ''}` : `${r}s`;
}

export default function AdminDisputes() {
  const { user, loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [meta, setMeta] = useState({}); // sessionId -> {client, astro}
  // Manual-refund modal (admin can refund any session by id)
  const [mrOpen, setMrOpen] = useState(false);
  const [mrSid, setMrSid] = useState('');
  const [mrReason, setMrReason] = useState(REFUND_REASONS[0]);
  const [mrBusy, setMrBusy] = useState(false);

  async function load() { setRows(await adminService.getAllDisputes()); }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  // Live pending refund queue.
  useEffect(() => {
    if (loading) return undefined;
    return sessionService.listenPendingRefunds(async (list) => {
      setRefunds(list);
      const need = list.filter((s) => !meta[s.id]);
      const updates = await Promise.all(need.map(async (s) => {
        try {
          const [u, a] = await Promise.all([
            s.userId ? userService.getUser(s.userId) : null,
            s.astroId ? astrologerService.getAstrologer(s.astroId) : null,
          ]);
          return [s.id, {
            client: (u && (u.name || u.email)) || 'Customer',
            astro: (a && (a.name || a.displayName)) || 'Astrologer',
          }];
        } catch (_) {
          return [s.id, { client: 'Customer', astro: 'Astrologer' }];
        }
      }));
      if (updates.length) {
        setMeta((m) => ({ ...m, ...Object.fromEntries(updates) }));
      }
    });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function processOne(s) {
    /* eslint-disable no-alert */
    if (!window.confirm(
      `Refund ₹${s.cost || 0} to ${(meta[s.id] || {}).client
        || 'customer'} for session #${sessionRefNo(s)}?`)) return;
    try {
      const r = await sessionService.processRefund(s.id, user.uid);
      flash(r.already ? 'Already processed'
        : `Refunded ₹${r.refunded}`);
    } catch (e) { flash('Could not process: ' + (e.message || 'error')); }
    /* eslint-enable no-alert */
  }

  async function submitManualRefund() {
    if (!mrSid.trim()) return;
    setMrBusy(true);
    try {
      await sessionService.requestRefund(
        mrSid.trim(), user.uid, 'admin', mrReason);
      const r = await sessionService.processRefund(
        mrSid.trim(), user.uid);
      flash(r.refunded > 0 ? `Refunded ₹${r.refunded}`
        : 'No refundable amount on that session');
      setMrOpen(false); setMrSid(''); setMrReason(REFUND_REASONS[0]);
    } catch (e) { flash('Failed: ' + (e.message || 'error')); }
    setMrBusy(false);
  }

  async function resolve(d) {
    /* eslint-disable no-alert */
    const resolution = prompt('Resolution note:') || '';
    const refund = Number(prompt('Refund amount ₹ (0 for none):') || 0);
    /* eslint-enable no-alert */
    await adminService.resolveDispute(d.id, resolution, refund);
    load();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <h1 className="text-xl font-bold">Disputes &amp; Refunds</h1>
        <button onClick={() => setMrOpen(true)}
          className="rounded-full bg-danger px-4 py-1.5 text-sm
            font-bold text-white">
          ↩ Refund a session by ID
        </button>
      </div>

      {/* PENDING REFUND REQUESTS */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Pending refund requests ({refunds.length})
        </h2>
        <div className="space-y-2">
          {refunds.length === 0 && (
            <div className="card text-sub-text">
              No pending refund requests.
            </div>
          )}
          {refunds.map((s) => {
            const m = meta[s.id] || {};
            const rr = s.refundRequest || {};
            return (
              <div key={s.id} className="card">
                <div className="flex flex-wrap items-center
                  justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {m.astro || 'Astrologer'} ↔ {m.client || 'Customer'}
                    </div>
                    <div className="text-xs text-sub-text">
                      {s.type} · {fmt(s.startTime || s.createdAt)} ·{' '}
                      {fmtDur(s.duration)} ·{' '}
                      <span className="font-mono">#{sessionRefNo(s)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">₹{s.cost || 0}</div>
                    <div className="text-[10px] uppercase text-amber-700">
                      requested by {rr.byRole || 'astrologer'}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-sm">
                  <b>Reason:</b> {rr.reason || '-'}
                </p>
                <button onClick={() => processOne(s)}
                  className="btn-primary mt-2">
                  Process refund · credit ₹{s.cost || 0}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* TICKET-STYLE DISPUTES */}
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
          text-sub-text">
          Open disputes
        </h2>
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="card text-sub-text">No disputes.</div>
          )}
          {rows.map((d) => (
            <div key={d.id} className="card">
              <div className="flex justify-between">
                <span className="font-semibold capitalize">{d.status}</span>
                <span className="text-xs text-sub-text">
                  Session #{sessionRefNo(d.sessionId || '')}
                </span>
              </div>
              <p className="mt-1 text-sm">{d.issue}</p>
              {d.resolution && (
                <p className="mt-1 text-sm text-success">
                  Resolved: {d.resolution} (refund ₹{d.refundAmount || 0})
                </p>
              )}
              {d.status !== 'resolved' && (
                <button onClick={() => resolve(d)}
                  className="btn-primary mt-2">Resolve</button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Manual refund-by-ID modal */}
      {mrOpen && (
        <div className="fixed inset-0 z-50 flex items-center
          justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-4">
            <h3 className="text-lg font-bold">Refund a session</h3>
            <label className="mt-3 block text-sm font-semibold">
              Session ID (or Ref like ABC123)
              <input value={mrSid} className="input mt-1"
                onChange={(e) => setMrSid(e.target.value)}
                placeholder="session id from the sessions list" />
            </label>
            <label className="mt-3 block text-sm font-semibold">
              Reason
              <select className="input mt-1" value={mrReason}
                onChange={(e) => setMrReason(e.target.value)}>
                {REFUND_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-sub-text">
              This instantly credits the full session cost to the
              customer wallet and logs the action.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setMrOpen(false)} disabled={mrBusy}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={submitManualRefund} disabled={mrBusy}
                className="flex-1 rounded-full bg-danger px-4 py-2
                  font-bold text-white disabled:opacity-60">
                {mrBusy ? 'Working…' : 'Refund now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
