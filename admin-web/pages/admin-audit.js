import { useEffect, useMemo, useState } from 'react';
import { db } from '@astro/shared';
import {
  collection, query, orderBy, limit, onSnapshot,
  getDoc, doc as fsDoc, where, getDocs,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Audit log - realtime feed of every signed-in action (route changes,
// logins, recharges, admin operations, password changes, etc.) written
// by the relay's /api/audit endpoint to the `audits/` collection.
//
// The page rewrite (2026-06-06) adds:
//   - rich user resolution: every row carries the actor's name + email
//     + DOB + phone + userCode resolved from users/{uid} (lazy +
//     cached so a 500-row page only fetches each user once)
//   - expand-row Inspector with the full meta json, IP, UA, breakdown
//   - Range filter (24h / 7d / 30d / custom) feeding both the table
//     and the report exporter
//   - Custom report card: pick range + type + app, then either View
//     (HTML preview) or Download PDF / CSV
//   - mobile-first responsive layout: cards under <md, table at md+
//   - LIVE pill + animated dot + relative "x ago" badge
//
// Operator: "should show the full log entire details along with their
// name as well, email, dob etc... add the custom report option
// downloadable in pdf and view, modern UI, mobile + desktop friendly"

function tsToMs(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (typeof ts === 'number') return ts;
  return 0;
}
function fmt(ts) {
  const ms = tsToMs(ts);
  if (!ms) return '–';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function relTime(ts) {
  const ms = tsToMs(ts);
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function fmtDob(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.toDate) {
    try {
      return v.toDate().toLocaleDateString('en-GB',
        { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return ''; }
  }
  return '';
}

const RANGES = [
  { id: '24h', label: 'Last 24 h', ms: 24 * 3600 * 1000 },
  { id: '7d',  label: 'Last 7 days', ms: 7 * 24 * 3600 * 1000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 24 * 3600 * 1000 },
  { id: 'all', label: 'All loaded', ms: 0 },
  { id: 'custom', label: 'Custom range', ms: -1 },
];

const TYPE_TONE = {
  signup:  'bg-emerald-100 text-emerald-700',
  login:   'bg-sky-100 text-sky-700',
  logout:  'bg-slate-100 text-slate-700',
  route:   'bg-violet-100 text-violet-700',
  recharge:'bg-amber-100 text-amber-800',
  refund:  'bg-rose-100 text-rose-700',
  admin_password_reset: 'bg-rose-100 text-rose-700',
  other:   'bg-bg-light text-sub-text',
};

export default function AdminAudit() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [appFilter, setAppFilter] = useState('all');
  const [range, setRange] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expanded, setExpanded] = useState(null); // row id
  // uid -> { name, email, dob, phone, userCode } cache. Lazy resolve
  // so a busy page with 500 events doesn't fan out 500 user reads -
  // it fans out exactly one per unique uid.
  const [userMap, setUserMap] = useState({});

  useEffect(() => {
    if (loading) return undefined;
    const unsub = onSnapshot(query(collection(db, 'audits'),
      orderBy('createdAt', 'desc'), limit(500)),
      (s) => {
        const next = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRows(next);
        const need = [...new Set(next.map((r) => r.uid).filter(Boolean))];
        need.forEach((uid) => {
          setUserMap((cur) => {
            if (cur[uid] !== undefined) return cur;
            const nx = { ...cur, [uid]: null };
            (async () => {
              try {
                const u = await getDoc(fsDoc(db, 'users', uid));
                const x = u.exists() ? u.data() : {};
                setUserMap((cur2) => ({ ...cur2, [uid]: {
                  name: x.name || '',
                  email: x.email || '',
                  phone: x.phone || '',
                  dob: fmtDob(x.dob),
                  userCode: x.userCode || '',
                  role: x.role || '',
                } }));
              } catch (_) {
                setUserMap((cur2) => ({ ...cur2, [uid]: {} }));
              }
            })();
            return nx;
          });
        });
      }, (_e) => setRows([]));
    return () => unsub();
  }, [loading]);

  const types = useMemo(() => {
    const set = new Set(['all']);
    (rows || []).forEach((r) => set.add(r.type || 'other'));
    return Array.from(set);
  }, [rows]);
  const apps = useMemo(() => {
    const set = new Set(['all']);
    (rows || []).forEach((r) => set.add(r.app || 'web'));
    return Array.from(set);
  }, [rows]);

  // The active date window. Used by both the table filter and the
  // custom report exporter so the on-screen rows always match the
  // PDF/CSV that would be downloaded.
  const window_ = useMemo(() => {
    if (range === 'all') return { from: 0, to: Date.now() + 1 };
    if (range === 'custom') {
      const f = customFrom ? new Date(customFrom).getTime() : 0;
      const t = customTo ? new Date(`${customTo}T23:59:59`).getTime()
        : Date.now() + 1;
      return { from: f, to: t };
    }
    const def = RANGES.find((r) => r.id === range);
    const ms = (def && def.ms) || 7 * 24 * 3600 * 1000;
    return { from: Date.now() - ms, to: Date.now() + 1 };
  }, [range, customFrom, customTo]);

  const filtered = useMemo(() => {
    const list = rows || [];
    const term = q.trim().toLowerCase();
    return list.filter((r) => {
      const ms = tsToMs(r.createdAt);
      if (ms && (ms < window_.from || ms > window_.to)) return false;
      if (typeFilter !== 'all' && (r.type || 'other') !== typeFilter) {
        return false;
      }
      if (appFilter !== 'all' && (r.app || 'web') !== appFilter) {
        return false;
      }
      if (!term) return true;
      const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
      const u = (r.uid && userMap[r.uid]) || {};
      return [r.type, r.app, r.uid, r.ip, r.ua,
        u.name, u.email, u.phone, u.userCode,
        m.path, m.target, m.email, m.action, m.method]
        .filter(Boolean).map((x) => String(x).toLowerCase())
        .some((x) => x.includes(term));
    });
  }, [rows, q, typeFilter, appFilter, window_, userMap]);

  function exportCsv() {
    const head = ['When','Type','App','Name','Email','Phone','DOB',
      'Code','IP','Path','Method','Target','Meta'];
    const lines = [head.join(',')];
    filtered.forEach((r) => {
      const u = (r.uid && userMap[r.uid]) || {};
      const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
      const cells = [
        fmt(r.createdAt), r.type || '', r.app || '',
        u.name || '', u.email || '', u.phone || '', u.dob || '',
        u.userCode || '', r.ip || '',
        m.path || '', m.method || '', m.target || '',
        JSON.stringify(m).replace(/"/g, "'").slice(0, 200),
      ];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function openPdf() {
    // Render a print-friendly HTML doc in a new window and trigger
    // print. Same approach we use elsewhere (orders PDF) because the
    // Spark plan does not give us Cloud Functions and pulling a
    // headless PDF lib into the bundle just for an admin export
    // would balloon the chunk. Browser print -> Save as PDF works
    // identically on desktop + mobile.
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return;
    const rangeLabel = RANGES.find((r) => r.id === range)?.label
      || range;
    const rows_ = filtered.map((r) => {
      const u = (r.uid && userMap[r.uid]) || {};
      const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
      const detail = [
        m.path && `path=${m.path}`,
        m.method && `method=${m.method}`,
        m.target && `target=${m.target}`,
        m.email && `email=${m.email}`,
        m.action && `action=${m.action}`,
      ].filter(Boolean).join(' · ');
      return `<tr>
        <td>${fmt(r.createdAt)}</td>
        <td><span class="chip">${r.type || 'other'}</span></td>
        <td>${r.app || '–'}</td>
        <td>
          <div class="who">
            <div class="who-name">${escapeHtml(u.name || '–')}</div>
            <div class="who-sub">${escapeHtml(u.email || '')}${
              u.userCode ? ` · ${u.userCode}` : ''}</div>
            ${u.phone ? `<div class="who-sub">${escapeHtml(u.phone)
              }${u.dob ? ` · DOB ${escapeHtml(u.dob)}` : ''}</div>` : ''}
          </div>
        </td>
        <td class="mono">${escapeHtml(detail || '–')}</td>
        <td class="mono">${escapeHtml(r.ip || '–')}</td>
      </tr>`;
    }).join('');
    win.document.write(`<!doctype html><html><head><title>Audit report</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1e;margin:24px}
        h1{font-size:20px;margin:0 0 4px}
        .meta{color:#666;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;vertical-align:top;text-align:left}
        th{background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#555}
        .chip{background:#eef2ff;color:#3730a3;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase}
        .who-name{font-weight:600}
        .who-sub{color:#666;font-size:10px}
        .mono{font-family:Menlo,Consolas,monospace;font-size:10px;color:#374151;word-break:break-all}
        @media print{body{margin:12px}}
      </style></head><body>
      <h1>Audit report</h1>
      <div class="meta">Range: <b>${rangeLabel}</b>
        ${range === 'custom' && customFrom ? ` (${customFrom} → ${customTo || 'now'})` : ''}
        · Type: <b>${typeFilter}</b> · App: <b>${appFilter}</b>
        · ${filtered.length} entries · Generated ${new Date().toLocaleString('en-GB')}</div>
      <table>
        <thead><tr>
          <th>When</th><th>Type</th><th>App</th>
          <th>User</th><th>Detail</th><th>IP</th>
        </tr></thead>
        <tbody>${rows_}</tbody>
      </table>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
      </body></html>`);
    win.document.close();
  }

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const liveSig = (
    <span className="inline-flex items-center gap-1 rounded-full
      bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full
        bg-emerald-500" />
      LIVE
    </span>
  );

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold
            text-dark-text">
            Audit log {liveSig}
          </h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Realtime feed of every signed-in event - signup, login,
            recharges, refunds, route changes, admin actions. Streams
            into the table within a second of the event landing.
          </p>
          <p className="mt-0.5 text-xs text-sub-text">
            {filtered.length} of {rows.length} entries shown
            {rows[0] && (
              <> · newest <b>{relTime(rows[0].createdAt)}</b></>
            )}
          </p>
        </div>
      </div>

      {/* Filter bar - sticky on scroll so the operator can keep
          changing range while scanning. */}
      <div className="surface mb-3 sticky top-0 z-10 p-3">
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-12">
          <input className="input md:col-span-4" value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, phone, code, path, IP…" />
          <select className="input md:col-span-2" value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
            ))}
          </select>
          <select className="input md:col-span-2" value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}>
            {apps.map((a) => (
              <option key={a} value={a}>{a === 'all' ? 'All apps' : a}</option>
            ))}
          </select>
          <select className="input md:col-span-2" value={range}
            onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 md:col-span-2">
            <button onClick={exportCsv}
              className="flex-1 rounded-full border border-gray-200
                px-3 py-1.5 text-xs font-semibold text-sub-text
                hover:bg-bg-light" title="Download filtered rows as CSV">
              ↓ CSV
            </button>
            <button onClick={openPdf}
              className="flex-1 rounded-full bg-primary px-3 py-1.5
                text-xs font-bold text-white hover:opacity-90"
              title="Open print-friendly view and Save as PDF">
              ⎙ PDF
            </button>
          </div>
        </div>
        {range === 'custom' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-bold uppercase
              tracking-wider text-sub-text">From</label>
            <input type="date" className="input"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)} />
            <label className="text-[11px] font-bold uppercase
              tracking-wider text-sub-text">To</label>
            <input type="date" className="input"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-sub-text">
          {rows.length === 0
            ? 'No audit entries yet. As soon as anyone signs in, '
              + 'changes a route or runs an admin action, rows will '
              + 'appear here in realtime.'
            : 'No entries match your filter. Widen the range, '
              + 'clear the search, or change the type / app picker.'}
        </div>
      ) : (
        <>
          {/* Card list - mobile-first. Hidden on md+ where the
              table renders instead. Tap a card to expand. */}
          <div className="space-y-2 md:hidden">
            {filtered.map((l) => (
              <AuditCard key={l.id} l={l}
                user={(l.uid && userMap[l.uid]) || null}
                isOpen={expanded === l.id}
                onToggle={() => setExpanded(
                  expanded === l.id ? null : l.id)} />
            ))}
          </div>

          {/* Table - md+. Each row is clickable; expanded row shows
              an inspector row beneath it. */}
          <div className="hidden overflow-x-auto rounded-card border
            border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-light text-left text-[11px]
                uppercase tracking-wider text-sub-text">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">App</th>
                  <th className="p-3">User</th>
                  <th className="p-3">Detail</th>
                  <th className="p-3">IP</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const u = (l.uid && userMap[l.uid]) || null;
                  const m = l.meta && typeof l.meta === 'object' ? l.meta : {};
                  const detail = [
                    m.path && `path=${m.path}`,
                    m.method && `method=${m.method}`,
                    m.target && `target=${m.target}`,
                    m.email && `email=${m.email}`,
                    m.action && `action=${m.action}`,
                  ].filter(Boolean).join(' · ');
                  const open = expanded === l.id;
                  return (
                    <>
                      <tr key={l.id}
                        onClick={() => setExpanded(open ? null : l.id)}
                        className="cursor-pointer border-t
                          border-gray-100 align-top
                          hover:bg-bg-light/40">
                        <td className="p-3 text-xs">
                          <div>{fmt(l.createdAt)}</div>
                          <div className="text-[10px] text-sub-text">
                            {relTime(l.createdAt)}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5
                            text-[10px] font-bold uppercase
                            ${TYPE_TONE[l.type] || TYPE_TONE.other}`}>
                            {l.type || 'other'}
                          </span>
                        </td>
                        <td className="p-3 text-xs">{l.app || '–'}</td>
                        <td className="p-3">
                          {l.uid ? (
                            u ? <UserChip u={u} /> : (
                              <span className="text-[11px] text-sub-text">
                                resolving…</span>
                            )
                          ) : <span className="text-[11px] text-sub-text">–</span>}
                        </td>
                        <td className="p-3 font-mono text-[10px]
                          break-all">{detail || '–'}</td>
                        <td className="p-3 font-mono text-[10px]">
                          {l.ip || '–'}
                        </td>
                        <td className="p-3 text-[10px] text-sub-text">
                          {open ? '▲' : '▼'}
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${l.id}-x`} className="bg-bg-light/40">
                          <td colSpan={7} className="p-4">
                            <Inspector l={l} user={u} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Layout>
  );
}

function UserChip({ u }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-bold text-dark-text">
        {u.name || '(unnamed)'}
      </div>
      <div className="text-[11px] text-sub-text">
        {u.email}
        {u.userCode && (
          <span className="ml-1 rounded bg-gray-100 px-1
            font-mono text-[9px] text-gray-700">{u.userCode}</span>
        )}
        {u.role && u.role !== 'client' && (
          <span className="ml-1 rounded bg-primary/10 px-1
            font-mono text-[9px] uppercase text-primary">
            {u.role}
          </span>
        )}
      </div>
      {(u.phone || u.dob) && (
        <div className="text-[10px] text-sub-text">
          {u.phone}{u.phone && u.dob ? ' · ' : ''}
          {u.dob && <>DOB {u.dob}</>}
        </div>
      )}
    </div>
  );
}

function AuditCard({ l, user, isOpen, onToggle }) {
  const m = l.meta && typeof l.meta === 'object' ? l.meta : {};
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3
      shadow-sm" onClick={onToggle}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px]
              font-bold uppercase
              ${TYPE_TONE[l.type] || TYPE_TONE.other}`}>
              {l.type || 'other'}
            </span>
            <span className="text-[10px] text-sub-text">
              {l.app || 'web'}
            </span>
            <span className="text-[10px] text-sub-text">
              · {relTime(l.createdAt)}
            </span>
          </div>
          {user && <div className="mt-1"><UserChip u={user} /></div>}
          {!user && l.uid && (
            <div className="mt-1 text-[11px] text-sub-text">
              resolving user…
            </div>
          )}
          <div className="mt-1 text-[11px] text-sub-text">
            {fmt(l.createdAt)}
          </div>
        </div>
        <div className="text-sub-text">{isOpen ? '▲' : '▼'}</div>
      </div>
      {isOpen && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <Inspector l={l} user={user} />
        </div>
      )}
      {!isOpen && (m.path || m.target || m.email) && (
        <div className="mt-2 truncate font-mono text-[10px]
          text-sub-text">
          {m.path || m.target || m.email}
        </div>
      )}
    </div>
  );
}

function Inspector({ l, user }) {
  const m = l.meta && typeof l.meta === 'object' ? l.meta : {};
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Block title="Actor">
        {user ? (
          <>
            <Kv k="Name" v={user.name} />
            <Kv k="Email" v={user.email} />
            <Kv k="Phone" v={user.phone} />
            <Kv k="DOB" v={user.dob} />
            <Kv k="Code" v={user.userCode} mono />
            {user.role && <Kv k="Role" v={user.role} />}
          </>
        ) : l.uid ? <div className="text-[11px] text-sub-text">
          resolving user…</div>
          : <div className="text-[11px] text-sub-text">no user (anon)</div>}
      </Block>
      <Block title="Event">
        <Kv k="Type" v={l.type || 'other'} />
        <Kv k="App" v={l.app || 'web'} />
        <Kv k="IP" v={l.ip || '–'} mono />
        <Kv k="When" v={fmt(l.createdAt)} />
        {m.path && <Kv k="Path" v={m.path} mono />}
        {m.method && <Kv k="Method" v={m.method} />}
        {m.target && <Kv k="Target" v={m.target} mono />}
        {m.email && <Kv k="Meta email" v={m.email} />}
        {m.action && <Kv k="Action" v={m.action} />}
      </Block>
      <Block title="Device / UA" full>
        <div className="font-mono text-[10px] text-sub-text break-all">
          {l.ua || '–'}
        </div>
      </Block>
      <Block title="Full meta payload" full>
        <pre className="max-h-48 overflow-auto rounded bg-bg-light p-2
          font-mono text-[10px] text-sub-text">
{JSON.stringify(l.meta || {}, null, 2)}
        </pre>
      </Block>
    </div>
  );
}

function Block({ title, full, children }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-3
      ${full ? 'sm:col-span-2' : ''}`}>
      <div className="mb-1 text-[10px] font-bold uppercase
        tracking-wider text-sub-text">{title}</div>
      {children}
    </div>
  );
}
function Kv({ k, v, mono }) {
  if (!v) return null;
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <div className="w-16 shrink-0 text-[10px] uppercase
        tracking-wider text-sub-text">{k}</div>
      <div className={`min-w-0 flex-1 break-all text-dark-text
        ${mono ? 'font-mono text-[11px]' : ''}`}>{v}</div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;' }[c]));
}
