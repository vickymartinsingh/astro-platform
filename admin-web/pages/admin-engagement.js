import { useEffect, useState, useCallback, useRef } from 'react';
import { engagementService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// /admin-engagement
//
// Full management console for the engagement tile system and the
// points-to-wallet economy. Everything persists to
// settings/engagement and takes effect immediately on client
// refresh. No deploy needed.
//
// Sections:
//   1. Points configuration (rate, min redemption, master toggle)
//   2. Tiles list (reorder, enable/disable, inline edit)
//   3. Per-tile content editor (type-aware: learn/quiz/manifest/comic/tarot)
//   4. Save button

const TILE_TYPES = [
  { id: 'learn', label: 'Learn' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'manifest', label: 'Manifest' },
  { id: 'comic', label: 'Comic' },
  { id: 'tarot', label: 'Tarot' },
  { id: 'custom', label: 'Custom' },
];

const TYPE_COLORS = {
  learn: 'bg-amber-100 text-amber-800',
  quiz: 'bg-rose-100 text-rose-800',
  manifest: 'bg-emerald-100 text-emerald-800',
  comic: 'bg-sky-100 text-sky-800',
  tarot: 'bg-red-100 text-red-800',
  custom: 'bg-gray-100 text-gray-700',
};

function uid() {
  return 'tile_' + Date.now().toString(36) + '_'
    + Math.random().toString(36).slice(2, 8);
}

export default function AdminEngagement() {
  const { loading } = useRequireAdmin();
  const [cfg, setCfg] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [points, setPoints] = useState({
    pointsToInr: 10000,
    minRedemptionInr: 100,
    enabled: true,
  });
  const [savedJson, setSavedJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState({});
  // Daily challenges state
  const [challenges, setChallenges] = useState([]);
  const [challengesDirty, setChallengesDirty] = useState(false);
  const [challengesBusy, setChallengesBusy] = useState(false);
  const [selectedChallenges, setSelectedChallenges] = useState({});
  const csvRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await engagementService.getEngagementConfig();
      setTiles(data.tiles || []);
      setPoints(data.pointsConfig || {
        pointsToInr: 10000, minRedemptionInr: 100, enabled: true,
      });
      setSavedJson(JSON.stringify(data));
      setCfg(data);
    } catch (e) {
      flash('Failed to load engagement config.', 'error');
    }
    try {
      const dc = await engagementService.getDailyChallenges();
      setChallenges((dc.challenges || [])
        .sort((a, b) => a.date < b.date ? -1 : 1));
    } catch (_) {}
  }, []);

  useEffect(() => { if (!loading) load(); }, [loading, load]);

  if (loading || !cfg) {
    return <Layout><div className="surface p-6">Loading...</div></Layout>;
  }

  const currentJson = JSON.stringify({ tiles, pointsConfig: points });
  const dirty = currentJson !== savedJson;

  // -- Points helpers --
  function setP(k, v) { setPoints((p) => ({ ...p, [k]: v })); }

  // -- Tile helpers --
  function setTile(idx, patch) {
    setTiles((prev) => prev.map((t, i) =>
      i === idx ? { ...t, ...patch } : t));
  }
  function moveTile(idx, dir) {
    setTiles((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((t, i) => ({ ...t, order: i }));
    });
  }
  function removeTile(idx) {
    if (!window.confirm('Remove this tile? This cannot be undone.')) return;
    setTiles((prev) => prev.filter((_, i) => i !== idx)
      .map((t, i) => ({ ...t, order: i })));
    setExpanded((prev) => { const n = { ...prev }; delete n[idx]; return n; });
  }
  function addTile() {
    const t = {
      id: uid(),
      name: 'New Tile',
      icon: '⭐',
      description: '',
      enabled: true,
      order: tiles.length,
      type: 'learn',
      pointsPerActivity: 10,
      content: { lessons: [] },
    };
    setTiles((prev) => [...prev, t]);
    setExpanded((prev) => ({ ...prev, [tiles.length]: true }));
  }
  async function loadDefaults() {
    if (!window.confirm(
      'Replace all tiles with the built-in defaults? '
      + 'Your current tile list will be overwritten.',
    )) return;
    const defaults = engagementService.getDefaultTiles();
    setTiles(defaults);
    flash('Default tiles loaded. Save to persist.');
  }
  function toggleExpand(idx) {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  // -- Content scaffold when changing tile type --
  function changeTileType(idx, newType) {
    const scaffolds = {
      learn: { lessons: [] },
      quiz: { questions: [] },
      manifest: { affirmations: [] },
      comic: { strips: [] },
      tarot: { cards: [] },
      custom: {},
    };
    setTile(idx, { type: newType, content: scaffolds[newType] || {} });
  }

  // -- Save --
  async function save() {
    setBusy(true);
    try {
      await engagementService.saveEngagementConfig({
        tiles,
        pointsConfig: {
          pointsToInr: Math.max(1, Math.round(Number(points.pointsToInr) || 10000)),
          minRedemptionInr: Math.max(0, Math.round(Number(points.minRedemptionInr) || 100)),
          enabled: !!points.enabled,
        },
      });
      const data = { tiles, pointsConfig: points };
      setSavedJson(JSON.stringify(data));
      flash('Engagement config saved. Changes are live.');
    } catch (e) {
      flash(`Save failed: ${e.message || e}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <Layout>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#7F2020' }}>
            Engagement
          </h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Manage engagement tiles, content, and the points-to-wallet
            economy. All changes take effect immediately.
          </p>
        </div>
        <button onClick={save} disabled={!dirty || busy}
          className="rounded-full px-5 py-2 text-sm font-bold text-white
            disabled:opacity-50"
          style={{ backgroundColor: dirty ? '#7F2020' : '#999' }}>
          {busy ? 'Saving...' : (dirty ? 'Save changes' : 'All saved')}
        </button>
      </div>

      {/* 1. Points Configuration */}
      <Section title="Points configuration">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Points per 100 INR
            </span>
            <input className="input mt-1" type="number" min="1"
              value={points.pointsToInr}
              onChange={(e) => setP('pointsToInr', e.target.value)} />
            <p className="mt-1 text-[11px] text-sub-text">
              How many points equal 100 INR when redeemed.
            </p>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-sub-text">
              Minimum redemption (INR)
            </span>
            <input className="input mt-1" type="number" min="0"
              value={points.minRedemptionInr}
              onChange={(e) => setP('minRedemptionInr', e.target.value)} />
            <p className="mt-1 text-[11px] text-sub-text">
              Users must accumulate at least this INR value before
              they can redeem.
            </p>
          </label>
          <div>
            <span className="text-xs font-semibold text-sub-text">
              Points system
            </span>
            <div className="mt-2 flex items-center gap-3">
              <Toggle on={!!points.enabled}
                onChange={(v) => setP('enabled', v)} />
              <span className={`text-sm font-semibold ${
                points.enabled ? 'text-emerald-700' : 'text-sub-text'
              }`}>
                {points.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-sub-text">
              When disabled, users cannot earn or redeem points.
            </p>
          </div>
        </div>
      </Section>

      {/* 2. Tiles Management */}
      <Section title="Tiles"
        right={
          <div className="flex gap-2">
            <button onClick={loadDefaults}
              className="rounded-full border px-3 py-1 text-[11px]
                font-bold hover:bg-gray-50"
              style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
              Load defaults
            </button>
            <button onClick={addTile}
              className="rounded-full px-3 py-1 text-[11px] font-bold
                text-white"
              style={{ backgroundColor: '#7F2020' }}>
              + Add tile
            </button>
          </div>
        }>
        {tiles.length === 0 && (
          <p className="py-4 text-center text-sm text-sub-text">
            No tiles yet. Click "Add tile" or "Load defaults" to begin.
          </p>
        )}
        <div className="space-y-2">
          {tiles.map((tile, idx) => (
            <div key={tile.id || idx}
              className="rounded-card border border-gray-200 bg-white">
              {/* Tile header row */}
              <div className="flex flex-wrap items-center gap-2 p-3">
                {/* Move arrows */}
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveTile(idx, -1)}
                    disabled={idx === 0}
                    className="grid h-5 w-5 place-items-center rounded
                      text-[10px] hover:bg-gray-100 disabled:opacity-30"
                    title="Move up">&#9650;</button>
                  <button onClick={() => moveTile(idx, 1)}
                    disabled={idx === tiles.length - 1}
                    className="grid h-5 w-5 place-items-center rounded
                      text-[10px] hover:bg-gray-100 disabled:opacity-30"
                    title="Move down">&#9660;</button>
                </div>

                {/* Enable/disable */}
                <Toggle on={!!tile.enabled}
                  onChange={(v) => setTile(idx, { enabled: v })} />

                {/* Icon */}
                <input className="w-10 rounded border border-gray-200
                  bg-gray-50 px-1 py-0.5 text-center text-lg"
                  value={tile.icon || ''}
                  onChange={(e) => setTile(idx, { icon: e.target.value })}
                  title="Icon (emoji)" />

                {/* Name */}
                <input className="input min-w-0 flex-1 text-sm font-semibold"
                  value={tile.name || ''}
                  onChange={(e) => setTile(idx, { name: e.target.value })}
                  placeholder="Tile name" />

                {/* Points */}
                <label className="flex items-center gap-1 text-[11px]
                  text-sub-text">
                  <span>Pts:</span>
                  <input className="input w-16 text-xs" type="number"
                    min="0"
                    value={tile.pointsPerActivity || 0}
                    onChange={(e) => setTile(idx, {
                      pointsPerActivity: Number(e.target.value) || 0,
                    })} />
                </label>

                {/* Type badge */}
                <span className={`rounded-full px-2 py-0.5 text-[10px]
                  font-bold uppercase ${TYPE_COLORS[tile.type] || TYPE_COLORS.custom}`}>
                  {tile.type || 'custom'}
                </span>

                {/* Expand/collapse */}
                <button onClick={() => toggleExpand(idx)}
                  className="grid h-7 w-7 place-items-center rounded
                    hover:bg-gray-100 text-sm"
                  title={expanded[idx] ? 'Collapse' : 'Expand content editor'}>
                  {expanded[idx] ? '▾' : '▸'}
                </button>

                {/* Remove */}
                <button onClick={() => removeTile(idx)}
                  className="grid h-7 w-7 place-items-center rounded
                    text-sm text-red-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove tile">&#10005;</button>
              </div>

              {/* Description row */}
              <div className="border-t border-gray-100 px-3 py-2">
                <input className="input w-full text-xs"
                  value={tile.description || ''}
                  onChange={(e) => setTile(idx, { description: e.target.value })}
                  placeholder="Short description shown to users" />
              </div>

              {/* Expanded content editor */}
              {expanded[idx] && (
                <div className="border-t border-gray-100 bg-gray-50/50 p-3">
                  {/* Type selector */}
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold text-sub-text">
                      Type:
                    </span>
                    <select className="input text-xs"
                      value={tile.type || 'custom'}
                      onChange={(e) => changeTileType(idx, e.target.value)}>
                      {TILE_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-sub-text">
                      Changing type resets content for this tile.
                    </span>
                  </div>

                  {tile.type === 'learn' && (
                    <LearnEditor content={tile.content}
                      onChange={(c) => setTile(idx, { content: c })} />
                  )}
                  {tile.type === 'quiz' && (
                    <QuizEditor content={tile.content}
                      onChange={(c) => setTile(idx, { content: c })} />
                  )}
                  {tile.type === 'manifest' && (
                    <ManifestEditor content={tile.content}
                      onChange={(c) => setTile(idx, { content: c })} />
                  )}
                  {tile.type === 'comic' && (
                    <ComicEditor content={tile.content}
                      onChange={(c) => setTile(idx, { content: c })} />
                  )}
                  {tile.type === 'tarot' && (
                    <TarotEditor content={tile.content}
                      onChange={(c) => setTile(idx, { content: c })} />
                  )}
                  {tile.type === 'custom' && (
                    <p className="text-xs text-sub-text">
                      Custom tiles have no structured content editor.
                      Use the JSON config or code to manage content.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Daily Challenges */}
      <DailyChallengesSection
        challenges={challenges}
        setChallenges={(c) => { setChallenges(c); setChallengesDirty(true); }}
        selectedChallenges={selectedChallenges}
        setSelectedChallenges={setSelectedChallenges}
        csvRef={csvRef}
        busy={challengesBusy}
        dirty={challengesDirty}
        onSave={async () => {
          setChallengesBusy(true);
          try {
            await engagementService.saveDailyChallenges(challenges);
            setChallengesDirty(false);
            flash('Daily challenges saved.');
          } catch (e) {
            flash(`Save failed: ${e.message || e}`, 'error');
          } finally { setChallengesBusy(false); }
        }}
      />

      {/* Sticky bottom save */}
      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t
          border-gray-200 bg-white/95 px-4 py-3 backdrop-blur
          sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-sub-text">
              You have unsaved changes.
            </span>
            <button onClick={save} disabled={busy}
              className="rounded-full px-5 py-2 text-sm font-bold
                text-white disabled:opacity-50"
              style={{ backgroundColor: '#7F2020' }}>
              {busy ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ============================================================
// Section wrapper
// ============================================================
function Section({ title, children, right }) {
  return (
    <div className="surface mb-3 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider"
          style={{ color: '#7F2020' }}>{title}</h2>
        {right || null}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Toggle
// ============================================================
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition
        ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white
        shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ============================================================
// Content Editors
// ============================================================

// -- Learn: list of lessons with title + body + quiz question ----------
function LearnEditor({ content, onChange }) {
  const lessons = content?.lessons || [];
  const [expandedQ, setExpandedQ] = useState({});

  function setLesson(i, patch) {
    const next = lessons.map((l, j) => j === i ? { ...l, ...patch } : l);
    onChange({ ...content, lessons: next });
  }
  function setQuizQ(i, patch) {
    const current = lessons[i]?.quizQ || {
      q: '', options: ['', '', '', ''], correct: 0,
    };
    setLesson(i, { quizQ: { ...current, ...patch } });
  }
  function setQuizOption(i, oi, val) {
    const opts = [...((lessons[i]?.quizQ?.options) || ['', '', '', ''])];
    opts[oi] = val;
    setQuizQ(i, { options: opts });
  }
  function addLesson() {
    onChange({ ...content, lessons: [...lessons, { title: '', body: '', points: 10 }] });
  }
  function removeLesson(i) {
    onChange({ ...content, lessons: lessons.filter((_, j) => j !== i) });
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-sub-text">
        Lessons ({lessons.length})
        <span className="ml-1 font-normal">
          (each lesson can have a quiz question for anti-cheat points)
        </span>
      </div>
      <div className="space-y-2">
        {lessons.map((l, i) => (
          <div key={i} className="rounded border border-gray-200
            bg-white p-2 space-y-1">
            <div className="flex items-center gap-2">
              <input className="input flex-1 text-xs font-semibold"
                value={l.title || ''}
                onChange={(e) => setLesson(i, { title: e.target.value })}
                placeholder={`Lesson ${i + 1} title`} />
              <label className="flex items-center gap-1 text-[10px]
                text-sub-text">
                <span>Pts:</span>
                <input className="input w-14 text-[10px]" type="number"
                  min="0" value={l.points || 0}
                  onChange={(e) => setLesson(i, {
                    points: Number(e.target.value) || 0,
                  })} />
              </label>
              <button onClick={() => removeLesson(i)}
                className="text-xs text-red-400 hover:text-red-600">
                &#10005;
              </button>
            </div>
            <textarea className="input w-full text-[11px] h-16"
              value={l.body || ''}
              onChange={(e) => setLesson(i, { body: e.target.value })}
              placeholder="Lesson body text" />

            {/* Quiz question for this lesson */}
            <div className="border-t border-dashed border-gray-200 pt-1">
              <button type="button"
                onClick={() => setExpandedQ(
                  (p) => ({ ...p, [i]: !p[i] }))}
                className="text-[10px] font-semibold"
                style={{ color: '#D4A12A' }}>
                {expandedQ[i] ? '&#9660;' : '&#9658;'}{' '}
                {l.quizQ?.q ? 'Edit quiz question' : '+ Add quiz question (anti-cheat)'}
              </button>
              {expandedQ[i] && (
                <div className="mt-1 rounded bg-amber-50 p-2 space-y-1">
                  <input className="input w-full text-[11px] font-semibold"
                    value={l.quizQ?.q || ''}
                    onChange={(e) => setQuizQ(i, { q: e.target.value })}
                    placeholder="Quiz question for this lesson" />
                  <div className="grid grid-cols-2 gap-1">
                    {[0, 1, 2, 3].map((oi) => (
                      <div key={oi} className="flex items-center gap-1">
                        <input type="radio"
                          name={`lesson${i}_correct`}
                          checked={(l.quizQ?.correct ?? 0) === oi}
                          onChange={() => setQuizQ(i, { correct: oi })}
                          title="Correct answer" />
                        <input className={`input flex-1 text-[11px] ${
                          (l.quizQ?.correct ?? 0) === oi
                            ? 'border-emerald-400 bg-emerald-50' : ''}`}
                          value={(l.quizQ?.options || [])[oi] || ''}
                          onChange={(e) => setQuizOption(i, oi, e.target.value)}
                          placeholder={`Option ${oi + 1}`} />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-700">
                    Select the radio button next to the correct answer.
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <button onClick={addLesson}
        className="mt-2 rounded-full border px-3 py-1 text-[11px]
          font-bold hover:bg-gray-50"
        style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
        + Add lesson
      </button>
    </div>
  );
}

// -- Quiz: list of questions with q, 4 options, correct selector, points --
function QuizEditor({ content, onChange }) {
  const questions = content?.questions || [];
  function setQ(i, patch) {
    const next = questions.map((q, j) => j === i ? { ...q, ...patch } : q);
    onChange({ ...content, questions: next });
  }
  function setOption(qi, oi, val) {
    const opts = [...(questions[qi].options || ['', '', '', ''])];
    opts[oi] = val;
    setQ(qi, { options: opts });
  }
  function addQuestion() {
    onChange({
      ...content,
      questions: [...questions, {
        q: '', options: ['', '', '', ''], correct: 0, points: 15,
      }],
    });
  }
  function removeQuestion(i) {
    onChange({ ...content, questions: questions.filter((_, j) => j !== i) });
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-sub-text">
        Questions ({questions.length})
      </div>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={i} className="rounded border border-gray-200
            bg-white p-2 space-y-1">
            <div className="flex items-center gap-2">
              <input className="input flex-1 text-xs font-semibold"
                value={q.q || ''}
                onChange={(e) => setQ(i, { q: e.target.value })}
                placeholder={`Question ${i + 1}`} />
              <label className="flex items-center gap-1 text-[10px]
                text-sub-text">
                <span>Pts:</span>
                <input className="input w-14 text-[10px]" type="number"
                  min="0" value={q.points || 0}
                  onChange={(e) => setQ(i, {
                    points: Number(e.target.value) || 0,
                  })} />
              </label>
              <button onClick={() => removeQuestion(i)}
                className="text-xs text-red-400 hover:text-red-600">
                &#10005;
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {[0, 1, 2, 3].map((oi) => (
                <div key={oi} className="flex items-center gap-1">
                  <input type="radio" name={`q${i}_correct`}
                    checked={q.correct === oi}
                    onChange={() => setQ(i, { correct: oi })}
                    title="Mark as correct answer" />
                  <input className={`input flex-1 text-[11px] ${
                    q.correct === oi
                      ? 'border-emerald-400 bg-emerald-50' : ''}`}
                    value={(q.options || [])[oi] || ''}
                    onChange={(e) => setOption(i, oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button onClick={addQuestion}
        className="mt-2 rounded-full border px-3 py-1 text-[11px]
          font-bold hover:bg-gray-50"
        style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
        + Add question
      </button>
    </div>
  );
}

// -- Manifest: list of affirmations --
function ManifestEditor({ content, onChange }) {
  const affirmations = content?.affirmations || [];
  function setAff(i, patch) {
    const next = affirmations.map((a, j) => j === i ? { ...a, ...patch } : a);
    onChange({ ...content, affirmations: next });
  }
  function addAff() {
    onChange({
      ...content,
      affirmations: [...affirmations, { text: '', points: 5 }],
    });
  }
  function removeAff(i) {
    onChange({ ...content, affirmations: affirmations.filter((_, j) => j !== i) });
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-sub-text">
        Affirmations ({affirmations.length})
      </div>
      <div className="space-y-2">
        {affirmations.map((a, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea className="input flex-1 text-[11px] h-12"
              value={a.text || ''}
              onChange={(e) => setAff(i, { text: e.target.value })}
              placeholder={`Affirmation ${i + 1}`} />
            <label className="flex items-center gap-1 text-[10px]
              text-sub-text">
              <span>Pts:</span>
              <input className="input w-14 text-[10px]" type="number"
                min="0" value={a.points || 0}
                onChange={(e) => setAff(i, {
                  points: Number(e.target.value) || 0,
                })} />
            </label>
            <button onClick={() => removeAff(i)}
              className="mt-1 text-xs text-red-400 hover:text-red-600">
              &#10005;
            </button>
          </div>
        ))}
      </div>
      <button onClick={addAff}
        className="mt-2 rounded-full border px-3 py-1 text-[11px]
          font-bold hover:bg-gray-50"
        style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
        + Add affirmation
      </button>
    </div>
  );
}

// -- Comic: list of strips with title + imageUrl --
function ComicEditor({ content, onChange }) {
  const strips = content?.strips || [];
  function setStrip(i, patch) {
    const next = strips.map((s, j) => j === i ? { ...s, ...patch } : s);
    onChange({ ...content, strips: next });
  }
  function addStrip() {
    onChange({
      ...content,
      strips: [...strips, { title: '', imageUrl: '', points: 5 }],
    });
  }
  function removeStrip(i) {
    onChange({ ...content, strips: strips.filter((_, j) => j !== i) });
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-sub-text">
        Comic strips ({strips.length})
      </div>
      <div className="space-y-2">
        {strips.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded
            border border-gray-200 bg-white p-2">
            <input className="input flex-1 text-xs font-semibold"
              value={s.title || ''}
              onChange={(e) => setStrip(i, { title: e.target.value })}
              placeholder="Strip title" />
            <input className="input flex-1 text-[11px]"
              value={s.imageUrl || ''}
              onChange={(e) => setStrip(i, { imageUrl: e.target.value })}
              placeholder="Image URL" />
            <label className="flex items-center gap-1 text-[10px]
              text-sub-text">
              <span>Pts:</span>
              <input className="input w-14 text-[10px]" type="number"
                min="0" value={s.points || 0}
                onChange={(e) => setStrip(i, {
                  points: Number(e.target.value) || 0,
                })} />
            </label>
            <button onClick={() => removeStrip(i)}
              className="text-xs text-red-400 hover:text-red-600">
              &#10005;
            </button>
          </div>
        ))}
      </div>
      <button onClick={addStrip}
        className="mt-2 rounded-full border px-3 py-1 text-[11px]
          font-bold hover:bg-gray-50"
        style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
        + Add strip
      </button>
    </div>
  );
}

// -- Daily Challenges manager ---------------------------------------
// Props:
//   challenges        - array of { date, questions:[{q,options,correct,bonus}], enabled }
//   setChallenges     - setter (also marks dirty in parent)
//   selectedChallenges - Set<number> of selected indices
//   setSelectedChallenges - setter
//   csvRef            - ref forwarded to the hidden file input
//   busy / dirty / onSave
function DailyChallengesSection({
  challenges, setChallenges,
  selectedChallenges, setSelectedChallenges,
  csvRef, busy, dirty, onSave,
}) {
  const [expanded, setExpanded] = useState({});
  const [seedBusy, setSeedBusy] = useState(false);

  /* -------- helpers -------- */
  function patchChallenge(idx, patch) {
    setChallenges(challenges.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }
  function patchQuestion(cidx, qidx, patch) {
    const qs = (challenges[cidx].questions || []).map(
      (q, i) => i === qidx ? { ...q, ...patch } : q,
    );
    patchChallenge(cidx, { questions: qs });
  }
  function setQOption(cidx, qidx, oi, val) {
    const opts = [...((challenges[cidx].questions[qidx].options) || ['', '', '', ''])];
    opts[oi] = val;
    patchQuestion(cidx, qidx, { options: opts });
  }
  function addQuestion(cidx) {
    patchChallenge(cidx, {
      questions: [
        ...(challenges[cidx].questions || []),
        { q: '', options: ['', '', '', ''], correct: 0, bonus: 5 },
      ],
    });
  }
  function removeQuestion(cidx, qidx) {
    patchChallenge(cidx, {
      questions: (challenges[cidx].questions || []).filter((_, i) => i !== qidx),
    });
  }

  /* -------- bulk ops -------- */
  function addChallenge() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const newIdx = challenges.length;
    setChallenges([...challenges, {
      date: dateStr,
      questions: [{ q: '', options: ['', '', '', ''], correct: 0, bonus: 5 }],
      enabled: true,
    }]);
    setExpanded((p) => ({ ...p, [newIdx]: true }));
  }

  function removeChallenge(idx) {
    setChallenges(challenges.filter((_, i) => i !== idx));
    setSelectedChallenges(new Set(
      [...selectedChallenges]
        .filter((i) => i !== idx)
        .map((i) => (i > idx ? i - 1 : i)),
    ));
  }

  function removeSelected() {
    const selSet = selectedChallenges;
    setChallenges(challenges.filter((_, i) => !selSet.has(i)));
    setSelectedChallenges(new Set());
  }

  function removeAll() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete ALL daily challenges? This cannot be undone.')) return;
    setChallenges([]);
    setSelectedChallenges(new Set());
  }

  function toggleSelect(idx) {
    const s = new Set(selectedChallenges);
    if (s.has(idx)) s.delete(idx); else s.add(idx);
    setSelectedChallenges(s);
  }

  function toggleSelectAll() {
    if (selectedChallenges.size === challenges.length) {
      setSelectedChallenges(new Set());
    } else {
      setSelectedChallenges(new Set(challenges.map((_, i) => i)));
    }
  }

  /* -------- Seed 30 days -------- */
  async function seed30Days() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    setSeedBusy(true);
    try {
      const merged = await engagementService.seed30DayChallenges(today);
      setChallenges(merged);
      flash(`30-day sample challenges seeded. ${merged.length} total days in Firestore.`);
    } catch (e) {
      flash(`Seed failed: ${e.message || e}`, 'error');
    } finally { setSeedBusy(false); }
  }

  /* -------- CSV -------- */
  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = (ev.target.result || '')
          .split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) { flash('CSV has no data rows', 'error'); return; }
        // Skip header row
        const byDate = {};
        lines.slice(1).forEach((row) => {
          // Support commas inside quoted fields minimally: split on first 7 commas
          const cols = row.split(',');
          if (cols.length < 7) return;
          const date = (cols[0] || '').trim();
          const q = (cols[1] || '').trim().replace(/^"|"$/g, '');
          const options = [cols[2], cols[3], cols[4], cols[5]].map(
            (o) => (o || '').trim().replace(/^"|"$/g, ''),
          );
          const correct = Math.max(0, Math.min(3, (parseInt(cols[6], 10) || 1) - 1));
          const bonus = parseInt(cols[7], 10) || 5;
          if (!date || !q) return;
          if (!byDate[date]) byDate[date] = [];
          byDate[date].push({ q, options, correct, bonus });
        });
        const incoming = Object.entries(byDate).map(([date, questions]) => ({
          date, questions, enabled: true,
        }));
        if (!incoming.length) { flash('No valid rows found in CSV', 'error'); return; }
        // Merge: overwrite existing dates, append new
        const merged = [...challenges];
        incoming.forEach((nc) => {
          const idx = merged.findIndex((c) => c.date === nc.date);
          if (idx >= 0) merged[idx] = nc; else merged.push(nc);
        });
        setChallenges(merged);
        flash(`Imported ${incoming.length} day(s) from CSV`);
      } catch (err) {
        flash(`CSV parse error: ${err.message || err}`, 'error');
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }

  function downloadTemplate() {
    const rows = [
      'date,question,option1,option2,option3,option4,correct_option,bonus_points',
      '2026-06-11,Which planet rules Aries?,Mars,Venus,Jupiter,Saturn,1,10',
      '2026-06-11,How many zodiac signs are there?,12,8,10,24,1,10',
      '2026-06-12,What element is associated with Taurus?,Earth,Fire,Water,Air,1,10',
      '2026-06-12,Which house rules the home and family?,4th,1st,7th,10th,1,10',
      '2026-06-12,The Sun takes how many days to transit one sign?,30,7,14,365,1,10',
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'daily_challenges_template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* -------- render -------- */
  const sortedIdx = challenges
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.date || '').localeCompare(b.c.date || ''));

  const selSize = selectedChallenges.size;
  const allSelected = challenges.length > 0 && selSize === challenges.length;

  return (
    <div className="surface mb-4 p-4">
      {/* Section header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold">Daily Challenges</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px]
          font-bold text-amber-800">
          {challenges.length} day{challenges.length !== 1 ? 's' : ''}
        </span>
        <p className="w-full text-[11px] text-sub-text">
          Admin sets 3, 5, or 10 questions per day. Different questions every day.
          Upload via CSV or add manually. Bonus points are awarded for correct answers.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={seed30Days} disabled={seedBusy}
            className="rounded-full border px-3 py-1 text-[11px]
              font-bold hover:bg-gray-50 disabled:opacity-50"
            style={{ borderColor: '#7F2020', color: '#7F2020' }}
            title="Pre-populate 30 days of sample astrology questions (skips existing dates)">
            {seedBusy ? 'Seeding…' : '&#9733; Seed 30 days'}
          </button>
          <button onClick={downloadTemplate}
            className="rounded-full border px-3 py-1 text-[11px]
              font-bold hover:bg-gray-50"
            style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
            &#8595; CSV Template
          </button>
          <label className="cursor-pointer rounded-full border px-3 py-1
            text-[11px] font-bold hover:bg-gray-50"
            style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
            &#8593; Upload CSV
            <input type="file" accept=".csv,text/csv" hidden
              ref={csvRef} onChange={handleCsvUpload} />
          </label>
          <button onClick={addChallenge}
            className="rounded-full border px-3 py-1 text-[11px]
              font-bold hover:bg-gray-50"
            style={{ borderColor: '#7F2020', color: '#7F2020' }}>
            + Add day manually
          </button>
        </div>
      </div>

      {/* Bulk-select toolbar */}
      {challenges.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2
          rounded-lg bg-gray-50 px-2 py-1 text-[11px]">
          <input type="checkbox" checked={allSelected}
            onChange={toggleSelectAll} title="Select / deselect all" />
          <span className="text-sub-text">
            {selSize > 0
              ? `${selSize} of ${challenges.length} selected`
              : 'Select all'}
          </span>
          {selSize > 0 && (
            <button onClick={removeSelected}
              className="rounded-full bg-red-50 px-2 py-0.5 font-semibold
                text-red-600 hover:bg-red-100">
              Delete selected ({selSize})
            </button>
          )}
          <button onClick={removeAll}
            className="ml-auto rounded-full bg-red-50 px-2 py-0.5
              font-semibold text-red-400 hover:bg-red-100">
            Delete all
          </button>
        </div>
      )}

      {/* Empty state */}
      {challenges.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-200
          py-10 text-center text-sm text-sub-text">
          No daily challenges yet.{' '}
          Upload a CSV template or click &ldquo;+ Add day manually&rdquo;.
        </div>
      )}

      {/* Challenge rows */}
      {sortedIdx.length > 0 && (
        <div className="divide-y divide-gray-100 rounded-lg border
          border-gray-200 bg-white">
          {sortedIdx.map(({ c, i }) => {
            const isExpanded = !!expanded[i];
            const isSel = selectedChallenges.has(i);
            return (
              <div key={i}
                className={isSel ? 'bg-amber-50' : ''}>
                {/* Row summary bar */}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input type="checkbox" checked={isSel}
                    onChange={() => toggleSelect(i)} />
                  <input type="date"
                    className="input w-36 text-xs font-semibold"
                    value={c.date || ''}
                    onChange={(e) => patchChallenge(i, {
                      date: e.target.value,
                    })} />
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5
                    text-[10px] font-bold text-amber-800">
                    {(c.questions || []).length} Q
                  </span>
                  <label className="flex cursor-pointer items-center
                    gap-1 text-[11px]">
                    <input type="checkbox"
                      checked={c.enabled !== false}
                      onChange={(e) => patchChallenge(i, {
                        enabled: e.target.checked,
                      })} />
                    Enabled
                  </label>
                  <button
                    onClick={() => setExpanded(
                      (p) => ({ ...p, [i]: !p[i] }))}
                    className="ml-auto text-[11px] font-semibold"
                    style={{ color: '#D4A12A' }}>
                    {isExpanded
                      ? '&#9660; Collapse'
                      : '&#9658; Edit questions'}
                  </button>
                  <button onClick={() => removeChallenge(i)}
                    className="text-xs text-red-400 hover:text-red-600"
                    title="Delete this day">
                    &#10005;
                  </button>
                </div>

                {/* Expanded: question editor */}
                {isExpanded && (
                  <div className="border-t border-dashed border-amber-200
                    bg-amber-50/40 px-3 pb-3 pt-2">
                    <p className="mb-2 text-[11px] text-sub-text">
                      Add 3, 5 or 10 questions. Each correct answer earns
                      its bonus points. Radio button = correct answer.
                    </p>
                    <div className="space-y-3">
                      {(c.questions || []).map((q, qi) => (
                        <div key={qi}
                          className="rounded-lg border border-amber-200
                            bg-white p-2 space-y-1.5">
                          {/* Question text + bonus + delete */}
                          <div className="flex items-start gap-2">
                            <span className="mt-1 shrink-0 rounded-full
                              bg-amber-100 px-1.5 text-[10px]
                              font-bold text-amber-800">
                              Q{qi + 1}
                            </span>
                            <textarea
                              className="input flex-1 text-[11px] h-10"
                              value={q.q || ''}
                              onChange={(e) => patchQuestion(i, qi, {
                                q: e.target.value,
                              })}
                              placeholder="Question text" />
                            <label className="flex shrink-0 items-center
                              gap-1 text-[10px] text-sub-text">
                              Bonus:
                              <input
                                className="input w-12 text-[10px]"
                                type="number" min="0"
                                value={q.bonus ?? 5}
                                onChange={(e) => patchQuestion(i, qi, {
                                  bonus: Number(e.target.value) || 0,
                                })} />
                            </label>
                            <button onClick={() => removeQuestion(i, qi)}
                              className="mt-1 text-xs text-red-400
                                hover:text-red-600"
                              title="Remove question">
                              &#10005;
                            </button>
                          </div>
                          {/* Options */}
                          <div className="grid grid-cols-2 gap-1">
                            {[0, 1, 2, 3].map((oi) => (
                              <div key={oi}
                                className="flex items-center gap-1">
                                <input type="radio"
                                  name={`dc_${i}_q${qi}`}
                                  checked={(q.correct ?? 0) === oi}
                                  onChange={() => patchQuestion(i, qi, {
                                    correct: oi,
                                  })}
                                  title="Mark as correct answer" />
                                <input
                                  className={`input flex-1 text-[11px] ${
                                    (q.correct ?? 0) === oi
                                      ? 'border-emerald-400 bg-emerald-50'
                                      : ''}`}
                                  value={(q.options || [])[oi] || ''}
                                  onChange={(e) => setQOption(
                                    i, qi, oi, e.target.value)}
                                  placeholder={`Option ${oi + 1}`} />
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-amber-700">
                            &#9432; Select the radio button beside the correct option.
                          </p>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addQuestion(i)}
                      className="mt-2 rounded-full border px-3 py-1
                        text-[11px] font-bold hover:bg-amber-50"
                      style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
                      + Add question
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save bar */}
      {dirty && (
        <button onClick={onSave} disabled={busy}
          className="btn-grad mt-3 w-full justify-center disabled:opacity-50">
          {busy ? 'Saving…' : 'Save Daily Challenges'}
        </button>
      )}
    </div>
  );
}

// -- Tarot: list of cards with name + meaning + reversedMeaning --
function TarotEditor({ content, onChange }) {
  const cards = content?.cards || [];
  function setCard(i, patch) {
    const next = cards.map((c, j) => j === i ? { ...c, ...patch } : c);
    onChange({ ...content, cards: next });
  }
  function addCard() {
    onChange({
      ...content,
      cards: [...cards, {
        name: '', meaning: '', reversedMeaning: '', points: 10,
      }],
    });
  }
  function removeCard(i) {
    onChange({ ...content, cards: cards.filter((_, j) => j !== i) });
  }
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-sub-text">
        Tarot cards ({cards.length})
      </div>
      <div className="space-y-2">
        {cards.map((c, i) => (
          <div key={i} className="rounded border border-gray-200
            bg-white p-2 space-y-1">
            <div className="flex items-center gap-2">
              <input className="input flex-1 text-xs font-semibold"
                value={c.name || ''}
                onChange={(e) => setCard(i, { name: e.target.value })}
                placeholder="Card name" />
              <label className="flex items-center gap-1 text-[10px]
                text-sub-text">
                <span>Pts:</span>
                <input className="input w-14 text-[10px]" type="number"
                  min="0" value={c.points || 0}
                  onChange={(e) => setCard(i, {
                    points: Number(e.target.value) || 0,
                  })} />
              </label>
              <button onClick={() => removeCard(i)}
                className="text-xs text-red-400 hover:text-red-600">
                &#10005;
              </button>
            </div>
            <textarea className="input w-full text-[11px] h-14"
              value={c.meaning || ''}
              onChange={(e) => setCard(i, { meaning: e.target.value })}
              placeholder="Upright meaning" />
            <textarea className="input w-full text-[11px] h-14"
              value={c.reversedMeaning || ''}
              onChange={(e) => setCard(i, { reversedMeaning: e.target.value })}
              placeholder="Reversed meaning" />
          </div>
        ))}
      </div>
      <button onClick={addCard}
        className="mt-2 rounded-full border px-3 py-1 text-[11px]
          font-bold hover:bg-gray-50"
        style={{ borderColor: '#D4A12A', color: '#D4A12A' }}>
        + Add card
      </button>
    </div>
  );
}
