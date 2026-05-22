import { useState } from 'react';
import { kundliService } from '@astro/shared';

function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

// Full ascendant-based Kundli report with tabbed sections. Same view
// the client sees, so the astrologer reads the identical chart.
export default function FullKundli({ r, kundli }) {
  const [tab, setTab] = useState('overview');
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  const TABS = [
    ['overview', 'Overview'],
    ['chart', 'Chart'],
    ['planets', 'Planets & Houses'],
    ['dasha', 'Dasha'],
  ];
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house) || 0;
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(p);
  });

  return (
    <div className="mt-3 rounded-card bg-bg-light p-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">Full Kundli</div>
        <span className="text-[11px] text-sub-text">
          {r.cached ? 'Saved report' : 'Newly generated'}
        </span>
      </div>
      <button
        onClick={() => kundliService.downloadKundliReport(kundli || {}, r)}
        className="mt-2 rounded-full bg-primary px-3 py-1.5 text-xs
          font-bold text-white">
        ⬇ Download full report (PDF)
      </button>

      <div className="mt-2 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              tab === k ? 'bg-primary text-white'
                : 'bg-white text-sub-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm
                          sm:grid-cols-4">
            <div><span className="text-sub-text">Ascendant</span><br />
              <b>{(r.ascendant && r.ascendant.sign) || '-'}</b></div>
            <div><span className="text-sub-text">Nakshatra</span><br />
              <b>{r.nakshatra || '-'}</b></div>
            <div><span className="text-sub-text">Moon sign</span><br />
              <b>{r.chandra_rasi || '-'}</b></div>
            <div><span className="text-sub-text">Sun sign</span><br />
              <b>{r.soorya_rasi || '-'}</b></div>
          </div>
          {n.personality && <Sec title="Personality">{n.personality}</Sec>}
          {n.career && <Sec title="Career">{n.career}</Sec>}
          {n.health && <Sec title="Health">{n.health}</Sec>}
          {n.love && <Sec title="Love & Relationships">{n.love}</Sec>}
          {n.life && <Sec title="Life Path">{n.life}</Sec>}
          <Sec title="Lucky">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              <div>Deity: <b>{lucky.deity}</b></div>
              <div>Colour: <b>{lucky.color}</b></div>
              <div>Stone: <b>{lucky.stone}</b></div>
              <div>Direction: <b>{lucky.direction}</b></div>
              <div>Syllables: <b>{lucky.syllables}</b></div>
            </div>
          </Sec>
        </div>
      )}

      {tab === 'chart' && (
        <div className="mt-3 space-y-4">
          {r.charts && r.charts.rasi ? (
            <div>
              <div className="mb-1 text-sm font-bold text-primary">
                Rasi chart (D1)
              </div>
              <div className="overflow-auto rounded-card bg-white p-2"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: r.charts.rasi }} />
            </div>
          ) : (
            <div className="text-sm text-sub-text">
              Chart image unavailable on the current Prokerala plan.
            </div>
          )}
          {r.charts && r.charts.navamsa && (
            <div>
              <div className="mb-1 text-sm font-bold text-primary">
                Navamsa chart (D9)
              </div>
              <div className="overflow-auto rounded-card bg-white p-2"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: r.charts.navamsa }} />
            </div>
          )}
        </div>
      )}

      {tab === 'planets' && (
        <div className="mt-3">
          <Sec title="Planet positions">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-sub-text">
                  <tr><th className="py-1 pr-3">Planet</th>
                    <th className="py-1 pr-3">Sign</th>
                    <th className="py-1 pr-3">House</th>
                    <th className="py-1 pr-3">Degree</th>
                    <th className="py-1">Retro</th></tr>
                </thead>
                <tbody>
                  {(r.planets || []).map((p) => (
                    <tr key={p.name} className="border-t border-white">
                      <td className="py-1 pr-3 font-semibold">{p.name}</td>
                      <td className="py-1 pr-3">{p.sign || '-'}</td>
                      <td className="py-1 pr-3">{p.house ?? '-'}</td>
                      <td className="py-1 pr-3">{p.degree ?? '-'}</td>
                      <td className="py-1">{p.retrograde ? 'R' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sec>
          <Sec title="Planets in houses">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <div key={h} className="rounded-card bg-white p-2">
                  <div className="text-xs font-bold">House {h}</div>
                  <div className="text-xs text-sub-text">
                    {(byHouse[h] || []).map((p) => p.name).join(', ')
                      || '-'}
                  </div>
                </div>
              ))}
            </div>
          </Sec>
        </div>
      )}

      {tab === 'dasha' && (
        <div className="mt-3">
          {r.currentDasha && (
            <div className="mb-2 rounded-card bg-primary p-3 text-sm
                            text-white">
              Current Maha Dasha: <b>{r.currentDasha.planet}</b>{' '}
              ({String(r.currentDasha.start || '').slice(0, 10)} to{' '}
              {String(r.currentDasha.end || '').slice(0, 10)})
            </div>
          )}
          <Sec title="Vimshottari Maha Dasha">
            <div className="space-y-1">
              {(r.dasha || []).length === 0 && (
                <div className="text-sub-text">
                  Dasha unavailable on the current Prokerala plan.
                </div>
              )}
              {(r.dasha || []).map((d, i) => (
                <div key={i}
                  className={`rounded-card p-2 text-xs ${d.current
                    ? 'bg-primary/10 font-semibold' : 'bg-white'}`}>
                  <div className="flex justify-between">
                    <span>{d.planet}{d.current ? ' (current)' : ''}</span>
                    <span className="text-sub-text">
                      {String(d.start || '').slice(0, 10)} to{' '}
                      {String(d.end || '').slice(0, 10)}
                    </span>
                  </div>
                  {d.current && d.antardasha && d.antardasha.length > 0 && (
                    <div className="mt-1 border-t border-gray-200 pt-1">
                      {d.antardasha.map((a, j) => (
                        <div key={j}
                          className={`flex justify-between ${a.current
                            ? 'font-bold text-primary' : ''}`}>
                          <span>{a.planet}</span>
                          <span>
                            {String(a.start || '').slice(0, 10)} to{' '}
                            {String(a.end || '').slice(0, 10)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Sec>
        </div>
      )}
    </div>
  );
}
