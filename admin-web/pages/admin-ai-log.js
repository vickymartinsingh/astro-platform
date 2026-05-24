import { useEffect, useState } from 'react';
import { db, assistantService } from '@astro/shared';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// AI diagnostic + log viewer. Every call to the relay's /api/aiAssist
// now writes a row to aiLog/{auto} with the outcome. This page is the
// single place an admin can come to when a customer complains the AI
// is silent: it shows the most recent attempts with WHY each one
// skipped / failed, plus the current AI configuration so the operator
// can spot a misconfig (e.g. ai_scope=selected with the astrologer
// missing from the list). A "Run test now" form fires aiAssist for any
// chatId / sessionId / astrologer-uid combo so you can reproduce the
// problem without waiting for a real customer to send a message.

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit',
      minute: '2-digit', second: '2-digit',
    });
  } catch (_) { return '-'; }
}

function shortId(id) {
  if (!id) return '-';
  return String(id).length > 12 ? String(id).slice(0, 10) + '…' : id;
}

function Pill({ tone, children }) {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    fail: 'bg-red-100 text-red-700',
    info: 'bg-bg-light text-sub-text',
  }[tone] || 'bg-bg-light text-sub-text';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold
      ${cls}`}>{children}</span>
  );
}

export default function AdminAiLog() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [providers, setProviders] = useState(null);
  const [filter, setFilter] = useState('all'); // all / replied / skipped / error
  const [chatFilter, setChatFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState({ chatId: '', sessionId: '',
    astroUid: '', clientUid: '' });

  async function load() {
    setBusy(true);
    try {
      const [snap, c, p] = await Promise.all([
        getDocs(query(collection(db, 'aiLog'),
          orderBy('createdAt', 'desc'), limit(200))),
        getDoc(doc(db, 'settings', 'config')),
        getDoc(doc(db, 'settings', 'aiProviders')),
      ]);
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setCfg(c.exists() ? (c.data() || {}) : {});
      setProviders(p.exists() ? (p.data() || {}) : {});
    } catch (e) {
      flash(`Could not load log: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }
  useEffect(() => { if (!loading) load(); }, [loading]);

  async function runTest() {
    if (!test.chatId) {
      flash('chatId is required.', 'error'); return;
    }
    setBusy(true);
    try {
      const ok = await assistantService.triggerAiAssist({
        chatId: test.chatId.trim(),
        sessionId: test.sessionId.trim() || undefined,
        astroUid: test.astroUid.trim() || undefined,
        clientUid: test.clientUid.trim() || undefined,
      });
      flash(ok ? 'Test fired - check the log below in a moment.'
        : 'Test call returned an error - check browser console.',
        ok ? null : 'error');
      // Give the relay a second to write the log row, then refresh.
      setTimeout(load, 1500);
    } catch (e) { flash(`Test failed: ${e.message || e}`, 'error'); }
    finally { setBusy(false); }
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const enabledProviders = (providers && Array.isArray(providers.providers))
    ? providers.providers.filter((p) => p.enabled && p.apiKey)
    : [];

  const filtered = (rows || []).filter((r) => {
    if (chatFilter && !(r.chatId || '').includes(chatFilter)
      && !(r.sessionId || '').includes(chatFilter)
      && !(r.astroUid || '').includes(chatFilter)) return false;
    if (filter === 'replied' && !r.replied) return false;
    if (filter === 'skipped' && !r.skipped) return false;
    if (filter === 'error' && !r.error && !r.aiError) return false;
    return true;
  });

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">AI diagnostic & log</h1>
      <p className="mb-3 text-sm text-sub-text">
        Every call the customer / astrologer apps make to{' '}
        <code>/api/aiAssist</code> writes a row here with the outcome.
        Use the filters and the test form to figure out why AI is silent
        for a specific chat.
      </p>

      {/* Snapshot of current AI config */}
      <div className="card mb-3 grid grid-cols-2 gap-2 text-sm
        sm:grid-cols-4">
        <Box label="Master switch"
          ok={cfg.ai_enabled !== false}>
          {cfg.ai_enabled === false ? 'OFF (explicit)'
            : cfg.ai_enabled === true ? 'ON' : 'ON (default)'}
        </Box>
        <Box label="Scope"
          ok={cfg.ai_scope !== 'selected'
            || (Array.isArray(cfg.ai_astrologers)
              && cfg.ai_astrologers.length > 0)}>
          {cfg.ai_scope === 'selected'
            ? `selected (${(cfg.ai_astrologers || []).length})`
            : 'all astrologers'}
        </Box>
        <Box label="Force-all"
          ok={cfg.ai_force_all !== false}>
          {cfg.ai_force_all === false ? 'OFF (per-astro toggle wins)'
            : 'ON (default)'}
        </Box>
        <Box label="Providers configured"
          ok={enabledProviders.length > 0}>
          {enabledProviders.length === 0
            ? 'NONE - add a key in /admin-ai'
            : enabledProviders.map((p) => p.id).join(', ')}
        </Box>
      </div>

      {/* Test form */}
      <div className="card mb-3">
        <div className="font-semibold">Run test now</div>
        <p className="mt-1 text-[12px] text-sub-text">
          Fires{' '}
          <code>POST /api/aiAssist</code> for any chatId. If only
          chatId is given the relay resolves the participants from the
          chat doc. Result lands in the log below within ~2 seconds.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input className="input" placeholder="chatId (required)"
            value={test.chatId}
            onChange={(e) => setTest({ ...test, chatId: e.target.value })} />
          <input className="input" placeholder="sessionId (optional)"
            value={test.sessionId}
            onChange={(e) => setTest({ ...test,
              sessionId: e.target.value })} />
          <input className="input" placeholder="astroUid (optional)"
            value={test.astroUid}
            onChange={(e) => setTest({ ...test,
              astroUid: e.target.value })} />
          <input className="input" placeholder="clientUid (optional)"
            value={test.clientUid}
            onChange={(e) => setTest({ ...test,
              clientUid: e.target.value })} />
        </div>
        <button onClick={runTest} disabled={busy || !test.chatId}
          className="mt-3 rounded-full bg-primary px-4 py-2 text-sm
            font-bold text-white disabled:opacity-60">
          {busy ? 'Firing…' : 'Fire aiAssist'}
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-bg-light p-1
          text-xs font-bold">
          {['all', 'replied', 'skipped', 'error'].map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1.5 ${filter === k
                ? 'bg-white text-primary shadow-sm'
                : 'text-sub-text'}`}>{k}</button>
          ))}
        </div>
        <input className="input flex-1" value={chatFilter}
          placeholder="Search by chatId / sessionId / astroUid"
          onChange={(e) => setChatFilter(e.target.value)} />
        <button onClick={load} disabled={busy}
          className="rounded-full bg-primary px-3 py-1.5 text-xs
            font-bold text-white disabled:opacity-60">
          {busy ? '…' : 'Refresh'}
        </button>
      </div>

      {/* Log table */}
      {rows == null ? (
        <div className="card">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-sm text-sub-text">
          No log entries match. The relay writes a row on every aiAssist
          call. If you see nothing here even after a customer message,
          the customer app is not calling the relay at all (probably an
          old build / cached web).
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((r) => (
            <div key={r.id} className="card !p-3">
              <div className="flex flex-wrap items-center gap-1.5
                text-[11px]">
                <span className="font-mono text-sub-text">
                  {fmt(r.createdAt)}
                </span>
                {r.replied && <Pill tone="ok">
                  REPLIED {r.bubbles ? `×${r.bubbles}` : ''}
                </Pill>}
                {r.accepted && <Pill tone="ok">accepted</Pill>}
                {r.skipped && <Pill tone="warn">
                  skipped: {r.skipped}
                </Pill>}
                {(r.error || r.aiError) && <Pill tone="fail">
                  error
                </Pill>}
                {r.fallback && <Pill tone="warn">fallback</Pill>}
                {r.provider && <Pill tone="info">
                  {r.provider}/{r.model || '?'}
                </Pill>}
              </div>
              <div className="mt-1 text-[11px] text-sub-text">
                chat <span className="font-mono">
                  {shortId(r.chatId)}
                </span>
                {r.sessionId && <> · session <span className="font-mono">
                  {shortId(r.sessionId)}
                </span></>}
                {r.astroUid && <> · astro <span className="font-mono">
                  {shortId(r.astroUid)}
                </span></>}
              </div>
              {(r.error || r.aiError) && (
                <div className="mt-1 break-all rounded-card bg-red-50
                  p-2 text-[11px] text-red-700">
                  {r.error || r.aiError}
                </div>
              )}
              {r.reason && (
                <div className="mt-1 break-all text-[11px]
                  text-sub-text">
                  reason: <code>{JSON.stringify(r.reason)}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

function Box({ label, ok, children }) {
  const cls = ok ? 'bg-emerald-50 text-emerald-800'
    : 'bg-amber-50 text-amber-800';
  return (
    <div className={`rounded-card p-2.5 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider
        opacity-70">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{children}</div>
    </div>
  );
}
