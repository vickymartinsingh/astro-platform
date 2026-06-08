import { useEffect, useMemo, useRef, useState } from 'react';
import { dailyQuoteService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-daily-quotes - manage the "Hey, Cosmic Explorer + Quote for
// the day" banner on the customer home (2026-06-08 rewrite).
//
// What changed in the date-scheduled rewrite:
//   - Quotes are now { date: YYYY-MM-DD, text } entries pinned to IST
//     calendar days. The customer sees the entry whose date matches
//     "today" (IST); if nothing is scheduled, the banner hides.
//   - The default list view shows Upcoming (today + future) only;
//     past dates are hidden but available via the All / Custom
//     filter chips so the operator can audit history.
//   - CSV upload accepts date,quote rows; a "Download template" link
//     gives the operator a head-start with three sample rows; a
//     "Download current schedule" link exports what's loaded.

const {
  DEFAULTS, sanitiseQuote, isValidQuote, isValidDateStr,
  parseQuotesCsv, serializeCsv, templateCsv,
  quoteForToday, istToday, istDateStr, addDaysIst,
} = dailyQuoteService;

// Filter chips. 'upcoming' is the default the operator lands on so
// only today + future shows; 'past' / 'all' surface archive material.
const RANGE_CHIPS = [
  ['upcoming', 'Upcoming'],
  ['today',    'Today'],
  ['week',     'This week'],
  ['month',    'This month'],
  ['year',     'This year'],
  ['past',     'Past'],
  ['all',      'All'],
  ['custom',   'Custom range'],
];

// Trigger a file download from a string.
function downloadString(text, filename, mime = 'text/csv') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export default function AdminDailyQuotes() {
  const { loading } = useRequireAdmin();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  // Quote list filters
  const [range, setRange] = useState('upcoming');
  const [customFrom, setCustomFrom] = useState(istToday());
  const [customTo, setCustomTo] = useState(addDaysIst(istToday(), 7));
  const [search, setSearch] = useState('');

  // Add-new form
  const [draftDate, setDraftDate] = useState(istToday());
  const [draftText, setDraftText] = useState('');

  // Inline edit
  const [editIdx, setEditIdx] = useState(-1);
  const [editDate, setEditDate] = useState('');
  const [editText, setEditText] = useState('');

  const fileRef = useRef(null);

  useEffect(() => {
    if (loading) return;
    (async () => { setState(await dailyQuoteService.getDailyQuotes()); })();
  }, [loading]);

  // Derive the date-bounded window the current chip implies.
  const dateWindow = useMemo(() => {
    const today = istToday();
    if (range === 'today') return { from: today, to: today };
    if (range === 'week') {
      // ISO week starting Monday in IST. JS getUTCDay returns Sun=0,
      // we want Mon-anchored: ((day + 6) % 7) days back to Monday.
      const [y, m, d] = today.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      const dow = date.getUTCDay();
      const back = (dow + 6) % 7;
      return {
        from: addDaysIst(today, -back),
        to: addDaysIst(today, 6 - back),
      };
    }
    if (range === 'month') {
      const [y, m] = today.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return {
        from: `${y}-${String(m).padStart(2, '0')}-01`,
        to: `${y}-${String(m).padStart(2, '0')}-${
          String(last).padStart(2, '0')}`,
      };
    }
    if (range === 'year') {
      const y = Number(today.slice(0, 4));
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    if (range === 'past') return { from: '0000-00-00', to:
      addDaysIst(today, -1) };
    if (range === 'all') return { from: '0000-00-00', to: '9999-12-31' };
    if (range === 'custom') {
      return {
        from: customFrom || '0000-00-00',
        to: customTo || '9999-12-31',
      };
    }
    // upcoming (default)
    return { from: today, to: '9999-12-31' };
  }, [range, customFrom, customTo]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const term = search.trim().toLowerCase();
    return state.quotes
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => {
        if (!q || !q.date) return false;
        if (q.date < dateWindow.from || q.date > dateWindow.to) {
          return false;
        }
        if (term && !q.text.toLowerCase().includes(term)) return false;
        return true;
      });
  }, [state, search, dateWindow]);

  const draftPreview = sanitiseQuote(draftText);
  const draftHasStripped = draftText.length > 0
    && draftPreview !== draftText.trim();
  const canAdd = isValidDateStr(draftDate) && isValidQuote(draftText);

  function addQuote() {
    if (!canAdd) {
      flash('Pick a valid date and type a real quote.', 'error');
      return;
    }
    setState((s) => {
      // If the operator picks an existing date, replace its text.
      const arr = (s.quotes || []).filter(
        (q) => q.date !== draftDate);
      arr.push({ date: draftDate, text: sanitiseQuote(draftText) });
      arr.sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, quotes: arr };
    });
    setDraftText('');
    // Auto-advance the date so the operator can rapid-fire several
    // upcoming entries.
    setDraftDate(addDaysIst(draftDate, 1));
  }

  function startEdit(i) {
    const q = state.quotes[i];
    setEditIdx(i);
    setEditDate(q.date);
    setEditText(q.text);
  }
  function saveEdit() {
    if (!isValidDateStr(editDate) || !isValidQuote(editText)) {
      flash('Date or quote is invalid.', 'error'); return;
    }
    setState((s) => {
      const arr = s.quotes.slice();
      // If date changed and collides with another entry, drop the
      // other (the edit wins).
      const other = arr.findIndex(
        (q, j) => j !== editIdx && q.date === editDate);
      if (other !== -1) arr.splice(other, 1);
      // Adjust index because we may have just spliced.
      const tgt = other !== -1 && other < editIdx
        ? editIdx - 1 : editIdx;
      arr[tgt] = { date: editDate, text: sanitiseQuote(editText) };
      arr.sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, quotes: arr };
    });
    setEditIdx(-1);
  }
  function cancelEdit() { setEditIdx(-1); }

  function removeQuote(i) {
    if (!confirm('Delete this scheduled quote?')) return;
    setState((s) => ({
      ...s, quotes: s.quotes.filter((_, j) => j !== i),
    }));
  }

  function loadSeed() {
    if (!confirm('Replace your schedule with 30 default quotes '
      + 'starting today? Your unsaved edits will be lost.')) return;
    const today = istToday();
    setState((s) => ({
      ...s,
      quotes: [
        'The universe noticed your return.',
        'You have arrived when you needed to.',
        'Another day, another sign to grow.',
        'The stars made room for you today.',
        'Today the cosmos quietly believes in you.',
        'Something kind is on its way to you.',
        'Your timing is wiser than you know.',
        'The sky has plans for you today.',
        'Small steps, blessed by big stars.',
        'Even the moon waits patiently.',
        'The light always finds its way home.',
        'Today opens with you in mind.',
        'The stars love a slow start too.',
        'You are exactly where you are meant to be.',
        'The cosmos is rooting for you quietly.',
        'Trust the soft pull of this day.',
        'The universe speaks first in stillness.',
        'Your story is being written in stardust.',
        'Something good is choosing you today.',
        'A gentle day, by cosmic design.',
        'The stars rearranged themselves for you.',
        'Today carries a quiet kind of magic.',
        'Your path is lit, even when you cannot see it.',
        'The cosmos saved this moment for you.',
        'Breathe. The universe has time.',
        'New light arrives in old places today.',
        'The stars say take it gently.',
        'A small wonder waits in your day.',
        'The universe is rearranging things in your favour.',
        'You are right on time, by cosmic clock.',
      ].map((text, i) => ({ date: addDaysIst(today, i), text })),
    }));
  }

  function onCsvPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseQuotesCsv(String(reader.result || ''));
        if (parsed.length === 0) {
          flash('CSV had no usable rows. Expected date,quote.',
            'error'); return;
        }
        setState((s) => {
          const byDate = new Map(
            (s.quotes || []).map((q) => [q.date, q]));
          let added = 0; let updated = 0;
          parsed.forEach((row) => {
            if (byDate.has(row.date)) updated += 1;
            else added += 1;
            byDate.set(row.date, row);
          });
          const merged = Array.from(byDate.values())
            .sort((a, b) => a.date.localeCompare(b.date));
          flash(`CSV imported: ${added} new, `
            + `${updated} date(s) updated.`);
          return { ...s, quotes: merged };
        });
      } catch (e2) {
        flash(`CSV import failed: ${e2?.message || e2}`, 'error');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  }

  function downloadCurrent() {
    if (!state) return;
    downloadString(serializeCsv(state.quotes),
      `daily-quotes-${istToday()}.csv`);
  }
  function downloadTemplate() {
    downloadString(templateCsv(), 'daily-quotes-template.csv');
  }

  async function save() {
    setBusy(true);
    try {
      const written = await dailyQuoteService.saveDailyQuotes(state);
      flash(`Saved. ${written} scheduled quote(s); banner ${
        state.enabled ? 'live' : 'hidden'}.`);
    } catch (e) {
      flash(`Save failed: ${e?.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  if (loading || !state) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const todayStr = istToday();
  const todayQuote = quoteForToday(state.quotes, todayStr);

  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-dark-text">
          Daily quote banner
        </h1>
        <p className="mt-1 text-sm text-sub-text">
          Schedule a cosmic quote for each day. Customers see the one
          pinned to TODAY in IST; the banner hides when nothing is
          scheduled. CSV upload + download lets you plan a quarter
          of quotes in a spreadsheet.
        </p>
      </header>

      {/* Live preview - guest + logged-in */}
      <section className="mb-5">
        <div className="mb-2 text-[11px] font-bold uppercase
          tracking-wider text-sub-text">
          Live preview · today ({todayStr} IST)
        </div>
        {todayQuote ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewCard label="Guest / no name"
              headline={state.title || DEFAULTS.title}
              subtitle={state.subtitle}
              quote={todayQuote}
              dim={!state.enabled} />
            <PreviewCard
              label="Logged in (sample name: Vicky)"
              headline={dailyQuoteService.resolveTitle(state,
                { name: 'Vicky Martin' })}
              subtitle={state.subtitle}
              quote={todayQuote}
              dim={!state.enabled} />
          </div>
        ) : (
          <div className="rounded-card bg-amber-50 px-4 py-3
            text-sm text-amber-900">
            No quote scheduled for today ({todayStr} IST). The banner
            stays hidden until you add one below.
          </div>
        )}
        {!state.enabled && (
          <div className="mt-1 text-[11px] text-sub-text">
            Banner is OFF on both devices. Customers do not see this
            card.
          </div>
        )}
      </section>

      {/* Visibility + copy (same as the hero pattern) */}
      <section className="surface mb-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">Visibility</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DeviceToggle label="Show on mobile / app"
            on={!!state.showMobile}
            onChange={(v) => setState((s) =>
              ({ ...s, showMobile: v, enabled: v || s.showDesktop }))} />
          <DeviceToggle label="Show on desktop / web"
            on={!!state.showDesktop}
            onChange={(v) => setState((s) =>
              ({ ...s, showDesktop: v, enabled: v || s.showMobile }))} />
        </div>
        <p className="mt-2 text-[11px] text-sub-text">
          Both off hides the card everywhere.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Title shown to guests"
            hint="Used when no one is logged in, or the logged-in user has no name on file.">
            <input className="input" maxLength={40}
              placeholder="Hey, Cosmic Explorer"
              value={state.title}
              onChange={(e) =>
                setState((s) => ({ ...s, title: e.target.value }))} />
          </Field>
          <Field label="Title shown to logged-in users"
            hint="Use [Name] to drop in the user's first name. Leave empty to use the guest title for everyone.">
            <input className="input" maxLength={40}
              placeholder="Hello, [Name]"
              value={state.titleAuthed || ''}
              onChange={(e) =>
                setState((s) =>
                  ({ ...s, titleAuthed: e.target.value }))} />
          </Field>
          <Field label="Subtitle (optional)"
            span="sm:col-span-2">
            <input className="input" maxLength={40}
              placeholder="Leave empty - no kicker line shown"
              value={state.subtitle}
              onChange={(e) =>
                setState((s) => ({ ...s, subtitle: e.target.value }))} />
          </Field>
        </div>
      </section>

      {/* Schedule */}
      <section className="surface mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between
          gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider
            text-sub-text">
            Schedule · {state.quotes.length} total · {filtered.length}
            {' '}shown
          </h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="rounded-full border border-primary px-3 py-1.5
                text-xs font-bold text-primary">
              Upload CSV
            </button>
            <input ref={fileRef} type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onCsvPick} className="hidden" />
            <button type="button" onClick={downloadCurrent}
              className="rounded-full border border-gray-300 px-3
                py-1.5 text-xs font-bold text-sub-text">
              Download CSV
            </button>
            <button type="button" onClick={downloadTemplate}
              className="rounded-full border border-gray-300 px-3
                py-1.5 text-xs font-bold text-sub-text">
              Download template
            </button>
            <button type="button" onClick={loadSeed}
              className="rounded-full border border-gray-300 px-3
                py-1.5 text-xs font-bold text-sub-text">
              Restore 30 defaults
            </button>
          </div>
        </div>

        {/* Add */}
        <div className="mt-3 rounded-card bg-bg-light p-3">
          <div className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Add a new quote</div>
          <div className="mt-1 flex flex-wrap items-start gap-2">
            <input type="date" className="input"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              style={{ maxWidth: '12rem' }} />
            <input className="input flex-1 min-w-[14rem]"
              maxLength={200}
              placeholder="Quote text…"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canAdd) addQuote();
              }} />
            <button onClick={addQuote} disabled={!canAdd}
              className="rounded-full bg-primary px-4 py-2 text-xs
                font-bold text-white disabled:opacity-50">
              Add
            </button>
          </div>
          {draftHasStripped && (
            <div className="mt-1 text-[11px] text-amber-700">
              Dashes / hyphens removed. Will save as:
              <i className="ml-1 font-semibold">{draftPreview}</i>
            </div>
          )}
        </div>

        {/* Filter chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {RANGE_CHIPS.map(([k, label]) => (
            <button key={k} type="button"
              onClick={() => setRange(k)}
              className={`rounded-full border px-3 py-1 text-[11px]
                font-bold ${range === k
                  ? 'border-primary bg-primary text-white'
                  : 'border-gray-300 bg-white text-sub-text'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        {range === 'custom' && (
          <div className="mt-2 flex flex-wrap items-center gap-2
            text-xs text-sub-text">
            <span>From</span>
            <input type="date" className="input"
              style={{ maxWidth: '12rem' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)} />
            <span>to</span>
            <input type="date" className="input"
              style={{ maxWidth: '12rem' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}

        {/* Search */}
        <div className="mt-3 max-w-sm">
          <input className="input" type="search"
            placeholder="Search quotes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>

        {/* List */}
        <ul className="mt-3 divide-y divide-gray-200">
          {filtered.map(({ q, i }) => {
            const isPast = q.date < todayStr;
            const isToday = q.date === todayStr;
            return (
              <li key={`${q.date}-${i}`} className="py-2">
                {editIdx === i ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="date" className="input"
                      style={{ maxWidth: '11rem' }}
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)} />
                    <input className="input flex-1 min-w-[14rem]"
                      maxLength={200} value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }} />
                    <button onClick={saveEdit}
                      className="rounded-full bg-primary px-3 py-1
                        text-[11px] font-bold text-white">
                      Save
                    </button>
                    <button onClick={cancelEdit}
                      className="rounded-full border border-gray-300
                        px-3 py-1 text-[11px] font-bold text-sub-text">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2
                      py-0.5 text-[10px] font-bold ${isToday
                        ? 'bg-emerald-100 text-emerald-800'
                        : isPast
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-amber-50 text-amber-800'}`}>
                      {q.date}
                      {isToday ? ' · today' : ''}
                    </span>
                    <span className="flex-1 text-sm text-dark-text">
                      {q.text}
                    </span>
                    <button onClick={() => startEdit(i)}
                      className="rounded-full border border-primary
                        px-3 py-1 text-[11px] font-bold text-primary">
                      Edit
                    </button>
                    <button onClick={() => removeQuote(i)}
                      className="rounded-full border border-rose-300
                        bg-rose-50 px-3 py-1 text-[11px] font-bold
                        text-rose-700">
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="py-4 text-center text-xs text-sub-text">
              {state.quotes.length === 0
                ? 'No quotes scheduled yet. Add one above or upload a CSV.'
                : 'Nothing in this view. Try a different filter or '
                  + 'switch to All.'}
            </li>
          )}
        </ul>
      </section>

      {/* CSV format helper */}
      <details className="surface mb-4 p-4 text-xs text-sub-text">
        <summary className="cursor-pointer font-bold">CSV format</summary>
        <p className="mt-2">
          Two columns: <code>date</code> (YYYY-MM-DD, IST) and
          {' '}<code>quote</code>. A header row is auto-detected; if
          you skip it we try to detect the date column. Rows with an
          invalid date are dropped silently.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-card bg-bg-light
          p-2 text-[11px]">{
`date,quote
${istToday()},The universe noticed your return.
${addDaysIst(istToday(), 1)},Another day, another sign to grow.
${addDaysIst(istToday(), 2)},Small steps, blessed by big stars.`
}</pre>
        <p className="mt-2">
          Tip: download the current schedule, edit dates / quotes in
          Excel or Numbers, and re-upload to replace them. Uploaded
          dates that already exist overwrite the old text.
        </p>
      </details>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy}
          className="rounded-full bg-primary px-5 py-2 text-sm
            font-bold text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
      </div>
    </Layout>
  );
}

function Field({ label, hint, span, children }) {
  return (
    <div className={span || ''}>
      <label className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && (
        <div className="mt-1 text-[10px] text-sub-text">{hint}</div>
      )}
    </div>
  );
}

function DeviceToggle({ label, on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`flex items-center justify-between rounded-card
        px-4 py-3 text-sm font-semibold transition ${on
          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
          : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200'}`}>
      <span>{label}</span>
      <span className={`relative inline-block h-5 w-9 rounded-full
        transition ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 inline-block h-4 w-4
          rounded-full bg-white shadow transition ${on
            ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function PreviewCard({ label, headline, subtitle, quote, dim }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase
        tracking-wider text-sub-text">{label}</div>
      <div
        className={`overflow-hidden rounded-2xl text-white shadow-sm ${
          dim ? 'opacity-50' : ''}`}
        style={{
          background: 'linear-gradient(135deg, #2A1410 0%, '
            + '#4a1212 45%, #7F2020 100%)',
        }}>
        <div className="relative px-5 py-4 sm:px-6 sm:py-5">
          <span aria-hidden style={{
            position: 'absolute', top: 8, right: 14,
            fontSize: 14, opacity: 0.65,
          }}>✦</span>
          {subtitle && (
            <div className="text-[11px] font-bold uppercase
              tracking-widest text-[#D4A12A]">
              {subtitle}
            </div>
          )}
          <h3 className={`${subtitle ? 'mt-1' : ''}
            text-lg font-bold sm:text-xl`}>
            {headline}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-snug
            text-white/90 sm:text-base">
            {quote}
          </p>
        </div>
      </div>
    </div>
  );
}
