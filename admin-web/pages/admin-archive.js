import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Archive browser. Every account reset (from /admin-reset or the per-
// account Danger Zone) writes the deleted docs into archives/{id}/items
// first - so admins can see exactly what was wiped and restore an
// account back to its previous state.
//
// This page is intentionally separate from the main People / Sessions /
// Transactions menus: archived data is NOT part of live records, it is
// a restorable snapshot of what was removed.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}
function sumCounts(counts) {
  return Object.values(counts || {}).reduce(
    (a, v) => a + (Number(v) || 0), 0);
}

export default function AdminArchive() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  async function load() {
    setRows(await adminService.listArchives({ limit: 100 }) || []);
  }
  useEffect(() => { if (!loading) load(); }, [loading]);

  async function openArchive(id) {
    setOpenId(id); setDetail('loading');
    setDetail(await adminService.getArchive(id));
  }
  async function restore(id) {
    if (!window.confirm('Restore this archive? It rewrites the original '
      + 'docs back to their collections.')) return;
    setBusy(true);
    try {
      const r = await adminService.restoreArchive(id);
      flash(`Restored ${r.restored} record(s).`);
      load(); if (openId === id) openArchive(id);
    } catch (e) { flash(`Restore failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }
  async function purge(id) {
    if (!window.confirm('Permanently delete this archive? The data will '
      + 'NO LONGER be restorable. Continue?')) return;
    setBusy(true);
    try {
      await adminService.deleteArchive(id);
      flash('Archive purged.');
      if (openId === id) { setOpenId(null); setDetail(null); }
      load();
    } catch (e) { flash(`Purge failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  const filtered = (rows || []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.uid || '').toLowerCase().includes(s)
      || (r.role || '').toLowerCase().includes(s)
      || (r.parts || []).join(',').toLowerCase().includes(s);
  });

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Archive (resets)</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every account reset is archived here first. Open one to inspect
        the deleted data, then Restore to put it back in the live
        collections, or Purge to permanently remove it.
      </p>

      <div className="card mb-3 flex items-center gap-2">
        <input className="input flex-1" placeholder="Search by uid /
          role / category"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={load}
          className="rounded-full bg-primary px-3 py-1.5 text-xs
            font-bold text-white">Refresh</button>
      </div>

      {!rows ? (
        <div className="card">Loading archives…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-sm text-sub-text">
          No archives yet. Every reset creates one automatically.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const total = sumCounts(a.counts);
            return (
              <div key={a.id} className="card">
                <div className="flex flex-wrap items-center
                  justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-dark-text">
                        {a.role || 'client'}
                      </span>
                      <span className="rounded-full bg-bg-light px-2
                        py-0.5 font-mono text-[10px] text-sub-text">
                        {a.uid}
                      </span>
                      {a.restored ? (
                        <span className="rounded-full bg-emerald-100
                          px-2 py-0.5 text-[10px] font-bold
                          text-emerald-700">Restored</span>
                      ) : (
                        <span className="rounded-full bg-amber-100
                          px-2 py-0.5 text-[10px] font-bold
                          text-amber-700">Archived</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-sub-text">
                      {fmt(a.createdAt)} · {total} record(s)
                      {(a.parts || []).length > 0
                        ? ` · ${(a.parts || []).join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openArchive(a.id)}
                      className="rounded-full bg-bg-light px-3 py-1.5
                        text-xs font-bold text-primary">
                      {openId === a.id ? 'Hide' : 'View'}
                    </button>
                    {!a.restored && (
                      <button onClick={() => restore(a.id)}
                        disabled={busy}
                        className="rounded-full bg-emerald-600 px-3
                          py-1.5 text-xs font-bold text-white
                          disabled:opacity-60">
                        Restore
                      </button>
                    )}
                    <button onClick={() => purge(a.id)} disabled={busy}
                      className="rounded-full border border-danger px-3
                        py-1.5 text-xs font-bold text-danger
                        disabled:opacity-60">
                      Purge
                    </button>
                  </div>
                </div>

                {openId === a.id && (
                  <div className="mt-3 rounded-card border
                    border-gray-200 p-3">
                    {detail === 'loading' && (
                      <div className="text-sm text-sub-text">Loading…</div>
                    )}
                    {detail && typeof detail === 'object'
                      && detail.id === a.id && (
                      <ArchiveItems items={detail.items || []} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

// Group archived items by their source collection so admin can see
// "10 transactions, 4 sessions, 2 chats" at a glance and drill down.
function ArchiveItems({ items }) {
  const groups = {};
  items.forEach((it) => {
    const k = it.coll || 'unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(it);
  });
  const keys = Object.keys(groups).sort();
  if (!keys.length) {
    return <div className="text-sm text-sub-text">
      Empty archive (profile-only reset).
    </div>;
  }
  return (
    <div className="space-y-3">
      {keys.map((k) => (
        <div key={k}>
          <div className="text-xs font-bold uppercase tracking-wider
            text-sub-text">{k} · {groups[k].length}</div>
          <div className="mt-1 max-h-56 overflow-auto rounded
            border border-gray-200">
            <table className="w-full text-[11px]">
              <thead className="bg-bg-light text-sub-text">
                <tr><th className="px-2 py-1 text-left">Doc ID</th>
                  <th className="px-2 py-1 text-left">Preview</th></tr>
              </thead>
              <tbody>
                {groups[k].slice(0, 100).map((it) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 font-mono">{it.docId}</td>
                    <td className="px-2 py-1 text-sub-text">
                      {previewOf(it.data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {groups[k].length > 100 && (
              <div className="px-2 py-1 text-[10px] text-sub-text">
                + {groups[k].length - 100} more not shown
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
function previewOf(data) {
  if (!data || typeof data !== 'object') return String(data || '');
  const fields = ['text', 'amount', 'cost', 'reason', 'type',
    'status', 'title', 'name', 'message'];
  const parts = [];
  for (const f of fields) {
    if (data[f] != null) parts.push(`${f}: ${String(data[f]).slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ') || JSON.stringify(data).slice(0, 80);
}
