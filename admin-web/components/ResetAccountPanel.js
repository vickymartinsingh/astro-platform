import { useState } from 'react';
import { adminService } from '@astro/shared';
import { flash } from '../lib/flash';

const { RESET_PARTS } = adminService;

// Admin "reset account" panel. Pick exactly what to wipe (chats, calls,
// history, kundli, remedies, wallet, transactions, refunds, complaints,
// notifications, profile…) for ONE user, or "Reset as default" to wipe
// everything and restore a clean default profile. Every destructive run
// is gated behind an explicit typed confirmation.
//
// Props:
//   uid     - the account to reset
//   role    - 'client' | 'astrologer' (decides which profile doc resets)
//   name    - shown in the confirmation
//   onDone  - optional callback after a successful reset (e.g. reload)
export default function ResetAccountPanel({ uid, role = 'client', name,
  onDone }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState({});
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const allKeys = RESET_PARTS.map(([k]) => k);
  const chosen = allKeys.filter((k) => sel[k]);
  const toggle = (k) => setSel((p) => ({ ...p, [k]: !p[k] }));
  const selectAll = (on) => setSel(on
    ? Object.fromEntries(allKeys.map((k) => [k, true])) : {});

  const isFull = chosen.length === allKeys.length;
  const need = isFull ? 'RESET DEFAULT' : 'RESET';

  async function run() {
    if (!chosen.length) { flash('Pick what to reset', 'error'); return; }
    if (confirm.trim().toUpperCase() !== need) {
      flash(`Type ${need} to confirm`, 'error'); return;
    }
    setBusy(true);
    try {
      const r = await adminService.resetAccountData(uid, {
        role, parts: chosen });
      const n = Object.values(r.counts || {})
        .reduce((a, v) => a + (Number(v) || 0), 0);
      flash(`Reset done, ${chosen.length} categor${
        chosen.length === 1 ? 'y' : 'ies'}, ${n} record(s) cleared`);
      setOpen(false); setSel({}); setConfirm('');
      if (onDone) onDone();
    } catch (e) {
      flash(`Reset failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="surface mt-4 border border-red-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide
          text-red-700">⚠ Danger zone: reset account</h2>
        <button onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-red-300 px-3 py-1.5
            text-xs font-bold text-red-700 hover:bg-red-50">
          {open ? 'Close' : 'Reset this account'}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <p className="text-xs text-sub-text">
            Choose what to permanently delete for
            {' '}<b>{name || uid}</b>. This cannot be undone.
            Selecting everything performs a full “reset as default”
            (account data wiped, profile restored to a clean default,
            login kept).
          </p>

          <div className="mt-2 flex gap-2 text-xs">
            <button onClick={() => selectAll(true)}
              className="rounded-full bg-red-600 px-3 py-1 font-bold
                text-white">Select all (reset as default)</button>
            <button onClick={() => selectAll(false)}
              className="rounded-full bg-gray-100 px-3 py-1 font-bold
                text-gray-700">Clear</button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {RESET_PARTS.map(([k, label]) => {
              const disabled = k === 'remedy' && role !== 'astrologer';
              return (
                <label key={k}
                  className={`flex items-center gap-2 rounded-card px-2
                    py-1.5 text-sm ${disabled ? 'opacity-40'
                    : 'hover:bg-bg-light'}`}>
                  <input type="checkbox" checked={!!sel[k]} disabled={disabled}
                    onChange={() => toggle(k)} />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-3 rounded-card bg-red-50 p-3">
            <label className="block text-xs font-semibold text-red-700">
              Type <span className="font-mono">{need}</span> to confirm
              ({chosen.length} selected)
              <input value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={need}
                className="input mt-1 border-red-300" />
            </label>
            <button onClick={run} disabled={busy}
              className="mt-2 rounded-full bg-red-600 px-4 py-2 text-sm
                font-bold text-white disabled:opacity-60">
              {busy ? 'Resetting…' : isFull
                ? 'Reset account as default' : 'Reset selected data'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
