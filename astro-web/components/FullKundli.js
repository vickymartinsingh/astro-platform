import { useState } from 'react';
import { kundliService, vimshottari } from '@astro/shared';

// Full kundli viewer for the astrologer panel. Mirrors the customer
// /kundli viewer (same data shape from kundliService.getFullKundli)
// but strips the "buy report" / "edit profile" UI — the astrologer
// only reads. Tabs: Overview · Chart (N/S) · Planets · Dasha · Houses
// · Transits · Yogas · Doshas · Panchang.

function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

const PLANET_SHORT = {
  Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
  Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
};

export default function FullKundli({ r, kundli }) {
  const [tab, setTab] = useState('overview');
  const [chartStyle, setChartStyle] = useState('north');
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  const raw = r.raw || {};
  const TABS = [
    ['overview', 'Overview'],
    ['chart', 'Chart'],
    ['planets', 'Planets'],
    ['houses', 'Houses'],
    ['dasha', 'Dasha'],
    ['transits', 'Transits'],
    ['yogas', 'Yogas'],
    ['doshas', 'Doshas'],
    ['panchang', 'Panchang'],
  ];

  return (
    <div className="mt-3 rounded-card bg-bg-light p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-bold">Full Kundli</div>
          <div className="text-[10px] text-sub-text">
            {kundli && kundli.name}
            {kundli && kundli.dob ? ` · ${kundli.dob}` : ''}
            {kundli && kundli.tob ? ` · ${kundli.tob} ${kundli.ampm || ''}`
              : ''}
            {kundli && kundli.place ? ` · ${kundli.place}` : ''}
          </div>
        </div>
        <span className="text-[10px] text-sub-text">
          {r.cached ? 'Saved report' : 'Newly generated'}
        </span>
      </div>
      <button type="button"
        onClick={() => kundliService.downloadKundliReport(kundli || {}, r)}
        className="mt-2 rounded-full bg-primary px-3 py-1.5 text-xs
          font-bold text-white">
        Download full report (PDF)
      </button>

      <div className="mt-3 flex flex-wrap gap-1 overflow-x-auto">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`whitespace-nowrap rounded-full px-3 py-1
              text-xs font-semibold transition ${
              tab === k ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab r={r} n={n} lucky={lucky} />)}
      {tab === 'chart' && (
        <ChartTab r={r} chartStyle={chartStyle}
          onChangeStyle={setChartStyle} />)}
      {tab === 'planets' && <PlanetsTab r={r} />}
      {tab === 'houses' && <HousesTab r={r} />}
      {tab === 'dasha' && <DashaTab r={r} />}
      {tab === 'transits' && <TransitsTab raw={raw} />}
      {tab === 'yogas' && <YogasTab r={r} raw={raw} />}
      {tab === 'doshas' && <DoshasTab r={r} raw={raw} />}
      {tab === 'panchang' && <PanchangTab r={r} raw={raw} />}
    </div>
  );
}

// ---------- Overview ---------------------------------------------
function OverviewTab({ r, n, lucky }) {
  return (
    <div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Ascendant" value={(r.ascendant && r.ascendant.sign)
          || '·'} sub={r.ascendant && r.ascendant.degree} />
        <Stat label="Nakshatra" value={r.nakshatra || '·'} />
        <Stat label="Moon sign" value={r.chandra_rasi || '·'} />
        <Stat label="Sun sign" value={r.soorya_rasi || '·'} />
      </div>
      {n.personality && <Sec title="Personality">{n.personality}</Sec>}
      {n.career && <Sec title="Career">{n.career}</Sec>}
      {n.health && <Sec title="Health">{n.health}</Sec>}
      {n.love && <Sec title="Love & relationships">{n.love}</Sec>}
      {n.life && <Sec title="Life path">{n.life}</Sec>}
      {(lucky.deity || lucky.color || lucky.stone) && (
        <Sec title="Lucky">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {lucky.deity && <div>Deity: <b>{lucky.deity}</b></div>}
            {lucky.color && <div>Colour: <b>{lucky.color}</b></div>}
            {lucky.stone && <div>Stone: <b>{lucky.stone}</b></div>}
            {lucky.direction && (
              <div>Direction: <b>{lucky.direction}</b></div>)}
            {lucky.syllables && (
              <div>Syllables: <b>{lucky.syllables}</b></div>)}
          </div>
        </Sec>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-card bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-sub-text">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-dark-text">
        {value}
      </div>
      {sub && <div className="text-[10px] text-sub-text">{sub}</div>}
    </div>
  );
}

// ---------- Chart (N / S toggle) ---------------------------------
function ChartTab({ r, chartStyle, onChangeStyle }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-sub-text">Style:</span>
        {['north', 'south'].map((s) => (
          <button key={s} type="button" onClick={() => onChangeStyle(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold
              ${chartStyle === s
                ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {s === 'north' ? 'North Indian' : 'South Indian'}
          </button>
        ))}
      </div>
      <div className="rounded-card bg-white p-3">
        <div className="mb-2 text-sm font-bold text-primary">
          Rasi chart (D1)
        </div>
        {chartStyle === 'north'
          ? <NorthChart r={r} />
          : <SouthChart r={r} />}
      </div>
    </div>
  );
}

function NorthChart({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  const CELLS = [
    { h: 1, x: 150, y: 90 }, { h: 2, x: 75, y: 60 },
    { h: 3, x: 50, y: 120 }, { h: 4, x: 80, y: 150 },
    { h: 5, x: 50, y: 180 }, { h: 6, x: 75, y: 240 },
    { h: 7, x: 150, y: 210 }, { h: 8, x: 225, y: 240 },
    { h: 9, x: 250, y: 180 }, { h: 10, x: 220, y: 150 },
    { h: 11, x: 250, y: 120 }, { h: 12, x: 225, y: 60 },
  ];
  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <svg viewBox="0 0 300 300" className="w-full">
        <rect x="10" y="10" width="280" height="280"
          fill="#fff" stroke="#7F2020" strokeWidth="2" />
        <line x1="10" y1="10" x2="290" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="290" y1="10" x2="10" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="150" y1="10" x2="10" y2="150"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="150" y1="10" x2="290" y2="150"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="290" y1="150" x2="150" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        <line x1="10" y1="150" x2="150" y2="290"
          stroke="#7F2020" strokeWidth="1" />
        {CELLS.map(({ h, x, y }) => {
          const ps = byHouse[h] || [];
          return (
            <g key={h}>
              <text x={x} y={y - 8} textAnchor="middle"
                fontSize="9" fill="#888">H{h}</text>
              <text x={x} y={y + 4} textAnchor="middle"
                fontSize="11" fontWeight="bold" fill="#1a1a2e">
                {ps.map((p) => PLANET_SHORT[p.name]
                  || (p.name || '').slice(0, 2)).join(' ')}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Lagna at H1. Counter-clockwise.
        {ascSign ? ` Lagna sign: ${ascSign}.` : ''}
      </p>
    </div>
  );
}

function SouthChart({ r }) {
  const SIGN_CELLS = [
    { sign: 'Pisces', col: 0, row: 0 },
    { sign: 'Aries', col: 1, row: 0 },
    { sign: 'Taurus', col: 2, row: 0 },
    { sign: 'Gemini', col: 3, row: 0 },
    { sign: 'Aquarius', col: 0, row: 1 },
    { sign: 'Cancer', col: 3, row: 1 },
    { sign: 'Capricorn', col: 0, row: 2 },
    { sign: 'Leo', col: 3, row: 2 },
    { sign: 'Sagittarius', col: 0, row: 3 },
    { sign: 'Scorpio', col: 1, row: 3 },
    { sign: 'Libra', col: 2, row: 3 },
    { sign: 'Virgo', col: 3, row: 3 },
  ];
  const bySign = {};
  (r.planets || []).forEach((p) => {
    if (!p.sign) return;
    (bySign[p.sign] = bySign[p.sign] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  return (
    <div className="mx-auto" style={{ maxWidth: 360 }}>
      <div className="grid grid-cols-4 overflow-hidden rounded
                      border-2 border-primary">
        {Array.from({ length: 16 }).map((_, idx) => {
          const col = idx % 4; const row = Math.floor(idx / 4);
          if ((col === 1 || col === 2) && (row === 1 || row === 2)) {
            if (idx === 5) {
              return (
                <div key={idx}
                  className="col-span-2 row-span-2 flex items-center
                             justify-center border border-primary/30
                             bg-bg-light p-2 text-center text-xs
                             text-sub-text">
                  <div>
                    <div className="text-[10px] uppercase
                                    tracking-wide">Lagna</div>
                    <div className="font-bold text-primary">
                      {ascSign || '·'}
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          }
          const cell = SIGN_CELLS.find(
            (c) => c.col === col && c.row === row);
          if (!cell) return <div key={idx} />;
          const ps = bySign[cell.sign] || [];
          const isAsc = cell.sign === ascSign;
          return (
            <div key={idx}
              className={`border border-primary/30 p-2 text-center
                ${isAsc ? 'bg-primary/10' : 'bg-white'}`}>
              <div className="text-[10px] text-sub-text">
                {cell.sign}
              </div>
              <div className="mt-1 min-h-[24px] text-xs font-semibold
                              text-dark-text">
                {ps.map((p) => PLANET_SHORT[p.name]
                  || (p.name || '').slice(0, 2)).join(' ') || ''}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Signs are fixed. Highlighted cell = Lagna ({ascSign || '·'}).
      </p>
    </div>
  );
}

// ---------- Planets ----------------------------------------------
function PlanetsTab({ r }) {
  return (
    <div className="mt-3">
      <Sec title="Planet positions">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Planet</th>
                <th className="py-1 pr-3">Sign</th>
                <th className="py-1 pr-3">House</th>
                <th className="py-1 pr-3">Degree</th>
                <th className="py-1 pr-3">Nakshatra</th>
                <th className="py-1 pr-3">Pada</th>
                <th className="py-1 pr-3">Dignity</th>
                <th className="py-1">State</th>
              </tr>
            </thead>
            <tbody>
              {(r.planets || []).map((p) => (
                <tr key={p.name} className="border-t border-white">
                  <td className="py-1 pr-3 font-semibold">{p.name}</td>
                  <td className="py-1 pr-3">{p.sign || '·'}</td>
                  <td className="py-1 pr-3">{p.house ?? '·'}</td>
                  <td className="py-1 pr-3">{p.degree ?? '·'}</td>
                  <td className="py-1 pr-3">{p.nakshatra || '·'}</td>
                  <td className="py-1 pr-3">{p.pada ?? '·'}</td>
                  <td className={`py-1 pr-3 ${p.dignity === 'Debilitated'
                    ? 'text-danger'
                    : p.dignity === 'Exalted' ? 'text-success' : ''}`}>
                    {p.dignity || '·'}
                  </td>
                  <td className="py-1">
                    {[p.retrograde ? 'R' : '',
                      p.combust ? 'C' : ''].filter(Boolean).join(' ')
                      || '·'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sec>
    </div>
  );
}

// ---------- Houses (planets-in-house grid) -----------------------
function HousesTab({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  return (
    <div className="mt-3">
      <Sec title="Planets in houses">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3
                        md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <div key={h} className="rounded-card bg-white p-2">
              <div className="text-[10px] font-bold uppercase
                              tracking-wide text-sub-text">
                House {h}
              </div>
              <div className="mt-0.5 text-xs font-semibold
                              text-dark-text">
                {(byHouse[h] || []).map((p) => p.name).join(', ') || '·'}
              </div>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  );
}

// ---------- Dasha (current + 4-level drilldown + table) ----------
function DashaTab({ r }) {
  const [sub, setSub] = useState('current');
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          ['current', 'Current periods'],
          ['drilldown', '4-level drilldown'],
          ['table', 'Full Vimshottari'],
        ].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${sub === k ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {l}
          </button>
        ))}
      </div>
      {sub === 'current' && (
        <CurrentDashaCard cd={r.currentDasha} />)}
      {sub === 'drilldown' && (
        <DashaDrilldown dasha={r.dasha || []} />)}
      {sub === 'table' && (
        <Sec title="Vimshottari Maha Dasha (full lifetime)">
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Mahadasha</th>
                <th className="py-1 pr-3">Starts</th>
                <th className="py-1 pr-3">Ends</th>
                <th className="py-1">Years</th>
              </tr>
            </thead>
            <tbody>
              {(r.dasha || []).map((d, i) => {
                const yrs = d.start && d.end
                  ? ((Date.parse(d.end) - Date.parse(d.start))
                     / (365.25 * 86400 * 1000)).toFixed(1)
                  : '·';
                return (
                  <tr key={i} className={`border-t border-white
                    ${d.current ? 'bg-primary/10 font-bold' : ''}`}>
                    <td className="py-1 pr-3">{d.planet}
                      {d.current ? ' (current)' : ''}</td>
                    <td className="py-1 pr-3">
                      {String(d.start || '').slice(0, 10)}
                    </td>
                    <td className="py-1 pr-3">
                      {String(d.end || '').slice(0, 10)}
                    </td>
                    <td className="py-1">{yrs}</td>
                  </tr>
                );
              })}
              {(r.dasha || []).length === 0 && (
                <tr><td colSpan="4" className="py-3 text-center
                  text-sub-text">No dasha data.</td></tr>
              )}
            </tbody>
          </table>
        </Sec>
      )}
    </div>
  );
}

function CurrentDashaCard({ cd }) {
  if (!cd || !cd.planet) {
    return <div className="rounded-card bg-white p-3 text-sm
      text-sub-text">No current period data yet.</div>;
  }
  const levels = [
    ['Maha Dasha', cd.planet, cd.start, cd.end],
    cd.antar && ['Antar', cd.antar.planet, cd.antar.start, cd.antar.end],
    cd.pratyantar && ['Pratyantar', cd.pratyantar.planet,
      cd.pratyantar.start, cd.pratyantar.end],
    cd.sookshma && ['Sookshma', cd.sookshma.planet,
      cd.sookshma.start, cd.sookshma.end],
  ].filter(Boolean);
  return (
    <div className="rounded-card bg-gradient-to-br from-primary to-accent
                    p-4 text-white">
      <div className="text-[11px] uppercase tracking-wide opacity-80">
        Currently running
      </div>
      <div className="mt-1 text-lg font-bold">
        {levels.map((l) => l[1]).join(' / ')}
      </div>
      <div className="mt-2 space-y-1 text-xs">
        {levels.map(([name, planet, s, e]) => (
          <div key={name} className="opacity-95">
            <b>{name}:</b> {planet}{' '}
            ({String(s || '').slice(0, 10)} to{' '}
            {String(e || '').slice(0, 10)})
          </div>
        ))}
      </div>
    </div>
  );
}

// 4-level drilldown — uses shared vimshottari math so any sub-period
// below pratyantar is computed client-side (no extra API calls).
const LEVEL_LABELS = ['Mahadasha', 'Antardasha',
  'Pratyantardasha', 'Sookshmadasha'];

function DashaDrilldown({ dasha }) {
  const [path, setPath] = useState([]);
  const nowMs = Date.now();
  const mahas = (dasha || []).map((d) => {
    const startMs = vimshottari.toMs(d.start);
    const endMs = vimshottari.toMs(d.end);
    const lord = vimshottari.normalizeLord(d.planet) || d.planet;
    if (!lord || !Number.isFinite(startMs)
        || !Number.isFinite(endMs)) return null;
    return { lord, startMs, endMs };
  }).filter(Boolean);

  if (!mahas.length) {
    return <div className="rounded-card bg-white p-4 text-sm
      text-sub-text">Dasha data unavailable.</div>;
  }

  let current = mahas;
  for (let i = 0; i < path.length; i += 1) {
    const node = current[path[i]];
    if (!node) { current = []; break; }
    current = vimshottari.subPeriods(node);
  }
  const depth = path.length;
  const canDrill = depth < 3;

  const crumbs = [];
  let cursor = mahas;
  for (let i = 0; i < path.length; i += 1) {
    const sel = cursor[path[i]];
    if (!sel) break;
    crumbs.push(sel);
    cursor = vimshottari.subPeriods(sel);
  }
  const curIdx = vimshottari.findCurrent(current, nowMs);

  return (
    <div className="space-y-3">
      <div className="rounded-card border border-primary/20 bg-white p-3">
        <div className="grid grid-cols-4 gap-1.5">
          {LEVEL_LABELS.map((label, i) => {
            const active = i === depth;
            const visited = i < depth;
            const sel = crumbs[i];
            return (
              <button key={label} type="button"
                disabled={i > depth}
                onClick={() => setPath(path.slice(0, i))}
                className={`rounded-card px-2 py-1.5 text-left
                  text-[10px] font-bold transition
                  ${active ? 'bg-primary text-white shadow'
                    : visited ? 'bg-primary/10 text-primary'
                      : 'bg-gray-100 text-sub-text opacity-60'}`}>
                <div className="uppercase tracking-wide">{`L${i + 1}`}</div>
                <div className="mt-0.5 truncate">{label}</div>
                {sel && (
                  <div className="mt-0.5 text-[9px] opacity-80">
                    {vimshottari.SHORT[sel.lord] || sel.lord}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {crumbs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5
                          text-[10px] text-sub-text">
            <span className="font-semibold">Path:</span>
            {crumbs.map((c, i) => (
              <span key={i} className="rounded-full bg-primary/10
                px-2 py-0.5 font-bold text-primary">
                {vimshottari.SHORT[c.lord] || c.lord}
                {i < crumbs.length - 1 && (
                  <span className="ml-1 opacity-50">›</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      {depth > 0 && (
        <button type="button"
          onClick={() => setPath(path.slice(0, -1))}
          className="flex items-center gap-1.5 rounded-full border
            border-primary bg-white px-3 py-1 text-[11px] font-bold
            text-primary hover:bg-primary hover:text-white">
          <span>↑</span> LEVEL UP
        </button>
      )}
      <div className="rounded-card bg-white p-2">
        <div className="mb-1 px-2 text-[11px] font-bold uppercase
          tracking-wide text-sub-text">
          {LEVEL_LABELS[depth]} · {current.length} periods
          {canDrill && ' · tap row to drill deeper'}
        </div>
        <div className="space-y-1">
          {current.map((c, i) => {
            const isCur = i === curIdx;
            return (
              <button key={i} type="button"
                disabled={!canDrill}
                onClick={() => canDrill && setPath([...path, i])}
                className={`flex w-full items-center justify-between
                  gap-2 rounded-card px-3 py-2 text-left text-[12px]
                  transition ${isCur
                    ? 'bg-primary/10 font-bold text-primary'
                    : 'bg-gray-50 hover:bg-primary/5'}
                  ${canDrill ? 'cursor-pointer' : 'cursor-default'}`}>
                <span className="flex items-center gap-2">
                  <span className={`inline-flex h-6 w-9 items-center
                    justify-center rounded-full text-[10px]
                    font-extrabold ${isCur
                      ? 'bg-primary text-white'
                      : 'bg-white text-primary'}`}>
                    {vimshottari.SHORT[c.lord] || c.lord}
                  </span>
                  <span>{c.lord}</span>
                  {isCur && (
                    <span className="rounded-full bg-accent px-2 py-0.5
                      text-[9px] font-bold text-white">now</span>
                  )}
                </span>
                <span className="flex items-center gap-2 text-[10.5px]
                  text-sub-text">
                  <span>{vimshottari.fmtDate(c.startMs)}</span>
                  <span className="opacity-50">→</span>
                  <span>{vimshottari.fmtDate(c.endMs)}</span>
                  {canDrill && (
                    <span className={`ml-1 ${isCur
                      ? 'text-primary' : 'text-sub-text'}`}>›</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {!canDrill && (
          <p className="mt-2 px-2 text-[10px] text-sub-text">
            Deepest level (Sookshma). LEVEL UP to climb back.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- Transits --------------------------------------------
function TransitsTab({ raw }) {
  const t = (raw && raw.transits) || null;
  const planets = (t && (t.planets || t.planetary_position)) || [];
  return (
    <div className="mt-3">
      <Sec title="Transits (current planetary positions vs natal chart)">
        {planets.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm text-sub-text">
            Transit snapshot not available.
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="text-left text-sub-text">
              <tr>
                <th className="py-1 pr-3">Planet</th>
                <th className="py-1 pr-3">Now in sign</th>
                <th className="py-1 pr-3">House (vs natal)</th>
                <th className="py-1">Aspecting natal</th>
              </tr>
            </thead>
            <tbody>
              {planets.map((p, i) => (
                <tr key={i} className="border-t border-white">
                  <td className="py-1 pr-3 font-semibold">
                    {p.name || p.planet}
                  </td>
                  <td className="py-1 pr-3">{p.sign || '·'}</td>
                  <td className="py-1 pr-3">{p.house ?? '·'}</td>
                  <td className="py-1">
                    {Array.isArray(p.aspects)
                      ? p.aspects.join(', ')
                      : (p.aspects || '·')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Sec>
    </div>
  );
}

// ---------- Yogas ------------------------------------------------
function YogasTab({ r, raw }) {
  const yogas = (Array.isArray(raw.yogas_detected) && raw.yogas_detected)
    || (Array.isArray(r.yogas) && r.yogas) || [];
  return (
    <div className="mt-3">
      <Sec title={`Yogas detected (${yogas.length})`}>
        {yogas.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm text-sub-text">
            No special yogas detected.
          </div>
        ) : (
          <div className="space-y-2">
            {yogas.map((y, i) => {
              const name = y.name || y.title || y;
              const desc = y.description || y.effect || y.meaning;
              return (
                <div key={i} className="rounded-card bg-white p-3">
                  <div className="font-bold text-primary">{name}</div>
                  {desc && (
                    <p className="mt-1 text-[12px] text-dark-text">
                      {desc}
                    </p>
                  )}
                  {y.planets && Array.isArray(y.planets) && (
                    <div className="mt-1 text-[10px] text-sub-text">
                      Formed by: {y.planets.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Sec>
    </div>
  );
}

// ---------- Doshas -----------------------------------------------
function DoshasTab({ r, raw }) {
  const doshas = raw.doshas_full || r.doshas || {};
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Mangal Dosha">
        <DoshaCard
          present={!!(doshas.mangal && doshas.mangal.present)}
          severity={doshas.mangal && doshas.mangal.severity}
          note={doshas.mangal && doshas.mangal.note}
          extra="Mars in 1/2/4/7/8/12. Affects marriage compatibility." />
      </Sec>
      <Sec title="Kalsarp Dosha">
        <DoshaCard
          present={!!(doshas.kalsarp && doshas.kalsarp.present)}
          severity={doshas.kalsarp && doshas.kalsarp.type}
          note={doshas.kalsarp && doshas.kalsarp.note}
          extra="All planets between Rahu and Ketu." />
      </Sec>
      <Sec title="Sade Sati">
        {doshas.sade_sati ? (
          <DoshaCard
            present={!!(doshas.sade_sati.current_phase)}
            severity={doshas.sade_sati.current_phase}
            note={doshas.sade_sati.note}
            extra="Saturn through 12th/1st/2nd from natal Moon." />
        ) : (
          <div className="rounded-card bg-white p-3 text-sm text-sub-text">
            Sade Sati data not available.
          </div>
        )}
      </Sec>
    </div>
  );
}

function DoshaCard({ present, severity, note, extra }) {
  return (
    <div className={`rounded-card p-3 text-sm ${present
      ? 'border border-warning/40 bg-warning/5'
      : 'border border-success/30 bg-success/5'}`}>
      <div className={`font-bold ${present
        ? 'text-warning' : 'text-success'}`}>
        {present ? 'Present' : 'Not present'}
        {present && severity ? ` · ${severity}` : ''}
      </div>
      {note && <p className="mt-1 text-[12px] text-dark-text">{note}</p>}
      {extra && <p className="mt-1 text-[11px] text-sub-text">{extra}</p>}
    </div>
  );
}

// ---------- Panchang --------------------------------------------
function PanchangTab({ r, raw }) {
  const p = (raw && raw.panchang) || r.panchang || {};
  const items = [
    ['Tithi', p.tithi],
    ['Yoga', p.yoga],
    ['Karana', p.karana],
    ['Nakshatra', p.nakshatra],
    ['Day of birth', p.day_of_birth || p.weekday],
    ['Hindu weekday', p.hindu_weekday],
    ['Sunrise', p.sunrise],
    ['Sunset', p.sunset],
    ['Moonrise', p.moonrise],
    ['Moonset', p.moonset],
    ['Paksha', p.paksha],
    ['Rahu kaalam', p.rahu_kaal],
    ['Gulika kaalam', p.gulika_kaal],
    ['Yamaganda', p.yamaganda],
  ].filter(([, v]) => v && (typeof v !== 'object' || v.name));
  return (
    <div className="mt-3">
      <Sec title="Panchang at birth">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-card bg-white p-2">
              <div className="text-[10px] uppercase tracking-wide
                              text-sub-text">{label}</div>
              <div className="mt-0.5 text-xs font-semibold text-dark-text">
                {typeof value === 'object'
                  ? (value.name || JSON.stringify(value).slice(0, 40))
                  : value}
              </div>
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <div className="text-sub-text">No panchang data.</div>
        )}
      </Sec>
    </div>
  );
}
