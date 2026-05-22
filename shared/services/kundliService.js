// kundliService, blueprint 8.2 & 4.13
import {
  doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { zodiacFromDOB } from '../theme.js';
import { sendMessage } from './chatService.js';

function parseZodiac(dob) {
  // dob expected as DD-MM-YYYY (blueprint example "12-05-1998")
  const [d, m] = String(dob || '').split('-').map(Number);
  if (!d || !m) return '';
  return zodiacFromDOB(d, m);
}

// Real kundli via the relay (Prokerala API; secret stays server-side).
// Endpoint derives from the push relay URL, or NEXT_PUBLIC_KUNDLI_ENDPOINT.
// Returns null if not configured / on any failure (caller shows the
// basic zodiac instead - never throws).
function kundliEndpoint() {
  // Reference process.env.NEXT_PUBLIC_* DIRECTLY: Next.js only inlines
  // the literal expression at build time, so an aliased read is
  // undefined in the static / APK build (this is why Kundli appeared
  // "not working" in the app even though the relay was fine).
  const explicit = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_KUNDLI_ENDPOINT) || '';
  if (explicit) return explicit;
  const push = (typeof process !== 'undefined' && process.env
    && process.env.NEXT_PUBLIC_PUSH_ENDPOINT) || '';
  return push ? push.replace(/\/sendPush\/?$/, '/kundli') : '';
}

export async function getProkeralaKundli(birth) {
  const url = kundliEndpoint();
  if (!url || !birth || !birth.dob) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dob: birth.dob, tob: birth.tob, ampm: birth.ampm,
        place: birth.place,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && !j.error ? j : null;
  } catch (_) { return null; }
}

// Signature of the birth inputs - the report is regenerated ONLY when
// one of these changes (saves the Prokerala API quota).
export function birthSig(b) {
  return [b && b.dob, b && b.tob, b && b.ampm, b && b.place]
    .map((x) => String(x || '').trim().toLowerCase()).join('|');
}

const SIGN_TRAITS = {
  Aries: { p: 'bold, energetic and a natural pioneer who leads from the front',
    c: 'thrives in leadership, defence, sport, entrepreneurship and any fast-moving field',
    h: 'strong vitality; watch the head, stress and a tendency to overexert',
    l: 'passionate and direct in love; values honesty and excitement' },
  Taurus: { p: 'patient, dependable and grounded with a love of comfort and beauty',
    c: 'excels in finance, real estate, food, arts and steady long-term work',
    h: 'robust constitution; mind the throat, neck and weight balance',
    l: 'loyal and sensual; seeks security and lasting commitment' },
  Gemini: { p: 'curious, witty and adaptable with a quick, communicative mind',
    c: 'shines in media, writing, sales, teaching, IT and travel',
    h: 'generally agile; protect the lungs, nerves and sleep routine',
    l: 'playful and intellectual; needs mental connection and variety' },
  Cancer: { p: 'caring, intuitive and protective with deep emotional intelligence',
    c: 'does well in care-giving, hospitality, real estate and family business',
    h: 'sensitive digestion and emotions; nurture rest and diet',
    l: 'devoted and nurturing; family and emotional safety matter most' },
  Leo: { p: 'confident, warm and creative with natural charisma and pride',
    c: 'born for leadership, entertainment, politics and the limelight',
    h: 'strong heart energy; guard the heart, back and over-confidence',
    l: 'generous and loyal; loves admiration and grand romance' },
  Virgo: { p: 'analytical, precise and service-minded with an eye for detail',
    c: 'great in health, analysis, editing, accounts and quality work',
    h: 'careful digestion and nerves; routine and clean diet help',
    l: 'thoughtful and devoted; shows love through practical care' },
  Libra: { p: 'balanced, charming and fair with a strong sense of harmony',
    c: 'suited to law, design, diplomacy, partnerships and the arts',
    h: 'watch kidneys and lower back; balance work and rest',
    l: 'romantic and partnership-oriented; seeks an equal companion' },
  Scorpio: { p: 'intense, determined and deeply perceptive with strong willpower',
    c: 'powerful in research, finance, medicine, investigation and strategy',
    h: 'strong recovery; manage stress and reproductive health',
    l: 'passionate and loyal; bonds deeply and values trust' },
  Sagittarius: { p: 'optimistic, free-spirited and philosophical, always seeking truth',
    c: 'excels in teaching, law, travel, publishing and consulting',
    h: 'active body; mind the hips, thighs and over-indulgence',
    l: 'honest and adventurous; needs freedom with loyalty' },
  Capricorn: { p: 'disciplined, ambitious and patient, building success steadily',
    c: 'a natural in management, government, engineering and long-term ventures',
    h: 'strong stamina; care for bones, knees and joints',
    l: 'committed and steady; shows love through reliability' },
  Aquarius: { p: 'original, humane and visionary with an independent mind',
    c: 'innovates in technology, science, social work and networks',
    h: 'guard circulation and ankles; avoid irregular routines',
    l: 'friendly and unconventional; values mental freedom' },
  Pisces: { p: 'compassionate, imaginative and spiritual with deep empathy',
    c: 'gifted in arts, healing, spirituality, music and charity',
    h: 'sensitive feet and immunity; needs emotional grounding',
    l: 'tender and selfless; seeks a soulful, understanding bond' },
};

// Build a full, readable report from the Prokerala data. Deterministic
// so it always has rich content even if a text endpoint is unavailable.
export function generateNarrative(r) {
  if (!r) return null;
  // Vedic reading is primarily LAGNA (ascendant) based.
  const asc = r.ascendant && r.ascendant.sign;
  const sign = asc || r.zodiac || r.soorya_rasi || '';
  const t = SIGN_TRAITS[sign] || {
    p: 'a unique blend of strengths', c: 'a wide range of fields',
    h: 'balanced wellbeing with mindful habits',
    l: 'a sincere and caring approach to relationships' };
  const ai = r.additional_info || {};
  const moon = r.chandra_rasi ? `Moon in ${r.chandra_rasi}` : '';
  const nak = r.nakshatra
    ? `${r.nakshatra}${r.nakshatra_pada ? ` (pada ${r.nakshatra_pada})` : ''}`
    : '';
  return {
    personality: `${asc ? `Your Lagna (ascendant) is ${asc}. ` : ''}`
      + `As a ${sign || 'native'} ascendant, you are ${t.p}. `
      + `${moon ? `${moon} colours your emotional nature. ` : ''}`
      + `${nak ? `Your birth star ${nak} adds its own signature to your `
        + 'temperament and instincts.' : ''}`,
    career: `Career: you ${t.c}. ${ai.planet
      ? `Your ruling planet ${ai.planet} supports focused growth when `
        + 'you align effort with timing.' : ''}`,
    health: `Health: ${t.h}. ${ai.nadi
      ? `Ayurvedic constitution leans ${ai.nadi}; favour foods and a `
        + 'routine that balance it.' : ''}`,
    love: `Love & relationships: you are ${t.l}. `
      + `${ai.animal_sign ? `Your yoni (${ai.animal_sign}) influences `
        + 'compatibility and bonding style.' : ''}`,
    life: `Life path: with ${nak || 'your birth star'} and ${sign
      || 'your sign'}, your journey rewards patience, dharma and using `
      + 'your natural gifts in service of clear goals. Favourable '
      + `direction ${ai.best_direction || 'as per chart'}, lucky colour `
      + `${ai.color || '-'}, birth stone ${ai.birth_stone || '-'}.`,
    lucky: {
      deity: ai.deity || '-',
      color: ai.color || '-',
      stone: ai.birth_stone || '-',
      direction: ai.best_direction || '-',
      syllables: ai.syllables || '-',
    },
  };
}

// ---------------------------------------------------------------------
// FULL PRINTABLE REPORT (free, multi-page "Save as PDF").
// Builds a long, richly-sectioned HTML document from the kundli data +
// narrative. Each major section starts on a new page (CSS page-break) so
// the browser / Android print dialog produces a complete multi-page PDF
// the customer, astrologer and admin can all download for free.
// ---------------------------------------------------------------------
const PLANET_TRAITS = {
  Sun: 'the soul, ego, vitality, father, authority and government. A '
    + 'strong Sun gives confidence, leadership and good health; a weak '
    + 'Sun can bring self-doubt or friction with authority.',
  Moon: 'the mind, emotions, mother and inner peace. The Moon governs '
    + 'how you feel and nurture; a well-placed Moon brings calm, '
    + 'popularity and emotional strength.',
  Mars: 'energy, courage, siblings, land and drive. Mars fuels ambition '
    + 'and action; when afflicted it can show impatience or conflict.',
  Mercury: 'intellect, speech, business, learning and communication. '
    + 'A strong Mercury sharpens analysis, trade and expression.',
  Jupiter: 'wisdom, fortune, children, teachers and dharma. Jupiter is '
    + 'the great benefic, expanding whatever it touches with knowledge '
    + 'and grace.',
  Venus: 'love, marriage, luxury, art and comforts. Venus governs '
    + 'relationships and refinement, vehicles and material pleasures.',
  Saturn: 'discipline, karma, longevity, labour and patience. Saturn '
    + 'rewards honest, sustained effort and teaches through delay.',
  Rahu: 'ambition, foreign matters, technology and sudden gains. Rahu '
    + 'amplifies worldly desire and unconventional paths.',
  Ketu: 'detachment, spirituality, past-life karma and liberation. '
    + 'Ketu turns the mind inward toward moksha.',
};
const HOUSE_MEANINGS = [
  ['First House (Lagna)', 'self, body, personality, vitality and the '
    + 'overall direction of life.'],
  ['Second House', 'wealth, family, speech, food and accumulated assets.'],
  ['Third House', 'courage, siblings, communication, short journeys and '
    + 'self-effort.'],
  ['Fourth House', 'mother, home, property, vehicles and inner happiness.'],
  ['Fifth House', 'intelligence, children, romance, creativity and past '
    + 'merit (purva punya).'],
  ['Sixth House', 'health, enemies, debts, service and daily work.'],
  ['Seventh House', 'marriage, partnerships, spouse and business '
    + 'relationships.'],
  ['Eighth House', 'longevity, transformation, inheritance and hidden '
    + 'matters.'],
  ['Ninth House', 'fortune, dharma, father, higher learning and long '
    + 'journeys.'],
  ['Tenth House', 'career, status, authority and karma in the world.'],
  ['Eleventh House', 'gains, income, friends, ambitions and fulfilment '
    + 'of desires.'],
  ['Twelfth House', 'expenses, losses, foreign lands, isolation and '
    + 'spiritual liberation.'],
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build the complete printable report as a standalone HTML document.
export function buildKundliReportHtml(kundli, report) {
  const k = kundli || {};
  const r = report || {};
  const n = r.narrative || {};
  const lucky = n.lucky || {};
  const asc = (r.ascendant && r.ascendant.sign) || r.zodiac || k.zodiac || '-';
  const planets = Array.isArray(r.planets) ? r.planets : [];
  const dasha = Array.isArray(r.dasha) ? r.dasha : [];
  const byHouse = {};
  planets.forEach((p) => {
    const h = Number(p.house) || 0;
    if (!byHouse[h]) byHouse[h] = [];
    byHouse[h].push(p.name);
  });
  const today = new Date().toISOString().slice(0, 10);

  const page = (inner) => `<section class="page">${inner}</section>`;
  const sec = (title, body) => `<h2>${esc(title)}</h2>${body}`;
  const para = (t) => `<p>${esc(t)}</p>`;

  // Cover
  let html = page(`
    <div class="cover">
      <div class="brand">AstroSeer</div>
      <h1>Vedic Birth Chart Report</h1>
      <div class="kundli-name">${esc(k.name || 'Native')}</div>
      <table class="birth">
        <tr><td>Date of birth</td><td>${esc(k.dob || '-')}</td></tr>
        <tr><td>Time of birth</td><td>${esc(k.tob || '-')} ${
  esc(k.ampm || '')}</td></tr>
        <tr><td>Place of birth</td><td>${esc(k.place || '-')}</td></tr>
        <tr><td>Ascendant (Lagna)</td><td>${esc(asc)}</td></tr>
        <tr><td>Moon sign (Rasi)</td><td>${esc(r.chandra_rasi || '-')}</td></tr>
        <tr><td>Sun sign</td><td>${esc(r.soorya_rasi || '-')}</td></tr>
        <tr><td>Nakshatra</td><td>${esc(r.nakshatra || '-')}${
  r.nakshatra_pada ? ` (pada ${esc(r.nakshatra_pada)})` : ''}</td></tr>
      </table>
      <div class="generated">Generated ${esc(today)} · Free full report</div>
    </div>`);

  // Personality & life overview
  html += page(sec('Personality & Nature',
    para(n.personality || `As a ${asc} ascendant native, your chart `
      + 'reflects a unique blend of strengths and lessons.'))
    + sec('Life Path', para(n.life || '')));

  // Career, health, love
  html += page(sec('Career & Profession', para(n.career || ''))
    + sec('Health & Wellbeing', para(n.health || ''))
    + sec('Love & Relationships', para(n.love || '')));

  // Lucky factors
  html += page(sec('Auspicious & Lucky Factors', `
    <table class="kv">
      <tr><td>Ruling deity</td><td>${esc(lucky.deity || '-')}</td></tr>
      <tr><td>Lucky colour</td><td>${esc(lucky.color || '-')}</td></tr>
      <tr><td>Birth stone</td><td>${esc(lucky.stone || '-')}</td></tr>
      <tr><td>Favourable direction</td><td>${
  esc(lucky.direction || '-')}</td></tr>
      <tr><td>Lucky syllables</td><td>${esc(lucky.syllables || '-')}</td></tr>
    </table>`));

  // Planet positions table
  html += page(sec('Planetary Positions', `
    <table class="grid">
      <tr><th>Planet</th><th>Sign</th><th>House</th><th>Degree</th>
        <th>Motion</th></tr>
      ${planets.length ? planets.map((p) => `<tr><td>${esc(p.name)}</td>`
    + `<td>${esc(p.sign || '-')}</td><td>${esc(p.house ?? '-')}</td>`
    + `<td>${esc(p.degree ?? '-')}</td>`
    + `<td>${p.retrograde ? 'Retrograde' : 'Direct'}</td></tr>`).join('')
    : '<tr><td colspan="5">Planetary detail unavailable on the '
      + 'current data plan.</td></tr>'}
    </table>`));

  // Per-planet detailed analysis (one page each)
  const planetByName = {};
  planets.forEach((p) => { planetByName[p.name] = p; });
  Object.keys(PLANET_TRAITS).forEach((name) => {
    const p = planetByName[name];
    const where = p ? `In your chart ${name} is placed in ${
      esc(p.sign || 'its sign')}${p.house ? `, in the ${p.house}th house`
      : ''}${p.retrograde ? ', and is retrograde' : ''}. `
      : `${name} is a key influence in every chart. `;
    html += page(sec(`${name} — Significance & Placement`,
      para(`${name} represents ${PLANET_TRAITS[name]}`)
      + para(`${where}This colours the related areas of life and should be `
        + 'strengthened through the recommended remedies and conscious '
        + 'effort.')));
  });

  // Per-house analysis (one page each)
  HOUSE_MEANINGS.forEach(([title, meaning], i) => {
    const occ = byHouse[i + 1] || [];
    html += page(sec(`${title}`, para(`The ${title} governs ${meaning}`)
      + para(occ.length
        ? `Planets occupying this house: ${esc(occ.join(', '))}. Their `
          + 'energies directly shape these matters in your life.'
        : 'No planet occupies this house, so its results flow mainly '
          + 'through its lord and the planets aspecting it.')));
  });

  // Dasha timeline
  html += page(sec('Vimshottari Dasha — Planetary Periods',
    (r.currentDasha
      ? `<p class="cur">Current Maha Dasha: <b>${
        esc(r.currentDasha.planet)}</b> (${
        esc(String(r.currentDasha.start || '').slice(0, 10))} to ${
        esc(String(r.currentDasha.end || '').slice(0, 10))})</p>`
      : '')
    + (dasha.length ? `<table class="grid"><tr><th>Mahadasha</th>`
      + `<th>From</th><th>To</th></tr>${dasha.map((d) => `<tr><td>${
        esc(d.planet)}${d.current ? ' (current)' : ''}</td><td>${
        esc(String(d.start || '').slice(0, 10))}</td><td>${
        esc(String(d.end || '').slice(0, 10))}</td></tr>`).join('')}</table>`
      : '<p>Dasha detail unavailable on the current data plan.</p>')));

  // Remedies / disclaimer
  html += page(sec('General Remedies & Guidance',
    para('Strengthen benefic planets through their gemstones, mantras, '
      + 'charity (daan) on the planet’s day, and a disciplined, '
      + 'dharmic routine. Favour your lucky colour and direction for '
      + 'important beginnings, and offer prayers to your ruling deity.')
    + para('This report is generated from your birth details for guidance '
      + 'and self-reflection. For personalised predictions, consult an '
      + 'astrologer on AstroSeer.')));

  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<title>${esc(k.name || 'Kundli')} — Vedic Report</title><style>`
    + `*{box-sizing:border-box}body{font-family:Georgia,'Times New Roman',`
    + `serif;color:#1f2937;margin:0;line-height:1.55}`
    + `.page{padding:48px 56px;min-height:100vh;page-break-after:always;`
    + `border-bottom:1px solid #eee}`
    + `h1{font-size:30px;color:#5b21b6;margin:8px 0}`
    + `h2{font-size:20px;color:#5b21b6;border-bottom:2px solid #ede9fe;`
    + `padding-bottom:6px;margin:0 0 12px}`
    + `p{font-size:14px;margin:0 0 12px;text-align:justify}`
    + `.cover{text-align:center;padding-top:80px}`
    + `.brand{letter-spacing:3px;color:#a78bfa;font-weight:bold}`
    + `.kundli-name{font-size:22px;font-weight:bold;margin:6px 0 24px}`
    + `table{width:100%;border-collapse:collapse;margin:0 auto 12px}`
    + `.birth{max-width:420px}.birth td,.kv td{padding:7px 10px;`
    + `border:1px solid #e5e7eb;text-align:left;font-size:14px}`
    + `.birth td:first-child,.kv td:first-child{color:#6b7280;width:45%}`
    + `.grid th,.grid td{border:1px solid #e5e7eb;padding:6px 8px;`
    + `font-size:13px;text-align:left}.grid th{background:#f5f3ff}`
    + `.generated{margin-top:36px;color:#9ca3af;font-size:12px}`
    + `.cur{background:#5b21b6;color:#fff;padding:10px 12px;border-radius:8px}`
    + `@media print{.page{border:none}}`
    + `</style></head><body>${html}</body></html>`;
}

// Open the printable report in a new window and trigger the print /
// "Save as PDF" dialog. Free, no page limit, works on web + Android.
// Window-guarded so importing this module never breaks SSR / the bundle.
export function downloadKundliReport(kundli, report) {
  if (typeof window === 'undefined') return false;
  const html = buildKundliReportHtml(kundli, report);
  const w = window.open('', '_blank');
  if (!w) {
    // Popup blocked (e.g. inside the app WebView): fall back to a data
    // URL navigation in the same tab so the user still gets the report.
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
    return true;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the layout a moment, then open the print dialog.
  w.onload = () => { try { w.focus(); w.print(); } catch (_) {} };
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 600);
  return true;
}

// Full kundli with CACHING. The report is stored on the profile doc and
// returned as-is unless dob / time / place changed (signature differs),
// which avoids re-hitting the Prokerala API every time.
export async function getFullKundli(profile) {
  if (!profile) return null;
  const sig = birthSig(profile);
  if (profile.report && profile.reportSig === sig) {
    return { ...profile.report, cached: true };
  }
  const data = await getProkeralaKundli(profile);
  if (!data) return null;
  const report = { ...data, narrative: generateNarrative(data) };
  if (profile.id) {
    try {
      await updateDoc(doc(db, 'kundliProfiles', profile.id), {
        report, reportSig: sig, reportAt: serverTimestamp(),
      });
    } catch (_) { /* still return it even if cache write fails */ }
  }
  return { ...report, cached: false };
}

export async function saveKundli(uid, data) {
  const ref = doc(collection(db, 'kundliProfiles'));
  await setDoc(ref, {
    userId: uid,
    name: data.name || '',
    dob: data.dob || '',
    tob: data.tob || '',
    ampm: data.ampm || 'AM',
    place: data.place || '',
    zodiac: parseZodiac(data.dob),
    isDefault: !!data.isDefault,
    createdAt: serverTimestamp(),
  });
  if (data.isDefault) await setDefaultKundli(uid, ref.id);
  return ref.id;
}

export async function getKundliProfiles(uid) {
  const q = query(collection(db, 'kundliProfiles'), where('userId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDefaultKundli(uid) {
  const list = await getKundliProfiles(uid);
  return list.find((k) => k.isDefault) || list[0] || null;
}

// Only one default per user, clears the flag on every other profile.
export async function setDefaultKundli(uid, kundliId) {
  const list = await getKundliProfiles(uid);
  const batch = writeBatch(db);
  list.forEach((k) =>
    batch.update(doc(db, 'kundliProfiles', k.id), { isDefault: k.id === kundliId }));
  await batch.commit();
}

export async function deleteKundli(id) {
  await deleteDoc(doc(db, 'kundliProfiles', id));
}

// Auto-shared as the first chat message when a session starts (blueprint 4.8).
export async function autoSendKundliToChat(chatId, systemSenderId, kundli) {
  if (!kundli) return;
  const lines = [
    kundli.name,
    `DOB: ${kundli.dob}`,
    `Time of birth: ${kundli.tob || '--'} ${kundli.ampm || ''}`.trim(),
    `Place of birth: ${kundli.place || '--'}`,
  ];
  if (kundli.zodiac) lines.push(`Sign: ${kundli.zodiac}`);
  await sendMessage(chatId, systemSenderId, lines.join('\n'));
}
