import { useEffect, useState } from 'react';
import { kundliService, userService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { DateField, TimeField, CityField } from '../components/BirthInputs';

const EMPTY = { name: '', gender: '', dob: '', tob: '', ampm: 'AM',
  place: '', isDefault: false };

export default function Kundli() {
  const { user, profile, loading } = useRequireClient();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [toolUrl, setToolUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState({});   // { [kundliId]: data|'loading'|'err' }

  async function viewFull(k) {
    setChart((c) => ({ ...c, [k.id]: 'loading' }));
    const data = await kundliService.getFullKundli(k);
    setChart((c) => ({ ...c, [k.id]: data || 'err' }));
  }

  async function refresh() {
    const l = await kundliService.getKundliProfiles(user.uid);
    setList(l);
    // By default, show the saved full report of the default profile
    // (cached - no API call unless dob / time / place changed).
    const def = l.find((k) => k.isDefault) || l[0];
    if (def) {
      setChart((c) => (c[def.id] ? c : { ...c, [def.id]: 'loading' }));
      const data = await kundliService.getFullKundli(def);
      setChart((c) => ({ ...c, [def.id]: data || 'err' }));
    }
  }

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, name: profile?.name || '',
      gender: profile?.gender || f.gender || '' }));
    refresh();
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setToolUrl(s.exists() ? (s.data().kundliToolUrl || '') : ''));
    // eslint-disable-next-line
  }, [user, profile]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await kundliService.saveKundli(user.uid, form);
      // If the customer picked their gender here (and it isn't already
      // on their account), also save it onto the user doc so it powers
      // the customer's avatar everywhere in the app.
      if (form.gender && form.gender !== (profile && profile.gender)) {
        try { await userService.updateUser(user.uid,
          { gender: form.gender }); } catch (_) {}
      }
      setForm({ ...EMPTY, name: profile?.name || '',
        gender: profile?.gender || form.gender || '' });
      await refresh();
    } finally { setBusy(false); }
  }

  async function makeDefault(id) {
    await kundliService.setDefaultKundli(user.uid, id);
    refresh();
  }
  async function remove(id) {
    await kundliService.deleteKundli(id);
    refresh();
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Kundli Profiles</h1>

      <form onSubmit={save} className="card mb-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,150px]">
          <input className="input" placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required />
          <select className="input" value={form.gender || ''} required
            onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Gender…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateField value={form.dob}
            onChange={(dob) => setForm({ ...form, dob })} />
          <TimeField value={form.tob} ampm={form.ampm}
            onChange={(tob, ampm) => setForm({ ...form, tob, ampm })} />
          <div className="sm:col-span-2">
            <CityField value={form.place}
              onChange={(place) => setForm({ ...form, place })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDefault}
            onChange={(e) =>
              setForm({ ...form, isDefault: e.target.checked })} />
          Set as default profile (auto-shared at session start)
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save Kundli'}
        </button>
      </form>

      {toolUrl && (
        <a href={toolUrl} target="_blank" rel="noreferrer"
          className="btn-ghost mb-4 inline-block">
          Open Kundli Chart Tool ↗
        </a>
      )}

      {list == null ? (
        <SkeletonList count={2} />
      ) : list.length === 0 ? (
        <div className="card text-sub-text">No profiles saved yet.</div>
      ) : (
        <div className="space-y-2">
          {list.map((k) => (
            <div key={k.id} className="card">
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {k.name}{' '}
                  {k.isDefault && (
                    <span className="badge bg-bg-light text-primary">
                      Default
                    </span>
                  )}
                </div>
                <span className="text-gold text-sm">{k.zodiac}</span>
              </div>
              <div className="mt-1 text-sm text-sub-text">
                {k.dob} · {k.tob} {k.ampm} · {k.place}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                <button onClick={() => viewFull(k)}
                  className="font-semibold text-primary">
                  View full Kundli
                </button>
                {!k.isDefault && (
                  <button onClick={() => makeDefault(k.id)}
                    className="text-primary font-semibold">
                    Make default
                  </button>
                )}
                <button onClick={() => remove(k.id)} className="text-danger">
                  Delete
                </button>
              </div>
              {chart[k.id] === 'loading' && (
                <div className="mt-2 text-sm text-sub-text">
                  Generating kundli...
                </div>
              )}
              {chart[k.id] === 'err' && (
                <div className="mt-2 text-sm text-danger">
                  Kundli service not available yet. (Admin: set Prokerala
                  keys on the relay.)
                </div>
              )}
              {chart[k.id] && typeof chart[k.id] === 'object' && (
                <FullKundli r={chart[k.id]} kundli={k} />
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

// Collapsible Maha-dasha row with nested Antar -> Pratyantar.
// Current period (any level) is always expanded + highlighted; the
// rest collapse so the list of 9 mahas stays scannable.
function DashaRow({ d }) {
  const [open, setOpen] = useState(!!d.current);
  const has = (d.antardasha || []).length > 0;
  return (
    <div className={`rounded-card border p-2 text-xs ${d.current
      ? 'border-primary/40 bg-primary/5'
      : 'border-gray-200 bg-white'}`}>
      <button type="button"
        onClick={() => has && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
                    text-left">
        <span className={`flex items-center gap-2 font-semibold
          ${d.current ? 'text-primary' : ''}`}>
          {has && (
            <span className={`inline-block w-3 text-center
                transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          )}
          {d.planet}
          {d.current && (
            <span className="rounded-full bg-primary px-2 py-0.5
                              text-[10px] font-bold text-white">
              current
            </span>
          )}
        </span>
        <span className="shrink-0 text-sub-text">
          {String(d.start || '').slice(0, 10)} —{' '}
          {String(d.end || '').slice(0, 10)}
        </span>
      </button>
      {has && open && (
        <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
          {d.antardasha.map((a, j) => (
            <AntarRow key={j} a={a} parentCurrent={!!d.current} />
          ))}
        </div>
      )}
    </div>
  );
}

function AntarRow({ a, parentCurrent }) {
  const [open, setOpen] = useState(!!a.current);
  const has = (a.pratyantardasha || []).length > 0;
  return (
    <div className={`rounded p-1.5 text-[11px] ${a.current
      ? 'bg-primary/10 font-semibold text-primary'
      : parentCurrent ? '' : 'text-sub-text'}`}>
      <button type="button"
        onClick={() => has && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2
                    text-left">
        <span className="flex items-center gap-1.5">
          {has && (
            <span className={`inline-block w-2.5 text-center
                transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          )}
          {!has && <span className="inline-block w-2.5" />}
          {a.planet}
          {a.current && (
            <span className="rounded-full bg-primary px-1.5 py-0.5
                              text-[9px] font-bold text-white">
              now
            </span>
          )}
        </span>
        <span className="shrink-0">
          {String(a.start || '').slice(0, 10)} —{' '}
          {String(a.end || '').slice(0, 10)}
        </span>
      </button>
      {has && open && (
        <div className="mt-1 space-y-0.5 border-t border-primary/10 pt-1
                         pl-4">
          {a.pratyantardasha.map((p, k) => (
            <div key={k}
              className={`flex justify-between ${p.current
                ? 'font-bold text-accent' : 'text-sub-text'}`}>
              <span>{p.planet}{p.current ? ' · now' : ''}</span>
              <span>
                {String(p.start || '').slice(0, 10)} —{' '}
                {String(p.end || '').slice(0, 10)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FullKundli({ r, kundli }) {
  const [tab, setTab] = useState('overview');
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  // Tabs that have no data on the current API plan are hidden entirely
  // instead of showing a "Chart/Dasha unavailable on the current
  // Prokerala plan" placeholder, which read like a broken feature to
  // the user. The Overview + Planets & Houses tabs always work from
  // the basic kundli payload, so they stay.
  const hasChart = !!(r.charts && (r.charts.rasi || r.charts.navamsa));
  const hasDasha = Array.isArray(r.dasha) && r.dasha.length > 0;
  const TABS = [
    ['overview', 'Overview'],
    hasChart && ['chart', 'Chart'],
    ['planets', 'Planets & Houses'],
    hasDasha && ['dasha', 'Dasha'],
  ].filter(Boolean);
  // If the currently-selected tab was just removed (e.g. user was on
  // 'dasha' but reloaded into a kundli without dasha data) snap back
  // to Overview so we never show a blank section.
  useEffect(() => {
    if (!TABS.find(([k]) => k === tab)) setTab('overview');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChart, hasDasha]);
  // Group planets by house (1..12) for the "planets in houses" view.
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
      <ReportButtons kundli={kundli} />

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
          {/* Current period card — drilled all the way to pratyantar
              when AstroSeer's /api/dasha/current returns it. */}
          {r.currentDasha && (
            <div className="mb-3 rounded-card bg-gradient-to-br
                            from-primary to-accent p-4 text-white">
              <div className="text-xs uppercase tracking-wide
                              opacity-80">
                Current period
              </div>
              <div className="mt-1 text-lg font-bold">
                {r.currentDasha.planet}
                {r.currentDasha.antar
                  ? <> / <span className="opacity-90">
                      {r.currentDasha.antar.planet}
                    </span></>
                  : null}
                {r.currentDasha.pratyantar
                  ? <> / <span className="opacity-80">
                      {r.currentDasha.pratyantar.planet}
                    </span></>
                  : null}
              </div>
              <div className="mt-1 text-xs opacity-90">
                Maha&nbsp;{r.currentDasha.planet}{' '}
                ({String(r.currentDasha.start || '').slice(0, 10)} —{' '}
                {String(r.currentDasha.end || '').slice(0, 10)})
              </div>
              {r.currentDasha.antar && (
                <div className="text-xs opacity-90">
                  Antar&nbsp;{r.currentDasha.antar.planet}{' '}
                  ({String(r.currentDasha.antar.start || '').slice(0, 10)} —{' '}
                  {String(r.currentDasha.antar.end || '').slice(0, 10)})
                </div>
              )}
              {r.currentDasha.pratyantar && (
                <div className="text-xs opacity-90">
                  Pratyantar&nbsp;{r.currentDasha.pratyantar.planet}{' '}
                  ({String(r.currentDasha.pratyantar.start || '').slice(0, 10)} —{' '}
                  {String(r.currentDasha.pratyantar.end || '').slice(0, 10)})
                </div>
              )}
            </div>
          )}
          <Sec title="Vimshottari Maha Dasha">
            <div className="space-y-1">
              {(r.dasha || []).length === 0 && (
                <div className="text-sub-text">
                  Dasha not available for this profile.
                </div>
              )}
              {(r.dasha || []).map((d, i) => (
                <DashaRow key={i} d={d} />
              ))}
            </div>
          </Sec>
        </div>
      )}
    </div>
  );
}

// ---- Report CTAs (free + paid) ------------------------------------
// Two buttons that sit inside the FullKundli card:
//   1. Free 250+ page Vedic kundli — server-side PDF, emailed,
//      downloadable immediately + later from /orders.
//   2. Paid 12-month forecast — price comes from Firestore
//      settings/config.kundli_report_price (default 50, set by
//      admin). Wallet-deducted server-side inside a Firestore
//      transaction; insufficient balance pops a "Top up wallet"
//      link instead of failing silently.
// On success the user sees an immediate Download popup with the
// signed Firebase Storage URL — same one stored on users/{uid}/
// orders/{id} for unlimited re-download.
function ReportButtons({ kundli }) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [price, setPrice] = useState(50);
  useEffect(() => {
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'config'));
        const p = Number(
          (s.exists() && s.data().kundli_report_price) || 0);
        if (p > 0) setPrice(p);
      } catch (_) { /* keep default */ }
    })();
  }, []);
  async function buy(kind) {
    setError(null); setBusy(kind); setResult(null);
    try {
      const uid = kundli && kundli.userId;
      if (!uid || !kundli.id) {
        throw new Error('Save a kundli profile first.');
      }
      const out = await kundliService.requestReport({
        uid, kundliProfileId: kundli.id, kind,
      });
      setResult(out);
    } catch (e) {
      setError(e);
    } finally { setBusy(''); }
  }
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => buy('free')}
          disabled={!!busy}
          className="rounded-full bg-primary px-3 py-1.5 text-xs
            font-bold text-white disabled:opacity-60">
          {busy === 'free'
            ? 'Preparing…'
            : '⬇ Free 250+ page Kundli (PDF)'}
        </button>
        <button type="button" onClick={() => buy('forecast12')}
          disabled={!!busy}
          className="rounded-full bg-accent px-3 py-1.5 text-xs
            font-bold text-white disabled:opacity-60">
          {busy === 'forecast12'
            ? 'Charging wallet…'
            : `12-Month Forecast · ₹${price} from wallet`}
        </button>
      </div>
      {error && (
        <div className="rounded-card bg-danger/10 p-2 text-xs text-danger">
          {error.code === 'insufficient_wallet' ? (
            <>
              Wallet balance ₹{error.wallet || 0} is not enough for
              ₹{error.price || price}.{' '}
              <a href="/wallet" className="font-bold underline">
                Add money to wallet
              </a>
            </>
          ) : (
            <>
              Could not generate the report: {error.message}
              {error.refunded ? ' (wallet refunded automatically)' : ''}
            </>
          )}
        </div>
      )}
      {result && result.ok && (
        <DownloadPopup result={result}
          onClose={() => setResult(null)} />
      )}
    </div>
  );
}

// Themed download popup. Shows the moment the relay returns the
// signed URL. Single primary CTA + hint that the same PDF is also
// in their email + the Orders section for later.
function DownloadPopup({ result, onClose }) {
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
                    justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5
                      text-center shadow-2xl">
        <div className="text-3xl">🎉</div>
        <div className="mt-2 text-lg font-bold text-primary">
          {result.kind === 'forecast12'
            ? '12-month forecast is ready'
            : 'Your Vedic kundli is ready'}
        </div>
        <div className="mt-1 text-xs text-sub-text">
          {result.amount > 0
            ? `₹${result.amount} deducted from wallet. `
            : ''}
          {result.emailed ? 'Also sent to your email. ' : ''}
          Saved in Orders for unlimited re-download.
        </div>
        <a href={result.pdfUrl} target="_blank" rel="noreferrer"
          className="mt-4 block rounded-full bg-primary py-2.5
            text-sm font-bold text-white">
          ⬇ Download PDF now
        </a>
        <a href="/orders"
          className="mt-2 block text-xs font-semibold text-primary">
          View all my orders →
        </a>
        <button type="button" onClick={onClose}
          className="mt-2 block w-full text-xs text-sub-text">
          Close
        </button>
      </div>
    </div>
  );
}
