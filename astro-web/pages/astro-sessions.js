import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { sessionService, userService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const { REFUND_REASONS, sessionRefNo } = sessionService;

function refundChip(s) {
  const rr = s.refundRequest;
  if (!rr) return null;
  if (rr.status === 'processed') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5
      text-[10px] font-bold text-emerald-700">Refunded</span>;
  }
  if (rr.status === 'pending') {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5
      text-[10px] font-bold text-amber-700">Refund pending</span>;
  }
  return null;
}

export default function AstroSessions() {
  const router = useRouter();
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState(false);
  // Refund modal state
  const [rfSession, setRfSession] = useState(null);
  const [rfReason, setRfReason] = useState(REFUND_REASONS[0]);
  const [rfNote, setRfNote] = useState('');
  const [rfBusy, setRfBusy] = useState(false);
  // Themed post-action banner (replaces window.alert) — disappears
  // after 6s on success, sticks until dismissed on error.
  const [toast, setToast] = useState(null);

  async function load() {
    const list = await sessionService.getAstrologerSessions(user.uid);
    const withNames = await Promise.all(list.map(async (s) => ({
      ...s, client: (await userService.getUser(s.userId))?.name,
    })));
    setRows(withNames);
  }
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ },
    [user]);

  async function submitRefund() {
    if (!rfSession) return;
    setRfBusy(true);
    try {
      const reason = rfReason === 'Other' && rfNote.trim()
        ? `Other: ${rfNote.trim()}` : rfReason;
      const r = await sessionService.instantRefund(rfSession.id, reason);
      setRfSession(null); setRfNote(''); setRfReason(REFUND_REASONS[0]);
      await load();
      const msg = r.ok
        ? (r.already
          ? 'This session was already refunded.'
          : `Refund processed instantly. ₹${r.refunded} credited to the `
            + 'customer wallet. Admin has been notified for records.')
        : 'Refund queued — admin will process within a few minutes.';
      setToast({ kind: 'ok', msg });
      setTimeout(() => setToast(null), 6000);
    } catch (e) {
      setToast({ kind: 'err',
        msg: `Could not submit the refund: ${e.message || 'error'}` });
    }
    setRfBusy(false);
  }

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const cutoff = Date.now() - 7 * 7 * 864e5;
  const shown = all ? rows : rows.filter((s) =>
    s.createdAt?.toDate && s.createdAt.toDate().getTime() >= cutoff);

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">My Sessions</h1>
      {toast && (
        <div className={`mb-3 flex items-start justify-between rounded-card
            p-3 text-sm shadow-sm ${toast.kind === 'err'
              ? 'border border-rose-200 bg-rose-50 text-rose-800'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <span className="pr-2">{toast.msg}</span>
          <button onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="shrink-0 text-current/60 hover:text-current">✕</button>
        </div>
      )}
      <div className="surface overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Client</th><th className="p-2">Type</th>
              <th className="p-2">Dur</th><th className="p-2">Gross</th>
              <th className="p-2">Earned</th><th className="p-2">Status</th>
              <th className="p-2">Ref</th><th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const rr = s.refundRequest;
              // Show on any past consultation (not actively in progress
              // / not already refunded). The modal handles edge cases
              // (zero cost, etc.) with clear messaging.
              const inProgress = s.status === 'requesting'
                || s.status === 'active';
              const canRefund = !inProgress
                && (!rr || rr.status !== 'processed');
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.client || '-'}</td>
                  <td className="p-2 capitalize">{s.type}</td>
                  <td className="p-2">
                    {Math.round((s.duration || 0) / 60)}m
                  </td>
                  <td className="p-2">₹{s.cost || 0}</td>
                  <td className="p-2 font-semibold text-success">
                    ₹{s.astrologerEarning || 0}
                  </td>
                  <td className="p-2 capitalize">
                    {s.status} {refundChip(s)}
                  </td>
                  <td className="p-2 font-mono text-xs text-sub-text">
                    #{sessionRefNo(s)}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() =>
                        router.push(`/astro-chat/${s.id}`)}
                        className="font-semibold text-primary">
                        View chat
                      </button>
                      {canRefund && (
                        <button onClick={() => {
                          setRfSession(s); setRfReason(REFUND_REASONS[0]);
                          setRfNote(''); }}
                          className="rounded-full bg-danger px-3 py-1
                            text-xs font-bold text-white">
                          ↩ Refund
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!all && (
        <button onClick={() => setAll(true)}
          className="btn-ghost mt-4 w-full">Show all history</button>
      )}

      {/* Refund modal */}
      {rfSession && (
        <div className="fixed inset-0 z-50 flex items-center
          justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-4">
            <h2 className="text-lg font-bold">Refund this consultation?</h2>
            <p className="mt-1 text-xs text-sub-text">
              {rfSession.client || 'Customer'} · {rfSession.type} ·{' '}
              {Math.round((rfSession.duration || 0) / 60)}m · ₹
              {rfSession.cost || 0} · #{sessionRefNo(rfSession)}
            </p>
            <p className="mt-2 text-xs text-sub-text">
              The full amount (₹{rfSession.cost || 0}) is credited back
              to the customer's wallet. Admin is notified for internal
              review.
            </p>
            <label className="mt-3 block text-sm font-semibold">
              Reason
              <select className="input mt-1" value={rfReason}
                onChange={(e) => setRfReason(e.target.value)}>
                {REFUND_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            {rfReason === 'Other' && (
              <textarea rows={2} className="input mt-2"
                placeholder="Describe the reason (optional)"
                value={rfNote}
                onChange={(e) => setRfNote(e.target.value)} />
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setRfSession(null)}
                className="btn-ghost flex-1" disabled={rfBusy}>
                Cancel
              </button>
              <button onClick={submitRefund} disabled={rfBusy}
                className="flex-1 rounded-full bg-danger px-4 py-2
                  font-bold text-white disabled:opacity-60">
                {rfBusy ? 'Submitting…' : 'Confirm refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
