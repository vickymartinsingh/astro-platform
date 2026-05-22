import { useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { RESET_PARTS } = adminService;

// Bulk reset: wipe selected data for EVERY client or EVERY astrologer at
// once. Extremely destructive, so it lives on its own page and needs a
// typed confirmation phrase. For single-account resets use the "Danger
// zone" panel on that user's / astrologer's profile page instead.
function BulkCard({ role, label, phrase }) {
  const [sel, setSel] = useState({});
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const allKeys = RESET_PARTS.map(([k]) => k);
  const chosen = allKeys.filter((k) => sel[k]);
  const toggle = (k) => setSel((p) => ({ ...p, [k]: !p[k] }));
  const selectAll = (on) => setSel(on
    ? Object.fromEntries(allKeys.map((k) => [k, true])) : {});

  async function run() {
    if (!chosen.length) { flash('Pick what to reset', 'error'); return; }
    if (confirm.trim().toUpperCase() !== phrase) {
      flash(`Type ${phrase} to confirm`, 'error'); return;
    }
    setBusy(true);
    try {
      const r = await adminService.resetAllAccounts({ role, parts: chosen });
      flash(`Done, reset ${r.done}/${r.total} ${label.toLowerCase()}`);
      setSel({}); setConfirm('');
    } catch (e) {
      flash(`Failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="surface border border-red-200 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-red-700">
        Reset ALL {label}
      </h2>
      <p className="mt-1 text-xs text-sub-text">
        Applies the selected reset to every {role}. Irreversible.
      </p>
      <div className="mt-2 flex gap-2 text-xs">
        <button onClick={() => selectAll(true)}
          className="rounded-full bg-red-600 px-3 py-1 font-bold text-white">
          Select all (reset as default)
        </button>
        <button onClick={() => selectAll(false)}
          className="rounded-full bg-gray-100 px-3 py-1 font-bold
            text-gray-700">Clear</button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {RESET_PARTS.map(([k, lab]) => {
          const disabled = k === 'remedy' && role !== 'astrologer';
          return (
            <label key={k}
              className={`flex items-center gap-2 rounded-card px-2 py-1.5
                text-sm ${disabled ? 'opacity-40' : 'hover:bg-bg-light'}`}>
              <input type="checkbox" checked={!!sel[k]} disabled={disabled}
                onChange={() => toggle(k)} />
              <span>{lab}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 rounded-card bg-red-50 p-3">
        <label className="block text-xs font-semibold text-red-700">
          Type <span className="font-mono">{phrase}</span> to confirm
          ({chosen.length} selected)
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder={phrase} className="input mt-1 border-red-300" />
        </label>
        <button onClick={run} disabled={busy}
          className="mt-2 rounded-full bg-red-600 px-4 py-2 text-sm font-bold
            text-white disabled:opacity-60">
          {busy ? 'Resetting…' : `Reset all ${label.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

export default function AdminReset() {
  const { loading } = useRequireAdmin();
  if (loading) return <Layout><div className="card">Loading…</div></Layout>;
  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold text-red-700">
        Bulk Account Reset
      </h1>
      <p className="mb-4 text-sm text-sub-text">
        Wipe selected data for every client or astrologer at once. To reset
        a single account, open that user’s profile and use its “Danger zone:
        reset account” panel. All resets are permanent.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BulkCard role="client" label="Clients" phrase="ERASE ALL CLIENTS" />
        <BulkCard role="astrologer" label="Astrologers"
          phrase="ERASE ALL ASTROLOGERS" />
      </div>
    </Layout>
  );
}
