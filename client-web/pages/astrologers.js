import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { astrologerService } from '@astro/shared';
import Layout from '../components/Layout';
import AstrologerCard from '../components/AstrologerCard';
import { SkeletonList, ErrorState } from '../components/Skeleton';
import { useOptionalClient } from '../lib/useAuth';
import { useAstroActions } from '../lib/useAstroActions';
import { useSettings } from '../lib/useSettings';
import { getFavorites } from '../lib/favorites';

const PAGE = 12;
// Topic chips kept for parity with the dashboard "Browse by topic" tiles.
const CHIPS = ['All', 'Love', 'Career', 'Marriage', 'Health',
  'Finance', 'Education', 'Vedic', 'Tarot', 'Numerology'];

// Sort options the customer picks from the dropdown next to the search
// box. Each maps to a comparator on the already-loaded list - sorting
// is client-side so toggling stays instant (no server round-trip).
const SORTS = [
  { key: 'recommended', label: 'Recommended (online + rating)' },
  { key: 'priceAsc', label: 'Price: low to high' },
  { key: 'priceDesc', label: 'Price: high to low' },
  { key: 'expAsc', label: 'Experience: low to high' },
  { key: 'expDesc', label: 'Experience: high to low' },
  { key: 'ratingDesc', label: 'Rating: high to low' },
];

// All bookable channels. Clicking one of these filters the list to
// astrologers who have that channel enabled, are online, and gives the
// empty-state suggestion to try the other channels.
const MODES = [
  { key: 'all', label: 'All' },
  { key: 'chat', label: 'Chat' },
  { key: 'call', label: 'Call' },
  { key: 'video', label: 'Video' },
];

// Cheapest enabled per-min price across the three channels - used by
// both the "price low to high" sort and by the displayed "from ₹X/min"
// figure on the card. Mirrors AstrologerCard.effPrice().
function bestPrice(a) {
  const eff = (b) => Math.round((b || 0)
    * (1 - Number(a.discountPercent || 0) / 100));
  const prices = [
    a.chat_enabled ? eff(a.priceChat) : null,
    a.call_enabled ? eff(a.priceCall) : null,
    a.video_enabled ? eff(a.priceVideo) : null,
  ].filter((p) => p != null && p > 0);
  return prices.length ? Math.min(...prices) : Number.MAX_SAFE_INTEGER;
}

function modeOk(a, mode) {
  if (mode === 'all') return true;
  if (mode === 'chat') return !!a.chat_enabled;
  if (mode === 'call') return !!a.call_enabled;
  if (mode === 'video') return !!a.video_enabled;
  return true;
}

export default function Astrologers() {
  const { user, profile, loading } = useOptionalClient();
  const router = useRouter();
  const { go } = useAstroActions(user);
  const { freeChatMin } = useSettings();
  // First-session-free is one-time: hide it once the user has used it.
  const freeMin = profile?.freeUsed ? 0 : freeChatMin;
  const [all, setAll] = useState(null);
  const [err, setErr] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [chip, setChip] = useState('All');
  const [search, setSearch] = useState('');
  const debounced = useRef(null);

  // NEW filters / sort state. All client-side so toggling is instant.
  const [mode, setMode] = useState('all');         // chat / call / video / all
  const [sort, setSort] = useState('recommended'); // see SORTS above
  const [minRating, setMinRating] = useState(0);   // 0 / 4 / 4.5
  // Multi-select skill chips. Astrologers must match AT LEAST ONE of
  // the selected skills (OR semantics) - matches how the dashboard
  // "Browse by topic" tile flow works.
  const [extraSkills, setExtraSkills] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const openProfile = (a) => router.push(`/astrologer/${a.id}`);

  async function load(skill) {
    setErr(false); setAll(null);
    try {
      setAll(await astrologerService.getAstrologers(
        skill && skill !== 'All' ? { skill } : {}));
    } catch { setErr(true); }
  }

  // Honour ?skill= from the dashboard category tiles.
  useEffect(() => {
    if (loading) return;
    const s = typeof router.query.skill === 'string' ? router.query.skill : '';
    if (s && CHIPS.includes(s)) setChip(s);
    load(s || 'All');
    // eslint-disable-next-line
  }, [loading, router.query.skill]);

  useEffect(() => { /* favourites preloaded for future use */
    if (user) getFavorites(user.uid).catch(() => {});
  }, [user]);

  function pickChip(c) {
    setChip(c);
    setVisible(PAGE);
    load(c);
  }
  function onSearch(v) {
    setSearch(v);
    clearTimeout(debounced.current);
    debounced.current = setTimeout(() => {
      astrologerService.getAstrologers(
        chip !== 'All' ? { skill: chip, search: v } : { search: v })
        .then((rows) => { setAll(rows); setVisible(PAGE); })
        .catch(() => setErr(true));
    }, 300);
  }

  // Build the union of skills present on the loaded astrologers so
  // the multi-select doesn't show options nobody offers.
  const availableSkills = useMemo(() => {
    const set = new Set();
    (all || []).forEach((a) => (a.skills || [])
      .forEach((s) => set.add(String(s))));
    return Array.from(set).sort();
  }, [all]);

  // Pipeline: chip-filter (server-side already), then mode, then
  // rating threshold, then skills, then sort.
  const filtered = useMemo(() => {
    if (!Array.isArray(all)) return null;
    let rows = all.slice();
    rows = rows.filter((a) => modeOk(a, mode));
    if (minRating > 0) {
      rows = rows.filter((a) => Number(a.rating || 0) >= minRating);
    }
    if (extraSkills.length) {
      const need = new Set(extraSkills);
      rows = rows.filter((a) => (a.skills || []).some((s) => need.has(s)));
    }
    const cmp = {
      recommended: (a, b) => {
        // Online first, then rating desc, then price asc.
        const ao = a.status === 'online' ? 1 : 0;
        const bo = b.status === 'online' ? 1 : 0;
        if (ao !== bo) return bo - ao;
        const ar = Number(a.rating || 0); const br = Number(b.rating || 0);
        if (ar !== br) return br - ar;
        return bestPrice(a) - bestPrice(b);
      },
      priceAsc: (a, b) => bestPrice(a) - bestPrice(b),
      priceDesc: (a, b) => bestPrice(b) - bestPrice(a),
      expAsc: (a, b) => Number(a.experience || 0) - Number(b.experience || 0),
      expDesc: (a, b) => Number(b.experience || 0) - Number(a.experience || 0),
      ratingDesc: (a, b) => Number(b.rating || 0) - Number(a.rating || 0),
    }[sort] || (() => 0);
    rows.sort(cmp);
    return rows;
  }, [all, mode, minRating, extraSkills, sort]);

  // When the mode/sort/filters change, reset paging so the user
  // doesn't see a confusing "Load more" of a stale page count.
  useEffect(() => { setVisible(PAGE); }, [mode, sort, minRating,
    extraSkills.length, chip]);

  // Empty-state copy. When the user picked Chat / Call / Video and
  // nobody is available on that channel, recommend the OTHER channels
  // that DO have someone online right now.
  function emptySuggestion() {
    if (mode === 'all') return null;
    const others = ['chat', 'call', 'video'].filter((m) => m !== mode);
    const counts = {};
    (all || []).forEach((a) => {
      others.forEach((m) => {
        if (!modeOk(a, m)) return;
        counts[m] = (counts[m] || 0) + 1;
      });
    });
    const alt = others.filter((m) => counts[m] > 0);
    if (!alt.length) {
      return `No astrologers are currently available on ${mode}. `
        + 'Please check back in a few minutes.';
    }
    const niceList = alt.map((m) => m[0].toUpperCase() + m.slice(1))
      .join(' or ');
    return `No astrologers are currently available on ${mode}. `
      + `Please try ${niceList} instead - someone is online there now.`;
  }

  function toggleSkill(s) {
    setExtraSkills((arr) => (arr.includes(s)
      ? arr.filter((x) => x !== s) : [...arr, s]));
  }
  function clearFilters() {
    setMode('all'); setSort('recommended'); setMinRating(0);
    setExtraSkills([]);
  }

  const activeFilterCount = (mode !== 'all' ? 1 : 0)
    + (sort !== 'recommended' ? 1 : 0)
    + (minRating > 0 ? 1 : 0)
    + (extraSkills.length ? 1 : 0);

  return (
    <Layout>
      <h1 className="text-2xl font-bold md:text-3xl">Our astrologers</h1>
      <p className="mb-4 text-sub-text">
        {filtered == null ? 'Loading...'
          : `${filtered.length} expert${filtered.length === 1 ? '' : 's'} `
            + (mode === 'all' ? 'available'
              : `available on ${mode}`)}
      </p>

      <div className="surface mb-4 p-3">
        <input className="input mb-3" placeholder="Search by name..."
          value={search} onChange={(e) => onSearch(e.target.value)} />

        {/* Mode buttons: Chat / Call / Video filter. The "All" chip
            sits at the front to make resetting one tap.  */}
        <div className="mb-3 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className={`whitespace-nowrap ${
                mode === m.key ? 'pill pill-active' : 'pill'}`}>
              {m.label}
            </button>
          ))}
          <span className="ml-1 flex items-center text-xs text-sub-text">
            mode
          </span>
        </div>

        {/* Topic chips (Love / Career / Vedic / Tarot etc).  */}
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {CHIPS.map((c) => (
            <button key={c} onClick={() => pickChip(c)}
              className={`whitespace-nowrap ${
                chip === c ? 'pill pill-active' : 'pill'}`}>
              {c}
            </button>
          ))}
        </div>

        {/* Sort + filters toggle row. Sort is always visible because
            it's the most-used control; everything else collapses
            into "More filters" so the surface stays calm.  */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-sub-text">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}
              className="rounded-full border border-gray-200 bg-white
                px-3 py-1.5 text-sm">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>
          <button onClick={() => setShowFilters((v) => !v)}
            className={`pill ${showFilters || activeFilterCount
              ? 'pill-active' : ''}`}>
            More filters{activeFilterCount
              ? ` (${activeFilterCount})` : ''}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters}
              className="pill border-danger text-danger">
              Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 rounded-2xl border border-gray-100
            bg-bg-light/40 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2
              text-sm">
              <span className="text-sub-text">Min rating</span>
              {[0, 3, 4, 4.5].map((r) => (
                <button key={r} onClick={() => setMinRating(r)}
                  className={`pill ${minRating === r ? 'pill-active' : ''}`}>
                  {r === 0 ? 'Any' : `${r}+ ★`}
                </button>
              ))}
            </div>
            {availableSkills.length > 0 && (
              <div>
                <div className="mb-2 text-sm text-sub-text">
                  Skills (any of)
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableSkills.map((s) => (
                    <button key={s} onClick={() => toggleSkill(s)}
                      className={`pill ${
                        extraSkills.includes(s) ? 'pill-active' : ''}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {err ? (
        <ErrorState onRetry={() => load(chip)} />
      ) : filtered == null ? (
        <SkeletonList count={6} />
      ) : filtered.length === 0 ? (
        <div className="surface px-5 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center
            justify-center rounded-full bg-bg-light text-2xl
            text-primary">🔍</div>
          <div className="text-base font-semibold">
            No astrologers match your filters
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm text-sub-text">
            {emptySuggestion() || 'Try a different topic or clear '
              + 'the filters to see all astrologers.'}
          </p>
          {(activeFilterCount > 0 || chip !== 'All') && (
            <button onClick={() => {
              clearFilters(); setChip('All'); load('All');
            }} className="mt-4 btn-grad">
              Show all astrologers
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2
                          lg:grid-cols-4">
            {filtered.slice(0, visible).map((a) => (
              <AstrologerCard key={a.id} a={a} onOpen={openProfile}
                onAction={go} freeMin={freeMin} />
            ))}
          </div>
          {visible < filtered.length && (
            <button onClick={() => setVisible((v) => v + PAGE)}
              className="mx-auto mt-6 block rounded-full border
                         border-gray-200 bg-white px-6 py-3 font-semibold">
              Load more
            </button>
          )}
        </>
      )}
    </Layout>
  );
}
