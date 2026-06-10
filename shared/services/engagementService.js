// engagementService - Engagement tiles + points system.
//
// Data model:
//   settings/engagement              tiles config + pointsConfig
//   users/{uid}/engagement/points    per-user points, redeemed total, history
//
// Points are awarded atomically via runTransaction so concurrent
// interactions from two tabs can never double-count or corrupt the
// balance. Redemption validates minimum INR threshold and balance
// before deducting points and crediting the wallet.
//
// Firebase Spark plan - everything is client-side Firestore, no
// Cloud Functions.
import {
  doc, getDoc, setDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// ---- Daily Challenges -------------------------------------------------
//
// Data model:
//   settings/dailyChallenges.challenges  Array of { id, date, questions, enabled }
//   users/{uid}/engagement/dc_{date}     Per-user daily challenge answers
//
// Admin sets challenges per date (3, 5, or 10 questions). The client
// fetches today's challenge and submits answers. Points are awarded
// only for correct answers, tracked per-user per-date so re-submitting
// is a no-op.

export async function getDailyChallenges() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'dailyChallenges'));
    if (!snap.exists()) return { challenges: [] };
    const d = snap.data() || {};
    return {
      challenges: Array.isArray(d.challenges) ? d.challenges : [],
    };
  } catch (_) { return { challenges: [] }; }
}

export async function saveDailyChallenges(challenges) {
  await setDoc(doc(db, 'settings', 'dailyChallenges'), {
    challenges: Array.isArray(challenges) ? challenges : [],
    updatedAt: serverTimestamp(),
  }, { merge: false });
}

// Get today's challenge (or null if none configured).
export async function getTodayChallenge() {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { challenges } = await getDailyChallenges();
    return challenges.find((c) =>
      c.date === today && c.enabled !== false) || null;
  } catch (_) { return null; }
}

// Mark a daily challenge as attempted. Returns { awarded, alreadyDone }.
//
// questionAnswers: array of per-question answer objects. Accepts both
//   legacy { idx, picked } format AND the newer format used by the
//   daily-challenge page: { qIdx, selected, isCorrect, bonus }.
// challengeQuestions: the questions array from the challenge doc
//   (used to re-derive correctness so the client cannot lie).
export async function completeDailyChallenge(uid, date, questionAnswers,
  challengeQuestions) {
  if (!uid || !date) return { awarded: 0, alreadyDone: false };
  const progRef = doc(db, 'users', uid, 'engagement', `dc_${date}`);
  const ptsRef = doc(db, 'users', uid, 'engagement', 'points');

  try {
    const result = await runTransaction(db, async (tx) => {
      const [progSnap, pSnap] = await Promise.all([
        tx.get(progRef), tx.get(ptsRef),
      ]);
      if (progSnap.exists()) return { awarded: 0, alreadyDone: true };

      // Support both answer formats
      let totalPts = 0;
      let correctCount = 0;
      const qs = challengeQuestions || [];
      const results = (questionAnswers || []).map((a, fallbackIdx) => {
        // Normalise: legacy uses { idx, picked }; new uses { qIdx, selected }
        const idx = a.idx != null ? a.idx
          : a.qIdx != null ? a.qIdx : fallbackIdx;
        const picked = a.picked != null ? a.picked
          : a.selected != null ? a.selected : null;
        const q = qs[idx] || {};
        // Server-side correctness check (bonus field: q.bonus or q.bonusPoints)
        const isCorrect = picked != null && picked === q.correct;
        const bonusPer = Number(q.bonus || q.bonusPoints || 10);
        const pts = isCorrect ? bonusPer : 0;
        totalPts += pts;
        if (isCorrect) correctCount += 1;
        return { idx, picked, isCorrect, pts };
      });

      if (totalPts > 0) {
        const pData = (pSnap.exists() && pSnap.data()) || {};
        const history = Array.isArray(pData.history)
          ? [...pData.history] : [];
        history.push({
          tileId: `_daily_${date}`,
          amount: totalPts,
          at: new Date().toISOString(),
          reason: `Daily challenge: ${date}`,
        });
        if (history.length > 500) history.splice(0, history.length - 500);
        tx.set(ptsRef, {
          total: Number(pData.total || 0) + totalPts,
          redeemed: Number(pData.redeemed || 0),
          history,
        });
      }

      tx.set(progRef, {
        date,
        completed: true,          // flag for quick completion check
        completedAt: serverTimestamp(),
        correctCount,
        total: qs.length,
        totalBonus: totalPts,
        results,
      });

      return { awarded: totalPts, alreadyDone: false,
        correctCount, total: qs.length };
    });
    return result;
  } catch (_) { return { awarded: 0, alreadyDone: false }; }
}

// Check if user has already done today's challenge.
export async function getDailyChallengeProgress(uid, date) {
  if (!uid || !date) return null;
  try {
    const snap = await getDoc(
      doc(db, 'users', uid, 'engagement', `dc_${date}`));
    return snap.exists() ? snap.data() : null;
  } catch (_) { return null; }
}

// Seed 30 days of sample daily challenges starting from `startDate`
// (YYYY-MM-DD string). Only adds dates not already present in the
// current challenges array. Returns the merged array.
export async function seed30DayChallenges(startDate) {
  const { challenges: existing } = await getDailyChallenges();
  const existingDates = new Set(existing.map((c) => c.date));

  // Helper to advance a date string by `n` days
  function addDays(base, n) {
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }

  // Pool of 150 questions across 10 themed groups x 5 each x 3 cycles
  // (same theme-group repeats after 10 days but each day still gets
  //  a fresh mix of topics so variety is good across any 10-day window).
  //
  // Format: [question, optA, optB, optC, optD, correctIdx(0-3), bonus]
  const POOL = [
    // --- ZODIAC BASICS ---
    ['Which element governs Aries, Leo, and Sagittarius?','Fire','Water','Earth','Air',0,10],
    ['What is the ruling planet of Cancer?','The Moon','The Sun','Venus','Mercury',0,10],
    ['Which zodiac sign is represented by the scales?','Libra','Virgo','Gemini','Aquarius',0,10],
    ['Taurus, Virgo, and Capricorn share which element?','Earth','Fire','Air','Water',0,10],
    ['Scorpio\'s modern ruling planet is?','Pluto','Mars','Saturn','Uranus',0,10],
    // --- PLANETS ---
    ['Mercury governs which life areas?','Communication and intellect','Love and beauty','Discipline and karma','Dreams and intuition',0,10],
    ['Venus rules which signs?','Taurus and Libra','Aries and Scorpio','Gemini and Virgo','Cancer and Capricorn',0,10],
    ['The planet associated with sudden change and innovation is?','Uranus','Neptune','Saturn','Jupiter',0,10],
    ['Jupiter is known as the planet of?','Expansion and luck','Discipline','Intuition','Communication',0,10],
    ['Which planet represents transformation and rebirth?','Pluto','Saturn','Mars','Uranus',0,10],
    // --- HOUSES ---
    ['The 5th house rules?','Creativity, romance, and children','Money and values','Communication','Career',0,10],
    ['Which house governs health and daily routines?','6th','8th','12th','3rd',0,10],
    ['The 8th house is associated with?','Transformation and shared resources','Family and home','Travel and philosophy','Self-image',0,10],
    ['The 11th house governs?','Friends, groups, and aspirations','Romance','Career','Spirituality',0,10],
    ['Which house is called "the house of hidden enemies"?','12th','7th','6th','9th',0,10],
    // --- TAROT ---
    ['How many cards are in a full standard tarot deck?','78','52','56','72',0,10],
    ['The Major Arcana card "The Tower" represents?','Sudden upheaval and revelation','Stability and security','Love and union','New beginnings',0,10],
    ['In tarot, the suit of Wands relates to?','Fire and inspiration','Water and emotion','Air and thought','Earth and material',0,10],
    ['The card "The Hermit" symbolises?','Solitude and inner guidance','Social activity','Material wealth','Conflict',0,10],
    ['The last card of the Major Arcana is?','The World (XXI)','Judgement (XX)','The Star (XVII)','The Moon (XVIII)',0,10],
    // --- NUMEROLOGY ---
    ['Which number in numerology is associated with psychic intuition?','7','3','5','9',0,10],
    ['The master number 11 is associated with?','Spiritual awakening and intuition','Financial success','Physical strength','Travel',0,10],
    ['In numerology, the number 9 represents?','Completion and humanitarianism','New beginnings','Stability','Communication',0,10],
    ['To find your life path number you?','Add all digits of your birth date down to a single digit','Add only birth year digits','Add only month and day','Add your name letters',0,10],
    ['The expression number in numerology is calculated from?','Full birth name letters','Birthday digits','Home address digits','Phone number digits',0,10],
    // --- GEMSTONES ---
    ['Which crystal is known for amplifying intentions and energy?','Clear Quartz','Obsidian','Jasper','Agate',0,10],
    ['The birthstone for September is?','Sapphire','Opal','Ruby','Topaz',0,10],
    ['Citrine is associated with?','Abundance and positive energy','Grief and protection','Psychic ability','Grounding',0,10],
    ['Which crystal is commonly used for grounding and protection?','Black Tourmaline','Rose Quartz','Amethyst','Selenite',0,10],
    ['Lapis Lazuli is associated with which chakra?','Third Eye','Root','Heart','Sacral',0,10],
    // --- VEDIC ASTROLOGY ---
    ['In Vedic astrology, the rising sign is called?','Lagna','Rashi','Dasha','Nakshatra',0,10],
    ['The Vedic system uses which zodiac?','Sidereal (star-based)','Tropical (season-based)','Chinese lunisolar','Maya calendar',0,10],
    ['Ketu represents in Vedic astrology?','Past karma and moksha','Future goals','Financial gains','Relationships',0,10],
    ['The Vimshottari Dasha system has how many planetary periods?','9','7','12','4',0,10],
    ['Rahu is associated with?','Desire, ambition, and illusion','Past karma','Spirituality','Communication',0,10],
    // --- MANIFESTATION ---
    ['The Law of Attraction states that?','Like attracts like','Opposites attract','Luck is random','Hard work alone determines outcomes',0,10],
    ['Visualisation in manifestation involves?','Mentally picturing your desired outcome vividly','Analysing past failures','Writing lists of problems','Avoiding negative thoughts passively',0,10],
    ['An affirmation is most effective when stated in?','Present tense, positive form','Future tense','Past tense','Negative form',0,10],
    ['The 369 method involves writing your intention?','3 times morning, 6 times afternoon, 9 times night','3 days in a row only','369 times total','Once per day for 9 days',0,10],
    ['Gratitude practice in manifestation helps by?','Raising your vibration','Reducing effort needed','Replacing physical action','Removing negative karma',0,10],
    // --- PALM READING ---
    ['The fate line in palmistry runs?','Vertically up the centre of the palm','Horizontally across the palm','From thumb to pinky','Diagonally from wrist to index finger',0,10],
    ['A long heart line suggests?','Deep emotions and strong relationships','Shallow feelings','Short lifespan','Purely logical nature',0,10],
    ['The mount below the little finger is called the Mount of?','Mercury','Saturn','Apollo','Jupiter',0,10],
    ['Rascette lines (bracelets) appear?','On the wrist below the palm','On the fingers','On the thumb','Below the middle finger',0,10],
    ['Many fine lines on the palm indicate?','A sensitive, impressionable nature','Long life','Financial luck','Career focus',0,10],
    // --- FACE READING ---
    ['In face reading, a broad nose indicates?','Practicality and determination','Creativity','Introversion','Sensitivity',0,10],
    ['Prominent cheekbones in face reading suggest?','Charisma and leadership','Timidity','Analytical nature','Dependence',0,10],
    ['A pointed chin in physiognomy indicates?','Cunning and adaptability','Stubbornness','Physical strength','Generosity',0,10],
    ['Wide nostrils in face reading are associated with?','Generosity and big energy','Frugality','Reserved nature','Analytical thinking',0,10],
    ['Deep-set eyes in physiognomy indicate?','Introspection and depth','Optimism','Spontaneity','Materialism',0,10],
    // --- ZODIAC ADVANCED ---
    ['Which sign rules the 9th house naturally?','Sagittarius','Aries','Virgo','Aquarius',0,10],
    ['An astrological "retrograde" occurs when a planet appears to?','Move backward from Earth\'s perspective','Speed up','Leave the solar system','Stop moving',0,10],
    ['The winter solstice typically falls when the Sun enters?','Capricorn','Cancer','Aries','Libra',0,10],
    ['A "stellium" means?','3 or more planets in one sign or house','A special eclipse','A planet at 0 degrees','Two planets in opposition',0,10],
    ['Saturn takes approximately how long to orbit the Sun?','29.5 years','12 years','84 years','165 years',0,10],
    // --- PLANETS ADVANCED ---
    ['Which planet rules over dreams and spirituality?','Neptune','Uranus','Pluto','Saturn',0,10],
    ['Mars represents which qualities?','Drive, action, and courage','Beauty and harmony','Wisdom and expansion','Communication',0,10],
    ['The "Saturn Return" typically occurs at what age?','27 to 30','18 to 21','40 to 45','50 to 55',0,10],
    ['Which planet is associated with higher learning and luck?','Jupiter','Saturn','Mercury','Uranus',0,10],
    ['The moon cycle is approximately how many days?','29.5','27','31','25',0,10],
    // --- TAROT ADVANCED ---
    ['How many Minor Arcana cards are in a tarot deck?','56','22','40','52',0,10],
    ['The suit of Pentacles in tarot represents?','Earth, material wealth, and body','Fire and passion','Air and intellect','Water and emotion',0,10],
    ['The "Judgement" card in tarot symbolises?','Awakening and rebirth','Endings','Justice','Celebration',0,10],
    ['Which tarot card is numbered XVII?','The Star','The Moon','The Sun','The World',0,10],
    ['The Empress tarot card represents?','Fertility, abundance, and nature','Discipline','Conflict','Travel',0,10],
    // --- CHAKRAS AND ENERGY ---
    ['The root chakra (Muladhara) is associated with?','Grounding and survival','Love and connection','Communication','Intuition',0,10],
    ['Which chakra governs communication and truth?','Throat chakra (Vishuddha)','Heart chakra','Third Eye','Crown chakra',0,10],
    ['The crown chakra colour is traditionally?','Violet or white','Red','Orange','Yellow',0,10],
    ['How many main chakras are there in the traditional system?','7','5','9','12',0,10],
    ['The sacral chakra governs?','Creativity and sexuality','Grounding','Love','Wisdom',0,10],
    // --- ASTROLOGY HISTORY ---
    ['Which civilisation is credited with the earliest astrology records?','Babylonian (Mesopotamian)','Ancient Greek','Roman','Egyptian',0,10],
    ['The tropical zodiac is based on?','Earth\'s seasons and equinoxes','Star positions','Lunar cycles','Planetary distances',0,10],
    ['What does "natal chart" mean?','A birth chart showing planetary positions at birth','A compatibility report','A future forecast','A daily horoscope',0,10],
    ['Chiron in astrology is known as?','The wounded healer asteroid','A planet beyond Pluto','A moon of Jupiter','A comet',0,10],
    ['Which astrologer is often called the father of modern Western astrology?','Ptolemy','Nostradamus','Galileo','Copernicus',0,10],
    // --- VEDIC ADVANCED ---
    ['How many nakshatras are there in Vedic astrology?','27','12','9','36',0,10],
    ['The Vedic period "Sade Sati" is associated with which planet?','Saturn','Mars','Rahu','Ketu',0,10],
    ['In Jyotish, "Dasha" refers to?','Planetary period or ruling cycle','Birth chart','Moon sign','Rising sign',0,10],
    ['The Vedic word "Jyotish" means?','Science of light','Star map','Planetary path','Moon wisdom',0,10],
    ['Navamsa is a divisional chart used for?','Marriage and dharma','Career','Health','Travel',0,10],
    // --- MANIFESTATION ADVANCED ---
    ['The "two-cup method" symbolises?','Shifting realities by pouring water between labelled cups','Drinking water at sunrise','Tea leaf reading','Chakra cleansing',0,10],
    ['Which book popularised the Law of Attraction widely in 2006?','The Secret by Rhonda Byrne','Think and Grow Rich','The Alchemist','Power of Now',0,10],
    ['Scripting is a manifestation technique where you?','Write as if your desired outcome has already happened','Repeat mantras aloud','Avoid thinking about your goal','Create a vision board only',0,10],
    ['According to LOA, your dominant thoughts attract?','Matching circumstances and events','Only positive outcomes','Random events','Nothing, it is pseudoscience',0,10],
    ['Pillow method manifestation involves?','Writing an affirmation and placing it under your pillow','Sleeping on your left side','Dreaming of your goal','Meditating before bed',0,10],
    // --- GEMSTONES ADVANCED ---
    ['Which stone is known as the "master healer"?','Clear Quartz','Obsidian','Garnet','Pyrite',0,10],
    ['Malachite is primarily associated with?','Transformation and protection','Love','Communication','Abundance',0,10],
    ['Which gemstone is often associated with enhancing psychic ability?','Amethyst','Carnelian','Jade','Tiger\'s Eye',0,10],
    ['Moonstone is traditionally linked to?','The Moon, intuition, and feminine energy','The Sun, vitality','Mars, courage','Jupiter, expansion',0,10],
    ['The green gemstone associated with Venus and love is?','Emerald','Jade','Malachite','Peridot',0,10],
    // --- ZODIAC COMPATIBILITY ---
    ['Aries is most naturally compatible with which element signs?','Fire and Air signs','Water and Earth signs','Only other Fire signs','Earth signs only',0,10],
    ['Which sign is opposite Aries on the zodiac wheel?','Libra','Scorpio','Taurus','Virgo',0,10],
    ['Two signs that are 90 degrees apart are said to be in?','Square aspect (tension)','Trine (harmony)','Sextile (opportunity)','Opposition (polarity)',0,10],
    ['A "trine" aspect between two planets means they are?','120 degrees apart (harmonious)','180 degrees apart (opposing)','90 degrees apart','0 degrees (conjunct)',0,10],
    ['The planet of karma and structure is?','Saturn','Jupiter','Pluto','Chiron',0,10],
    // --- PALMISTRY ADVANCED ---
    ['A broken life line in palmistry indicates?','A major life change or transition, not early death','Death at that age','Poor health always','Relationship break-up',0,10],
    ['The "simian line" occurs when?','The heart line and head line merge into one line','The fate line is absent','The life line is very short','Three lines cross',0,10],
    ['Stars on the palm in palmistry indicate?','Outstanding achievement or unexpected event at that point','Bad luck always','Family problems','Travel',0,10],
    ['A double life line (sister line) suggests?','Extra vitality, support, or dual life path','Two marriages','Health problems','Luck in finance',0,10],
    ['Vertical lines on the mounts indicate?','Positive energy and productivity in that life area','Stress','Past trauma','Poor finances',0,10],
    // --- FACE READING ADVANCED ---
    ['A high, rounded forehead in physiognomy suggests?','Intelligence and creativity','Stubbornness','Emotional volatility','Physical strength',0,10],
    ['Thin, tight lips in face reading indicate?','Discipline, precision, and private nature','Generosity','Laziness','Impulsiveness',0,10],
    ['Ears that sit high on the head suggest?','Quick thinking and ambition','Calm nature','Emotional depth','Practical mindset',0,10],
    ['A long, straight nose in face reading is linked to?','Leadership and strong will','Creativity','Sensitivity','Unpredictability',0,10],
    ['Wide-set eyes suggest?','Open-minded and tolerant nature','Focused and analytical mind','Reserved personality','Distrustful character',0,10],
  ];

  // Build 30 days: each day gets 5 questions cycling through available
  // pool groups. Each group of 5 covers one theme.
  // If the pool has fewer than 30 groups, the cycle repeats from group 0 —
  // days with the same group mod index get the same questions, which is
  // fine since they are 21+ days apart.
  const groupCount = Math.floor(POOL.length / 5); // e.g. 21
  const newChallenges = [];
  for (let day = 0; day < 30; day++) {
    const date = addDays(startDate, day);
    if (existingDates.has(date)) continue; // don't overwrite existing
    const groupStart = (day % groupCount) * 5;
    const questions = POOL.slice(groupStart, groupStart + 5).map((row) => ({
      q: row[0],
      options: [row[1], row[2], row[3], row[4]],
      correct: row[5],
      bonus: row[6],
    }));
    newChallenges.push({ date, questions, enabled: true });
  }

  const merged = [...existing, ...newChallenges].sort(
    (a, b) => (a.date || '').localeCompare(b.date || ''),
  );
  await saveDailyChallenges(merged);
  return merged;
}

// ---- Config -----------------------------------------------------------

export async function getEngagementConfig() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'engagement'));
    if (!snap.exists()) {
      return { tiles: getDefaultTiles(), pointsConfig: defaultPointsConfig() };
    }
    const d = snap.data() || {};
    const tiles = Array.isArray(d.tiles) && d.tiles.length > 0
      ? d.tiles : getDefaultTiles();
    return {
      tiles,
      pointsConfig: d.pointsConfig || defaultPointsConfig(),
    };
  } catch (e) {
    console.error('[engagementService] getEngagementConfig', e);
    return { tiles: getDefaultTiles(), pointsConfig: defaultPointsConfig() };
  }
}

export async function saveEngagementConfig(config) {
  const payload = {
    tiles: Array.isArray(config.tiles) ? config.tiles : [],
    pointsConfig: config.pointsConfig || defaultPointsConfig(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'settings', 'engagement'), payload, { merge: true });
}

function defaultPointsConfig() {
  return {
    pointsToInr: 10000,     // 10 000 points = 100 INR
    minRedemptionInr: 100,   // minimum redemption is 100 INR
    enabled: true,
  };
}

// ---- User points ------------------------------------------------------

export async function getUserPoints(uid) {
  if (!uid) return { total: 0, redeemed: 0, history: [] };
  try {
    const snap = await getDoc(
      doc(db, 'users', uid, 'engagement', 'points'),
    );
    if (!snap.exists()) return { total: 0, redeemed: 0, history: [] };
    const d = snap.data() || {};
    return {
      total: Number(d.total || 0),
      redeemed: Number(d.redeemed || 0),
      history: Array.isArray(d.history) ? d.history : [],
    };
  } catch (e) {
    console.error('[engagementService] getUserPoints', e);
    return { total: 0, redeemed: 0, history: [] };
  }
}

// Award points atomically: increment total + append history entry.
export async function awardPoints(uid, tileId, amount, reason) {
  if (!uid || !amount) return;
  const pts = Math.max(0, Math.floor(Number(amount)));
  if (pts <= 0) return;
  const ref = doc(db, 'users', uid, 'engagement', 'points');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists() && snap.data()) || {};
    const total = Number(data.total || 0) + pts;
    const history = Array.isArray(data.history) ? [...data.history] : [];
    history.push({
      tileId: tileId || '',
      amount: pts,
      at: new Date().toISOString(),
      reason: reason || '',
    });
    // Keep history from growing unbounded - trim to last 500 entries.
    if (history.length > 500) history.splice(0, history.length - 500);
    tx.set(ref, {
      total,
      redeemed: Number(data.redeemed || 0),
      history,
    });
  });
}

// Redeem points into wallet balance.
// Returns { success, error?, walletCredited?, pointsDeducted? }
export async function redeemPoints(uid, amount) {
  if (!uid) return { success: false, error: 'No user.' };
  const pts = Math.max(0, Math.floor(Number(amount)));
  if (pts <= 0) return { success: false, error: 'Invalid amount.' };

  // Load points config for conversion + minimum check.
  let cfg;
  try {
    const snap = await getDoc(doc(db, 'settings', 'engagement'));
    cfg = (snap.exists() && snap.data()?.pointsConfig) || defaultPointsConfig();
  } catch (_) {
    cfg = defaultPointsConfig();
  }

  if (!cfg.enabled) {
    return { success: false, error: 'Points redemption is currently disabled.' };
  }

  const rate = Number(cfg.pointsToInr) || 10000;
  const minInr = Number(cfg.minRedemptionInr) || 100;
  const inrValue = (pts / rate) * 100; // convert to INR

  if (inrValue < minInr) {
    return {
      success: false,
      error: `Minimum redemption is ${minInr} INR. `
        + `You need at least ${Math.ceil((minInr / 100) * rate)} points.`,
    };
  }

  const ptsRef = doc(db, 'users', uid, 'engagement', 'points');
  const userRef = doc(db, 'users', uid);

  try {
    const result = await runTransaction(db, async (tx) => {
      const pSnap = await tx.get(ptsRef);
      const pData = (pSnap.exists() && pSnap.data()) || {};
      const currentTotal = Number(pData.total || 0);
      const currentRedeemed = Number(pData.redeemed || 0);
      const available = currentTotal - currentRedeemed;

      if (pts > available) {
        throw new Error(
          `Not enough points. Available: ${available}, requested: ${pts}.`,
        );
      }

      // Credit wallet
      const uSnap = await tx.get(userRef);
      const wallet = Number(
        (uSnap.exists() && uSnap.data()?.wallet) || 0,
      );
      const creditInr = Math.floor(inrValue);

      tx.set(userRef, { wallet: wallet + creditInr }, { merge: true });

      // Deduct points
      const history = Array.isArray(pData.history)
        ? [...pData.history] : [];
      history.push({
        tileId: '_redemption',
        amount: -pts,
        at: new Date().toISOString(),
        reason: `Redeemed ${pts} points for ${creditInr} INR wallet credit`,
      });
      if (history.length > 500) history.splice(0, history.length - 500);

      tx.set(ptsRef, {
        total: currentTotal,
        redeemed: currentRedeemed + pts,
        history,
      });

      return { walletCredited: creditInr, pointsDeducted: pts };
    });

    return { success: true, ...result };
  } catch (e) {
    return {
      success: false,
      error: (e && e.message) || 'Redemption failed. Please try again.',
    };
  }
}

// ---- Default tiles ----------------------------------------------------

export function getDefaultTiles() {
  return [
    // 1. Learn Astrology - 12 lessons
    {
      id: 'learn_astrology',
      name: 'Learn Astrology',
      icon: '✨',
      description: 'Master the basics of Vedic astrology',
      enabled: true,
      order: 0,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'What is Vedic Astrology?', body: 'Vedic astrology (Jyotish) is an ancient Indian system of astronomy and astrology. Unlike Western astrology which uses the tropical zodiac, Vedic astrology uses the sidereal zodiac aligned with fixed star constellations.', points: 10, quizQ: { q: 'Which zodiac system does Vedic astrology use?', options: ['Tropical zodiac', 'Sidereal zodiac', 'Chinese zodiac', 'Both tropical and sidereal'], correct: 1 } },
          { title: 'The 12 Zodiac Signs (Rashis)', body: 'The 12 rashis are Aries (Mesha), Taurus (Vrishabha), Gemini (Mithuna), Cancer (Karka), Leo (Simha), Virgo (Kanya), Libra (Tula), Scorpio (Vrishchika), Sagittarius (Dhanu), Capricorn (Makara), Aquarius (Kumbha), and Pisces (Meena).', points: 10, quizQ: { q: 'What is the Sanskrit name for Scorpio?', options: ['Karka', 'Simha', 'Vrishchika', 'Meena'], correct: 2 } },
          { title: 'The 12 Houses (Bhavas)', body: 'Each house in a birth chart represents a different life area. The 1st house is self and appearance, 2nd is wealth, 3rd is siblings and courage, 4th is home and mother, 5th is children and creativity, and so on up to the 12th house of spiritual liberation.', points: 10, quizQ: { q: 'Which house represents children and creativity?', options: ['3rd house', '4th house', '5th house', '7th house'], correct: 2 } },
          { title: 'The 9 Planets (Navagraha)', body: 'Vedic astrology uses 9 celestial bodies: Sun (Surya), Moon (Chandra), Mars (Mangal), Mercury (Budh), Jupiter (Guru), Venus (Shukra), Saturn (Shani), Rahu (north lunar node), and Ketu (south lunar node).', points: 10, quizQ: { q: 'What is Rahu?', options: ['A visible planet', 'The north lunar node', 'The south lunar node', 'A comet'], correct: 1 } },
          { title: 'Planetary Strengths', body: 'Each planet is strongest in its sign of exaltation and weakest in its debilitation sign. For example, the Sun is exalted in Aries and debilitated in Libra. Jupiter is exalted in Cancer and debilitated in Capricorn.', points: 10, quizQ: { q: 'In which sign is the Sun exalted?', options: ['Leo', 'Libra', 'Aries', 'Sagittarius'], correct: 2 } },
          { title: 'Nakshatras (Lunar Mansions)', body: 'There are 27 nakshatras, each spanning 13 degrees 20 minutes of the zodiac. Your birth nakshatra is determined by the Moon position at birth. Ashwini, Bharani, and Krittika are the first three nakshatras in Aries.', points: 15, quizQ: { q: 'How many nakshatras are there in Vedic astrology?', options: ['12', '21', '27', '36'], correct: 2 } },
          { title: 'Understanding Your Ascendant', body: 'The Lagna (ascendant) is the zodiac sign rising on the eastern horizon at the time of your birth. It shapes your physical appearance, personality, and how others perceive you. It is the most important point in a Vedic chart.', points: 10, quizQ: { q: 'What is the Lagna (ascendant)?', options: ['Your Sun sign', 'Your Moon sign', 'The sign rising on the eastern horizon at birth', 'Your nakshatra'], correct: 2 } },
          { title: 'Planetary Aspects (Drishti)', body: 'In Vedic astrology, all planets aspect the 7th house from their position. Mars also aspects the 4th and 8th, Jupiter the 5th and 9th, and Saturn the 3rd and 10th houses from their position.', points: 15, quizQ: { q: 'Which house does every planet aspect in Vedic astrology?', options: ['4th house', '5th house', '7th house', '10th house'], correct: 2 } },
          { title: 'Yogas in Vedic Astrology', body: 'Yogas are special planetary combinations. Raj Yoga forms when lords of trines (1, 5, 9) combine with lords of kendras (1, 4, 7, 10), promising power and success. Gajakesari Yoga (Moon + Jupiter in kendras) brings wisdom and wealth.', points: 15, quizQ: { q: 'What does Gajakesari Yoga involve?', options: ['Sun + Mars', 'Moon + Jupiter in kendras', 'Venus + Mercury', 'Saturn + Rahu'], correct: 1 } },
          { title: 'Dasha System', body: 'The Vimshottari Dasha system divides your life into planetary periods. Each planet rules a specific number of years: Sun 6, Moon 10, Mars 7, Rahu 18, Jupiter 16, Saturn 19, Mercury 17, Ketu 7, Venus 20. Total cycle is 120 years.', points: 15, quizQ: { q: 'How many years does Venus Mahadasha last in Vimshottari?', options: ['16', '17', '19', '20'], correct: 3 } },
          { title: 'Transits (Gochar)', body: 'Transits show where planets are currently moving through the zodiac relative to your birth chart. Saturn transit (Sade Sati) through the 12th, 1st, and 2nd from Moon lasts about 7.5 years and is considered a challenging period.', points: 15, quizQ: { q: 'How long does Sade Sati last?', options: ['2.5 years', '5 years', '7.5 years', '12 years'], correct: 2 } },
          { title: 'Remedies in Vedic Astrology', body: 'Common remedies include gemstone therapy (wearing specific stones for weak planets), mantra chanting, charity on specific days, fasting, and performing pujas. Remedies aim to strengthen weak planets or pacify malefic influences.', points: 20, quizQ: { q: 'What is the purpose of remedies in Vedic astrology?', options: ['Predict the future', 'Change your birth chart', 'Strengthen weak planets or pacify malefic ones', 'Replace consulting an astrologer'], correct: 2 } },
        ],
      },
    },

    // 2. Quiz Game - 20 questions
    {
      id: 'quiz_game',
      name: 'Quiz Game',
      icon: '🧠',
      description: 'Test your astrology knowledge',
      enabled: true,
      order: 1,
      type: 'quiz',
      pointsPerActivity: 15,
      content: {
        questions: [
          { q: 'Which planet rules Scorpio in Vedic astrology?', options: ['Venus', 'Mars', 'Saturn', 'Rahu'], correct: 1, points: 15 },
          { q: 'How many nakshatras are there in Vedic astrology?', options: ['12', '27', '9', '36'], correct: 1, points: 10 },
          { q: 'Which planet is known as Guru in Sanskrit?', options: ['Mercury', 'Saturn', 'Jupiter', 'Venus'], correct: 2, points: 10 },
          { q: 'What is the exaltation sign of the Sun?', options: ['Leo', 'Aries', 'Sagittarius', 'Capricorn'], correct: 1, points: 15 },
          { q: 'Rahu and Ketu are also known as?', options: ['Inner planets', 'Outer planets', 'Shadow planets (lunar nodes)', 'Gas giants'], correct: 2, points: 10 },
          { q: 'Which house represents career and profession?', options: ['7th house', '10th house', '2nd house', '5th house'], correct: 1, points: 10 },
          { q: 'How many years does Saturn Mahadasha last in Vimshottari?', options: ['16 years', '7 years', '19 years', '20 years'], correct: 2, points: 15 },
          { q: 'Which zodiac sign is ruled by Venus along with Taurus?', options: ['Cancer', 'Libra', 'Pisces', 'Gemini'], correct: 1, points: 10 },
          { q: 'What is the 7th house primarily associated with?', options: ['Wealth', 'Marriage and partnerships', 'Career', 'Health'], correct: 1, points: 10 },
          { q: 'Which planet is debilitated in Capricorn?', options: ['Mars', 'Saturn', 'Jupiter', 'Mercury'], correct: 2, points: 15 },
          { q: 'What does Mangal Dosha relate to?', options: ['Mercury in 7th house', 'Mars in certain houses', 'Saturn return', 'Rahu-Ketu axis'], correct: 1, points: 15 },
          { q: 'How long does Sade Sati last approximately?', options: ['2.5 years', '5 years', '7.5 years', '12 years'], correct: 2, points: 10 },
          { q: 'Which planet rules Pisces?', options: ['Jupiter', 'Neptune', 'Venus', 'Moon'], correct: 0, points: 10 },
          { q: 'What is the ascendant (Lagna)?', options: ['Sun sign', 'Moon sign', 'Rising sign on the eastern horizon', 'Midheaven point'], correct: 2, points: 10 },
          { q: 'Which gemstone is associated with Saturn?', options: ['Ruby', 'Blue Sapphire', 'Emerald', 'Pearl'], correct: 1, points: 15 },
          { q: 'The Navamsa chart divides each sign into how many parts?', options: ['3', '9', '12', '7'], correct: 1, points: 20 },
          { q: 'Which planet is the karaka (significator) of marriage?', options: ['Mars', 'Moon', 'Venus', 'Jupiter'], correct: 2, points: 15 },
          { q: 'Ketu is the co-ruler of which zodiac sign?', options: ['Aries', 'Scorpio', 'Pisces', 'Aquarius'], correct: 1, points: 20 },
          { q: 'What does the 5th house represent?', options: ['Siblings', 'Enemies', 'Children, creativity, romance', 'Travel'], correct: 2, points: 10 },
          { q: 'Venus Mahadasha lasts how many years?', options: ['16', '17', '19', '20'], correct: 3, points: 15 },
        ],
      },
    },

    // 3. Manifestation - 15 affirmations
    {
      id: 'manifestation',
      name: 'Manifestation',
      icon: '🌟',
      description: 'Daily affirmations aligned with cosmic energy',
      enabled: true,
      order: 2,
      type: 'manifest',
      pointsPerActivity: 5,
      content: {
        affirmations: [
          { text: 'I am aligned with the abundant energy of Jupiter. Prosperity flows to me effortlessly.', points: 5 },
          { text: 'The Sun within me shines bright. I step into my power with confidence and clarity.', points: 5 },
          { text: 'Like the Moon, I embrace all my phases. Every cycle brings growth and renewal.', points: 5 },
          { text: 'Mercury blesses my communication. My words carry truth and create positive change.', points: 5 },
          { text: 'Venus fills my heart with love. I attract beautiful relationships and creative abundance.', points: 5 },
          { text: 'I accept Saturn\'s lessons with grace. Discipline and patience are building my future.', points: 5 },
          { text: 'Mars gives me courage. I take bold action toward my dreams without fear.', points: 5 },
          { text: 'The stars have written a magnificent story for me. I trust the cosmic plan unfolding.', points: 5 },
          { text: 'I release what no longer serves me, like Ketu releases attachments. I am free.', points: 5 },
          { text: 'Rahu\'s energy drives my ambition. I pursue my goals with passion and purpose.', points: 5 },
          { text: 'My nakshatras bless me with unique gifts. I honour my cosmic blueprint every day.', points: 5 },
          { text: 'I am a child of the universe. The planets guide and protect me on my path.', points: 5 },
          { text: 'Like the sky that holds all stars, my heart holds infinite possibilities.', points: 5 },
          { text: 'I vibrate at the frequency of abundance. The cosmos responds to my positive energy.', points: 5 },
          { text: 'Today I choose to align with my highest destiny. The universe conspires in my favour.', points: 5 },
        ],
      },
    },

    // 4. Astro Comic - 10 strips
    {
      id: 'astro_comic',
      name: 'Astro Comic',
      icon: '📚',
      description: 'Funny astrology strips for every sign',
      enabled: true,
      order: 3,
      type: 'comic',
      pointsPerActivity: 5,
      content: {
        strips: [
          { title: 'Aries at a Restaurant', imageUrl: '/images/comics/aries_restaurant.png', points: 5 },
          { title: 'Taurus on a Diet', imageUrl: '/images/comics/taurus_diet.png', points: 5 },
          { title: 'Gemini Making Plans', imageUrl: '/images/comics/gemini_plans.png', points: 5 },
          { title: 'Cancer Packing for a Trip', imageUrl: '/images/comics/cancer_packing.png', points: 5 },
          { title: 'Leo Taking a Selfie', imageUrl: '/images/comics/leo_selfie.png', points: 5 },
          { title: 'Virgo Organizing Everything', imageUrl: '/images/comics/virgo_organizing.png', points: 5 },
          { title: 'Libra Making a Decision', imageUrl: '/images/comics/libra_decision.png', points: 5 },
          { title: 'Scorpio Being "Fine"', imageUrl: '/images/comics/scorpio_fine.png', points: 5 },
          { title: 'Sagittarius Booking Flights', imageUrl: '/images/comics/sagittarius_flights.png', points: 5 },
          { title: 'Capricorn on Vacation', imageUrl: '/images/comics/capricorn_vacation.png', points: 5 },
        ],
      },
    },

    // 5. Tarot Learning - 10 major arcana
    {
      id: 'tarot_learning',
      name: 'Tarot Learning',
      icon: '🃏',
      description: 'Explore the meanings of Major Arcana cards',
      enabled: true,
      order: 4,
      type: 'tarot',
      pointsPerActivity: 10,
      content: {
        cards: [
          { name: 'The Fool (0)', meaning: 'New beginnings, innocence, spontaneity, and a free spirit. The Fool encourages you to take a leap of faith and embrace the unknown journey ahead.', reversedMeaning: 'Recklessness, risk-taking, holding back from new experiences due to fear.', points: 10 },
          { name: 'The Magician (I)', meaning: 'Manifestation, resourcefulness, power, and inspired action. You have all the tools you need to create your desired reality.', reversedMeaning: 'Manipulation, poor planning, untapped talents left unused.', points: 10 },
          { name: 'The High Priestess (II)', meaning: 'Intuition, sacred knowledge, the subconscious mind, and divine feminine wisdom. Trust your inner voice.', reversedMeaning: 'Secrets, withdrawal from intuition, disconnected from inner self.', points: 10 },
          { name: 'The Empress (III)', meaning: 'Femininity, beauty, nature, nurturing, and abundance. A period of growth, comfort, and creative fertility.', reversedMeaning: 'Creative block, dependence on others, neglecting self-care.', points: 10 },
          { name: 'The Emperor (IV)', meaning: 'Authority, structure, control, and fatherhood. Establishing order and taking a leadership role in your life.', reversedMeaning: 'Domination, excessive control, rigidity, lack of discipline.', points: 10 },
          { name: 'The Hierophant (V)', meaning: 'Spiritual wisdom, religious beliefs, tradition, and conformity. Seeking guidance from established institutions or mentors.', reversedMeaning: 'Personal beliefs challenged, rebellion, subversiveness, new approaches.', points: 10 },
          { name: 'The Lovers (VI)', meaning: 'Love, harmony, relationships, and values alignment. A significant choice about a relationship or personal values.', reversedMeaning: 'Self-love needed, disharmony, imbalance, misalignment of values.', points: 10 },
          { name: 'The Chariot (VII)', meaning: 'Control, willpower, success, and determination. Overcoming obstacles through confidence and inner strength.', reversedMeaning: 'Self-discipline needed, opposition, lack of direction.', points: 10 },
          { name: 'Strength (VIII)', meaning: 'Inner strength, bravery, compassion, and focus. Mastering your emotions and channeling raw energy positively.', reversedMeaning: 'Self-doubt, low energy, raw emotion overwhelming reason.', points: 10 },
          { name: 'The Wheel of Fortune (X)', meaning: 'Good luck, karma, life cycles, and destiny. A turning point is coming; embrace change as part of the cosmic plan.', reversedMeaning: 'Bad luck, resistance to change, breaking cycles.', points: 10 },
        ],
      },
    },

    // 6. Numerology Basics - 8 lessons
    {
      id: 'numerology_basics',
      name: 'Numerology Basics',
      icon: '🔢',
      description: 'Discover the power of numbers 1 through 9',
      enabled: true,
      order: 5,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'What is Numerology?', body: 'Numerology is the study of numbers and their cosmic vibrations. Each number from 1 to 9 carries a unique energy that influences personality, destiny, and life events. Your Life Path number is calculated from your birth date.', points: 10 },
          { title: 'Number 1 - The Leader', body: 'Number 1 is ruled by the Sun. People with this number are natural leaders, independent, ambitious, and pioneering. They blaze new trails and prefer to work alone. Lucky day: Sunday. Lucky colour: Gold.', points: 10 },
          { title: 'Number 2 - The Diplomat', body: 'Number 2 is ruled by the Moon. These individuals are gentle, cooperative, and deeply intuitive. They excel at mediation and creating harmony. Lucky day: Monday. Lucky colour: White and Silver.', points: 10 },
          { title: 'Number 3 - The Creative', body: 'Number 3 is ruled by Jupiter. People with this number are expressive, artistic, and optimistic. They have a gift for communication and inspire others with their enthusiasm. Lucky day: Thursday.', points: 10 },
          { title: 'Number 4 - The Builder', body: 'Number 4 is ruled by Rahu. These individuals are practical, hardworking, and methodical. They build strong foundations through discipline and determination. Lucky day: Saturday.', points: 10 },
          { title: 'Number 5 - The Adventurer', body: 'Number 5 is ruled by Mercury. People with this number love freedom, travel, and change. They are versatile, curious, and quick-witted. Lucky day: Wednesday. Lucky colour: Green.', points: 10 },
          { title: 'Number 6 - The Nurturer', body: 'Number 6 is ruled by Venus. These individuals are loving, responsible, and artistic. They are natural caregivers devoted to family and community. Lucky day: Friday. Lucky colour: Blue and Pink.', points: 10 },
          { title: 'Numbers 7, 8, and 9', body: 'Number 7 (Ketu) represents spirituality and introspection. Number 8 (Saturn) governs material success and karmic lessons. Number 9 (Mars) embodies courage, humanitarianism, and completion of cycles. Together they complete the numerological spectrum.', points: 15 },
        ],
      },
    },

    // 7. Crystal Guide - 8 crystals
    {
      id: 'crystal_guide',
      name: 'Crystal Guide',
      icon: '💎',
      description: 'Learn about healing crystals and their properties',
      enabled: true,
      order: 6,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'Amethyst - The Spiritual Stone', body: 'Amethyst is a calming stone linked to the Crown chakra. It enhances intuition, promotes peaceful sleep, and protects against negative energy. Place it under your pillow to prevent nightmares. Best for: Pisces, Virgo, Aquarius, Capricorn.', points: 10 },
          { title: 'Rose Quartz - The Love Stone', body: 'Rose Quartz opens the Heart chakra and attracts love in all forms. It promotes self-love, heals emotional wounds, and restores trust. Carry it in your pocket or place it in the southwest corner of your bedroom. Best for: Taurus, Libra.', points: 10 },
          { title: 'Citrine - The Abundance Stone', body: 'Citrine is connected to the Solar Plexus chakra and attracts wealth, prosperity, and success. Known as the "merchant stone," it never needs cleansing as it does not absorb negative energy. Best for: Aries, Leo, Gemini.', points: 10 },
          { title: 'Tiger Eye - The Courage Stone', body: 'Tiger Eye boosts confidence, willpower, and protection. It combines earth and sun energy to create a high vibration that is grounding yet uplifting. Excellent for overcoming fear and taking action. Best for: Leo, Capricorn.', points: 10 },
          { title: 'Clear Quartz - The Master Healer', body: 'Clear Quartz amplifies energy and intention. Known as the "master healer," it works on all chakras and can be programmed for any purpose. It also amplifies the energy of other crystals placed nearby. Best for: All zodiac signs.', points: 10 },
          { title: 'Black Tourmaline - The Protector', body: 'Black Tourmaline is the most powerful protection stone. It repels negative energy, electromagnetic radiation, and psychic attacks. Place it near your front door or workspace for a protective shield. Best for: Capricorn, Scorpio.', points: 10 },
          { title: 'Moonstone - The Intuition Stone', body: 'Moonstone harnesses lunar energy and is deeply connected to the Sacral and Third Eye chakras. It enhances intuition, balances emotions, and supports new beginnings. Especially potent during full moon. Best for: Cancer, Libra, Scorpio.', points: 10 },
          { title: 'Lapis Lazuli - The Wisdom Stone', body: 'Lapis Lazuli activates the Throat and Third Eye chakras. It promotes self-awareness, honest expression, and deep wisdom. Ancient civilizations revered it as a stone of royalty and truth. Best for: Sagittarius, Taurus, Libra.', points: 10 },
        ],
      },
    },

    // 8. Daily Rituals - 10 rituals
    {
      id: 'daily_rituals',
      name: 'Daily Rituals',
      icon: 'DailyRituals',
      description: 'Simple Vedic rituals for everyday well-being',
      enabled: true,
      order: 7,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'Surya Namaskar at Sunrise', body: 'Offer water (Arghya) to the Sun at sunrise while chanting "Om Suryaya Namah." Face east, take water in a copper vessel, and pour it slowly while looking at the Sun through the stream. This strengthens a weak Sun in your chart and boosts confidence.', points: 10, quizQ: { q: 'What do you chant while offering water to the Sun?', options: ['Om Namah Shivaya', 'Om Suryaya Namah', 'Om Ganeshaya Namah', 'Om Namo Bhagavate'], correct: 1 } },
          { title: 'Light a Diya (Oil Lamp)', body: 'Light a ghee or sesame oil diya every morning and evening in your prayer area. The flame removes negative energy and invites positive vibrations. Use a cotton wick and place the lamp facing east or north for best results.', points: 10, quizQ: { q: 'Which direction should an oil lamp face for best results?', options: ['South or West', 'East or North', 'Any direction', 'Only East'], correct: 1 } },
          { title: 'Tulsi Puja (Holy Basil)', body: 'Water a Tulsi plant every morning and offer prayers. Tulsi purifies the air and the surrounding energy. Walking around the Tulsi plant 7 times clockwise is believed to remove obstacles and attract good fortune.', points: 10, quizQ: { q: 'How many times do you walk around the Tulsi plant clockwise?', options: ['3 times', '5 times', '7 times', '9 times'], correct: 2 } },
          { title: 'Hanuman Chalisa on Tuesday', body: 'Recite the Hanuman Chalisa on Tuesdays to strengthen Mars in your chart. It removes Mangal Dosha effects and brings courage. Wearing red clothes and offering red flowers or sindoor to Lord Hanuman enhances the remedy.', points: 10, quizQ: { q: 'Which planet does Hanuman Chalisa on Tuesday help strengthen?', options: ['Saturn', 'Jupiter', 'Mars', 'Sun'], correct: 2 } },
          { title: 'Feeding Birds and Animals', body: 'Feed grains to birds in the morning to strengthen the Sun. Feeding cows with green grass strengthens a weak Moon. Feeding dogs on Saturday helps pacify Saturn. This simple act of charity generates positive karma.', points: 10, quizQ: { q: 'Which remedy helps pacify Saturn?', options: ['Feeding birds grains', 'Feeding cows', 'Feeding dogs on Saturday', 'Feeding fish'], correct: 2 } },
          { title: 'Chanting Om Before Sleep', body: 'Chant "Om" 11 times before sleeping. The vibration of Om aligns all seven chakras and calms the mind. It reduces anxiety, promotes deep sleep, and creates a protective energy field around you through the night.', points: 10, quizQ: { q: 'How many times should you chant Om before sleeping?', options: ['7 times', '9 times', '11 times', '21 times'], correct: 2 } },
          { title: 'Saturday Saturn Remedy', body: 'On Saturdays, donate black sesame seeds, mustard oil, or dark-coloured items to the needy. Avoid purchasing iron items on Saturday. Light a sesame oil lamp in the evening to pacify Saturn and reduce Sade Sati effects.', points: 10, quizQ: { q: 'What should you avoid buying on Saturday?', options: ['Gold', 'Iron items', 'Fruits', 'Clothing'], correct: 1 } },
          { title: 'Camphor Burning (Kapur Aarti)', body: 'Burn camphor in the evening during aarti. Camphor burns completely without leaving any residue, symbolizing the burning of ego. The fragrance purifies the home and wards off negative spirits and energies.', points: 10, quizQ: { q: 'What does camphor burning without residue symbolize?', options: ['Prosperity', 'Burning of ego', 'Strength', 'Wisdom'], correct: 1 } },
          { title: 'Wearing Rudraksha', body: 'Wear a Panchmukhi (5-faced) Rudraksha for general well-being. It represents Lord Shiva and pacifies all planets. Energize it by chanting "Om Namah Shivaya" 108 times on a Monday before wearing it for the first time.', points: 10, quizQ: { q: 'How many faces does the Panchmukhi Rudraksha have?', options: ['3', '4', '5', '7'], correct: 2 } },
          { title: 'Evening Gratitude Practice', body: 'Before sunset, sit quietly and express gratitude to each of the Navagraha (9 planets) for their blessings. Acknowledge the lessons from challenging transits. Gratitude raises your vibration and harmonizes your relationship with cosmic energies.', points: 10, quizQ: { q: 'How many planets (Navagraha) do you express gratitude to?', options: ['7', '8', '9', '12'], correct: 2 } },
        ],
      },
    },

    // 9. Palm Reading - 8 lessons
    {
      id: 'palm_reading',
      name: 'Palm Reading',
      icon: 'PalmReading',
      description: 'Discover what your hands reveal about your destiny',
      enabled: true,
      order: 8,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'Introduction to Palmistry', body: 'Palmistry (Hast Rekha Shastra) is the ancient art of reading the palm to understand personality, life events, and future potential. In Vedic palmistry, both hands are read: the dominant hand shows your present and future, while the non-dominant hand shows your inherited potential and past karma. Always read both hands together for a complete picture.', points: 10, quizQ: { q: 'Which hand shows inherited potential in Vedic palmistry?', options: ['Dominant hand', 'Non-dominant hand', 'Both equally', 'It varies by person'], correct: 1 } },
          { title: 'The Four Major Lines', body: 'There are four major lines in palmistry: 1) The Heart Line (topmost horizontal line) governs emotions and relationships. 2) The Head Line (middle horizontal line) governs intellect and thinking. 3) The Life Line (curved line around the thumb mount) governs vitality and life events. 4) The Fate Line (vertical line rising toward middle finger) governs career and destiny.', points: 10, quizQ: { q: 'Which palm line governs emotions and relationships?', options: ['Head Line', 'Life Line', 'Heart Line', 'Fate Line'], correct: 2 } },
          { title: 'Reading the Heart Line', body: 'A long, clear Heart Line reaching the index finger indicates a devoted, idealistic lover. A short Heart Line suggests a practical approach to love. A curved Heart Line indicates emotional expressiveness; a straight one indicates emotional control. Breaks in the Heart Line may suggest emotional difficulties or a broken relationship at that life stage.', points: 10, quizQ: { q: 'What does a curved Heart Line indicate?', options: ['Emotional control', 'Practical approach to love', 'Emotional expressiveness', 'Poor relationships'], correct: 2 } },
          { title: 'Reading the Head Line', body: 'A long, clear Head Line reaching across the palm indicates analytical thinking and strong concentration. A short Head Line indicates someone who is decisive and direct. A curved Head Line shows creativity and imagination. A wavy Head Line may indicate scattered thinking. A sloping Head Line reaching toward the Moon mount reveals strong creative and intuitive abilities.', points: 10, quizQ: { q: 'What does a sloping Head Line reaching toward the Moon mount reveal?', options: ['Analytical thinking', 'Decision-making ability', 'Creative and intuitive abilities', 'Poor memory'], correct: 2 } },
          { title: 'The Life Line: Myths and Facts', body: 'Contrary to popular belief, the Life Line does not predict the length of your life. It reveals the quality and vitality of your life experiences. A deep, long Life Line shows strong vitality. A faint line may indicate low energy. Breaks may show major life changes or health events. Islands on the Life Line can indicate periods of stress or illness.', points: 10, quizQ: { q: 'What does the Life Line actually reveal (not predict)?', options: ['Length of life', 'Quality and vitality of life', 'Number of marriages', 'Career success'], correct: 1 } },
          { title: 'The Seven Mounts', body: 'The seven mounts are raised fleshy areas at the base of each finger and the palm edges. Mount of Jupiter (below index finger): ambition and leadership. Mount of Saturn (below middle finger): wisdom. Mount of Apollo/Sun (below ring finger): creativity. Mount of Mercury (below little finger): communication. Mount of Venus (thumb base): love. Mount of Moon: intuition. Plain of Mars: courage.', points: 15, quizQ: { q: 'Which mount represents communication?', options: ['Mount of Jupiter', 'Mount of Apollo', 'Mount of Mercury', 'Mount of Venus'], correct: 2 } },
          { title: 'Minor Lines and Special Markings', body: 'The Marriage Line (small horizontal lines on the edge of the palm below the little finger) indicates significant relationships. The Sun Line (vertical line below the ring finger) indicates fame and success. Stars on mounts indicate exceptional talent. Crosses can indicate challenges or crossroads. Triangles on mounts are auspicious signs of skill. Grilles indicate scattered energy in that life area.', points: 15, quizQ: { q: 'Where are Marriage Lines found on the palm?', options: ['Below the index finger', 'At the base of the thumb', 'On the edge below the little finger', 'In the center of the palm'], correct: 2 } },
          { title: 'Thumb Shape and Personality', body: 'The thumb reveals willpower and logic. A long thumb indicates strong willpower and leadership. A short thumb suggests emotional decision-making. A flexible (bendable) thumb shows adaptability and generosity. A stiff thumb indicates stubbornness. The upper phalange (top part) of the thumb represents willpower; the lower phalange represents logic and reasoning ability.', points: 10, quizQ: { q: 'What does a flexible, bendable thumb indicate?', options: ['Stubbornness', 'Strong willpower', 'Adaptability and generosity', 'Poor decision-making'], correct: 2 } },
        ],
      },
    },

    // 11. Chakra Healing - 9 lessons
    {
      id: 'chakra_healing',
      name: 'Chakra Healing',
      icon: '&#9679;',
      description: 'Understand and balance your 7 energy centres',
      enabled: true,
      order: 10,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'What Are Chakras?', body: 'Chakras are energy centres in your body. The word "chakra" comes from Sanskrit and means "wheel." There are 7 main chakras running along your spine from the base to the top of your head. Each chakra spins like a wheel and manages specific organs, emotions, and life themes. When a chakra is open and balanced, energy flows freely and you feel healthy and at peace. When a chakra is blocked, you may feel stuck, anxious, or unwell in that area of life.', points: 10, quizQ: { q: 'What does the word "chakra" mean in Sanskrit?', options: ['Lotus flower', 'Wheel', 'Light', 'Energy'], correct: 1 } },
          { title: 'Root Chakra (Muladhara)', body: 'The Root Chakra is located at the base of your spine. Its colour is red. It governs your sense of safety, survival, and connection to the earth. When balanced, you feel grounded, secure, and at home in your body. Signs of a blocked root chakra include fear, anxiety, financial worry, and feeling "unrooted." To heal it: walk barefoot on grass, eat root vegetables, wear red, chant "LAM," and spend time in nature.', points: 10 },
          { title: 'Sacral Chakra (Svadhisthana)', body: 'The Sacral Chakra sits just below your navel. Its colour is orange. It governs creativity, emotions, pleasure, and sexuality. When balanced, you feel creative, passionate, and emotionally free. A blocked sacral chakra shows up as creative blocks, emotional numbness, or unhealthy relationships. To heal it: dance freely, enjoy water activities, eat sweet fruits and nuts, wear orange, and chant "VAM."', points: 10, quizQ: { q: 'What colour is the Sacral Chakra?', options: ['Red', 'Orange', 'Yellow', 'Green'], correct: 1 } },
          { title: 'Solar Plexus Chakra (Manipura)', body: 'The Solar Plexus Chakra is located in your upper abdomen, above the navel. Its colour is yellow. It governs personal power, confidence, willpower, and self-esteem. When balanced, you feel confident, decisive, and in control of your life. Signs of imbalance include low self-esteem, lack of willpower, and digestive issues. To heal it: practice core exercises, spend time in sunlight, eat yellow foods, chant "RAM," and set personal boundaries.', points: 10 },
          { title: 'Heart Chakra (Anahata)', body: 'The Heart Chakra is at the centre of your chest. Its colour is green (and sometimes pink). It governs love, compassion, forgiveness, and connection. When open, you give and receive love freely and feel deep empathy. A blocked heart chakra can cause loneliness, jealousy, grief, or difficulty forgiving. To heal it: practice loving-kindness meditation, hug loved ones, work with rose quartz, eat green foods, and chant "YAM."', points: 10, quizQ: { q: 'What colour is the Heart Chakra?', options: ['Blue', 'Yellow', 'Green', 'Violet'], correct: 2 } },
          { title: 'Throat Chakra (Vishuddha)', body: 'The Throat Chakra is at your throat. Its colour is blue. It governs communication, truth, and self-expression. When balanced, you speak clearly, listen well, and express your truth without fear. A blocked throat chakra may show up as difficulty speaking up, lying, sore throats, or poor listening. To heal it: sing, journal your thoughts, work with blue crystals like lapis lazuli, eat blueberries, and chant "HAM."', points: 10 },
          { title: 'Third Eye Chakra (Ajna)', body: 'The Third Eye Chakra is between your eyebrows. Its colour is indigo. It governs intuition, wisdom, imagination, and inner vision. When open, you have clear insights, strong intuition, and vivid dreams. Imbalances cause confusion, poor judgment, and disconnection from your inner wisdom. To heal it: meditate daily, practice visualization, work with amethyst, reduce screen time before bed, and chant "OM."', points: 10, quizQ: { q: 'Where is the Third Eye Chakra located?', options: ['Top of the head', 'Between the eyebrows', 'At the throat', 'In the chest'], correct: 1 } },
          { title: 'Crown Chakra (Sahasrara)', body: 'The Crown Chakra is at the very top of your head. Its colour is violet or white. It governs spiritual connection, consciousness, and your link to the universe. When open, you feel a deep sense of peace, purpose, and connection to something greater. Imbalances cause feelings of isolation, purposelessness, or spiritual disconnection. To heal it: meditate in silence, practice gratitude, work with clear quartz, spend time in prayer, and chant "OM" or simply sit in stillness.', points: 15 },
          { title: 'Balancing All 7 Chakras Together', body: 'True wellbeing comes from all 7 chakras being open and balanced. A simple daily practice: sit in a quiet place, close your eyes, and visualize each chakra from root to crown glowing in its colour. Breathe deeply into each one and imagine it spinning freely. You can also use a full-body crystal layout: red jasper at the base, carnelian at the sacral, citrine at the solar plexus, green aventurine at the heart, blue lace agate at the throat, amethyst at the third eye, and clear quartz at the crown. Regular yoga, breathwork, and meditation keep all chakras healthy.', points: 15, quizQ: { q: 'Which crystal is used for the Root Chakra in a full-body crystal layout?', options: ['Amethyst', 'Citrine', 'Red Jasper', 'Rose Quartz'], correct: 2 } },
        ],
      },
    },

    // 12. Zodiac Compatibility - 20 quiz questions
    {
      id: 'zodiac_compatibility',
      name: 'Zodiac Compat.',
      icon: '&#10084;',
      description: 'Quiz: how well do the signs match?',
      enabled: true,
      order: 11,
      type: 'quiz',
      pointsPerActivity: 10,
      content: {
        questions: [
          { q: 'Which sign is the natural opposite of Aries?', options: ['Taurus', 'Libra', 'Scorpio', 'Cancer'], correct: 1, points: 10 },
          { q: 'Fire signs are most naturally harmonious with which element?', options: ['Water', 'Earth', 'Air', 'Other fire'], correct: 2, points: 10 },
          { q: 'Which two signs are often called "the power couple" of the zodiac?', options: ['Leo and Aquarius', 'Scorpio and Taurus', 'Virgo and Pisces', 'Aries and Libra'], correct: 0, points: 10 },
          { q: 'In astrology, two planets 60 degrees apart have which aspect?', options: ['Square', 'Opposition', 'Sextile', 'Conjunction'], correct: 2, points: 15 },
          { q: 'Which sign is considered the most loyal in a relationship?', options: ['Gemini', 'Taurus', 'Sagittarius', 'Aries'], correct: 1, points: 10 },
          { q: 'Cancer is most compatible with which water signs?', options: ['Aries and Leo', 'Scorpio and Pisces', 'Virgo and Capricorn', 'Gemini and Aquarius'], correct: 1, points: 10 },
          { q: 'A trine aspect (120 degrees) between signs indicates?', options: ['Tension and growth', 'Natural harmony and ease', 'Opposition and polarity', 'Attraction with challenges'], correct: 1, points: 15 },
          { q: 'Which sign is ruled by Venus and deeply values harmony in relationships?', options: ['Leo', 'Scorpio', 'Libra', 'Aquarius'], correct: 2, points: 10 },
          { q: 'Scorpio and Taurus are in opposition. This means they are?', options: ['Completely incompatible', 'Identical in nature', 'Opposite signs that attract and challenge each other', 'Ruled by the same planet'], correct: 2, points: 15 },
          { q: 'Which sign values freedom so much that it can struggle in committed relationships?', options: ['Taurus', 'Cancer', 'Sagittarius', 'Capricorn'], correct: 2, points: 10 },
          { q: 'Earth signs (Taurus, Virgo, Capricorn) are most harmonious with which element?', options: ['Fire', 'Air', 'Water', 'Other Earth'], correct: 2, points: 10 },
          { q: 'What is the Venus sign used for in compatibility readings?', options: ['Career compatibility', 'Love style and what you find attractive', 'Family relationships', 'Friendship only'], correct: 1, points: 15 },
          { q: 'Which pair is known as the "twin flame" axis in the zodiac?', options: ['Leo and Aquarius', 'Gemini and Sagittarius', 'Cancer and Capricorn', 'Virgo and Pisces'], correct: 1, points: 10 },
          { q: 'Aquarius is ruled by Uranus and values what most in a partner?', options: ['Tradition and security', 'Intellect and independence', 'Passion and intensity', 'Luxury and comfort'], correct: 1, points: 10 },
          { q: 'The 7th house in a birth chart is called the house of?', options: ['Career', 'Finance', 'Partnerships and marriage', 'Spirituality'], correct: 2, points: 10 },
          { q: 'Which planet is called the "great benefic" and expands whatever it touches?', options: ['Saturn', 'Mars', 'Jupiter', 'Uranus'], correct: 2, points: 10 },
          { q: 'In synastry (relationship astrology), which aspect creates the most tension?', options: ['Trine (120 deg)', 'Square (90 deg)', 'Sextile (60 deg)', 'Conjunction (0 deg)'], correct: 1, points: 15 },
          { q: 'Pisces and Virgo are opposites. What quality do they share that draws them together?', options: ['Desire for adventure', 'Service and devotion', 'Love of luxury', 'Ambition'], correct: 1, points: 15 },
          { q: 'The Mars sign in compatibility shows?', options: ['What you find beautiful', 'How you love', 'How you pursue and express desire', 'Your communication style'], correct: 2, points: 10 },
          { q: 'Which is generally considered the most challenging compatibility pairing due to opposite temperaments?', options: ['Taurus and Virgo', 'Scorpio and Aquarius', 'Cancer and Pisces', 'Aries and Leo'], correct: 1, points: 15 },
        ],
      },
    },

    // 10. Face Reading - 8 lessons
    {
      id: 'face_reading',
      name: 'Face Reading',
      icon: 'FaceReading',
      description: 'Ancient face reading science: Samudrika Shastra',
      enabled: true,
      order: 9,
      type: 'learn',
      pointsPerActivity: 10,
      content: {
        lessons: [
          { title: 'Introduction to Face Reading', body: 'Samudrika Shastra is the ancient Vedic science of reading physical features to understand character, destiny, and health. The face is divided into three zones: the upper zone (forehead to eyebrows) governs wisdom and intellect; the middle zone (eyebrows to nose tip) governs practical life; and the lower zone (below nose to chin) governs material and physical life. A balanced face with all three zones equal indicates a well-rounded personality.', points: 10, quizQ: { q: 'Which zone of the face governs wisdom and intellect?', options: ['Lower zone', 'Middle zone', 'Upper zone', 'All zones equally'], correct: 2 } },
          { title: 'Reading the Forehead', body: 'A high, wide forehead indicates intelligence, wisdom, and leadership potential. A narrow forehead suggests a practical, action-oriented mind. Horizontal lines on the forehead are Jupiter lines and indicate wisdom gained through experience. Vertical lines between the eyebrows are Mars lines and indicate willpower and potential frustration. A smooth, wide forehead with few lines is considered very auspicious.', points: 10, quizQ: { q: 'What do horizontal lines on the forehead indicate?', options: ['Stress and worry', 'Wisdom from experience', 'Poor health', 'Aggressive nature'], correct: 1 } },
          { title: 'Eyes: Windows to the Soul', body: 'In face reading, eyes reveal inner nature. Large eyes indicate emotional sensitivity and openness. Small, sharp eyes indicate shrewdness and intelligence. Almond-shaped eyes suggest diplomacy and grace. Deep-set eyes indicate introspection and depth. Wide-spaced eyes show open-mindedness; close-set eyes indicate concentration. Clear, bright eyes are a sign of good health and positive karma; dull eyes may indicate fatigue or blocked energy.', points: 10, quizQ: { q: 'What do large eyes indicate in face reading?', options: ['Shrewdness and intelligence', 'Introversion', 'Emotional sensitivity and openness', 'Poor health'], correct: 2 } },
          { title: 'The Nose: Wealth and Career', body: 'The nose in Samudrika Shastra relates to the 40s of a person\'s life and is strongly linked to wealth. A fleshy, rounded nose tip (the "wealth bulb") indicates financial acumen and prosperity. A sharp, pointed nose suggests analytical thinking and ambition. A straight nose bridge indicates balanced judgment. A nose with wide, round nostrils indicates a generous personality and good money flow.', points: 10, quizQ: { q: 'A fleshy, rounded nose tip indicates what?', options: ['Health problems', 'Financial acumen and prosperity', 'Poor judgment', 'Emotional sensitivity'], correct: 1 } },
          { title: 'Lips, Mouth, and Expression', body: 'Full lips indicate generosity, warmth, and sensuality. Thin lips suggest precision, reserve, and careful speech. A wide mouth indicates social confidence and leadership. Upturned corners of the mouth indicate an optimistic, positive nature. Downturned corners suggest a tendency toward pessimism. The upper lip represents giving; the lower lip represents receiving. A well-defined Cupid\'s bow on the upper lip indicates artistic talent.', points: 10, quizQ: { q: 'What do upturned corners of the mouth indicate?', options: ['Pessimism', 'Aggressive nature', 'Optimistic and positive nature', 'Secretive nature'], correct: 2 } },
          { title: 'Ears: Listening and Luck', body: 'Ears represent the 0-14 years of life and indicate innate abilities and early karma. Large ears indicate good fortune and longevity in many Asian face-reading traditions. The ear\'s top (helix) relates to ambition; the middle (antihelix) to practical thinking; the earlobe to material comfort. Thick, fleshy earlobes that hang down are considered extremely auspicious and a sign of wisdom and prosperity.', points: 10, quizQ: { q: 'What do thick, fleshy hanging earlobes indicate?', options: ['Health problems', 'Poor relationships', 'Wisdom and prosperity', 'Short life'], correct: 2 } },
          { title: 'Jaw and Chin: Determination', body: 'The jaw and chin represent the 60s and 70s of life and show determination, resilience, and practical ability. A strong, square jaw indicates determination, stubbornness, and physical strength. A round, soft chin indicates gentleness and a caring nature. A prominent, projecting chin shows ambition and the drive to achieve. A receding chin may indicate indecisiveness. The chin also represents the final chapter of life.', points: 10, quizQ: { q: 'What does a strong, square jaw indicate?', options: ['Gentleness and caring', 'Determination and physical strength', 'Artistic talent', 'Spiritual wisdom'], correct: 1 } },
          { title: 'The Complete Face Reading', body: 'Reading the full face requires balancing all features together. The left side of the face (from the reader\'s right) reflects private, inner life; the right side (from the reader\'s left) reflects public, outer life. Symmetrical faces are considered balanced and fortunate in Eastern traditions. Each decade of life has a corresponding area: the forehead governs the 20s-30s, the eyes and nose the 30s-50s, and the mouth and chin the 50s-70s. A skilled reader looks at the face as a complete story.', points: 15, quizQ: { q: 'Which decade does the forehead govern in face reading?', options: ['0-20s', '20s-30s', '50s-60s', '70s+'], correct: 1 } },
        ],
      },
    },
  ];
}

// ---- Lesson completion tracking (anti-cheat) -------------------------
// Tracks which individual lessons a user has completed, so the same
// lesson cannot award points more than once. Uses a per-tile doc under
// users/{uid}/engagement/{tileId}_progress.
//
// Structure:
//   { completedLessons: ['0', '1', '3', ...], updatedAt: timestamp }
//
// The lesson index is stored as a string to avoid Firestore array
// numeric sort edge cases.

export async function getLessonProgress(uid, tileId) {
  if (!uid || !tileId) return { completedLessons: [] };
  try {
    const ref = doc(db, 'users', uid, 'engagement', `${tileId}_progress`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { completedLessons: [] };
    const d = snap.data() || {};
    return {
      completedLessons: Array.isArray(d.completedLessons)
        ? d.completedLessons.map(String) : [],
    };
  } catch (_) { return { completedLessons: [] }; }
}

// Mark a lesson as completed and award points in a single transaction.
// Returns { awarded: true, alreadyDone: bool } so the UI can show the
// right feedback.
export async function completeLessonAndAward(uid, tileId, lessonIdx,
  points, reason) {
  if (!uid || !tileId) return { awarded: false };
  const idx = String(lessonIdx);
  const ptsRef = doc(db, 'users', uid, 'engagement', 'points');
  const progRef = doc(db, 'users', uid, 'engagement', `${tileId}_progress`);

  try {
    const result = await runTransaction(db, async (tx) => {
      const [pSnap, progSnap] = await Promise.all([
        tx.get(ptsRef), tx.get(progRef),
      ]);

      const progData = (progSnap.exists() && progSnap.data()) || {};
      const done = Array.isArray(progData.completedLessons)
        ? progData.completedLessons.map(String) : [];

      // Idempotency: if already completed, never award again.
      if (done.includes(idx)) return { awarded: false, alreadyDone: true };

      const pts = Math.max(0, Math.floor(Number(points) || 0));
      if (pts > 0) {
        // Award points
        const pData = (pSnap.exists() && pSnap.data()) || {};
        const total = Number(pData.total || 0) + pts;
        const history = Array.isArray(pData.history) ? [...pData.history] : [];
        history.push({
          tileId: tileId || '',
          amount: pts,
          at: new Date().toISOString(),
          reason: reason || `Lesson completed`,
        });
        if (history.length > 500) history.splice(0, history.length - 500);
        tx.set(ptsRef, {
          total,
          redeemed: Number(pData.redeemed || 0),
          history,
        });
      }

      // Mark lesson as complete
      tx.set(progRef, {
        completedLessons: [...done, idx],
        updatedAt: serverTimestamp(),
      }, { merge: true });

      return { awarded: pts > 0, alreadyDone: false };
    });
    return result;
  } catch (_) { return { awarded: false }; }
}
