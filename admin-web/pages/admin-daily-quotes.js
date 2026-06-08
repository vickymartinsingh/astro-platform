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

      {/* Live preview - one card for the guest greeting and one for
          the logged-in greeting so the operator can see BOTH states
          before saving. Both share the same toggles + subtitle +
          quote pool; only the headline differs. */}
      <section className="mb-5">
        <div className="mb-2 text-[11px] font-bold uppercase
          tracking-wider text-sub-text">
          Live preview (today's quote)
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewCard label="Guest / no name"
            headline={state.title || DEFAULTS.title}
            subtitle={state.subtitle}
            quote={todayQuote}
            dim={!state.enabled} />
          <PreviewCard
            label="Logged in (sample name: Vicky)"
            headline={dailyQuoteService.resolveTitle(
              state, { name: 'Vicky Martin' })}
            subtitle={state.subtitle}
            quote={todayQuote}
            dim={!state.enabled} />
        </div>
        {!state.enabled && (
          <div className="mt-1 text-[11px] text-sub-text">
            Banner is OFF. Customers do not see this card.
          </div>
        )}
      </section>

      {/* Visibility (per-device, same pattern as the hero banner) +
          copy. The banner is shown only on the devices the operator
          enabled; both off => fully hidden. */}
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
          Both off hides the card everywhere. Mirror of the home hero
          pattern so you can flip mobile on first, watch how it
          looks, then enable desktop.
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
          <Field label="Subtitle (optional, leave empty to hide)"
            span="sm:col-span-2">
            <input className="input" maxLength={40}
              placeholder="Leave empty - no kicker line shown"
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

// PreviewCard - shared chrome between the two side-by-side previews
// (guest vs logged-in). The headline already has [Name] substituted
// before it lands here; this component only handles the styling.
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
