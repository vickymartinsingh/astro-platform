import { useEffect, useState } from 'react';
import Link from 'next/link';
import { kundliService, userService, db, vimshottari } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { DateField, TimeField, CityField } from '../components/BirthInputs';

// Form shape. lat/lng/tz are captured at place-pick time so the
// relay always has the right coordinates + timezone — fixes the
// silent "kundli with coordinates 0,0 / GMT+0" failure mode.
const EMPTY = { name: '', gender: '', dob: '', tob: '', ampm: 'AM',
  place: '', lat: null, lng: null, tz: null,
  country: '', state: '', city: '', countryCode: '',
  isDefault: false };

export default function Kundli() {
  const { user, profile, loading } = useRequireClient();
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null); // null = create
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
      if (editingId) {
        await kundliService.updateKundli(user.uid, editingId, form);
        // Clear the cached chart for this profile so the user sees
        // fresh data the next time they tap View Full Kundli (the
        // service already drops report+reportSig from Firestore when
        // birth fields change).
        setChart((c) => ({ ...c, [editingId]: undefined }));
      } else {
        await kundliService.saveKundli(user.uid, form);
      }
      // If the customer picked their gender here (and it isn't already
      // on their account), also save it onto the user doc so it powers
      // the customer's avatar everywhere in the app.
      if (form.gender && form.gender !== (profile && profile.gender)) {
        try { await userService.updateUser(user.uid,
          { gender: form.gender }); } catch (_) {}
      }
      setForm({ ...EMPTY, name: profile?.name || '',
        gender: profile?.gender || form.gender || '' });
      setEditingId(null);
      await refresh();
    } finally { setBusy(false); }
  }

  function edit(k) {
    setEditingId(k.id);
    setForm({
      name: k.name || '',
      gender: k.gender || profile?.gender || '',
      dob: k.dob || '',
      tob: k.tob || '',
      ampm: k.ampm || 'AM',
      place: k.place || '',
      // Carry locked location data across the edit if it exists.
      // Without lat/lng the CityField shows just the text and the
      // user has to re-pick from autocomplete to re-lock coords.
      lat: k.lat != null ? Number(k.lat) : null,
      lng: k.lng != null ? Number(k.lng) : null,
      tz: k.tz != null ? Number(k.tz) : null,
      country: k.country || '',
      state: k.state || '',
      city: k.city || '',
      countryCode: k.countryCode || '',
      isDefault: !!k.isDefault,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function cancelEdit() {
    setEditingId(null);
    setForm({ ...EMPTY, name: profile?.name || '',
      gender: profile?.gender || '' });
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
            <CityField
              value={form.lat ? {
                place: form.place, lat: form.lat, lng: form.lng,
                tz: form.tz, country: form.country, state: form.state,
                city: form.city, countryCode: form.countryCode,
                label: form.place,
              } : form.place}
              onChange={(loc) => setForm((f) => ({
                ...f,
                place: loc.place || '',
                lat: loc.lat != null ? loc.lat : null,
                lng: loc.lng != null ? loc.lng : null,
                tz: loc.tz != null ? loc.tz : null,
                country: loc.country || '',
                state: loc.state || '',
                city: loc.city || '',
                countryCode: loc.countryCode || '',
              }))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDefault}
            onChange={(e) =>
              setForm({ ...form, isDefault: e.target.checked })} />
          Set as default profile (auto-shared at session start)
        </label>
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy}>
            {busy
              ? 'Saving…'
              : editingId ? 'Save changes' : 'Save Kundli'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit}
              className="rounded-full border border-gray-300 px-4
                py-2 text-sm font-semibold text-sub-text">
              Cancel
            </button>
          )}
        </div>
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
                <button onClick={() => edit(k)}
                  className="font-semibold text-primary">
                  Edit
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
                  Generating kundli…
                </div>
              )}
              {chart[k.id] === 'err' && (
                <div className="mt-2 flex flex-wrap items-center gap-2
                                text-sm text-danger">
                  <span>
                    Could not load the chart right now. The kundli
                    service may be waking up. Please try again in a
                    moment.
                  </span>
                  <button type="button"
                    onClick={() => viewFull(k)}
                    className="rounded-full border border-danger px-3
                      py-1 text-xs font-bold text-danger">
                    Retry
                  </button>
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

// AstroTalk-style yellow banner header used at the top of every
// boxed section. Matches the reference screenshots:
// rounded-edge yellow strip with bold centred dark text.
function Banner({ title, sub }) {
  return (
    <div className="mt-3 rounded-card bg-[#FFD63A] py-2 text-center">
      <div className="text-sm font-bold text-dark-text">{title}</div>
      {sub && (
        <div className="mt-0.5 text-[11px] font-semibold text-dark-text/80">
          {sub}
        </div>
      )}
    </div>
  );
}

// AstroSeer / AstroTalk-style providers sometimes return rich
// objects for fields the UI expects to be scalars (e.g. nakshatra
// arrives as `{ name, lord, number, pada }`, sign_lord arrives as
// `{ name, vedic_name }`). Rendering an object directly is the
// classic React error #31. txt() coerces any of these into the
// best human-readable string before they hit JSX.
function txt(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number'
    || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map(txt).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') {
    return String(v.name || v.title || v.label || v.vedic_name
      || v.value || v.id || v.lord || '');
  }
  return '';
}

// Legacy small-header section used inside cards; left as-is for the
// existing tabs (transits / yogas / doshas etc) that haven't been
// restyled yet.
function Sec({ title, children }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-sm font-bold text-primary">{title}</div>
      <div className="text-sm text-dark-text">{children}</div>
    </div>
  );
}

// "Connect with an Astrologer..." CTA strip the AstroTalk reference
// drops between sections. Two pill buttons -> Astrologer list, with
// the call mode pre-selected.
function TalkChatCTA() {
  return (
    <div className="mt-4 rounded-card bg-[#FFD63A] p-3 text-center">
      <div className="mb-2 text-[12px] font-semibold text-dark-text">
        Connect with an Astrologer on Call or Chat for more
        personalised detailed predictions.
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/astrologers?mode=call"
          className="inline-flex items-center gap-1.5 rounded-full
            bg-white px-4 py-1.5 text-xs font-bold text-dark-text
            shadow-sm">
          <span>📞</span> Talk to Astrologer
        </Link>
        <Link href="/astrologers?mode=chat"
          className="inline-flex items-center gap-1.5 rounded-full
            bg-white px-4 py-1.5 text-xs font-bold text-dark-text
            shadow-sm">
          <span>💬</span> Chat with Astrologer
        </Link>
      </div>
    </div>
  );
}

// "Download & share your kundli report" dark banner the reference
// places at the bottom of each tab. Wires straight to the same
// download path the Reports section uses.
function DownloadBanner({ kundli, full }) {
  return (
    <button type="button"
      onClick={() => kundliService.downloadKundliReport(
        kundli || {}, full || {})}
      className="mt-3 flex w-full items-center gap-3 rounded-card
        bg-gradient-to-r from-[#0F0A23] to-[#1A1245] p-4 text-left
        text-white shadow">
      <div className="grid h-12 w-12 shrink-0 place-items-center
        rounded-full bg-[#FFD63A]/15 text-2xl">📜</div>
      <div className="flex-1">
        <div className="text-sm font-bold">
          Download &amp; share your kundli report
        </div>
        <span className="mt-1 inline-block rounded-full bg-[#FFD63A]
          px-3 py-1 text-[11px] font-bold text-dark-text">
          Download Kundli PDF
        </span>
      </div>
    </button>
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
          {String(d.start || '').slice(0, 10)} to{' '}
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
          {String(a.start || '').slice(0, 10)} to{' '}
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
                {String(p.start || '').slice(0, 10)} to{' '}
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
  const raw = r.raw || {};
  // Read user's preferred chart style. Stored on users/{uid}.
  // .chartStyle: 'north' | 'south'. Default = north.
  const [chartStyle, setChartStyle] = useState('north');
  useEffect(() => {
    (async () => {
      try {
        const uid = kundli && kundli.userId;
        if (!uid) return;
        const u = await getDoc(doc(db, 'users', uid));
        const s = u.exists() && u.data().chartStyle;
        if (s === 'north' || s === 'south') setChartStyle(s);
      } catch (_) { /* keep default */ }
    })();
  }, [kundli]);
  async function saveChartStyle(s) {
    setChartStyle(s);
    try {
      const uid = kundli && kundli.userId;
      if (!uid) return;
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'users', uid), { chartStyle: s });
    } catch (_) { /* best effort */ }
  }

  // Seven top-level tabs that mirror the AstroTalk reference exactly.
  // Older tabs (transits / yogas / doshas / compat / numerology) are
  // folded into the relevant new tab as a sub-section so nothing is
  // lost — just reorganised to match the reference layout.
  const TABS = [
    ['basic', 'Basic'],
    ['kundli', 'Kundli'],
    ['kp', 'KP'],
    ['ashtakvarga', 'Ashtakvarga'],
    ['charts', 'Charts'],
    ['dasha', 'Dasha'],
    ['freeReport', 'Free Report'],
  ];

  // Coerce older saved tab keys to the new schema so the bookmarked
  // ?tab=overview keeps working after the rename.
  const ALIAS = {
    overview: 'basic', chart: 'kundli', planets: 'kundli',
    transits: 'kundli', yogas: 'kundli', doshas: 'kundli',
    panchang: 'basic', compat: 'freeReport', nav: 'freeReport',
  };
  const activeTab = ALIAS[tab] || tab;

  return (
    <div className="mt-3 rounded-card bg-bg-light p-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">Full Kundli</div>
        <span className="text-[11px] text-sub-text">
          {r.cached ? 'Saved report' : 'Newly generated'}
        </span>
      </div>
      <ReportButtons kundli={kundli} />

      {/* Yellow-active pill tabs, matching the AstroTalk web view. */}
      <div className="mt-3 flex flex-nowrap gap-1 overflow-x-auto
        rounded-card bg-white p-1">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`shrink-0 rounded-card px-3 py-1.5
              text-[12px] font-bold transition ${activeTab === k
                ? 'bg-[#FFD63A] text-dark-text shadow-sm'
                : 'text-sub-text hover:text-dark-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'basic' && (
        <BasicTab r={r} raw={raw} kundli={kundli} />
      )}
      {activeTab === 'kundli' && (
        <KundliMainTab r={r} raw={raw} kundli={kundli}
          chartStyle={chartStyle} onChangeStyle={saveChartStyle} />
      )}
      {activeTab === 'kp' && <KpTab r={r} raw={raw} />}
      {activeTab === 'ashtakvarga' && (
        <AshtakvargaTab r={r} raw={raw} />
      )}
      {activeTab === 'charts' && (
        <ChartsGridTab r={r} raw={raw} chartStyle={chartStyle} />
      )}
      {activeTab === 'dasha' && <DashaTab r={r} />}
      {activeTab === 'freeReport' && (
        <FreeReportTab r={r} n={n} lucky={lucky} kundli={kundli} />
      )}

      <TalkChatCTA />
      <DownloadBanner kundli={kundli} full={r} />
    </div>
  );
}

// =====================================================================
// AstroTalk-style tabs. Mirror the user's reference screenshots:
//   Basic | Kundli | KP | Ashtakvarga | Charts | Dasha | Free Report
// Each tab opens with a yellow banner header, content in clean rows,
// and the CTA + download banner appear underneath via the shell.
// =====================================================================

// ---------- Tab: Basic --------------------------------------------
// Three boxed tables: Basic Details, Avakhada Details, Panchang Details.
// Mirrors User-kundali-report.pdf p.2 + p.3 layout.
function BasicTab({ r, raw, kundli }) {
  const a = r.ascendant || {};
  const p = (raw && raw.panchang) || r.panchang || {};
  const moon = (r.planets || []).find((x) => /moon/i.test(x.name || ''))
    || {};
  // Birth details, taken from the kundli profile + r.basic when set.
  const basic = r.basic || {};
  const tz = basic.timezone || kundli?.tz != null
    ? `GMT${kundli.tz >= 0 ? '+' : ''}${kundli.tz}` : '·';
  const placeStr = kundli?.place
    || [basic.city, basic.state, basic.country].filter(Boolean).join(', ');
  const dobStr = kundli?.dob || basic.date || '·';
  const tobStr = kundli?.tob
    ? `${kundli.tob} ${kundli.ampm || ''}`.trim()
    : (basic.time || '·');
  // Every row value goes through txt() so provider-returned objects
  // (e.g. r.nakshatra = { name, lord, number, pada }) never reach
  // React as a child — that's React error #31.
  const birthRows = [
    ['Name', txt(kundli?.name || basic.name) || '·'],
    ['Date', txt(dobStr) || '·'],
    ['Time', txt(tobStr) || '·'],
    ['Place', txt(placeStr) || '·'],
    ['Latitude', kundli?.lat != null ? Number(kundli.lat).toFixed(2)
      : txt(basic.latitude) || '·'],
    ['Longitude', kundli?.lng != null ? Number(kundli.lng).toFixed(2)
      : txt(basic.longitude) || '·'],
    ['Timezone', txt(tz || basic.timezone) || '·'],
    ['Sunrise', txt(basic.sunrise || p.sunrise) || '·'],
    ['Sunset', txt(basic.sunset || p.sunset) || '·'],
    ['Ayanamsha', txt(basic.ayanamsha || raw?.ayanamsha) || '·'],
  ];
  // Avakhada — pull from raw.avakhada if AstroSeer returns it,
  // fall back to derived values from the existing fields so the
  // table is never empty.
  const av = raw?.avakhada || raw?.avakhada_details || {};
  const avakhadaRows = [
    ['Varna', txt(av.varna) || '·'],
    ['Vashya', txt(av.vashya) || '·'],
    ['Yoni', txt(av.yoni) || '·'],
    ['Gan', txt(av.gan || av.gana) || '·'],
    ['Nadi', txt(av.nadi) || '·'],
    ['Sign', txt(av.sign || moon.sign || r.chandra_rasi) || '·'],
    ['Sign Lord', txt(av.sign_lord || moon.sign_lord) || '·'],
    ['Nakshatra-Charan',
      txt(av.nakshatra_charan || moon.pada || r.nakshatra) || '·'],
    ['Yog', txt(av.yog || p.yoga) || '·'],
    ['Karan', txt(av.karan || p.karana) || '·'],
    ['Tithi', txt(av.tithi || p.tithi) || '·'],
    ['Yunja', txt(av.yunja) || '·'],
    ['Tatva', txt(av.tatva) || '·'],
    ['Name alphabet', txt(av.name_alphabet || av.syllable) || '·'],
    ['Paya', txt(av.paya) || '·'],
  ];
  const panchangRows = [
    ['Tithi', txt(p.tithi) || '·'],
    ['Karan', txt(p.karana) || '·'],
    ['Yog', txt(p.yoga) || '·'],
    ['Nakshatra', txt(p.nakshatra || r.nakshatra) || '·'],
  ];
  return (
    <>
      <Banner title="Basic Astrological Details" />
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <YBox title="Basic Details" rows={birthRows} />
        <YBox title="Avakhada Details" rows={avakhadaRows} />
      </div>
      <div className="mt-3">
        <YBox title="Panchang Details" rows={panchangRows} />
      </div>
    </>
  );
}

// Yellow-headed two-column key/value table — the building block used
// by every "Details" box across the AstroTalk reference.
function YBox({ title, rows }) {
  return (
    <div className="overflow-hidden rounded-card border border-gray-200
      bg-white">
      <div className="bg-[#FFD63A] py-2 text-center text-sm
        font-bold text-dark-text">
        {title}
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 px-3 py-1.5 text-[12px]">
            <span className="w-1/2 shrink-0 font-bold text-dark-text">
              {k}
            </span>
            <span className="flex-1 text-dark-text">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Tab: Kundli (Lagna chart + Planets table) --------------
function KundliMainTab({ r, raw, kundli,
  chartStyle, onChangeStyle }) {
  return (
    <>
      <Banner title="Lagna / Ascendant / Basic Birth chart" />
      <div className="mt-2 flex items-center justify-center gap-2">
        {['north', 'south'].map((s) => (
          <button key={s} type="button"
            onClick={() => onChangeStyle(s)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${chartStyle === s
                ? 'bg-[#FFD63A] text-dark-text'
                : 'bg-white text-sub-text'}`}>
            {s === 'north' ? 'North Indian' : 'South Indian'}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-card bg-[#FFF7E0] p-3">
        {chartStyle === 'north'
          ? <NorthChart r={r} />
          : <SouthChart r={r} />}
      </div>

      <Banner title="Planets" />
      <div className="mt-2 overflow-x-auto rounded-card bg-white p-2">
        <table className="w-full text-[11px]">
          <thead className="bg-[#FFF7E0] text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Planet</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Nakshatra</th>
              <th className="px-2 py-1.5">Naksh Lord</th>
              <th className="px-2 py-1.5">Degree</th>
              <th className="px-2 py-1.5">Retro(R)</th>
              <th className="px-2 py-1.5">Combust</th>
              <th className="px-2 py-1.5">Avastha</th>
              <th className="px-2 py-1.5">House</th>
              <th className="px-2 py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {(r.planets || []).map((p) => (
              <tr key={txt(p.name)}
                className="border-t border-gray-100">
                <td className="px-2 py-1 font-semibold">{txt(p.name)}</td>
                <td className="px-2 py-1">{txt(p.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(p.sign_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(p.nakshatra) || '·'}</td>
                <td className="px-2 py-1">
                  {txt(p.nakshatra_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(p.degree) || '·'}</td>
                <td className="px-2 py-1">
                  {p.retrograde ? 'Retro' : 'Direct'}
                </td>
                <td className="px-2 py-1">
                  {p.combust ? 'Yes' : 'No'}
                </td>
                <td className="px-2 py-1">{txt(p.avastha) || '·'}</td>
                <td className="px-2 py-1">{p.house ?? '·'}</td>
                <td className={`px-2 py-1 ${
                  txt(p.dignity) === 'Debilitated'
                    ? 'text-danger'
                    : txt(p.dignity) === 'Exalted'
                      ? 'text-success' : ''}`}>
                  {txt(p.dignity) || txt(p.status) || '·'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Tab: KP (Bhav Chalit + Ruling Planets + KP Planets) ----
function KpTab({ r, raw }) {
  const kp = raw?.kp || {};
  const ruling = kp.ruling_planets || raw?.ruling_planets || {};
  const cusps = kp.cusps || raw?.cusps || [];
  return (
    <>
      <Banner title="Bhav Chalit Chart" />
      <div className="mt-3 rounded-card bg-[#FFF7E0] p-3">
        <NorthChart r={r} />
      </div>

      <Banner title="Ruling Planets" />
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {[['Sign Lord', ruling.sign_lord],
          ['Star Lord', ruling.star_lord],
          ['Sub Lord', ruling.sub_lord]].map(([k, v]) => (
          <div key={k} className="rounded-card border border-gray-200
            bg-white p-3 text-center text-sm">
            <div className="text-[11px] font-bold uppercase
              tracking-wide text-sub-text">{k}</div>
            <div className="mt-1 font-bold text-dark-text">
              {txt(v) || '·'}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-card bg-white p-2">
          <span className="font-bold text-dark-text">Day Lord:</span>{' '}
          {txt(ruling.day_lord) || '·'}
        </div>
        <div className="rounded-card bg-white p-2">
          <span className="font-bold text-dark-text">Asc:</span>{' '}
          {txt(r.ascendant && r.ascendant.sign) || '·'}
        </div>
      </div>

      <Banner title="Planets" />
      <div className="mt-2 overflow-x-auto rounded-card bg-white p-2">
        <table className="w-full text-[11px]">
          <thead className="bg-[#FFF7E0] text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Planet</th>
              <th className="px-2 py-1.5">Cusp</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Star Lord</th>
              <th className="px-2 py-1.5">Sub Lord</th>
            </tr>
          </thead>
          <tbody>
            {(r.planets || []).map((p) => (
              <tr key={txt(p.name)}
                className="border-t border-gray-100">
                <td className="px-2 py-1 font-semibold">{txt(p.name)}</td>
                <td className="px-2 py-1">
                  {p.cusp ?? p.house ?? '·'}
                </td>
                <td className="px-2 py-1">{txt(p.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(p.sign_lord) || '·'}</td>
                <td className="px-2 py-1">
                  {txt(p.nakshatra_lord || p.star_lord) || '·'}
                </td>
                <td className="px-2 py-1">{txt(p.sub_lord) || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Banner title="Cusps" />
      <div className="mt-2 overflow-x-auto rounded-card bg-white p-2">
        <table className="w-full text-[11px]">
          <thead className="bg-[#FFF7E0] text-left text-dark-text">
            <tr>
              <th className="px-2 py-1.5">Cusp</th>
              <th className="px-2 py-1.5">Degree</th>
              <th className="px-2 py-1.5">Sign</th>
              <th className="px-2 py-1.5">Sign Lord</th>
              <th className="px-2 py-1.5">Star Lord</th>
              <th className="px-2 py-1.5">Sub Lord</th>
            </tr>
          </thead>
          <tbody>
            {(cusps && cusps.length > 0
              ? cusps : Array.from({ length: 12 }, (_, i) => ({
                cusp: i + 1, degree: '·',
              }))).map((c, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1">{c.cusp || (i + 1)}</td>
                <td className="px-2 py-1">{txt(c.degree) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sign) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sign_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(c.star_lord) || '·'}</td>
                <td className="px-2 py-1">{txt(c.sub_lord) || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------- Tab: Ashtakvarga (grid of 8 mini-charts) ---------------
function AshtakvargaTab({ r, raw }) {
  // Use raw.ashtakvarga from AstroSeer when present (a map keyed by
  // planet -> 12 house numbers). Fall back to a placeholder layout
  // that still renders the structure the user is asking for.
  const av = raw?.ashtakvarga || raw?.ashtakvarga_full || null;
  const ENTRIES = [
    ['Sav', 'Sarvashtaka'],
    ['Asc', 'Ascendant'],
    ['Jupiter', 'Jupiter'],
    ['Mars', 'Mars'],
    ['Mercury', 'Mercury'],
    ['Moon', 'Moon'],
    ['Saturn', 'Saturn'],
    ['Sun', 'Sun'],
    ['Venus', 'Venus'],
  ];
  function bindu(key) {
    if (!av) return null;
    return av[key] || av[key.toLowerCase()]
      || av[(key === 'Sav' ? 'sarvashtaka' : key.toLowerCase())]
      || null;
  }
  return (
    <>
      <Banner title="Ashtakvarga Chart" />
      <p className="mt-2 text-[11px] text-sub-text">
        Ashtakvarga is used to assess the strength and patterns each
        planet creates in your chart. A score of 1 to 8 bindus is given
        per house; the total across all 8 BAVs are overlaid here. A
        score of 4 or less indicates the house should be 30+.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        {ENTRIES.map(([key, label]) => (
          <div key={key}
            className="rounded-card bg-[#FFF7E0] p-2 text-center">
            <div className="mb-1 text-[12px] font-bold text-dark-text">
              {label}
            </div>
            <AshtakvargaMiniChart bindus={bindu(key)} />
          </div>
        ))}
      </div>
    </>
  );
}

// Mini Ashtakvarga chart — North-Indian diamond with one bindu number
// per house. Reused 8 times in the AshtakvargaTab grid.
function AshtakvargaMiniChart({ bindus }) {
  const cells = bindus && typeof bindus === 'object'
    ? bindus : {};
  const HOUSES = [
    { h: 1, x: 100, y: 60 }, { h: 2, x: 50, y: 38 },
    { h: 3, x: 30, y: 80 }, { h: 4, x: 50, y: 100 },
    { h: 5, x: 30, y: 120 }, { h: 6, x: 50, y: 160 },
    { h: 7, x: 100, y: 140 }, { h: 8, x: 150, y: 160 },
    { h: 9, x: 170, y: 120 }, { h: 10, x: 150, y: 100 },
    { h: 11, x: 170, y: 80 }, { h: 12, x: 150, y: 38 },
  ];
  return (
    <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[170px]">
      <rect x="8" y="8" width="184" height="184" fill="#fff"
        stroke="#A77B1F" strokeWidth="1.5" />
      <line x1="8" y1="8" x2="192" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="192" y1="8" x2="8" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="100" y1="8" x2="8" y2="100"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="100" y1="8" x2="192" y2="100"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="192" y1="100" x2="100" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      <line x1="8" y1="100" x2="100" y2="192"
        stroke="#A77B1F" strokeWidth="1" />
      {HOUSES.map(({ h, x, y }) => (
        <text key={h} x={x} y={y} textAnchor="middle"
          fontSize="11" fontWeight="bold" fill="#1a1a2e">
          {cells[h] != null ? String(cells[h]) : ''}
        </text>
      ))}
    </svg>
  );
}

// ---------- Tab: Charts (12 divisional charts grid) ----------------
function ChartsGridTab({ r, raw, chartStyle }) {
  const div = raw?.divisional || raw?.divisional_charts || {};
  // Canonical divisional list with the AstroTalk subtitle. Each entry
  // pulls its planets/sign data from raw.divisional[<key>] when
  // present; otherwise the slot still renders the layout so it's
  // obvious where the data is missing.
  const DIVS = [
    ['Hora', 'Prospects of marriage', 'd2'],
    ['Drekkana', 'Relationship with siblings', 'd3'],
    ['Chaturthamsa', 'Assets', 'd4'],
    ['Saptamsa', 'Progeny', 'd7'],
    ['Navamsa', 'Marriage', 'd9'],
    ['Dasamsa', 'Profession', 'd10'],
    ['Dvadasamsa', 'Native parents / Ancestors', 'd12'],
    ['Shodasamsa', 'Travel', 'd16'],
    ['Vimsamsa', 'Spiritual progress', 'd20'],
    ['Chaturvimsamsa', 'Intellectual', 'd24'],
    ['Saptavimsamsa', 'Strength / Protection', 'd27'],
    ['Trimsamsa', 'Misfortunes', 'd30'],
    ['Khavedamsa', 'Auspiciousness', 'd40'],
    ['Akshavedamsa', 'General issues', 'd45'],
    ['Shastiamsa', 'Summary of charts', 'd60'],
  ];
  return (
    <>
      <Banner title="Divisional Charts" />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2
        md:grid-cols-3">
        {DIVS.map(([name, sub, key]) => {
          const d = div[key] || div[name.toLowerCase()] || null;
          // Provider returns either the same { planets[], ascendant }
          // shape as the main report or a flat string. Coerce to a
          // shape NorthChart can render.
          const rd = (d && d.planets) ? d
            : { planets: r.planets || [], ascendant: r.ascendant };
          return (
            <div key={key}
              className="rounded-card bg-[#FFF7E0] p-2 text-center">
              <div className="text-[12px] font-bold text-dark-text">
                {name}
              </div>
              <div className="mb-1 text-[10px] text-sub-text">{sub}</div>
              {chartStyle === 'south'
                ? <SouthChart r={rd} />
                : <NorthChart r={rd} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Tab: Free Report (Ascendant report sections) -----------
function FreeReportTab({ r, n, lucky, kundli }) {
  const a = r.ascendant || {};
  const sign = txt(a.sign || r.chandra_rasi) || '·';
  return (
    <>
      <Banner title="Free Report" />
      <Banner title="Ascendant Report" />
      {a.sign && (
        <div className="mt-3 rounded-card bg-[#FFF7E0] p-3 text-sm">
          <b>Description.</b> Ascendant is one of the most sought
          concepts in astrology when it comes to predicting the minute
          events in your life. At the time of birth, the sign that
          rises in the sky is the person&apos;s ascendant. It helps in
          making predictions about the minute events, unlike your Moon
          or Sun sign that help in making weekly, monthly or yearly
          predictions for you. Your ascendant is {sign}.
        </div>
      )}
      {n.personality && (
        <ReportSection label="Personality" body={n.personality} />
      )}
      {n.career && (
        <ReportSection label="Career" body={n.career} />
      )}
      {n.health && (
        <ReportSection label="Health" body={n.health} />
      )}
      {n.love && (
        <ReportSection label="Love &amp; Relationships" body={n.love} />
      )}
      {n.life && (
        <ReportSection label="Life Path" body={n.life} />
      )}

      {(lucky.deity || lucky.color || lucky.stone) && (
        <>
          <Banner title="Lucky" />
          <div className="mt-3 rounded-card bg-white p-3 text-sm">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {lucky.deity && <div>Deity: <b>{lucky.deity}</b></div>}
              {lucky.color && <div>Colour: <b>{lucky.color}</b></div>}
              {lucky.stone && <div>Stone: <b>{lucky.stone}</b></div>}
              {lucky.direction && (
                <div>Direction: <b>{lucky.direction}</b></div>)}
              {lucky.syllables && (
                <div>Syllables: <b>{lucky.syllables}</b></div>)}
            </div>
          </div>
        </>
      )}
    </>
  );
}
function ReportSection({ label, body }) {
  return (
    <div className="mt-3 rounded-card bg-white p-3 text-sm">
      <div className="mb-1 font-bold text-dark-text">{label}</div>
      <p className="text-dark-text">{body}</p>
    </div>
  );
}

// ---------- Tab: Overview ----------------------------------------
function OverviewTab({ r, n, lucky }) {
  const a = r.ascendant || {};
  return (
    <div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm
                      sm:grid-cols-4">
        <Stat label="Ascendant"
          value={txt(a.sign)}
          sub={txt(a.degree_display || a.degree)} />
        <Stat label="Nakshatra"
          value={txt(r.nakshatra)}
          sub={a.pada ? `Pada ${a.pada}` : ''} />
        <Stat label="Moon sign" value={txt(r.chandra_rasi)} />
        <Stat label="Sun sign" value={txt(r.soorya_rasi)} />
        {a.lord && (
          <Stat label="Lagna lord" value={txt(a.lord)} />)}
        {a.nakshatra_lord && (
          <Stat label="Nakshatra lord" value={txt(a.nakshatra_lord)} />)}
        {a.element && <Stat label="Element" value={txt(a.element)} />}
        {a.modality && <Stat label="Modality" value={txt(a.modality)} />}
      </div>
      {n.personality && <Sec title="Personality">{n.personality}</Sec>}
      {n.career && <Sec title="Career">{n.career}</Sec>}
      {n.health && <Sec title="Health">{n.health}</Sec>}
      {n.love && <Sec title="Love and Relationships">{n.love}</Sec>}
      {n.life && <Sec title="Life Path">{n.life}</Sec>}
      <Sec title="Lucky">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <div>Deity: <b>{lucky.deity || '·'}</b></div>
          <div>Colour: <b>{lucky.color || '·'}</b></div>
          <div>Stone: <b>{lucky.stone || '·'}</b></div>
          <div>Direction: <b>{lucky.direction || '·'}</b></div>
          <div>Syllables: <b>{lucky.syllables || '·'}</b></div>
        </div>
      </Sec>
    </div>
  );
}
function Stat({ label, value, sub }) {
  return (
    <div>
      <span className="text-sub-text">{label}</span><br />
      <b>{value || '·'}</b>
      {sub && (
        <div className="text-[10px] text-sub-text">{sub}</div>
      )}
    </div>
  );
}

// ---------- Tab: Chart (North + South Indian, toggle) ------------
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
        <span className="ml-auto text-[10px] text-sub-text">
          Saved as default
        </span>
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

// North Indian diamond chart — Lagna at top middle, houses run
// counter-clockwise. Drawn as a single SVG so it looks identical
// on web + bundled APK/iOS shells.
function NorthChart({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  const SHORT = {
    Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
    Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
  };
  // 12 house cells with x/y positions inside a 300x300 SVG.
  const CELLS = [
    { h: 1, x: 150, y: 75 },   { h: 12, x: 75, y: 75 },
    { h: 11, x: 75, y: 150 },  { h: 10, x: 75, y: 225 },
    { h: 9, x: 150, y: 225 },  { h: 8, x: 225, y: 225 },
    { h: 7, x: 225, y: 150 },  { h: 6, x: 225, y: 75 },
    { h: 5, x: 150, y: 35 },   { h: 4, x: 75, y: 35 },
    { h: 3, x: 35, y: 150 },   { h: 2, x: 75, y: 35 },
  ];
  // Simpler reliable layout: 4x4 grid with diamond split.
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
        {/* North Indian house numbers + planets */}
        {[
          { h: 1, x: 150, y: 90 },
          { h: 2, x: 75, y: 60 },
          { h: 3, x: 50, y: 120 },
          { h: 4, x: 80, y: 150 },
          { h: 5, x: 50, y: 180 },
          { h: 6, x: 75, y: 240 },
          { h: 7, x: 150, y: 210 },
          { h: 8, x: 225, y: 240 },
          { h: 9, x: 250, y: 180 },
          { h: 10, x: 220, y: 150 },
          { h: 11, x: 250, y: 120 },
          { h: 12, x: 225, y: 60 },
        ].map(({ h, x, y }) => {
          const ps = byHouse[h] || [];
          return (
            <g key={h}>
              <text x={x} y={y - 8} textAnchor="middle"
                fontSize="9" fill="#888">H{h}</text>
              <text x={x} y={y + 4} textAnchor="middle"
                fontSize="11" fontWeight="bold" fill="#1a1a2e">
                {ps.map((p) => SHORT[p.name] || p.name.slice(0, 2))
                  .join(' ')}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Ascendant (Lagna) is House 1. Counter-clockwise from there.
        {ascSign ? ` Your Lagna sign: ${ascSign}.` : ''}
      </p>
    </div>
  );
}

// South Indian chart — fixed sign layout, planets slot into the
// sign-cell they currently occupy. Always reads the same way.
function SouthChart({ r }) {
  const SIGN_CELLS = [
    { sign: 'Pisces',      col: 0, row: 0 },
    { sign: 'Aries',       col: 1, row: 0 },
    { sign: 'Taurus',      col: 2, row: 0 },
    { sign: 'Gemini',      col: 3, row: 0 },
    { sign: 'Aquarius',    col: 0, row: 1 },
    { sign: 'Cancer',      col: 3, row: 1 },
    { sign: 'Capricorn',   col: 0, row: 2 },
    { sign: 'Leo',         col: 3, row: 2 },
    { sign: 'Sagittarius', col: 0, row: 3 },
    { sign: 'Scorpio',     col: 1, row: 3 },
    { sign: 'Libra',       col: 2, row: 3 },
    { sign: 'Virgo',       col: 3, row: 3 },
  ];
  const bySign = {};
  (r.planets || []).forEach((p) => {
    if (!p.sign) return;
    (bySign[p.sign] = bySign[p.sign] || []).push(p);
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  const SHORT = {
    Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
    Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
  };
  return (
    <div className="mx-auto" style={{ maxWidth: 360 }}>
      <div className="grid grid-cols-4 overflow-hidden rounded
                      border-2 border-primary">
        {Array.from({ length: 16 }).map((_, idx) => {
          const col = idx % 4; const row = Math.floor(idx / 4);
          // Center 2x2 is empty (traditional kundli layout).
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
                                    tracking-wide">
                      Lagna
                    </div>
                    <div className="font-bold text-primary">
                      {ascSign || '·'}
                    </div>
                  </div>
                </div>
              );
            }
            return null; // covered by the col-span-2 row-span-2
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
              <div className="mt-1 min-h-[24px] text-xs
                              font-semibold text-dark-text">
                {ps.map((p) => SHORT[p.name] || p.name.slice(0, 2))
                  .join(' ') || ''}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-sub-text">
        Signs are fixed; the highlighted cell is your Lagna
        ({ascSign || '·'}).
      </p>
    </div>
  );
}

// ---------- Tab: Planets & Houses --------------------------------
function PlanetsTab({ r }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) (byHouse[h] = byHouse[h] || []).push(p);
  });
  return (
    <div className="mt-3 space-y-4">
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
                <tr key={txt(p.name)} className="border-t border-white">
                  <td className="py-1 pr-3 font-semibold">{txt(p.name)}</td>
                  <td className="py-1 pr-3">{txt(p.sign) || '·'}</td>
                  <td className="py-1 pr-3">{p.house ?? '·'}</td>
                  <td className="py-1 pr-3">{txt(p.degree) || '·'}</td>
                  <td className="py-1 pr-3">{txt(p.nakshatra) || '·'}</td>
                  <td className="py-1 pr-3">{p.pada ?? '·'}</td>
                  <td className={`py-1 pr-3 ${
                    txt(p.dignity) === 'Debilitated' ? 'text-danger'
                      : txt(p.dignity) === 'Exalted' ? 'text-success'
                        : ''}`}>{txt(p.dignity) || '·'}</td>
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
                {(byHouse[h] || []).map((p) => txt(p.name))
                  .filter(Boolean).join(', ') || '·'}
              </div>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  );
}

// ---------- Tab: Dashas (Vimshottari full + current 6 levels) ----
function DashaTab({ r }) {
  const [sub, setSub] = useState('current');
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          ['current', 'Current periods'],
          ['drilldown', '4-level drilldown'],
          ['table', 'Full Vimshottari (120 years)'],
          ['tree', 'Interactive tree'],
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
        <CurrentDashaCard cd={r.currentDasha} />
      )}
      {sub === 'drilldown' && (
        <DashaDrilldown dasha={r.dasha || []} />
      )}
      {sub === 'table' && (
        <Sec title="Vimshottari Maha Dasha (full lifetime, 120 years)">
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
                  <tr key={i}
                    className={`border-t border-white ${d.current
                      ? 'bg-primary/10 font-bold' : ''}`}>
                    <td className="py-1 pr-3">
                      {d.planet}{d.current ? ' (current)' : ''}
                    </td>
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
                  text-sub-text">
                  Dasha data is loading or unavailable for this profile.
                </td></tr>
              )}
            </tbody>
          </table>
        </Sec>
      )}
      {sub === 'tree' && (
        <Sec title="Interactive Vimshottari tree">
          <div className="space-y-1">
            {(r.dasha || []).length === 0 && (
              <div className="text-sub-text">No dasha data.</div>
            )}
            {(r.dasha || []).map((d, i) => (<DashaRow key={i} d={d} />))}
          </div>
        </Sec>
      )}
    </div>
  );
}

// ---------- 4-level interactive drilldown ----------------------
// AstroTalk-style: click a Mahadasha to see its 9 Antardashas,
// click an Antardasha to see its 9 Pratyantars, click a Pratyantar
// to see its 9 Sookshmas. "LEVEL UP" button climbs back. The Maha
// level comes straight from r.dasha; the deeper levels are computed
// with proportional Vimshottari math (no extra API calls).
const LEVEL_LABELS = [
  'Mahadasha', 'Antardasha', 'Pratyantardasha', 'Sookshmadasha',
];

function DashaDrilldown({ dasha }) {
  // path = chain of selections, one per level above the one we're
  // currently viewing. path[0] = chosen Maha, path[1] = chosen
  // Antar, path[2] = chosen Pratyantar. Length 0 = looking at the
  // list of 9 Mahas. Length 3 = looking at 9 Sookshmas (deepest).
  const [path, setPath] = useState([]);
  const nowMs = Date.now();

  // Normalize the maha list once: { lord, startMs, endMs }.
  const mahas = (dasha || [])
    .map((d) => {
      const startMs = vimshottari.toMs(d.start);
      const endMs = vimshottari.toMs(d.end);
      const lord = vimshottari.normalizeLord(d.planet) || d.planet;
      if (!lord || !Number.isFinite(startMs)
          || !Number.isFinite(endMs)) return null;
      return { lord, startMs, endMs };
    })
    .filter(Boolean);

  if (!mahas.length) {
    return (
      <div className="rounded-card bg-white p-4 text-sm text-sub-text">
        Dasha data unavailable for this profile yet. Re-open the
        kundli to fetch from the provider.
      </div>
    );
  }

  // Walk the path. At each level the "current" list is the children
  // of the selected node from the prior level.
  let current = mahas;
  for (let i = 0; i < path.length; i += 1) {
    const node = current[path[i]];
    if (!node) { current = []; break; }
    current = vimshottari.subPeriods(node);
  }
  const depth = path.length; // 0 = Maha, 3 = Sookshma
  const canDrill = depth < 3;

  // Build the breadcrumb of selected lords (with short labels).
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
      {/* Stepper: 4 chips showing the 4 levels, with the
          currently-viewed level highlighted + breadcrumb of
          chosen lords underneath. */}
      {/* Horizontal 4-step stepper matching the AstroTalk reference.
          Numbered circles connected by a dashed line; active = yellow,
          visited = success-green, todo = gray. Tap any visited step to
          jump back to that level. */}
      <div className="rounded-card border border-gray-200 bg-white p-3">
        <div className="mb-3 text-center text-[11px] font-bold
          uppercase tracking-wider text-sub-text">
          Vimshottari Dasha
        </div>
        <div className="relative flex items-start justify-between">
          <div className="absolute left-6 right-6 top-3
            border-t border-dashed border-gray-300" />
          {LEVEL_LABELS.map((label, i) => {
            const active = i === depth;
            const visited = i < depth;
            const sel = crumbs[i];
            return (
              <button key={label} type="button"
                disabled={i > depth}
                onClick={() => setPath(path.slice(0, i))}
                className="relative z-10 flex flex-col items-center
                  bg-bg-light px-1
                  disabled:cursor-default">
                <span className={`grid h-7 w-7 place-items-center
                  rounded-full text-[12px] font-bold transition
                  ${active ? 'bg-[#FFD63A] text-dark-text shadow'
                    : visited ? 'bg-success text-white'
                      : 'bg-gray-100 text-sub-text'}`}>
                  {i + 1}
                </span>
                <span className={`mt-1 text-center text-[10px]
                  font-bold ${active ? 'text-dark-text'
                    : visited ? 'text-success' : 'text-sub-text'}`}>
                  {label}
                </span>
                {sel && (
                  <span className="text-[9px] text-sub-text">
                    {vimshottari.SHORT[sel.lord] || sel.lord}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {crumbs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center
            justify-center gap-1.5 border-t border-gray-100 pt-2
            text-[10px] text-sub-text">
            <span className="font-semibold">Path:</span>
            {crumbs.map((c, i) => (
              <span key={i} className="rounded-full bg-[#FFF7E0]
                px-2 py-0.5 font-bold text-dark-text">
                {vimshottari.SHORT[c.lord] || c.lord}
                {i < crumbs.length - 1 && (
                  <span className="ml-1 opacity-50">›</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Level Up button — visible whenever we're below level 1.
          AstroTalk reference shows this as a full-width yellow strip
          underneath the table; we use a centered pill that fits the
          same visual language. */}
      {depth > 0 && (
        <button type="button"
          onClick={() => setPath(path.slice(0, -1))}
          className="mx-auto block rounded-full bg-[#FFD63A] px-6
            py-1.5 text-[11px] font-bold uppercase tracking-wider
            text-dark-text shadow-sm">
          LEVEL UP
        </button>
      )}

      {/* List of 9 children at the current level. Click any
          row to drill one level deeper (unless we're at the
          deepest level — Sookshma — already). */}
      <div className="rounded-card bg-white p-2">
        <div className="mb-1 px-2 text-[11px] font-bold
          uppercase tracking-wide text-sub-text">
          {LEVEL_LABELS[depth]}
          {' · '}
          {current.length} periods
          {canDrill && ' · tap a row to drill deeper'}
        </div>
        <div className="space-y-1">
          {current.map((c, i) => {
            const isCur = i === curIdx;
            return (
              <button key={i} type="button"
                disabled={!canDrill}
                onClick={() => canDrill
                  && setPath([...path, i])}
                className={`flex w-full items-center
                  justify-between gap-2 rounded-card px-3 py-2
                  text-left text-[12px] transition
                  ${isCur
                    ? 'bg-primary/10 font-bold text-primary'
                    : 'bg-gray-50 hover:bg-primary/5'}
                  ${canDrill ? 'cursor-pointer' : 'cursor-default'}`}>
                <span className="flex items-center gap-2">
                  <span className={`inline-flex h-6 w-9
                    items-center justify-center rounded-full
                    text-[10px] font-extrabold
                    ${isCur
                      ? 'bg-primary text-white'
                      : 'bg-white text-primary'}`}>
                    {vimshottari.SHORT[c.lord] || c.lord}
                  </span>
                  <span>{c.lord}</span>
                  {isCur && (
                    <span className="rounded-full bg-accent
                      px-2 py-0.5 text-[9px] font-bold text-white">
                      now
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2
                  text-[10.5px] text-sub-text">
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
            You're at the deepest level (Sookshma).
            Use LEVEL UP to climb back.
          </p>
        )}
      </div>
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
    cd.antar && ['Antar Dasha', cd.antar.planet,
      cd.antar.start, cd.antar.end],
    cd.pratyantar && ['Pratyantar Dasha', cd.pratyantar.planet,
      cd.pratyantar.start, cd.pratyantar.end],
    cd.sookshma && ['Sookshma Dasha', cd.sookshma.planet,
      cd.sookshma.start, cd.sookshma.end],
    cd.prana && ['Prana Dasha', cd.prana.planet,
      cd.prana.start, cd.prana.end],
    cd.deha && ['Deha Dasha', cd.deha.planet,
      cd.deha.start, cd.deha.end],
  ].filter(Boolean);
  return (
    <div className="rounded-card bg-gradient-to-br from-primary
                    to-accent p-4 text-white">
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
      {levels.length < 6 && (
        <p className="mt-2 text-[10px] opacity-75">
          Sookshma, Prana and Deha levels surface when the provider
          returns them.
        </p>
      )}
    </div>
  );
}

// ---------- Tab: Transits ----------------------------------------
function TransitsTab({ r }) {
  // Transits are typically retrieved per-date. AstroSeer's main
  // /api/kundli returns raw.transits = current snapshot. We show
  // that + a date input so the user can recompute via the relay.
  const t = (r.raw && r.raw.transits) || null;
  const planets = t && (t.planets || t.planetary_position) || [];
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Transits (current planetary positions vs your natal chart)">
        <p className="mb-2 text-[11px] text-sub-text">
          A transit happens when a planet's current sky position
          activates a house or planet in your birth chart. Mark a
          period for the future or past below to see what was/will
          be active then.
        </p>
        {planets.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm
                          text-sub-text">
            Transit snapshot is loading. Refresh in a moment if it
            stays empty.
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

// ---------- Tab: Yogas -------------------------------------------
function YogasTab({ r, raw }) {
  // Use raw.yogas_detected when present (AstroSeer v1.1+), fall
  // back to the top-level mapped yogas array.
  const yogas = (Array.isArray(raw.yogas_detected) && raw.yogas_detected)
    || (Array.isArray(r.yogas) && r.yogas) || [];
  return (
    <div className="mt-3 space-y-3">
      <Sec title={`Yogas detected (${yogas.length})`}>
        {yogas.length === 0 ? (
          <div className="rounded-card bg-white p-3 text-sm
                          text-sub-text">
            No special yogas detected in this chart.
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

// ---------- Tab: Doshas (with future/past date check) ------------
function DoshasTab({ r, raw }) {
  const doshas = raw.doshas_full || r.doshas || {};
  const [date, setDate] = useState(
    () => new Date().toISOString().slice(0, 10));
  // Sade Sati window check: pure client-side, runs against Saturn
  // transit windows over the natal Moon sign. AstroSeer returns
  // doshas.sade_sati with start/end ranges when available.
  function sadeSatiActiveAt(d) {
    const ss = doshas.sade_sati;
    if (!ss || !Array.isArray(ss.windows)) return null;
    const t = Date.parse(d);
    return ss.windows.find(
      (w) => Date.parse(w.start) <= t && t <= Date.parse(w.end))
      || null;
  }
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-sub-text">
          Check dosha status at any date:
        </label>
        <input type="date" className="input !w-auto !min-h-0 py-1
                                       text-xs"
          value={date}
          onChange={(e) => setDate(e.target.value)} />
      </div>
      <Sec title="Mangal Dosha">
        <DoshaCard
          present={!!(doshas.mangal && doshas.mangal.present)}
          severity={doshas.mangal && doshas.mangal.severity}
          note={doshas.mangal && doshas.mangal.note}
          extra="Activated by Mars in 1, 2, 4, 7, 8 or 12. Affects
                 marriage compatibility. Remedies: Hanuman Chalisa
                 Tuesdays, coral on right ring finger after
                 consulting an astrologer." />
      </Sec>
      <Sec title="Kalsarp Dosha">
        <DoshaCard
          present={!!(doshas.kalsarp && doshas.kalsarp.present)}
          severity={doshas.kalsarp && doshas.kalsarp.type}
          note={doshas.kalsarp && doshas.kalsarp.note}
          extra="All planets between Rahu and Ketu. Causes delays
                 and obstacles. Remedies include silver naag-naagin
                 worship and Naga Panchami rituals." />
      </Sec>
      <Sec title="Sade Sati">
        {(() => {
          const active = sadeSatiActiveAt(date);
          if (!doshas.sade_sati) {
            return <div className="rounded-card bg-white p-3 text-sm
              text-sub-text">Sade Sati data not available.</div>;
          }
          return (
            <DoshaCard
              present={!!active}
              severity={active ? active.phase : doshas.sade_sati.current_phase}
              note={active
                ? `Active on ${date}. Phase: ${active.phase}.`
                : `Not active on ${date}.`}
              extra="Saturn transiting the 12th, 1st and 2nd houses
                     from natal Moon. Slows things down, tests
                     patience. Remedies: Hanuman Chalisa, mustard
                     oil offerings to Saturn on Saturdays." />
          );
        })()}
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
      {note && (
        <p className="mt-1 text-[12px] text-dark-text">{note}</p>
      )}
      {extra && (
        <p className="mt-1 text-[11px] text-sub-text">{extra}</p>
      )}
    </div>
  );
}

// ---------- Tab: Panchang ----------------------------------------
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
    <div className="mt-3 space-y-3">
      <Sec title="Panchang at your birth">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-card bg-white p-2">
              <div className="text-[10px] uppercase tracking-wide
                              text-sub-text">{label}</div>
              <div className="mt-0.5 text-xs font-semibold
                              text-dark-text">
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

// ---------- Tab: Compatibility (Guna Milan) ----------------------
function CompatibilityTab() {
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Guna Milan (marriage compatibility)">
        <p className="text-[12px] text-dark-text">
          Match two charts using the Ashta-Koota 36-point system.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link href="/matching"
            className="rounded-full bg-primary py-2 text-center
              text-xs font-bold text-white">
            Pick a partner from saved profiles
          </Link>
          <Link href="/matching"
            className="rounded-full border border-primary py-2
              text-center text-xs font-bold text-primary">
            Enter partner details manually
          </Link>
        </div>
        <p className="mt-2 text-[10px] text-sub-text">
          Both options take you to the Matching page where your
          chart is pre-filled and you only add the partner.
        </p>
      </Sec>
    </div>
  );
}

// ---------- Tab: Numerology --------------------------------------
function NumerologyTab() {
  return (
    <div className="mt-3 space-y-3">
      <Sec title="Numerology">
        <p className="text-[12px] text-dark-text">
          Driver / conductor / soul numbers, lucky days, gemstones
          and detailed numerology reading powered by your name and
          DOB.
        </p>
        <Link href="/numerology"
          className="mt-3 inline-block rounded-full bg-primary px-4
            py-2 text-xs font-bold text-white">
          Open Numerology
        </Link>
      </Sec>
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
// Table of contents shown in the confirm popup so the customer
// knows exactly what they're getting before we deduct any money
// (paid kind) or kick off any processing (free kind).
// Sections + names live in shared/reportTypes.js so client + relay
// stay in sync (one place to add a new product).
import { REPORT_TYPES, reportType, resolvePrice } from '@astro/shared';

function ReportButtons({ kundli }) {
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Per-report-type prices. Loaded from settings/config once.
  const [prices, setPrices] = useState(() => {
    const out = {};
    REPORT_TYPES.forEach((t) => { out[t.id] = t.defaultPrice; });
    return out;
  });
  // Holds the kind the user clicked. Non-null = confirm popup open.
  const [pending, setPending] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const s = await getDoc(doc(db, 'settings', 'config'));
        const cfg = (s.exists() && s.data()) || {};
        const next = {};
        REPORT_TYPES.forEach((t) => {
          next[t.id] = resolvePrice(t.id, cfg);
        });
        setPrices(next);
      } catch (_) { /* keep defaults */ }
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
  // Show confirm popup; only on Yes does buy() actually fire.
  function ask(kind) {
    setError(null); setResult(null);
    setPending({ kind, price: prices[kind] || 0 });
  }
  // Build a per-type button. Free uses primary maroon; paid types
  // use accent + show the live price.
  const renderButton = (t) => {
    const price = prices[t.id] || 0;
    const isPaid = price > 0;
    const isBusy = busy === t.id;
    const busyLabel = t.id === 'free' ? 'Preparing…' : 'Charging wallet…';
    const label = isPaid
      ? `${t.shortName} · ₹${price} from wallet`
      : t.shortName;
    return (
      <button key={t.id} type="button" onClick={() => ask(t.id)}
        disabled={!!busy}
        className={`rounded-full px-3 py-1.5 text-xs font-bold
          text-white disabled:opacity-60 ${isPaid
            ? 'bg-accent' : 'bg-primary'}`}>
        {isBusy ? busyLabel : label}
      </button>
    );
  };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {REPORT_TYPES.map(renderButton)}
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
      {pending && (
        <ConfirmReportPopup
          spec={(() => {
            const t = reportType(pending.kind);
            if (!t) return null;
            return {
              title: t.name,
              badge: t.defaultPrice === 0 ? 'No charge' : '',
              sections: t.sections,
              tat: t.tat,
              confirmCta: t.confirmCta,
              summary: t.summary,
            };
          })()}
          price={pending.price}
          kind={pending.kind}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const k = pending.kind;
            setPending(null);
            buy(k);
          }}
        />
      )}
      {result && result.ok && (
        <DownloadPopup result={result}
          onClose={() => setResult(null)} />
      )}
    </div>
  );
}

// Pre-purchase confirm popup. Lists every section the report will
// contain + the expected delivery time + the price (for paid kinds).
// Two CTAs, Cancel on the left and the action on the right so the
// user has a real "are you sure?" beat before any wallet deduction.
function ConfirmReportPopup({ spec, price, kind, onCancel, onConfirm }) {
  if (!spec) return null;
  const isPaid = kind === 'forecast12';
  // Professional, dash-free layout: serif-feel title, a single muted
  // divider, a numbered list (no colourful emojis), a quiet outlined
  // delivery panel and balanced full-width CTAs. Replaces the older
  // emoji-heavy / dash-heavy popup that read "messy".
  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center
                    justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl
                      bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-100 px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-primary">
              {spec.title}
            </h2>
            <span className={`shrink-0 rounded-full px-3 py-1
                text-[11px] font-bold uppercase tracking-wide
                ${isPaid
                  ? 'bg-accent/10 text-accent'
                  : 'bg-success/10 text-success'}`}>
              {isPaid ? `₹${price} from wallet` : spec.badge}
            </span>
          </div>
          {spec.summary && (
            <p className="mt-2 text-[13px] leading-snug text-dark-text">
              {spec.summary}
            </p>
          )}
          <p className="mt-2 text-xs font-medium uppercase
                        tracking-wide text-sub-text">
            What is included in your PDF
          </p>
        </div>

        {/* Sections — numbered, plain text, scrollable */}
        <ol className="max-h-72 list-none space-y-2 overflow-auto
                       px-5 py-4 text-[13px] leading-snug
                       text-dark-text">
          {spec.sections.map((text, i) => (
            <li key={text} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0
                  items-center justify-center rounded-full
                  bg-primary/10 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>

        {/* Delivery panel */}
        <div className="border-t border-gray-100 bg-bg-light px-5 py-3">
          <div className="text-[11px] font-bold uppercase
                          tracking-wide text-primary">
            Delivery
          </div>
          <p className="mt-1 text-[12px] leading-snug text-dark-text">
            {spec.tat}
          </p>
        </div>

        {/* CTAs */}
        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onCancel}
            className="flex-1 rounded-full border border-gray-300
              bg-white py-2.5 text-sm font-bold text-dark-text
              transition hover:bg-bg-light">
            No
          </button>
          <button type="button" onClick={onConfirm}
            className={`flex-1 rounded-full py-2.5 text-sm
              font-bold text-white shadow-sm transition
              ${isPaid
                ? 'bg-accent hover:brightness-95'
                : 'bg-primary hover:brightness-95'}`}>
            {spec.confirmCta}
          </button>
        </div>
      </div>
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
      <div className="w-full max-w-sm overflow-hidden rounded-2xl
                      bg-white shadow-2xl">
        {/* Header strip on the brand colour — gives a confident,
            professional vibe without resorting to emoji confetti. */}
        <div className="bg-primary px-5 py-4 text-white">
          <div className="text-[11px] font-bold uppercase
                          tracking-wide opacity-80">
            Report ready
          </div>
          <div className="mt-0.5 text-lg font-bold">
            {result.kind === 'forecast12'
              ? '12-Month Forecast'
              : 'Your Vedic Kundli'}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 text-center">
          <p className="text-[13px] leading-snug text-dark-text">
            Your PDF is ready to download.
          </p>
          <p className="mt-2 text-[12px] text-sub-text">
            {result.amount > 0
              ? `₹${result.amount} deducted from wallet. `
              : ''}
            {result.emailed
              ? 'A copy has also been sent to your email. '
              : ''}
            Saved in Orders for unlimited re-download.
          </p>

          <button type="button"
            onClick={() => kundliService.downloadPdfFromUrl(
              result.pdfUrl,
              result.pdfName || 'AstroSeer-Kundli.pdf')}
            className="mt-4 block w-full rounded-full bg-primary
              py-2.5 text-sm font-bold text-white shadow-sm
              transition hover:brightness-95">
            Download PDF now
          </button>
          <a href="/orders"
            className="mt-2 block text-xs font-semibold text-primary
                       hover:underline">
            View all my orders
          </a>
          <button type="button" onClick={onClose}
            className="mt-2 block w-full text-xs text-sub-text
                       hover:text-dark-text">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// 12-house grid showing planets in each bhava + ascendant marker.
// Used as a fallback when the provider didn't ship a rendered SVG
// chart (AstroSeer's /api/kundli omits charts by design — they sit
// on a separate /api/chart/render endpoint we'll wire later). Far
// more useful than the old "Chart image unavailable on the current
// Prokerala plan" placeholder, which read like a broken feature to
// the user.
function HouseGrid({ r, title }) {
  const byHouse = {};
  (r.planets || []).forEach((p) => {
    const h = Number(p.house);
    if (h >= 1 && h <= 12) {
      (byHouse[h] = byHouse[h] || []).push(p.name);
    }
  });
  const ascSign = r.ascendant && r.ascendant.sign;
  return (
    <div>
      <div className="mb-2 text-sm font-bold text-primary">{title}</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => {
          const planets = byHouse[h] || [];
          return (
            <div key={h}
              className={`rounded-card border p-2 text-center
                ${h === 1
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-gray-200 bg-white'}`}>
              <div className="text-[10px] uppercase tracking-wide
                              text-sub-text">
                House {h}{h === 1 && ascSign ? ` · ${ascSign}` : ''}
              </div>
              <div className="mt-1 min-h-[36px] text-xs font-semibold
                              text-dark-text">
                {planets.length ? planets.join(', ') : '·'}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-sub-text">
        House 1 holds the Ascendant (Lagna). Read planets in each
        bhava with their lord + nakshatra (see Planets & Houses tab).
      </p>
    </div>
  );
}
