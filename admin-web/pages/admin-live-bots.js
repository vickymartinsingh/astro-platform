import { useState, useEffect, useMemo, useRef } from 'react';
import { liveBotService, adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-live-bots
//
// Manages the dummy live-stream audience: bot identities, the
// question pool they pull from, the pacing config (join + comment
// rates) and the per-astrologer scope. Astrologer-side UIs never
// read these; only the admin panel + the relay tick.
//
// Three tabs:
//   - Audience: 7-digit-coded bot profiles. Add, edit, delete,
//               CSV import + template download + bulk seed 5000.
//   - Questions: short messages bots post on entering a stream.
//                Bulk-seed the curated pool, add custom ones.
//   - Settings:  master switch, join + comment cadence (seconds),
//                scope (all astrologers or a specific allowlist).
function classNames(...xs) {
  return xs.filter(Boolean).join(' ');
}

export default function AdminLiveBots() {
  const { loading } = useRequireAdmin();
  const [tab, setTab] = useState('audience');

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-end justify-between
        gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live audience bots</h1>
          <p className="mt-1 text-sm text-sub-text">
            Synthetic viewers that join an astrologer&apos;s live
            stream, appear in the viewer count and ask realistic
            short questions in the chat. Astrologers never see the
            controls; admin enables the feature here.
          </p>
        </div>
      </div>

      <div className="mb-4 inline-flex rounded-full bg-bg-light p-1
        text-xs font-bold">
        {[['audience', 'Audience'], ['questions', 'Questions'],
          ['settings', 'Settings']].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={classNames('rounded-full px-3.5 py-1.5',
              tab === k ? 'bg-white text-primary shadow-sm'
                : 'text-sub-text')}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'audience' && <AudienceTab />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'settings' && <SettingsTab />}
    </Layout>
  );
}

// ============================================================
// Audience tab
// ============================================================
function AudienceTab() {
  const [bots, setBots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, type, enabled }
  const [adding, setAdding] = useState(null);   // { name, type, code }
  const [seedN, setSeedN] = useState(5000);
  const fileRef = useRef(null);

  useEffect(() => { void refresh(); }, []);
  async function refresh() {
    setBusy(true);
    try { setBots(await liveBotService.listAllBots()); }
    catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return bots.filter((b) => {
      if (enabledOnly && b.enabled === false) return false;
      if (!s) return true;
      return (b.name || '').toLowerCase().includes(s)
        || (b.code || b.id || '').includes(s);
    });
  }, [bots, q, enabledOnly]);

  async function doSeed() {
    if (!Number.isFinite(Number(seedN)) || Number(seedN) <= 0) {
      flash('Enter a positive number.', 'error'); return;
    }
    if (!window.confirm(`Generate ${seedN} new bot profiles? This `
      + 'is additive (existing bots are kept).')) return;
    setBusy(true);
    try {
      const written = await liveBotService.bulkSeedBots(
        Number(seedN));
      flash(`Seeded ${written} bots.`, 'success');
      await refresh();
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }
  function downloadTemplate() {
    const csv = liveBotService.csvTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'liveBots-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  function downloadCurrent() {
    const csv = liveBotService.exportCsv(bots);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'liveBots-current.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function onUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const n = await liveBotService.importCsv(text);
      flash(`Imported ${n} rows.`, 'success');
      await refresh();
    } catch (err) {
      flash(String((err && err.message) || err), 'error');
    } finally { setBusy(false); e.target.value = ''; }
  }
  async function doAdd() {
    if (!adding || !adding.name) return;
    setBusy(true);
    try {
      await liveBotService.createBot({
        name: adding.name,
        type: adding.type || (adding.name.includes(' ')
          ? 'full' : 'single'),
        code: adding.code || null,
      });
      flash('Added.', 'success');
      setAdding(null);
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function doSave() {
    if (!editing) return;
    setBusy(true);
    try {
      await liveBotService.updateBot(editing.id, {
        name: editing.name,
        type: editing.type,
        enabled: editing.enabled !== false,
      });
      flash('Saved.', 'success');
      setEditing(null);
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function doDelete(b) {
    if (!window.confirm(`Delete ${b.name}?`)) return;
    setBusy(true);
    try { await liveBotService.deleteBot(b.id); await refresh(); }
    catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function toggleEnabled(b) {
    setBusy(true);
    try {
      await liveBotService.updateBot(b.id, {
        enabled: !(b.enabled !== false) });
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="surface mb-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[200px]"
            placeholder="Search by name or 7-digit code"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-[12px]
            font-semibold">
            <input type="checkbox" checked={enabledOnly}
              onChange={(e) => setEnabledOnly(e.target.checked)} />
            Enabled only
          </label>
          <span className="ml-auto text-xs text-sub-text">
            {filtered.length} of {bots.length}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setAdding({ name: '', type: 'full',
            code: '' })} className="rounded-full bg-primary px-3 py-1.5
            text-xs font-bold text-white">
            + Add single
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="rounded-full bg-amber-100 px-3 py-1.5 text-xs
              font-bold text-amber-800">
            Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv"
            onChange={onUpload} className="hidden" />
          <button onClick={downloadTemplate}
            className="rounded-full bg-bg-light px-3 py-1.5 text-xs
              font-bold text-dark-text">
            Download CSV template
          </button>
          <button onClick={downloadCurrent}
            className="rounded-full bg-bg-light px-3 py-1.5 text-xs
              font-bold text-dark-text">
            Export current as CSV
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <input type="number" min="1" value={seedN}
              onChange={(e) => setSeedN(e.target.value)}
              className="w-24 rounded-md border border-gray-200
                px-2 py-1 text-sm" />
            <button onClick={doSeed} disabled={busy}
              className="rounded-full bg-emerald-100 px-3 py-1.5
                text-xs font-bold text-emerald-800 disabled:opacity-50">
              Generate {seedN} bots
            </button>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal title="Edit bot"
          values={editing} onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={doSave} busy={busy} />
      )}
      {adding && (
        <EditModal title="Add bot"
          values={adding} onChange={setAdding}
          onCancel={() => setAdding(null)}
          onSave={doAdd} busy={busy} allowCode />
      )}

      <div className="surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase
            tracking-wider text-sub-text">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Name</th>
              <th className="p-3">Type</th>
              <th className="p-3">Enabled</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5}
                className="p-6 text-center text-sub-text">
                {bots.length === 0
                  ? 'No bots yet. Use Generate 5000 bots above to '
                    + 'seed the pool, or upload a CSV.'
                  : 'No matches.'}
              </td></tr>
            ) : filtered.slice(0, 200).map((b) => (
              <tr key={b.id}
                className="border-t border-gray-200 align-top">
                <td className="p-3 font-mono text-xs font-bold">
                  {b.code || b.id}
                </td>
                <td className="p-3">{b.name}</td>
                <td className="p-3">
                  <span className="rounded-full bg-bg-light
                    px-2 py-0.5 text-[10px] font-bold capitalize">
                    {b.type || 'single'}
                  </span>
                </td>
                <td className="p-3">
                  <button onClick={() => toggleEnabled(b)}
                    className={classNames('rounded-full px-2 py-0.5',
                      'text-[10px] font-bold',
                      b.enabled === false
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-emerald-100 text-emerald-700')}>
                    {b.enabled === false ? 'Off' : 'On'}
                  </button>
                </td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button onClick={() => setEditing({
                      id: b.id, name: b.name, type: b.type,
                      enabled: b.enabled !== false })}
                      className="rounded-full bg-bg-light px-2.5
                        py-1 text-[11px] font-bold">
                      Edit
                    </button>
                    <button onClick={() => doDelete(b)}
                      className="rounded-full bg-danger/10 px-2.5
                        py-1 text-[11px] font-bold text-danger">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div className="border-t border-gray-200 p-3 text-center
            text-[11px] text-sub-text">
            Showing the first 200 results. Use the search box to
            narrow down.
          </div>
        )}
      </div>
    </>
  );
}

function EditModal({ title, values, onChange, onCancel, onSave,
  busy, allowCode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/45 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">{title}</h3>
        <div className="mt-3 space-y-3">
          {allowCode && (
            <label className="block">
              <span className="text-xs font-semibold text-sub-text">
                7-digit code (optional - we mint one if blank)
              </span>
              <input className="input mt-1" maxLength="7"
                value={values.code || ''}
                onChange={(e) => onChange({ ...values,
                  code: e.target.value.replace(/[^0-9]/g, '') })} />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Name
            </span>
            <input className="input mt-1" value={values.name || ''}
              onChange={(e) => onChange({ ...values,
                name: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Type
            </span>
            <select className="input mt-1" value={values.type || 'full'}
              onChange={(e) => onChange({ ...values,
                type: e.target.value })}>
              <option value="full">Full name (first + surname)</option>
              <option value="single">Single name only</option>
            </select>
          </label>
          {values.enabled != null && (
            <label className="flex items-center gap-2">
              <input type="checkbox"
                checked={values.enabled !== false}
                onChange={(e) => onChange({ ...values,
                  enabled: e.target.checked })} />
              <span className="text-sm">Enabled</span>
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-full bg-bg-light px-4 py-1.5 text-sm
              font-bold">Cancel</button>
          <button onClick={onSave} disabled={busy || !values.name}
            className="rounded-full bg-primary px-4 py-1.5 text-sm
              font-bold text-white disabled:opacity-50">
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Questions tab
// ============================================================
function QuestionsTab() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [newText, setNewText] = useState('');
  const [editing, setEditing] = useState(null); // {id, text}

  useEffect(() => { void refresh(); }, []);
  async function refresh() {
    setBusy(true);
    try { setItems(await liveBotService.listQuestions()); }
    catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => (x.text || '').toLowerCase()
      .includes(s));
  }, [items, q]);
  async function addOne() {
    const t = newText.trim();
    if (!t) return;
    setBusy(true);
    try {
      await liveBotService.createQuestion(t);
      setNewText('');
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function seedPool() {
    if (!window.confirm('Add the curated 200-question pool? '
      + 'Existing duplicates are skipped.')) return;
    setBusy(true);
    try {
      const n = await liveBotService.bulkSeedQuestions();
      flash(`Added ${n} questions.`, 'success');
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function delOne(id) {
    if (!window.confirm('Delete this question?')) return;
    setBusy(true);
    try { await liveBotService.deleteQuestion(id); await refresh(); }
    catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await liveBotService.updateQuestion(editing.id, editing.text);
      setEditing(null);
      await refresh();
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="surface mb-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[200px]"
            placeholder="Search the question pool"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={seedPool} disabled={busy}
            className="rounded-full bg-emerald-100 px-3 py-1.5
              text-xs font-bold text-emerald-800 disabled:opacity-50">
            Seed curated 200-question pool
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input flex-1"
            placeholder="Type a new short question"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addOne(); }} />
          <button onClick={addOne} disabled={busy || !newText.trim()}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white disabled:opacity-50">
            Add
          </button>
        </div>
        <div className="mt-2 text-[11px] text-sub-text">
          Rule: short, plain English, no hyphens. Bots pick from this
          pool randomly and never repeat within a single live stream.
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center
          justify-center bg-black/45 p-4"
          onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5
            shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Edit question</h3>
            <textarea rows={3} className="input mt-3 w-full"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing,
                text: e.target.value })} />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="rounded-full bg-bg-light px-4 py-1.5
                  text-sm font-bold">Cancel</button>
              <button onClick={saveEdit}
                disabled={busy || !editing.text.trim()}
                className="rounded-full bg-primary px-4 py-1.5
                  text-sm font-bold text-white disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="surface">
        <div className="border-b border-gray-200 px-4 py-2
          text-[11px] font-semibold text-sub-text">
          {filtered.length} question{filtered.length === 1 ? '' : 's'}
        </div>
        <ul className="divide-y divide-gray-200">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-sub-text">
              {items.length === 0
                ? 'Empty pool. Seed the curated 200 above.'
                : 'No matches.'}
            </li>
          ) : filtered.slice(0, 300).map((x) => (
            <li key={x.id}
              className="flex items-start justify-between gap-3
                px-4 py-2.5">
              <span className="flex-1 text-sm">{x.text}</span>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing({ id: x.id,
                  text: x.text })}
                  className="rounded-full bg-bg-light px-2.5 py-1
                    text-[11px] font-bold">Edit</button>
                <button onClick={() => delOne(x.id)}
                  className="rounded-full bg-danger/10 px-2.5 py-1
                    text-[11px] font-bold text-danger">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ============================================================
// Settings tab
// ============================================================
function SettingsTab() {
  const [cfg, setCfg] = useState(null);
  const [astros, setAstros] = useState([]);
  const [busy, setBusy] = useState(false);
  const [astroQ, setAstroQ] = useState('');
  const [diagAstro, setDiagAstro] = useState('');
  const [diagOut, setDiagOut] = useState(null);

  useEffect(() => {
    (async () => {
      try { setCfg(await liveBotService.getBotConfig()); }
      catch (_) { setCfg(liveBotService.BOT_CONFIG_DEFAULTS); }
      try {
        const { astrologerService } = await import('@astro/shared');
        setAstros(await astrologerService.getAstrologers() || []);
      } catch (_) {}
    })();
  }, []);
  async function save() {
    setBusy(true);
    try {
      await adminService.updateSettings('config', cfg);
      flash('Settings saved.', 'success');
    } catch (e) { flash(String((e && e.message) || e), 'error'); }
    finally { setBusy(false); }
  }
  function toggleAstro(uid) {
    const arr = Array.isArray(cfg.live_bots_astro_uids)
      ? cfg.live_bots_astro_uids : [];
    const next = arr.includes(uid)
      ? arr.filter((x) => x !== uid)
      : [...arr, uid];
    setCfg({ ...cfg, live_bots_astro_uids: next });
  }
  if (!cfg) return <div className="card">Loading settings...</div>;

  const filteredAstros = (astros || []).filter((a) => {
    const s = astroQ.trim().toLowerCase();
    if (!s) return true;
    return (a.name || '').toLowerCase().includes(s)
      || (a.email || '').toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="surface space-y-3 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">Master switch</h2>
        <label className="flex items-center gap-2">
          <input type="checkbox"
            checked={cfg.live_bots_enabled === true}
            onChange={(e) => setCfg({ ...cfg,
              live_bots_enabled: e.target.checked })} />
          <span className="text-sm font-semibold">
            Enable live audience bots globally
          </span>
        </label>
        <p className="text-[11px] text-sub-text">
          When off, no bot ever joins any stream. When on, scope and
          cadence settings below apply.
        </p>
      </div>

      <div className="surface space-y-3 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">Cadence</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Seconds between bot joins (viewer count tick)
            </span>
            <input type="number" min="3"
              className="input mt-1"
              value={cfg.live_bots_join_rate_sec || 12}
              onChange={(e) => setCfg({ ...cfg,
                live_bots_join_rate_sec: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Seconds between bot chat messages
            </span>
            <input type="number" min="5"
              className="input mt-1"
              value={cfg.live_bots_comment_rate_sec || 35}
              onChange={(e) => setCfg({ ...cfg,
                live_bots_comment_rate_sec: Number(e.target.value) })} />
          </label>
        </div>
        <p className="text-[11px] text-sub-text">
          Smaller numbers feel faster; too small (under 5) makes the
          audience look bot-like. Sensible defaults: 12s joins, 35s
          comments.
        </p>
      </div>

      <div className="surface space-y-3 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">Scope</h2>
        <div className="flex flex-wrap items-center gap-3">
          {['all', 'allowlist'].map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input type="radio" name="scope" value={s}
                checked={(cfg.live_bots_scope || 'all') === s}
                onChange={() => setCfg({ ...cfg,
                  live_bots_scope: s })} />
              <span className="text-sm capitalize">
                {s === 'all' ? 'Every astrologer' : 'Specific astrologers'}
              </span>
            </label>
          ))}
        </div>
        {cfg.live_bots_scope === 'allowlist' && (
          <>
            <input className="input"
              placeholder="Search astrologers"
              value={astroQ}
              onChange={(e) => setAstroQ(e.target.value)} />
            <div className="max-h-72 space-y-1 overflow-y-auto
              rounded-card border border-gray-200 p-2">
              {filteredAstros.length === 0 ? (
                <div className="p-3 text-center text-sm
                  text-sub-text">No matches.</div>
              ) : filteredAstros.slice(0, 100).map((a) => {
                const checked = (cfg.live_bots_astro_uids || [])
                  .includes(a.id || a.uid);
                return (
                  <label key={a.id}
                    className="flex cursor-pointer items-center gap-2
                      rounded-md px-2 py-1 hover:bg-bg-light">
                    <input type="checkbox" checked={checked}
                      onChange={() => toggleAstro(a.id || a.uid)} />
                    <span className="flex-1 text-sm">{a.name
                      || '(no name)'}</span>
                    <span className="text-[10px] text-sub-text">
                      {a.email}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="text-[11px] text-sub-text">
              {(cfg.live_bots_astro_uids || []).length} astrologer(s)
              selected
            </div>
          </>
        )}
      </div>

      <button onClick={save} disabled={busy}
        className="w-full rounded-full bg-primary px-4 py-2.5 text-sm
          font-bold text-white disabled:opacity-50">
        {busy ? 'Saving...' : 'Save settings'}
      </button>

      {/* Diagnostic burst - lets the operator verify the entire
          pipeline (pool read + question pick + chat write + UI
          render) without waiting for the astrologer to actually
          go live or for a fresh astro-web deploy. Picks the target
          astrologer's uid, fires 3 joins + 2 comments into their
          chats/live_{uid}/messages collection, and reports
          successes / errors so the failing gate is visible. */}
      <div className="surface space-y-3 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Diagnostic burst
        </h2>
        <p className="text-[11px] text-sub-text">
          Sends 3 bot joins + 2 bot comments into the chosen
          astrologer&apos;s live chat right now. If the astrologer is
          live in a browser tab, the names + questions should appear
          within a second. If nothing appears, the issue is at the
          UI / deploy layer (astro-web not on the new bundle).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-md border border-gray-200
            bg-white px-2 py-2 text-sm" value={diagAstro}
            onChange={(e) => setDiagAstro(e.target.value)}>
            <option value="">Pick astrologer...</option>
            {(astros || []).map((a) => (
              <option key={a.id || a.uid} value={a.id || a.uid}>
                {a.name || '(no name)'}
                {a.email ? ` (${a.email})` : ''}
              </option>
            ))}
          </select>
          <button onClick={async () => {
            if (!diagAstro) { flash('Pick an astrologer.', 'error');
              return; }
            setBusy(true); setDiagOut(null);
            try {
              const r = await liveBotService
                .fireDiagnosticBurst(diagAstro);
              setDiagOut(r);
              flash(`Fired ${r.joins + r.comments} event(s).`,
                'success');
            } catch (e) {
              flash(String((e && e.message) || e), 'error');
            } finally { setBusy(false); }
          }} disabled={busy || !diagAstro}
            className="rounded-full bg-emerald-100 px-3 py-1.5
              text-xs font-bold text-emerald-800
              disabled:opacity-50">
            Fire 5 events now
          </button>
        </div>
        {diagOut && (
          <div className="rounded-card bg-bg-light p-3 text-[12px]
            font-mono">
            <div>joins: {diagOut.joins} / 3</div>
            <div>comments: {diagOut.comments} / 2</div>
            {diagOut.errors.length > 0 && (
              <div className="mt-1 text-danger">
                errors:
                <ul className="ml-4 list-disc">
                  {diagOut.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
