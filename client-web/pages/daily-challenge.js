import { useEffect, useState } from 'react';
import Link from 'next/link';
import { engagementService } from '@astro/shared';
import Layout from '../components/Layout';
import { useAuth } from '../lib/useAuth';
import { useAuthModal } from '../lib/authModal';

const MAROON = '#7F2020';
const AMBER = '#D4A12A';
const QUIZ_SECS = 30;

// Floating coin-burst animation when points are awarded.
function CoinPop({ pts, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]
      flex items-center justify-center">
      <div style={{
        background: 'linear-gradient(135deg,#D4A12A,#7F2020)',
        animation: 'coinPop 1.8s ease-out forwards',
      }} className="flex flex-col items-center gap-1 rounded-2xl
        px-8 py-5 text-white shadow-2xl">
        <span className="text-4xl">&#127775;</span>
        <span className="text-2xl font-extrabold">+{pts} pts</span>
        <span className="text-sm opacity-85">Points added!</span>
      </div>
      <style>{`
        @keyframes coinPop {
          0%  {opacity:0;transform:scale(.5) translateY(50px)}
          25% {opacity:1;transform:scale(1.1) translateY(-12px)}
          55% {opacity:1;transform:scale(1) translateY(0)}
          80% {opacity:1;transform:scale(1) translateY(0)}
          100%{opacity:0;transform:scale(.9) translateY(-25px)}
        }
      `}</style>
    </div>
  );
}

// -----------------------------------------------------------------
// Circular countdown timer. Re-mounts (resets) when `timerKey` changes.
// -----------------------------------------------------------------
function QuizTimer({ timerKey, onExpire }) {
  const [secs, setSecs] = useState(QUIZ_SECS);

  useEffect(() => {
    setSecs(QUIZ_SECS);
    const t = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) { clearInterval(t); onExpire(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = circ * (secs / QUIZ_SECS);
  const color = secs > 10 ? AMBER : '#ef4444';

  return (
    <svg width="60" height="60" viewBox="0 0 60 60" aria-label={`${secs} seconds remaining`}>
      <circle cx="30" cy="30" r={r} fill="none"
        stroke="#e5e7eb" strokeWidth="5" />
      <circle cx="30" cy="30" r={r} fill="none"
        stroke={color} strokeWidth="5"
        strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`}
        strokeLinecap="round"
        transform="rotate(-90 30 30)" />
      <text x="30" y="35" textAnchor="middle"
        fontSize="15" fontWeight="bold" fill={color}>
        {secs}
      </text>
    </svg>
  );
}

// -----------------------------------------------------------------
// Derive today's date string YYYY-MM-DD
// -----------------------------------------------------------------
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// -----------------------------------------------------------------
// Main page
// -----------------------------------------------------------------
export default function DailyChallenge() {
  const { user } = useAuth();
  const { openLogin } = useAuthModal();

  const [challenge, setChallenge] = useState(null); // today's challenge doc
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [prevResult, setPrevResult] = useState(null); // prior run result
  const [loading, setLoading] = useState(true);

  // Quiz state
  const [started, setStarted] = useState(false);
  const [qIdx, setQIdx] = useState(0);
  const [timerKey, setTimerKey] = useState(0);
  const [selected, setSelected] = useState(null);   // option index or null
  const [revealed, setRevealed] = useState(false);  // show answer feedback
  const [answered, setAnswered] = useState([]);     // accumulated per-Q results
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [showCoin, setShowCoin] = useState(false);

  const today = todayStr();

  // ----- load challenge + previous progress -----
  useEffect(() => {
    let active = true;
    setLoading(true);

    async function load() {
      try {
        const ch = await engagementService.getTodayChallenge();
        if (!active) return;
        setChallenge(ch || null);

        if (ch && user) {
          const prog = await engagementService.getDailyChallengeProgress(
            user.uid, today,
          );
          if (!active) return;
          if (prog && prog.completed) {
            setAlreadyDone(true);
            setPrevResult({
              correct: prog.correctCount || 0,
              total: prog.total || 0,
              totalBonus: prog.totalBonus || 0,
            });
          }
        }
      } catch (e) {
        // ignore load errors; show empty state
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user]);

  const questions = challenge?.questions || [];
  const totalQ = questions.length;
  const currentQ = questions[qIdx] || null;

  // ----- timer expire: count as missed -----
  function handleExpire() {
    if (revealed) return;
    setRevealed(true);
    setSelected(null); // null = timed out
  }

  // ----- user picks an option -----
  function handlePick(oi) {
    if (revealed) return;
    setSelected(oi);
    setRevealed(true);
  }

  // ----- advance to next question or finish -----
  function handleNext() {
    const isCorrect = selected !== null && selected === (currentQ?.correct ?? -1);
    const entry = {
      selected,
      correct: currentQ?.correct ?? 0,
      isCorrect,
      bonus: isCorrect ? (currentQ?.bonus || currentQ?.bonusPoints || 10) : 0,
    };
    const nextAnswered = [...answered, entry];
    setAnswered(nextAnswered);

    if (qIdx + 1 >= totalQ) {
      finishChallenge(nextAnswered);
    } else {
      setQIdx((n) => n + 1);
      setSelected(null);
      setRevealed(false);
      setTimerKey((k) => k + 1);
    }
  }

  // ----- submit completed challenge -----
  async function finishChallenge(answerArr) {
    const totalBonus = answerArr.reduce((s, a) => s + (a.bonus || 0), 0);
    const correctCount = answerArr.filter((a) => a.isCorrect).length;
    setDone(true);
    setResult({ totalBonus, correct: correctCount, total: answerArr.length });

    if (!user) return; // guest: show result but no points stored

    setSubmitBusy(true);
    try {
      // Pass answers in the normalised format the service accepts.
      // Server re-derives correctness from challengeQuestions to
      // prevent client-side manipulation.
      const questionAnswers = answerArr.map((a, i) => ({
        qIdx: i,
        selected: a.selected,   // option index chosen (null = timed out)
      }));
      const res = await engagementService.completeDailyChallenge(
        user.uid, today, questionAnswers, questions,
      );
      if (res && res.awarded > 0) setShowCoin(true);
    } catch (e) {
      // Points may not have been awarded; user can contact support.
      console.error('Daily challenge submit error:', e);
    } finally {
      setSubmitBusy(false);
    }
  }

  // ================================================================
  // Render states
  // ================================================================

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4
            border-amber-300 border-t-amber-600" />
        </div>
      </Layout>
    );
  }

  // No challenge today
  if (!challenge || !questions.length) {
    return (
      <Layout>
        <div className="mx-auto max-w-lg px-4 py-10 text-center">
          <div className="mb-4 text-5xl">&#127775;</div>
          <h1 className="mb-2 text-xl font-bold" style={{ color: MAROON }}>
            No challenge today
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            There is no daily challenge scheduled for today. Check back tomorrow!
          </p>
          <Link href="/"
            className="rounded-full px-6 py-2 text-sm font-bold text-white"
            style={{ backgroundColor: MAROON }}>
            Back to home
          </Link>
        </div>
      </Layout>
    );
  }

  // Already completed today
  if (alreadyDone && !done) {
    return (
      <Layout>
        <div className="mx-auto max-w-lg px-4 py-10 text-center">
          <div className="mb-4 text-5xl">&#127942;</div>
          <h1 className="mb-2 text-xl font-bold" style={{ color: MAROON }}>
            Already completed today!
          </h1>
          {prevResult && (
            <p className="mb-2 text-base text-gray-700">
              You scored{' '}
              <span className="font-bold" style={{ color: AMBER }}>
                {prevResult.correct}/{prevResult.total}
              </span>{' '}
              and earned{' '}
              <span className="font-bold" style={{ color: MAROON }}>
                +{prevResult.totalBonus} pts
              </span>{' '}
              bonus.
            </p>
          )}
          <p className="mb-6 text-sm text-gray-500">
            Come back tomorrow for a fresh challenge and more bonus points!
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/points"
              className="rounded-full border px-5 py-2 text-sm font-bold"
              style={{ borderColor: MAROON, color: MAROON }}>
              My Points
            </Link>
            <Link href="/"
              className="rounded-full px-5 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: MAROON }}>
              Home
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  // Finished this session
  if (done && result) {
    const pct = totalQ > 0 ? Math.round((result.correct / result.total) * 100) : 0;
    return (
      <Layout>
        {showCoin && (
          <CoinPop pts={result.totalBonus}
            onDone={() => setShowCoin(false)} />
        )}
        <div className="mx-auto max-w-lg px-4 py-10 text-center">
          <div className="mb-4 text-5xl">
            {pct >= 80 ? '&#127881;' : pct >= 50 ? '&#128077;' : '&#128170;'}
          </div>
          <h1 className="mb-2 text-2xl font-bold" style={{ color: MAROON }}>
            Challenge complete!
          </h1>
          <div className="mb-4 rounded-2xl p-5 text-white"
            style={{ background: `linear-gradient(135deg, ${MAROON} 0%, #4a1212 100%)` }}>
            <div className="text-lg font-bold">
              {result.correct} / {result.total} correct
            </div>
            <div className="mt-1 text-3xl font-extrabold">
              +{result.totalBonus}{' '}
              <span className="text-base font-normal opacity-70">bonus pts</span>
            </div>
            {submitBusy && (
              <div className="mt-2 text-xs opacity-70">
                Saving your points&#8230;
              </div>
            )}
            {!submitBusy && user && (
              <div className="mt-2 text-xs opacity-70">
                Points added to your balance.
              </div>
            )}
          </div>
          {!user && (
            <div className="mb-4 rounded-xl border border-amber-300
              bg-amber-50 p-3 text-sm text-amber-800">
              Sign in to save your points and track your progress.
              <button onClick={openLogin}
                className="ml-2 font-bold underline">
                Sign in
              </button>
            </div>
          )}

          {/* Per-question breakdown */}
          <div className="mb-6 space-y-2 text-left">
            {answered.map((a, i) => (
              <div key={i}
                className={`flex items-start gap-3 rounded-xl p-3 text-sm
                  ${a.isCorrect
                    ? 'bg-emerald-50 border border-emerald-200'
                    : 'bg-red-50 border border-red-200'}`}>
                <span className="mt-0.5 shrink-0 text-base">
                  {a.isCorrect ? '&#10004;' : '&#10008;'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800">
                    Q{i + 1}: {questions[i]?.q || ''}
                  </div>
                  {!a.isCorrect && (
                    <div className="mt-0.5 text-[11px] text-sub-text">
                      Correct: {(questions[i]?.options || [])[a.correct] || ''}
                    </div>
                  )}
                </div>
                <span className={`shrink-0 text-xs font-bold ${
                  a.isCorrect ? 'text-emerald-700' : 'text-red-400'}`}>
                  {a.isCorrect ? `+${a.bonus}pts` : '0 pts'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-3">
            <Link href="/points"
              className="rounded-full border px-5 py-2 text-sm font-bold"
              style={{ borderColor: MAROON, color: MAROON }}>
              View points
            </Link>
            <Link href="/"
              className="rounded-full px-5 py-2 text-sm font-bold text-white"
              style={{ backgroundColor: MAROON }}>
              Back to home
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  // Not started yet: intro screen
  if (!started) {
    return (
      <Layout>
        <div className="mx-auto max-w-lg px-4 py-8">
          <div className="mb-6 rounded-2xl p-5 text-white"
            style={{ background: `linear-gradient(135deg, ${MAROON} 0%, #4a1212 100%)` }}>
            <div className="text-[11px] uppercase tracking-widest opacity-70">
              Daily Challenge
            </div>
            <h1 className="mt-1 text-2xl font-extrabold">
              {totalQ} questions &middot; {todayStr()}
            </h1>
            <p className="mt-2 text-sm opacity-80">
              You have 30 seconds per question. Answer correctly to earn bonus points.
              Each challenge can only be completed once per day.
            </p>
          </div>

          <div className="mb-6 rounded-xl border border-amber-200
            bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold mb-1">How it works</p>
            <ul className="list-disc list-inside space-y-1 text-[13px]">
              <li>A 30-second timer starts with each question.</li>
              <li>Select the correct answer before time runs out.</li>
              <li>Earn bonus points only for correct answers.</li>
              <li>Wrong or expired answers score 0 pts for that question.</li>
              <li>You can still move through all questions regardless.</li>
            </ul>
          </div>

          {!user && (
            <div className="mb-4 rounded-xl border border-gray-200
              bg-gray-50 p-3 text-sm text-gray-600">
              You are not signed in. You can take the challenge as a guest
              but your points will not be saved.{' '}
              <button onClick={openLogin}
                className="font-bold underline" style={{ color: MAROON }}>
                Sign in
              </button>
            </div>
          )}

          <button onClick={() => setStarted(true)}
            className="w-full rounded-full py-3 text-base font-extrabold
              text-white shadow-md"
            style={{ backgroundColor: MAROON }}>
            Start Challenge
          </button>
        </div>
      </Layout>
    );
  }

  // ================================================================
  // Active quiz
  // ================================================================
  const progress = qIdx / totalQ;

  return (
    <Layout>
      <div className="mx-auto max-w-lg px-4 py-6">
        {/* Progress bar */}
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-[11px] text-gray-500">
            <span>Question {qIdx + 1} of {totalQ}</span>
            <span style={{ color: MAROON }}>Daily Challenge</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: AMBER,
              }} />
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl border border-gray-200 bg-white
          p-5 shadow-sm">
          {/* Timer + question text */}
          <div className="mb-4 flex items-start gap-4">
            <QuizTimer timerKey={timerKey} onExpire={handleExpire} />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: AMBER }}>
                Question {qIdx + 1}
              </div>
              <p className="mt-1 text-base font-semibold leading-snug
                text-gray-900">
                {currentQ?.q || ''}
              </p>
              {currentQ?.bonus > 0 && (
                <div className="mt-1 text-[11px]" style={{ color: MAROON }}>
                  +{currentQ.bonus} pts for correct answer
                </div>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {(currentQ?.options || []).map((opt, oi) => {
              let cls = 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100';
              if (revealed) {
                if (oi === (currentQ?.correct ?? -1)) {
                  cls = 'border-emerald-400 bg-emerald-50 text-emerald-800 font-bold';
                } else if (oi === selected && selected !== currentQ?.correct) {
                  cls = 'border-red-400 bg-red-50 text-red-700 line-through';
                } else {
                  cls = 'border-gray-100 bg-gray-50 text-gray-400';
                }
              } else if (selected === oi) {
                cls = 'border-amber-400 bg-amber-50 text-amber-900 font-semibold';
              }
              return (
                <button key={oi}
                  disabled={revealed}
                  onClick={() => handlePick(oi)}
                  className={`w-full rounded-xl border px-4 py-3 text-left
                    text-sm transition-colors disabled:cursor-default ${cls}`}>
                  <span className="mr-2 font-bold">
                    {String.fromCharCode(65 + oi)}.
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Feedback + next button */}
          {revealed && (
            <div className="mt-4">
              <div className={`mb-3 rounded-xl px-4 py-2 text-sm font-semibold
                ${selected !== null && selected === currentQ?.correct
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-red-50 text-red-700'}`}>
                {selected === null
                  ? '&#9203; Time\'s up! No points awarded.'
                  : selected === currentQ?.correct
                    ? `&#10004; Correct! +${currentQ?.bonus || 5} pts earned.`
                    : `&#10008; Wrong. The correct answer was: ${
                        (currentQ?.options || [])[currentQ?.correct] || ''}`}
              </div>
              <button onClick={handleNext}
                className="w-full rounded-full py-2.5 text-sm font-bold
                  text-white"
                style={{ backgroundColor: MAROON }}>
                {qIdx + 1 >= totalQ ? 'Finish' : 'Next question'}
              </button>
            </div>
          )}
        </div>

        {/* Abort link */}
        <div className="mt-4 text-center">
          <Link href="/"
            className="text-xs text-gray-400 underline hover:text-gray-600">
            Exit challenge
          </Link>
        </div>
      </div>
    </Layout>
  );
}
