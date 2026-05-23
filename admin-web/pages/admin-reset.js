import { useState, useEffect } from 'react';
import { adminService, astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { RESET_PARTS } = adminService;

// Bulk + individual account reset. Every reset is now SOFT (deleted docs
// are archived into archives/{archiveId}/items first), so admin can
// review the archived data and Restore from /admin-archive at any time.
function ResetCard({ role, label, phrase, all }) {
  const allKeys = RESET_PARTS.map(([k]) => k);
  const [sel, setSel] = useState({});
  const [pick, setPick] = useState('all'); // 'all' | 'selected'
  const [selectedUids, setSelectedUids] = useState({});
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = allKeys.filter((k) => sel[k]);
  const toggle = (k) => setSel((p) => ({ ...p, [k]: !p[k] }));
  const selectAll = (on) => setSel(on
    ? Object.fromEntries(allKeys.map((k) => [k, true])) : {});

  const pickedUids = Object.keys(selectedUids).filter((u) => selectedUids[u]);
  const filtered = (all || []).filter((u) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (u.name || '').toLowerCase().includes(s)
      || (u.email || '').toLowerCase().includes(s)
      || String(u.phone || '').includes(s)
      || String(u.userCode || '').toLowerCase().includes(s);
  }).slice(0, 100);

  async function run() {
    if (!chosen.length) { flash('Pick what to reset', 'error'); return; }
    if (pick === 'selected' && !pickedUids.length) {
      flash(`Pick at least one ${role} or switch to All.`, 'error');
      return;
    }
    if (confirm.trim().toUpperCase() !== phrase) {
      flash(`Type ${phrase} to confirm`, 'error'); return;
    }
    setBusy(true);
    try {
      const r = await adminService.resetAllAccounts({
        role, parts: chosen,
        uids: pick === 'selected' ? pickedUids : null,
      });
      flash(`Done. Reset ${r.done}/${r.total} ${label.toLowerCase()}. `
        + 'Archived for review / restore.');
      setSel({}); setConfirm(''); setSelectedUids({}); setPick('all');
    } catch (e) {
      flash(`Failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="surface border border-red-200 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide
        text-red-700">Reset {label}</h2>
      <p className="mt-1 text-xs text-sub-text">
        Applies the selected reset to your chosen scope. Reversible from
        the Archive page until manually purged.
      </p>

      {/* Scope: All vs Specific individuals */}
      <div className="mt-3 inline-flex rounded-full bg-bg-light p-1
        text-xs font-bold">
        <button type="button" onClick={() => setPick('all')}
          className={`rounded-full px-3 py-1.5 ${pick === 'all'
            ? 'bg-white text-red-700 shadow-sm' : 'text-sub-text'}`}>
          All {label.toLowerCase()}
        </button>
        <button type="button" onClick={() => setPick('selected')}
          className={`rounded-full px-3 py-1.5 ${pick === 'selected'
            ? 'bg-white text-red-700 shadow-sm' : 'text-sub-text'}`}>
          Specific individuals
        </button>
      </div>

      {pick === 'selected' && (
        <div className="mt-3 rounded-card border border-gray-200 p-2">
          <input className="input mb-2" placeholder={`Search ${role} by`
            + ' name / email / phone / code'}
            value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mb-1 text-[11px] text-sub-text">
            {pickedUids.length} selected · {filtered.length} shown
            {(all || []).length > filtered.length
              ? ` of ${(all || []).length}` : ''}
          </div>
          <div className="max-h-72 space-y-1 overflow-auto">
            {filtered.map((u) => (
              <label key={u.uid}
                className="flex items-center gap-2 rounded px-2 py-1.5
                  text-sm hover:bg-bg-light">
                <input type="checkbox" checked={!!selectedUids[u.uid]}
                  onChange={() => setSelectedUids((p) => ({ ...p,
                    [u.uid]: !p[u.uid] }))} />
                <span className="flex-1 truncate">
                  {u.name || '(no name)'}
                  <span className="ml-1 text-[11px] text-sub-text">
                    {u.email || u.phone || u.userCode || u.uid}
                  </span>
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-xs text-sub-text">No match.</div>
            )}
          </div>
        </div>
      )}

      {/* Category checkboxes */}
      <div className="mt-3 flex gap-2 text-xs">
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
          ({chosen.length} categories ·{' '}
          {pick === 'all' ? 'ALL' : pickedUids.length} {role}s)
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder={phrase} className="input mt-1 border-red-300" />
        </label>
        <button onClick={run} disabled={busy}
          className="mt-2 rounded-full bg-red-600 px-4 py-2 text-sm
            font-bold text-white disabled:opacity-60">
          {busy ? 'Resetting…' : `Reset ${
            pick === 'all' ? 'all' : pickedUids.length
          } ${label.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

export default function AdminReset() {
  const { loading } = useRequireAdmin();
  const [clients, setClients] = useState([]);
  const [astros, setAstros] = useState([]);

  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) =>
      setClients((list || []).filter(
        (u) => (u.role || 'client') === 'client')))
      .catch(() => {});
    astrologerService.getAstrologers()
      .then((list) => setAstros((list || []).map(
        (a) => ({ uid: a.id || a.uid, name: a.name,
          email: a.email, phone: a.phone, userCode: a.userCode }))))
      .catch(() => {});
  }, [loading]);

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;
  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold text-red-700">
        Account Reset
      </h1>
      <p className="mb-4 text-sm text-sub-text">
        Wipe selected data for ALL or SPECIFIC clients / astrologers. Every
        reset is archived first, so you can review or Restore it from
        <a href="/admin-archive" className="ml-1 font-semibold
          text-primary underline">Archive</a>.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ResetCard role="client" label="Clients"
          phrase="ERASE ALL CLIENTS" all={clients} />
        <ResetCard role="astrologer" label="Astrologers"
          phrase="ERASE ALL ASTROLOGERS" all={astros} />
      </div>
    </Layout>
  );
}
