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
