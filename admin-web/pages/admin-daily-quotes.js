import { useEffect, useMemo, useRef, useState } from 'react';
import { dailyQuoteService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-daily-quotes - manage the "Hey, Cosmic Explorer + Quote for
// the day" banner on the customer home (2026-06-07 spec).
//
// Features the operator asked for:
//   - enable / disable toggle (default OFF; banner hidden when OFF)
//   - editable banner title + subtitle, live preview
//   - quotes: add single, edit inline, delete, search
//   - CSV upload (one quote per line OR first column of a CSV)
//   - 30 starter quotes loaded the first time the doc is empty
//   - HARD rule: no hyphens or dashes inside a quote - we sanitise
//     on every save and visually warn on input
//   - "Save & publish" button writes to settings/dailyQuotes; the
//     customer dashboard's onSnapshot picks it up live

const { DEFAULTS, sanitiseQuote, isValidQuote, parseQuotesCsv,
  quoteForToday } = dailyQuoteService;

export default function AdminDailyQuotes() {
  const { loading } = useRequireAdmin();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState('');
  const [editIdx, setEditIdx] = useState(-1);
  const [editVal, setEditVal] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (loading) return;
    (async () => {
      const cur = await dailyQuoteService.getDailyQuotes();
      // When the doc is empty or has no quotes saved yet, seed the
      // pool with the 30 defaults so the operator sees a populated
      // list straight away.
      if (!cur.quotes || cur.quotes.length === 0) {
        setState({ ...cur, quotes: [...DEFAULTS.quotes] });
      } else {
        setState(cur);
      }
    })();
  }, [loading]);

  // Filtered + indexed view for the list panel (we keep the original
  // index alongside so edit/delete still reference the source array).
  const filtered = useMemo(() => {
    if (!state) return [];
    const t = filter.trim().toLowerCase();
    return state.quotes.map((q, i) => ({ q, i }))
      .filter(({ q }) => !t || q.toLowerCase().includes(t));
  }, [state, filter]);

  // Cleaned-up draft preview as the operator types - we show what
  // will be SAVED so there are no surprises (em-dashes / hyphens go
  // away under their nose).
  const draftPreview = sanitiseQuote(draft);
  const draftHasStripped = draft.length > 0
    && draftPreview !== draft.trim();

  function addQuote() {
    if (!isValidQuote(draft)) {
      flash('Quote is empty or all dashes - please type some words.',
        'error'); return;
    }
    setState((s) => ({ ...s,
      quotes: [...s.quotes, sanitiseQuote(draft)] }));
    setDraft('');
  }

  function startEdit(i) {
    setEditIdx(i);
    setEditVal(state.quotes[i]);
  }
  function saveEdit() {
    if (!isValidQuote(editVal)) {
      flash('Quote is empty or all dashes.', 'error'); return;
    }
    setState((s) => {
      const next = s.quotes.slice();
      next[editIdx] = sanitiseQuote(editVal);
      return { ...s, quotes: next };
    });
    setEditIdx(-1);
    setEditVal('');
  }
  function cancelEdit() { setEditIdx(-1); setEditVal(''); }

  function removeQuote(i) {
    if (!window.confirm('Delete this quote?')) return;
    setState((s) => ({ ...s,
      quotes: s.quotes.filter((_, j) => j !== i) }));
  }

  function loadSeedQuotes() {
    if (!window.confirm('Replace the current list with the 30 default '
      + 'AstroSeer quotes? Your unsaved edits will be lost.')) return;
    setState((s) => ({ ...s, quotes: [...DEFAULTS.quotes] }));
  }

  function onCsvPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = parseQuotesCsv(text);
        if (parsed.length === 0) {
          flash('CSV had no usable quotes.', 'error'); return;
        }
        // De-dupe against what we already have (case-insensitive).
        setState((s) => {
          const seen = new Set(s.quotes.map((q) => q.toLowerCase()));
          const added = [];
          parsed.forEach((q) => {
            const k = q.toLowerCase();
            if (!seen.has(k)) { seen.add(k); added.push(q); }
          });
          flash(`Imported ${added.length} new quote(s) `
            + `(${parsed.length - added.length} duplicates skipped).`);
          return { ...s, quotes: [...s.quotes, ...added] };
        });
      } catch (e2) {
        flash(`CSV import failed: ${e2?.message || e2}`, 'error');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  }

  async function save() {
    setBusy(true);
    try {
      const written = await dailyQuoteService.saveDailyQuotes(state);
      flash(`Saved. ${written} quote(s) published, banner ${
        state.enabled ? 'live' : 'hidden'}.`);
    } catch (e) {
      flash(`Save failed: ${e?.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  if (loading || !state) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const todayQuote = quoteForToday(state.quotes, new Date());

  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-dark-text">
          Daily quote banner
        </h1>
        <p className="mt-1 text-sm text-sub-text">
          "Hey, Cosmic Explorer" + a rotating quote on the customer
          home. Default off; flip the toggle, click Save, and it goes
          live to every open app instantly.
        </p>
      </header>

      {/* Live preview - matches the customer banner exactly. */}
      <section className="mb-5">
        <div className="mb-2 text-[11px] font-bold uppercase
          tracking-wider text-sub-text">
          Live preview (today's quote)
        </div>
        <div
          className={`overflow-hidden rounded-2xl text-white shadow-sm ${
            state.enabled ? '' : 'opacity-50'}`}
          style={{
            background: 'linear-gradient(135deg, #2A1410 0%, '
              + '#4a1212 45%, #7F2020 100%)',
          }}>
          <div className="relative px-5 py-4 sm:px-6 sm:py-5">
            <span aria-hidden style={{
              position: 'absolute', top: 8, right: 14,
              fontSize: 14, opacity: 0.65,
            }}>✦</span>
            <div className="text-[11px] font-bold uppercase
              tracking-widest text-[#D4A12A]">
              {state.subtitle || 'Quote for the day'}
            </div>
            <h3 className="mt-1 text-lg font-bold sm:text-xl">
              {state.title || DEFAULTS.title}
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-snug
              text-white/90 sm:text-base">
              {todayQuote}
            </p>
          </div>
        </div>
        {!state.enabled && (
          <div className="mt-1 text-[11px] text-sub-text">
            Banner is OFF. Customers do not see this card.
          </div>
        )}
      </section>

      {/* Toggle + copy */}
      <section className="surface mb-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-dark-text">
              {state.enabled ? 'Banner is showing' : 'Banner is hidden'}
            </div>
            <div className="text-[11px] text-sub-text">
              Toggle off to instantly hide the card from every
              customer; toggle on + Save to roll it out.
            </div>
          </div>
          <button type="button"
            onClick={() =>
              setState((s) => ({ ...s, enabled: !s.enabled }))}
            className={`relative h-7 w-12 rounded-full transition ${
              state.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-1 inline-block h-5 w-5
              rounded-full bg-white shadow transition ${
                state.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className="input" maxLength={40}
              value={state.title}
              onChange={(e) =>
                setState((s) => ({ ...s, title: e.target.value }))} />
          </Field>
          <Field label="Subtitle (small kicker)">
            <input className="input" maxLength={40}
              value={state.subtitle}
              onChange={(e) =>
                setState((s) => ({ ...s, subtitle: e.target.value }))} />
          </Field>
        </div>
      </section>

      {/* Quote pool */}
      <section className="surface mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between
          gap-2">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider
              text-sub-text">
              Quote pool · {state.quotes.length} loaded
            </h2>
            <p className="text-[11px] text-sub-text">
              One quote is shown per calendar day, picked by day of
              year so the same line stays visible all day across
              every device.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()}
              className="rounded-full border border-primary px-3 py-1.5
                text-xs font-bold text-primary">
              Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain"
              onChange={onCsvPick} className="hidden" />
            <button type="button" onClick={loadSeedQuotes}
              className="rounded-full border border-gray-300 px-3 py-1.5
                text-xs font-bold text-sub-text">
              Restore 30 defaults
            </button>
          </div>
        </div>

        {/* Add single */}
        <div className="mt-3 rounded-card bg-bg-light p-3">
          <div className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Add a new quote</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <input className="input flex-1 min-w-[14rem]"
              maxLength={200}
              placeholder="The universe noticed your return."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuote();
              }} />
            <button onClick={addQuote}
              disabled={!isValidQuote(draft)}
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

        {/* Search */}
        <div className="mt-3 max-w-sm">
          <input className="input" type="search"
            placeholder="Search quotes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)} />
        </div>

        {/* List */}
        <ul className="mt-3 divide-y divide-gray-200">
          {filtered.map(({ q, i }) => (
            <li key={i} className="py-2">
              {editIdx === i ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input flex-1 min-w-[14rem]"
                    maxLength={200} value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
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
                  <span className="w-7 shrink-0 text-right
                    font-mono text-[10px] text-sub-text">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-dark-text">
                    {q}
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
          ))}
          {filtered.length === 0 && (
            <li className="py-4 text-center text-xs text-sub-text">
              {filter ? 'No quotes match that search.'
                : 'No quotes yet. Add one above or upload a CSV.'}
            </li>
          )}
        </ul>
      </section>

      {/* CSV format helper */}
      <details className="surface mb-4 p-4 text-xs text-sub-text">
        <summary className="cursor-pointer font-bold">
          CSV format
        </summary>
        <p className="mt-2">
          One quote per line. A header row labelled <code>quote</code>
          is auto-detected and skipped. Multi-column CSVs use the
          first column. Lines with only dashes / hyphens are
          rejected automatically.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-card bg-bg-light
          p-2 text-[11px]">{
`quote
The universe noticed your return.
You have arrived when you needed to.
The stars made room for you today.`
}</pre>
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

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
