import { useState } from 'react';
import { adminService } from '@astro/shared';

// Shared Refund modal used both from UserActionBar (open with no
// context, admin fills everything) and from inline row buttons on
// the Transactions tab / admin-orders / admin-sessions. Inline
// callers pass `prefill` so the source pill, reference id and
// amount land pre-selected and the operator only has to pick a
// narration + click Issue.
//
// Why a separate file: the UserActionBar version was tied to its
// shared modal state. Inlining a Refund button on every order row
// needed an independent dialog with its own state, so the form +
// submit logic moved here and UserActionBar just renders this when
// 'refund' is its current modal.

const TEMPLATES = adminService.REFUND_TEMPLATES || [];
const SOURCES = [
  { id: 'chat', label: 'Chat' },
  { id: 'call', label: 'Call' },
  { id: 'video', label: 'Video' },
  { id: 'live', label: 'Live stream' },
  { id: 'report', label: 'Report' },
  { id: 'order', label: 'Order' },
  { id: 'other', label: 'Other' },
];

export default function RefundModal({ uid, user, prefill = {},
  onClose, onDone }) {
  const [amount, setAmount] = useState(
    prefill.amount != null ? String(Math.abs(prefill.amount)) : '');
  const [source, setSource] = useState(prefill.kind || 'chat');
  const [refId, setRefId] = useState(prefill.referenceId || '');
  const [template, setTemplate] = useState('');
  const [narration, setNarration] = useState(prefill.narration || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  async function submit() {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || amt <= 0) { setErr('Enter a positive amount.'); return; }
    const final = (narration || '').trim()
      || (TEMPLATES.find((t) => t.id === template) || {}).text || '';
    if (!final) {
      setErr('Pick a narration template or type your own.'); return;
    }
    setBusy(true); setErr('');
    try {
      const out = await adminService.adminRefund({
        uid, amount: amt, kind: source,
        referenceId: (refId || '').trim(),
        narration: final, notes,
      });
      setOkMsg(`Refund ₹${amt} credited.`);
      if (typeof onDone === 'function') onDone(out);
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2">
          <h3 className="text-base font-bold text-dark-text">
            Refund to wallet
          </h3>
          <p className="mt-0.5 text-[11px] text-sub-text">
            Issues a credit and tags it with the source + narration.
            Appears in {user?.name || 'the customer'}&apos;s statement as
            a Refund row with a clickable source.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Amount (₹)</label>
            <input className="input mt-1" type="number" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Source</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => setSource(s.id)}
                  className={`rounded-full border px-3 py-1 text-xs
                    font-semibold transition ${source === s.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 text-sub-text '
                        + 'hover:bg-bg-light'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">
              Reference id (session / order / report - optional)
            </label>
            <input className="input mt-1" value={refId}
              onChange={(e) => setRefId(e.target.value)}
              placeholder="e.g. T12345678" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Narration template</label>
            <select className="input mt-1" value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                const t = TEMPLATES.find((x) => x.id === e.target.value);
                if (t) setNarration(t.text);
              }}>
              <option value="">- pick a template -</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.text}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">
              Narration (shown to customer)
            </label>
            <textarea className="input mt-1" rows={2} value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Type your own or edit the template..." />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Internal note</label>
            <input className="input mt-1" value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Admin-only, not shown to customer" />
          </div>
          {err && (
            <div className="rounded-card bg-rose-50 p-2 text-xs
              text-rose-700">{err}</div>
          )}
          {okMsg && (
            <div className="rounded-card bg-emerald-50 p-2 text-xs
              text-emerald-700">{okMsg}</div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="rounded-full px-4 py-2 text-sm font-semibold
              text-sub-text hover:bg-bg-light disabled:opacity-50">
            Close
          </button>
          <button onClick={submit} disabled={busy || !!okMsg}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white disabled:opacity-50">
            {busy ? 'Issuing...' : okMsg ? 'Done' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small inline trigger - drop on any row to surface the Refund dialog
// prefilled with the row's amount + kind + referenceId. Looks like a
// chip so it doesn't fight with the row content visually.
export function InlineRefundButton({ uid, user, prefill, onDone,
  label = 'Refund', className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`rounded-full border border-sky-200 bg-sky-50
          px-2 py-0.5 text-[10px] font-bold text-sky-700
          hover:bg-sky-100 ${className}`}
        title="Refund this charge to the customer's wallet">
        ↶ {label}
      </button>
      {open && (
        <RefundModal uid={uid} user={user} prefill={prefill}
          onClose={() => setOpen(false)}
          onDone={(out) => { if (onDone) onDone(out); }} />
      )}
    </>
  );
}
