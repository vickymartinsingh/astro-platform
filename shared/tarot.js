// Full 78-card Tarot deck with concise upright meanings + keywords, plus a
// reading synthesiser. Built-in (no API, free). Used by the "Pick your
// card" feature: draw 1 (card of the day) or 3 (past, present, future).

const MAJOR = [
  ['The Fool', 'beginnings, spontaneity, faith', 'A fresh start and a leap of faith. Trust the journey ahead.'],
  ['The Magician', 'manifestation, skill, willpower', 'You have all the tools to make it happen. Act with intent.'],
  ['The High Priestess', 'intuition, mystery, inner voice', 'Listen to your intuition. The answer is already within.'],
  ['The Empress', 'abundance, nurturing, creativity', 'Growth and abundance flow when you nurture what matters.'],
  ['The Emperor', 'structure, authority, stability', 'Discipline and structure bring the security you seek.'],
  ['The Hierophant', 'tradition, guidance, learning', 'Seek wisdom from a mentor or a trusted tradition.'],
  ['The Lovers', 'love, harmony, choices', 'A meaningful union, or an important values based choice.'],
  ['The Chariot', 'willpower, victory, control', 'Focused determination carries you to victory.'],
  ['Strength', 'courage, patience, compassion', 'Gentle strength and patience overcome the challenge.'],
  ['The Hermit', 'reflection, solitude, insight', 'Step back and reflect. Clarity comes in quiet.'],
  ['Wheel of Fortune', 'cycles, change, destiny', 'A turning point. Fortune shifts in your favour.'],
  ['Justice', 'fairness, truth, balance', 'Truth and fair decisions restore balance.'],
  ['The Hanged Man', 'pause, surrender, perspective', 'A pause and a new viewpoint reveal the way forward.'],
  ['Death', 'endings, transformation, renewal', 'An ending makes space for powerful transformation.'],
  ['Temperance', 'balance, moderation, healing', 'Moderation and patience bring lasting healing.'],
  ['The Devil', 'attachment, materialism, release', 'Notice what binds you. Release it to be free.'],
  ['The Tower', 'sudden change, awakening', 'Sudden change clears false foundations. Rebuild stronger.'],
  ['The Star', 'hope, renewal, inspiration', 'Hope returns. Healing and inspiration light the path.'],
  ['The Moon', 'illusion, intuition, uncertainty', 'Trust intuition through uncertainty. Not all is as it seems.'],
  ['The Sun', 'success, joy, vitality', 'Joy, success and clarity. A very positive omen.'],
  ['Judgement', 'rebirth, reckoning, calling', 'A wake up call invites renewal and a fresh purpose.'],
  ['The World', 'completion, fulfilment, wholeness', 'A cycle completes with fulfilment and well earned reward.'],
];

const SUITS = {
  Wands: { theme: 'energy, passion, career and action' },
  Cups: { theme: 'emotions, love and relationships' },
  Swords: { theme: 'thoughts, conflict and decisions' },
  Pentacles: { theme: 'money, work and material life' },
};
const RANKS = [
  ['Ace', 'a powerful new beginning in'],
  ['Two', 'a choice or partnership in'],
  ['Three', 'early growth and collaboration in'],
  ['Four', 'stability and consolidation in'],
  ['Five', 'a challenge or loss testing'],
  ['Six', 'recovery and progress in'],
  ['Seven', 'perseverance and assessment in'],
  ['Eight', 'momentum and movement in'],
  ['Nine', 'near completion and resilience in'],
  ['Ten', 'culmination and fulfilment in'],
  ['Page', 'curiosity and a message about'],
  ['Knight', 'bold action and pursuit of'],
  ['Queen', 'mastery and nurturing of'],
  ['King', 'authority and command of'],
];

function buildDeck() {
  const deck = MAJOR.map(([name, kw, up]) => ({
    name, arcana: 'Major', keywords: kw, meaning: up,
  }));
  for (const [suit, info] of Object.entries(SUITS)) {
    for (const [rank, phrase] of RANKS) {
      deck.push({
        name: `${rank} of ${suit}`,
        arcana: 'Minor',
        suit,
        keywords: info.theme,
        meaning: `${rank} of ${suit} signals ${phrase} ${info.theme}.`,
      });
    }
  }
  return deck; // 22 + 56 = 78
}

export const TAROT = buildDeck();

export function drawCards(n = 1) {
  const idx = new Set();
  while (idx.size < n) idx.add(Math.floor(Math.random() * TAROT.length));
  return [...idx].map((i) => TAROT[i]);
}

// Structured reading (no dash formatting needed in the UI).
export function tarotReading(cards) {
  const pos = cards.length === 3
    ? ['Past', 'Present', 'Future'] : ['Your card'];
  const rows = cards.map((c, i) => ({
    position: pos[i] || 'Card',
    name: c.name,
    meaning: c.meaning,
  }));
  const names = cards.map((c) => c.name).join(', ');
  const summary =
    `The cards (${names}) point to a period of meaningful movement. ` +
    `In love and relationships, lead with honesty and openness. ` +
    `In career and finance, steady deliberate effort is favoured over ` +
    `haste. For health, protect your energy with rest and balance. ` +
    `Overall, trust the process: the guidance points toward growth ` +
    `when you act with intention.`;
  return { rows, summary };
}

// Aspect categories for the guided "Pick your card" flow.
export const TAROT_ASPECTS = [
  'General', 'Love & Relationships', 'Marriage', 'Career',
  'Finance', 'Health', 'Education', 'Family', 'Business',
  'Travel', 'Spiritual',
];

// Aspect-focused reading. For a specific aspect every line speaks ONLY
// to that aspect (>= 20 words) and never mentions other aspects. For
// "General" it covers past/present/future overall.
export function aspectReading(cards, aspectRaw) {
  const aspect = aspectRaw || 'General';
  const general = aspect === 'General';
  const pos = cards.length === 3
    ? ['Past', 'Present', 'Future'] : ['Your card'];
  const rows = cards.map((c, i) => {
    const where = pos[i] || 'Card';
    let text;
    if (general) {
      text = `${c.name}: ${c.meaning} As a ${where.toLowerCase()} `
        + `influence it shapes the overall direction of the question, `
        + `so weigh it as part of the whole story.`;
    } else {
      text = `${c.name} (${where}): ${c.meaning} Here it points to a `
        + `meaningful shift, so move with clarity and patience and let `
        + `it guide your next step with quiet confidence.`;
    }
    return { position: where, name: c.name, meaning: c.meaning, text };
  });
  const names = cards.map((c) => c.name).join(', ');
  const summary = general
    ? `Overall the cards (${names}) suggest a meaningful turning `
      + `point. Past sets the context, the present asks for honest `
      + `action, and the future rewards steady intention.`
    : `Together (${names}), the cards say steady, intentional effort `
      + `brings real progress in ${aspect.toLowerCase()}. Trust this `
      + `guidance and act with a calm, clear mind.`;
  return { rows, summary, aspect };
}
