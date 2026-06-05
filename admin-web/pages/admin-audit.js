import { useEffect, useMemo, useState } from 'react';
import { db } from '@astro/shared';
import {
  collection, query, orderBy, limit, onSnapshot,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Audit log - realtime feed of every signed-in action (route changes,
// logins, recharges, admin operations, password changes, etc.) written
// by the apps via auditService.logAudit. The page used to do a
// one-shot read which left the operator looking at a stale view; now
// it subscribes to the SAME collection so new entries paint at the
// top within ~1 second of being written.
//
// Search box filters across action, type, target, role, IP and UA in
// memory. Most-recent rows are at the top.
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : 0;
    if (!ms) return '–';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (_) { return '–'; }
}

export default function AdminAudit() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (loading) return undefined;
    // Live subscription to /logs ordered by timestamp desc. The
    // collection name comes from auditService - logAudit() writes
    // each row there. Limit caps the page at 500 most recent rows
    // so a 10k-row collection doesn't blow the client memory.
    const unsub = onSnapshot(query(collection(db, 'logs'),
      orderBy('timestamp', 'desc'), limit(500)),
      (s) => {
        setRows(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (_e) => setRows([]));
    return () => unsub();
  }, [loading]);

  const types = useMemo(() => {
    const set = new Set(['all']);
    (rows || []).forEach((r) => set.add(r.type || 'other'));
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows || [];
    const term = q.trim().toLowerCase();
    return list.filter((r) => {
      if (typeFilter !== 'all' && (r.type || 'other') !== typeFilter) {
        return false;
      }
      if (!term) return true;
      return [r.action, r.type, r.target, r.role, r.uid, r.ip, r.ua]
        .filter(Boolean).map((x) => String(x).toLowerCase())
        .some((x) => x.includes(term));
    });
  }, [rows, q, typeFilter]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Realtime feed. New events stream in at the top within a
            second. Showing the {filtered.length} most recent of{' '}
            {rows.length} entries.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex items-center gap-1 rounded-full
            bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500
              animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
        <input className="input flex-1 min-w-[200px]" value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search action, target, role, IP, UA..." />
        <select className="rounded-md border border-gray-200 px-2 py-2
          text-sm" value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}>
          {types.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-sub-text">
          {rows.length === 0
            ? 'No audit entries yet. As soon as anyone signs in, '
              + 'changes a route or runs an admin action, rows will '
              + 'appear here in realtime.'
            : 'No entries match your filter.'}
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase
              tracking-wider text-sub-text">
              <tr>
                <th className="p-3">When</th>
                <th className="p-3">Type</th>
                <th className="p-3">Action</th>
                <th className="p-3">Role</th>
                <th className="p-3">UID</th>
                <th className="p-3">Target</th>
                <th className="p-3">IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="border-t border-gray-200
                  align-top">
                  <td className="p-3 text-xs">{fmt(l.timestamp)}</td>
                  <td className="p-3">
                    <span className="rounded-full bg-bg-light
                      px-2 py-0.5 text-[10px] font-bold">
                      {l.type || 'other'}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{l.action || '–'}</td>
                  <td className="p-3 text-xs">{l.role || '–'}</td>
                  <td className="p-3 font-mono text-[10px]">
                    {String(l.uid || '').slice(0, 10) || '–'}
                  </td>
                  <td className="p-3 font-mono text-[10px]
                    break-all">
                    {String(l.target || '').slice(0, 40) || '–'}
                  </td>
                  <td className="p-3 font-mono text-[10px]">
                    {l.ip || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
