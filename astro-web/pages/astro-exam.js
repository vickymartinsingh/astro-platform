// Astrologer onboarding exam. Shown after the astrologer submits their
// application (or on first login before the exam has been completed).
//
// Flow: 10 multiple-choice questions, 30 s timer per question.
// Timer turns amber under 10 s, red under 5 s. Auto-advances on
// timeout and marks the question wrong. After all 10 questions a
// results screen is shown and the score is saved to Firestore at
// astrologers/{uid}/examResult = { score, total, completedAt,
//   specialty, answers }.
//
// The question bank is keyed by specialty. Skills that match a known
// specialty key are used; otherwise "Vedic Astrology" is the default.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { doc, updateDoc } from 'firebase/firestore';
import { db, astrologerService } from '@astro/shared';
import { useRequireAstrologer } from '../lib/useAuth';

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------
const QUESTION_BANK = {
  'Vedic Astrology': [
    {
      q: 'Which planet is known as the "Yoga Karaka" for Taurus ascendant?',
      options: ['Saturn', 'Jupiter', 'Venus', 'Mercury'],
      answer: 'Saturn',
    },
    {
      q: 'Rahu is considered exalted in which sign?',
      options: ['Aries', 'Gemini', 'Taurus', 'Cancer'],
      answer: 'Taurus',
    },
    {
      q: 'Which house represents marriage and partnerships in Vedic astrology?',
      options: ['4th house', '5th house', '7th house', '9th house'],
      answer: '7th house',
    },
    {
      q: 'What is the name of the divisional chart used for career analysis?',
      options: [
        'Navamsa (D9)',
        'Dashamsa (D10)',
        'Dwadasamsa (D12)',
        'Shodasamsa (D16)',
      ],
      answer: 'Dashamsa (D10)',
    },
    {
      q: 'Which Nakshatra is ruled by Ketu?',
      options: ['Ashwini', 'Rohini', 'Pushya', 'Hasta'],
      answer: 'Ashwini',
    },
    {
      q: 'In Vedic astrology, what does "Atmakaraka" represent?',
      options: [
        'The planet of the soul',
        'The ruling planet',
        'The planet of karma',
        'The exalted planet',
      ],
      answer: 'The planet of the soul',
    },
    {
      q: 'Which planet rules the 12th house naturally?',
      options: ['Mars', 'Jupiter', 'Saturn', 'Neptune'],
      answer: 'Jupiter',
    },
    {
      q: 'What is "Ashtakavarga" used for in Vedic astrology?',
      options: [
        'Calculating planetary strengths',
        'Reading navamsa',
        'Predicting marriage',
        'Analyzing house lords',
      ],
      answer: 'Calculating planetary strengths',
    },
    {
      q: 'Which sign is considered the Moolatrikona of Jupiter?',
      options: ['Pisces', 'Sagittarius', 'Cancer', 'Gemini'],
      answer: 'Sagittarius',
    },
    {
      q: 'Vimsottari Dasha is a system based on:',
      options: [
        '120-year cycle',
        '108-year cycle',
        '100-year cycle',
        '108-month cycle',
      ],
      answer: '120-year cycle',
    },
  ],
  Numerology: [
    {
      q: 'Which number is associated with the planet Sun in Numerology?',
      options: ['1', '2', '3', '4'],
      answer: '1',
    },
    {
      q: 'In Pythagorean Numerology, which letter has the value 9?',
      options: ['I', 'R', 'Z', 'Both I and R'],
      answer: 'Both I and R',
    },
    {
      q: 'What is the Life Path Number for someone born on 29 November 1990?',
      options: ['5', '6', '7', '8'],
      answer: '5',
    },
    {
      q: 'Which master number is called the "Master Builder"?',
      options: ['11', '22', '33', '44'],
      answer: '22',
    },
    {
      q: 'The Expression Number is derived from:',
      options: [
        'Date of birth',
        'Full name at birth',
        'Current name',
        'Mother\'s name',
      ],
      answer: 'Full name at birth',
    },
    {
      q: 'Which number is known as the "Universal Number" or number of completion?',
      options: ['6', '7', '8', '9'],
      answer: '9',
    },
    {
      q: 'In Chaldean Numerology, the number 9 is assigned to which letter?',
      options: ['I', 'Z', 'No letter', 'R'],
      answer: 'No letter',
    },
    {
      q: 'The Soul Urge Number is calculated using:',
      options: [
        'All letters of the full name',
        'Consonants of the full name',
        'Vowels of the full name',
        'Date of birth only',
      ],
      answer: 'Vowels of the full name',
    },
    {
      q: 'Which number rules the planet Saturn in Numerology?',
      options: ['6', '7', '8', '9'],
      answer: '8',
    },
    {
      q: 'A person with Life Path 7 is typically associated with:',
      options: [
        'Leadership and ambition',
        'Introspection and spirituality',
        'Creativity and expression',
        'Practicality and hard work',
      ],
      answer: 'Introspection and spirituality',
    },
  ],
  'Tarot Reading': [
    {
      q: 'How many cards are in a standard Tarot deck?',
      options: ['52', '72', '78', '80'],
      answer: '78',
    },
    {
      q: 'The Major Arcana consists of how many cards?',
      options: ['14', '21', '22', '56'],
      answer: '22',
    },
    {
      q: 'Which card in the Major Arcana is numbered 0?',
      options: ['The Magician', 'The Fool', 'The World', 'The Sun'],
      answer: 'The Fool',
    },
    {
      q: 'What do the four suits of the Minor Arcana traditionally represent?',
      options: [
        'Earth, Air, Fire, Water',
        'Spring, Summer, Autumn, Winter',
        'Cups, Wands, Swords, Pentacles',
        'Love, Work, Health, Money',
      ],
      answer: 'Cups, Wands, Swords, Pentacles',
    },
    {
      q: 'The Tower card (XVI) typically represents:',
      options: [
        'Stability and security',
        'Sudden upheaval or revelation',
        'New beginnings',
        'Spiritual enlightenment',
      ],
      answer: 'Sudden upheaval or revelation',
    },
    {
      q: 'Which suit in Tarot is associated with the element of Water?',
      options: ['Wands', 'Swords', 'Pentacles', 'Cups'],
      answer: 'Cups',
    },
    {
      q: 'The High Priestess card is associated with:',
      options: [
        'Action and willpower',
        'Intuition and hidden knowledge',
        'Material wealth',
        'Logic and analysis',
      ],
      answer: 'Intuition and hidden knowledge',
    },
    {
      q: 'How many cards are in each Minor Arcana suit?',
      options: ['10', '12', '14', '16'],
      answer: '14',
    },
    {
      q: 'The Hermit card (IX) symbolises:',
      options: [
        'Community and togetherness',
        'Solitude and inner guidance',
        'Conflict and war',
        'Abundance and joy',
      ],
      answer: 'Solitude and inner guidance',
    },
    {
      q: 'In a Celtic Cross spread, how many cards are used?',
      options: ['7', '8', '10', '12'],
      answer: '10',
    },
  ],
  'Vastu Shastra': [
    {
      q: 'Which direction is considered the most auspicious for the main entrance of a home?',
      options: ['South', 'West', 'North or East', 'North-West'],
      answer: 'North or East',
    },
    {
      q: 'In Vastu, which direction is governed by the Lord of Water (Varuna)?',
      options: ['North', 'East', 'West', 'South'],
      answer: 'West',
    },
    {
      q: 'The Brahmasthan is located at:',
      options: [
        'North-East corner',
        'Centre of the building',
        'South-West corner',
        'North-West corner',
      ],
      answer: 'Centre of the building',
    },
    {
      q: 'Which direction is ideal for placing the kitchen in a house?',
      options: [
        'North-East',
        'South-East',
        'North-West',
        'South-West',
      ],
      answer: 'South-East',
    },
    {
      q: 'Vastu Shastra is primarily a science of:',
      options: [
        'Planetary movements',
        'Directional and spatial alignment',
        'Numerical vibrations',
        'Elemental healing',
      ],
      answer: 'Directional and spatial alignment',
    },
    {
      q: 'The North-East zone (Ishanya) is associated with which element?',
      options: ['Fire', 'Earth', 'Water', 'Air'],
      answer: 'Water',
    },
    {
      q: 'Which direction is considered ideal for the master bedroom?',
      options: [
        'North-East',
        'South-East',
        'South-West',
        'North-West',
      ],
      answer: 'South-West',
    },
    {
      q: 'According to Vastu, where should heavy furniture ideally be placed?',
      options: [
        'North and East walls',
        'South and West walls',
        'Centre of the room',
        'Near windows',
      ],
      answer: 'South and West walls',
    },
    {
      q: 'The Pancha Bhutas in Vastu represent:',
      options: [
        'Five planets',
        'Five elements',
        'Five directions',
        'Five deities',
      ],
      answer: 'Five elements',
    },
    {
      q: 'A toilet or bathroom in the North-East zone is considered:',
      options: [
        'Highly auspicious',
        'Neutral',
        'Highly inauspicious',
        'Beneficial for wealth',
      ],
      answer: 'Highly inauspicious',
    },
  ],
};

// Specialty-to-question-bank key mapping.
const SPECIALTY_MAP = {
  'vedic astrology': 'Vedic Astrology',
  'kp astrology': 'Vedic Astrology',
  'nadi astrology': 'Vedic Astrology',
  'western astrology': 'Vedic Astrology',
  'horary / prashna': 'Vedic Astrology',
  'lal kitab': 'Vedic Astrology',
  numerology: 'Numerology',
  'tarot reading': 'Tarot Reading',
  'vastu shastra': 'Vastu Shastra',
};

function resolveSpecialty(skills) {
  if (!Array.isArray(skills)) return 'Vedic Astrology';
  for (const s of skills) {
    const key = SPECIALTY_MAP[String(s || '').toLowerCase().trim()];
    if (key) return key;
  }
  return 'Vedic Astrology';
}

// ---------------------------------------------------------------------------
// Timer constants
// ---------------------------------------------------------------------------
const TOTAL_SECONDS = 30;

// ---------------------------------------------------------------------------
// Circular SVG timer
// ---------------------------------------------------------------------------
function CircleTimer({ seconds }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const progress = seconds / TOTAL_SECONDS;
  const offset = circ * (1 - progress);

  let strokeColor = '#7F2020';
  if (seconds <= 5) strokeColor = '#dc2626';
  else if (seconds <= 10) strokeColor = '#D4A12A';

  return (
    <div className="relative flex items-center justify-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="5"
        />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="5"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s linear, stroke 0.3s' }}
        />
      </svg>
      <span
        className="absolute text-lg font-extrabold"
        style={{
          color: strokeColor,
          transition: 'color 0.3s',
        }}
      >
        {seconds}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AstroExam() {
  const { user, profile, loading } = useRequireAstrologer();
  const router = useRouter();

  // Astrologer profile + exam state
  const [astro, setAstro] = useState(undefined);
  const [examResult, setExamResult] = useState(undefined); // null = no prior result
  const [specialty, setSpecialty] = useState('Vedic Astrology');
  const [questions, setQuestions] = useState([]);

  // Exam progress
  const [phase, setPhase] = useState('loading'); // loading | intro | exam | results
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(null); // selected option text for current q
  const [answers, setAnswers] = useState([]); // array of { question, selected, correct, timedOut }
  const [timeLeft, setTimeLeft] = useState(TOTAL_SECONDS);
  const [submitting, setSubmitting] = useState(false);

  const timerRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Load astrologer profile on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    astrologerService.getAstrologer(user.uid).then((a) => {
      setAstro(a || null);
      const sp = resolveSpecialty(a?.skills);
      setSpecialty(sp);
      setQuestions(QUESTION_BANK[sp] || QUESTION_BANK['Vedic Astrology']);
      // Check if exam already completed (field on astrologer doc)
      setExamResult(a?.examResult || null);
      setPhase('intro');
    }).catch(() => {
      setAstro(null);
      setSpecialty('Vedic Astrology');
      setQuestions(QUESTION_BANK['Vedic Astrology']);
      setExamResult(null);
      setPhase('intro');
    });
  }, [user]);

  // ---------------------------------------------------------------------------
  // Per-question timer
  // ---------------------------------------------------------------------------
  const advanceQuestion = useCallback((timedOut, currentSelected, currentAnswers) => {
    clearInterval(timerRef.current);
    const q = questions[qIndex];
    const isCorrect = !timedOut && currentSelected === q.answer;
    const newAnswers = [
      ...currentAnswers,
      {
        question: q.q,
        selected: timedOut ? null : currentSelected,
        correct: isCorrect,
        timedOut,
        correctAnswer: q.answer,
      },
    ];

    if (qIndex + 1 >= questions.length) {
      // All questions done - save + show results
      saveAndShowResults(newAnswers);
    } else {
      setAnswers(newAnswers);
      setQIndex((i) => i + 1);
      setSelected(null);
      setTimeLeft(TOTAL_SECONDS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, questions]);

  // Start timer when a new question is shown
  useEffect(() => {
    if (phase !== 'exam') return undefined;
    clearInterval(timerRef.current);
    setTimeLeft(TOTAL_SECONDS);
    let t = TOTAL_SECONDS;
    timerRef.current = setInterval(() => {
      t -= 1;
      setTimeLeft(t);
      if (t <= 0) {
        clearInterval(timerRef.current);
        // Pass current answers/selected via functional reads to avoid stale closures
        setAnswers((prevAnswers) => {
          setSelected((prevSelected) => {
            advanceQuestion(true, prevSelected, prevAnswers);
            return prevSelected;
          });
          return prevAnswers;
        });
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIndex]);

  // ---------------------------------------------------------------------------
  // Save results to Firestore
  // ---------------------------------------------------------------------------
  async function saveAndShowResults(finalAnswers) {
    setPhase('results');
    setAnswers(finalAnswers);
    if (!user) return;
    const score = finalAnswers.filter((a) => a.correct).length;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'astrologers', user.uid), {
        examResult: {
          score,
          total: finalAnswers.length,
          completedAt: Date.now(),
          specialty,
          answers: finalAnswers,
        },
      });
    } catch (_) {
      // Non-blocking - results still shown to user
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // User actions
  // ---------------------------------------------------------------------------
  function startExam() {
    setAnswers([]);
    setQIndex(0);
    setSelected(null);
    setTimeLeft(TOTAL_SECONDS);
    setPhase('exam');
  }

  function handleSelect(option) {
    if (selected) return; // already picked, wait for Next
    setSelected(option);
  }

  function handleNext() {
    if (!selected) return;
    setAnswers((prev) => {
      advanceQuestion(false, selected, prev);
      return prev;
    });
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading || phase === 'loading' || astro === undefined) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: '#FFF8E7' }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: '#7F2020', borderTopColor: 'transparent' }}
          />
          <p className="text-sm" style={{ color: '#7F2020' }}>
            Preparing exam...
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Already completed - show existing result
  // ---------------------------------------------------------------------------
  if (phase === 'intro' && examResult) {
    return (
      <ExamShell>
        <div className="mx-auto max-w-md text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center
              rounded-full"
            style={{ background: '#7F2020' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFF8E7" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1
            className="text-2xl font-extrabold mb-2"
            style={{ color: '#7F2020' }}
          >
            Exam Already Completed
          </h1>
          <p className="text-sm mb-4" style={{ color: '#5a3a1a' }}>
            You scored{' '}
            <span className="font-bold" style={{ color: '#D4A12A' }}>
              {examResult.score}/{examResult.total}
            </span>{' '}
            on your {examResult.specialty} exam.
          </p>
          <div
            className="mb-6 rounded-2xl border px-6 py-4 text-sm"
            style={{
              background: '#fffbf0',
              borderColor: '#D4A12A',
              color: '#5a3a1a',
            }}
          >
            Results submitted to admin for review.
          </div>
          <button
            type="button"
            onClick={() => router.push('/astro-dashboard')}
            className="w-full rounded-2xl py-3 font-bold text-white shadow-sm
              transition hover:opacity-90"
            style={{ background: '#7F2020' }}
          >
            Back to Dashboard
          </button>
        </div>
      </ExamShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Intro screen
  // ---------------------------------------------------------------------------
  if (phase === 'intro') {
    return (
      <ExamShell>
        <div className="mx-auto max-w-md text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center
              rounded-full"
            style={{ background: '#7F2020' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFF8E7" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1
            className="text-2xl font-extrabold mb-1"
            style={{ color: '#7F2020' }}
          >
            Onboarding Exam
          </h1>
          <p
            className="text-sm mb-1 font-semibold"
            style={{ color: '#D4A12A' }}
          >
            {specialty}
          </p>
          <p className="mb-6 text-sm" style={{ color: '#5a3a1a' }}>
            You will be shown 10 multiple-choice questions. Each question has
            a 30-second timer. The exam cannot be paused once started.
          </p>

          <div
            className="mb-6 grid grid-cols-3 gap-3 rounded-2xl border p-4"
            style={{ borderColor: '#D4A12A', background: '#fffbf0' }}
          >
            <div className="text-center">
              <p
                className="text-2xl font-extrabold"
                style={{ color: '#7F2020' }}
              >
                10
              </p>
              <p className="text-xs font-semibold" style={{ color: '#5a3a1a' }}>
                Questions
              </p>
            </div>
            <div className="text-center">
              <p
                className="text-2xl font-extrabold"
                style={{ color: '#7F2020' }}
              >
                30s
              </p>
              <p className="text-xs font-semibold" style={{ color: '#5a3a1a' }}>
                Per question
              </p>
            </div>
            <div className="text-center">
              <p
                className="text-2xl font-extrabold"
                style={{ color: '#7F2020' }}
              >
                MCQ
              </p>
              <p className="text-xs font-semibold" style={{ color: '#5a3a1a' }}>
                4 options each
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={startExam}
            className="w-full rounded-2xl py-3 font-bold text-white shadow-md
              transition hover:opacity-90 active:scale-[.97]"
            style={{ background: '#7F2020' }}
          >
            Start Exam
          </button>
          <button
            type="button"
            onClick={() => router.push('/astro-dashboard')}
            className="mt-3 w-full rounded-2xl border py-3 text-sm
              font-semibold transition hover:bg-gray-50"
            style={{ borderColor: '#D4A12A', color: '#7F2020' }}
          >
            Take later (go to Dashboard)
          </button>
        </div>
      </ExamShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Results screen
  // ---------------------------------------------------------------------------
  if (phase === 'results') {
    const score = answers.filter((a) => a.correct).length;
    const percent = Math.round((score / answers.length) * 100);
    const passed = percent >= 60;

    return (
      <ExamShell>
        <div className="mx-auto max-w-lg">
          {/* Score card */}
          <div
            className="mb-6 overflow-hidden rounded-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg, #7F2020 0%, #5a1616 100%)' }}
          >
            <div className="px-6 py-8 text-center text-white">
              <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1">
                Exam Result
              </p>
              <p className="text-sm font-semibold opacity-80 mb-3">{specialty}</p>
              <div
                className="mx-auto flex h-28 w-28 items-center justify-center
                  rounded-full border-4 mb-4"
                style={{
                  borderColor: '#D4A12A',
                  background: 'rgba(0,0,0,0.2)',
                }}
              >
                <div>
                  <div className="text-4xl font-extrabold leading-none">
                    {score}
                  </div>
                  <div className="text-sm opacity-70">/ {answers.length}</div>
                </div>
              </div>
              <p
                className="text-xl font-extrabold"
                style={{ color: '#D4A12A' }}
              >
                {percent}%
              </p>
              <p className="mt-1 text-sm opacity-80">
                {passed
                  ? 'Good performance! Results sent for admin review.'
                  : 'Results submitted. Admin will review your application.'}
              </p>
            </div>
          </div>

          {/* Submitted notice */}
          <div
            className="mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3"
            style={{ borderColor: '#D4A12A', background: '#fffbf0' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#D4A12A" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 shrink-0 mt-0.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-sm font-semibold" style={{ color: '#5a3a1a' }}>
              {submitting
                ? 'Saving results...'
                : 'Results submitted to admin for review.'}
            </p>
          </div>

          {/* Answer breakdown */}
          <h2
            className="mb-3 text-sm font-bold uppercase tracking-wider"
            style={{ color: '#7F2020' }}
          >
            Answer Breakdown
          </h2>
          <div className="space-y-2 mb-6">
            {answers.map((a, i) => (
              <div
                key={i}
                className="rounded-2xl border px-4 py-3"
                style={{
                  borderColor: a.correct ? '#16a34a33' : '#dc262633',
                  background: a.correct ? '#f0fdf4' : '#fef2f2',
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center
                      justify-center rounded-full text-[10px] font-bold text-white"
                    style={{
                      background: a.correct ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 mb-1">
                      {a.question}
                    </p>
                    {a.timedOut ? (
                      <p className="text-[11px] font-semibold text-amber-700">
                        Time expired - marked wrong
                      </p>
                    ) : (
                      <p
                        className="text-[11px] font-semibold"
                        style={{ color: a.correct ? '#16a34a' : '#dc2626' }}
                      >
                        Your answer: {a.selected}
                      </p>
                    )}
                    {!a.correct && (
                      <p className="text-[11px] text-gray-600">
                        Correct: {a.correctAnswer}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => router.push('/astro-dashboard')}
            className="w-full rounded-2xl py-3 font-bold text-white shadow-sm
              transition hover:opacity-90"
            style={{ background: '#7F2020' }}
          >
            Back to Dashboard
          </button>
        </div>
      </ExamShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Exam screen
  // ---------------------------------------------------------------------------
  const currentQ = questions[qIndex];
  if (!currentQ) return null;

  return (
    <ExamShell>
      <div className="mx-auto max-w-lg">
        {/* Progress bar + header row */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: '#7F2020' }}>
                Question {qIndex + 1} of {questions.length}
              </span>
              <span className="text-xs" style={{ color: '#D4A12A' }}>
                {specialty}
              </span>
            </div>
            {/* Progress bar */}
            <div
              className="h-2 w-full rounded-full overflow-hidden"
              style={{ background: '#e5e7eb' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${(qIndex / questions.length) * 100}%`,
                  background: 'linear-gradient(90deg, #7F2020 0%, #D4A12A 100%)',
                }}
              />
            </div>
          </div>
          <CircleTimer seconds={timeLeft} />
        </div>

        {/* Question card */}
        <div
          className="mb-5 rounded-2xl px-5 py-5 shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #7F2020 0%, #5a1616 100%)',
          }}
        >
          <p className="text-base font-bold leading-snug text-white">
            {currentQ.q}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-5">
          {currentQ.options.map((opt) => {
            const isSelected = selected === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => handleSelect(opt)}
                disabled={!!selected}
                className="w-full rounded-2xl border-2 px-4 py-3.5 text-left
                  text-sm font-semibold transition active:scale-[.98]"
                style={{
                  borderColor: isSelected ? '#D4A12A' : '#e5e7eb',
                  background: isSelected ? '#fffbf0' : '#ffffff',
                  color: isSelected ? '#7F2020' : '#1f2937',
                  cursor: selected ? (isSelected ? 'default' : 'not-allowed') : 'pointer',
                  opacity: selected && !isSelected ? 0.55 : 1,
                }}
              >
                <span
                  className="mr-3 inline-flex h-6 w-6 items-center justify-center
                    rounded-full text-xs font-bold"
                  style={{
                    background: isSelected ? '#D4A12A' : '#f3f4f6',
                    color: isSelected ? '#ffffff' : '#6b7280',
                  }}
                >
                  {String.fromCharCode(65 + currentQ.options.indexOf(opt))}
                </span>
                {opt}
              </button>
            );
          })}
        </div>

        {/* Next button - appears after selecting an option */}
        {selected && (
          <button
            type="button"
            onClick={handleNext}
            className="w-full rounded-2xl py-3.5 font-bold text-white shadow-sm
              transition hover:opacity-90 active:scale-[.97]"
            style={{ background: '#7F2020' }}
          >
            {qIndex + 1 === questions.length ? 'Submit Exam' : 'Next Question'}
          </button>
        )}

        {/* Timer warning */}
        {!selected && timeLeft <= 10 && (
          <p
            className="text-center text-xs font-bold animate-pulse"
            style={{ color: timeLeft <= 5 ? '#dc2626' : '#D4A12A' }}
          >
            {timeLeft <= 5
              ? 'Hurry! Almost out of time.'
              : 'Select an answer quickly.'}
          </p>
        )}
      </div>
    </ExamShell>
  );
}

// ---------------------------------------------------------------------------
// Wrapper: full-screen no-navigation shell
// ---------------------------------------------------------------------------
function ExamShell({ children }) {
  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{ background: '#FFF8E7' }}
    >
      {/* Top brand strip */}
      <div
        className="mb-6 flex items-center justify-center gap-2"
      >
        <div
          className="h-8 w-8 rounded-full flex items-center justify-center"
          style={{ background: '#7F2020' }}
        >
          <svg viewBox="0 0 24 24" fill="#D4A12A" className="w-5 h-5">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </div>
        <span className="text-base font-extrabold" style={{ color: '#7F2020' }}>
          AstroSeer
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase
            tracking-wide"
          style={{ background: '#7F2020', color: '#D4A12A' }}
        >
          Onboarding Exam
        </span>
      </div>
      {children}
    </div>
  );
}
