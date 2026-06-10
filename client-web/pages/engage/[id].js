import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { engagementService } from '@astro/shared';
import Layout from '../../components/Layout';
import { SkeletonList } from '../../components/Skeleton';
import { useOptionalClient } from '../../lib/useAuth';
import { useAuthModal } from '../../lib/authModal';
import { Icon } from '../../components/Icons';

const MAROON = '#7F2020';
const AMBER = '#D4A12A';
const CREAM = '#FFF8E7';

// Quiz only appears at specific lesson indices (0-based).
// Pattern: lessons 3, 5, 8, 11, then every 5th after (16, 21, 26 ...).
const QUIZ_LESSON_INDICES = new Set([
  2, 4, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99,
]);
function isQuizLesson(idx) { return QUIZ_LESSON_INDICES.has(idx); }

function PointsBadge({ pts }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5
      text-xs font-bold" style={{ backgroundColor: MAROON, color: CREAM }}>
      +{pts} pts
    </span>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard"
      className="mb-4 inline-flex items-center gap-1 text-sm font-medium"
      style={{ color: MAROON }}>
      &larr; Back to Home
    </Link>
  );
}

// ---- 30-second countdown timer for quizzes ----------------------------
function QuizTimer({ onExpire, timerKey }) {
  const [secs, setSecs] = useState(30);
  const expired = useRef(false);

  useEffect(() => {
    setSecs(30);
    expired.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  useEffect(() => {
    if (secs <= 0) {
      if (!expired.current) { expired.current = true; onExpire(); }
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs, onExpire]);

  const pct = (secs / 30) * 100;
  const colour = secs > 10 ? '#4CAF50' : secs > 5 ? AMBER : '#E53935';
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-8 w-8">
        <svg viewBox="0 0 32 32" className="h-8 w-8 -rotate-90">
          <circle cx="16" cy="16" r="13" fill="none"
            stroke="#E5E5E5" strokeWidth="3" />
          <circle cx="16" cy="16" r="13" fill="none"
            stroke={colour} strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 13}`}
            strokeDashoffset={`${2 * Math.PI * 13 * (1 - pct / 100)}`}
            style={{ transition: 'stroke-dashoffset 0.9s linear' }} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center
          text-[10px] font-bold" style={{ color: colour }}>
          {secs}
        </span>
      </div>
      <span className="text-xs text-gray-500">seconds left</span>
    </div>
  );
}

// ---- Inline quiz question after reading a lesson ----------------------
function LessonQuiz({ quizQ, lessonIdx, tileId, onResult }) {
  const [picked, setPicked] = useState(null);
  const [timeUp, setTimeUp] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const resultFiredRef = useRef(false);

  const fireResult = (correct) => {
    if (resultFiredRef.current) return;
    resultFiredRef.current = true;
    onResult(correct);
  };

  const handleExpire = () => {
    if (submitted) return;
    setTimeUp(true);
    setSubmitted(true);
    fireResult(false);
  };

  const pick = (idx) => {
    if (picked !== null || submitted) return;
    setPicked(idx);
    setSubmitted(true);
    fireResult(idx === quizQ.correct);
  };

  return (
    <div className="mt-4 rounded-xl border-2 p-4"
      style={{ borderColor: AMBER, backgroundColor: '#FFFDF5' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide"
          style={{ color: AMBER }}>
          Quick check: answer to earn points
        </span>
        {!submitted && <QuizTimer onExpire={handleExpire} />}
      </div>
      <p className="mb-3 text-sm font-semibold" style={{ color: MAROON }}>
        {quizQ.q}
      </p>
      <div className="flex flex-col gap-2">
        {quizQ.options.map((opt, oi) => {
          let bg = '#F5F5F5';
          let border = '#E0E0E0';
          let fg = '#333';
          if (submitted || timeUp) {
            if (oi === quizQ.correct) {
              bg = '#E8F5E9'; border = '#4CAF50'; fg = '#2E7D32';
            } else if (oi === picked && picked !== quizQ.correct) {
              bg = '#FFEBEE'; border = '#E53935'; fg = '#B71C1C';
            }
          } else if (oi === picked) {
            bg = '#F3E5F5'; border = MAROON; fg = MAROON;
          }
          return (
            <button key={oi} type="button" onClick={() => pick(oi)}
              disabled={submitted || timeUp}
              className="rounded-lg px-4 py-2.5 text-left text-sm
                font-medium transition disabled:cursor-default"
              style={{ backgroundColor: bg, border: `2px solid ${border}`,
                color: fg }}>
              {opt}
            </button>
          );
        })}
      </div>
      {submitted && (
        <div className={`mt-3 rounded-lg p-3 text-sm font-semibold
          ${picked === quizQ.correct
            ? 'bg-green-50 text-green-800'
            : timeUp && picked === null
              ? 'bg-gray-100 text-gray-600'
              : 'bg-red-50 text-red-800'}`}>
          {timeUp && picked === null
            ? 'Time ran out. No points this time. Keep reading and try again!'
            : picked === quizQ.correct
              ? 'Correct! Points awarded.'
              : 'Incorrect. No points this round, but you can proceed.'}
        </div>
      )}
    </div>
  );
}

// ---- Learn view: read lesson, quiz only at specific indices ----------
function LearnView({ tile, user, completedLessons, onLessonComplete }) {
  const lessons = tile.content?.lessons || [];
  const firstIncomplete = lessons.findIndex(
    (_, i) => !completedLessons.includes(String(i)));
  const [activeIdx, setActiveIdx] = useState(
    firstIncomplete >= 0 ? firstIncomplete : 0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [canProceed, setCanProceed] = useState(false);

  useEffect(() => {
    setShowQuiz(false);
    setCanProceed(false);
  }, [activeIdx]);

  const lesson = lessons[activeIdx];
  const isDone = completedLessons.includes(String(activeIdx));
  const total = lessons.length;

  const handleContinue = () => {
    if (lesson?.quizQ && isQuizLesson(activeIdx) && !isDone) {
      setShowQuiz(true);
    } else {
      if (!isDone) {
        onLessonComplete(
          activeIdx,
          lesson?.points || tile.pointsPerActivity || 10,
          `Lesson: ${lesson?.title || ''}`,
        );
      }
      setCanProceed(true);
    }
  };

  const handleQuizResult = (correct) => {
    const pts = correct ? (lesson.points || tile.pointsPerActivity || 10) : 0;
    onLessonComplete(activeIdx, pts, `Lesson: ${lesson.title}`);
    setCanProceed(true);
  };

  const goPrev = () => { if (activeIdx > 0) setActiveIdx((i) => i - 1); };
  const goNext = () => { if (activeIdx + 1 < total) setActiveIdx((i) => i + 1); };

  const allDone = lessons.every((_, i) => completedLessons.includes(String(i)));

  if (allDone) {
    return (
      <div className="surface rounded-xl p-6 text-center">
        <div className="mb-2 text-4xl">&#127881;</div>
        <h3 className="mb-1 text-lg font-bold" style={{ color: MAROON }}>
          Course Complete!
        </h3>
        <p className="text-sm text-gray-600">
          You have finished all {total} lessons. Great work!
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Progress */}
      <div>
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>Lesson {activeIdx + 1} of {total}</span>
          <span>{completedLessons.length} of {total} completed</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full transition-all"
            style={{
              width: `${(completedLessons.length / total) * 100}%`,
              backgroundColor: AMBER,
            }} />
        </div>
      </div>

      {/* Lesson card */}
      <div className="surface rounded-xl p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-base font-bold leading-snug" style={{ color: MAROON }}>
            {lesson.title}
          </h3>
          {isDone ? (
            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5
              text-xs font-bold text-green-700">
              &#10003; Done
            </span>
          ) : (
            <span className="shrink-0">
              <PointsBadge pts={lesson.points || tile.pointsPerActivity || 10} />
            </span>
          )}
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          {lesson.body}
        </p>

        {/* Action button */}
        {!isDone && !showQuiz && !canProceed && (
          <div className="mt-4">
            <button type="button" onClick={handleContinue}
              className="w-full rounded-lg py-3 text-sm font-bold
                text-white transition"
              style={{ backgroundColor: MAROON }}>
              {lesson.quizQ && isQuizLesson(activeIdx)
                ? 'Answer the question'
                : 'Mark as complete'}
            </button>
          </div>
        )}

        {/* Quiz */}
        {showQuiz && !canProceed && lesson.quizQ && (
          <LessonQuiz
            quizQ={lesson.quizQ}
            lessonIdx={activeIdx}
            tileId={tile.id}
            onResult={handleQuizResult}
          />
        )}
      </div>

      {/* Prev / Next navigation */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={goPrev}
          disabled={activeIdx === 0}
          className="flex-1 rounded-lg py-2.5 text-sm font-semibold
            transition disabled:opacity-30"
          style={{ backgroundColor: CREAM, color: MAROON,
            border: `1.5px solid ${MAROON}` }}>
          Previous
        </button>
        {(canProceed || isDone) && activeIdx + 1 < total ? (
          <button type="button" onClick={goNext}
            className="flex-1 rounded-lg py-2.5 text-sm font-bold
              text-white transition"
            style={{ backgroundColor: AMBER }}>
            Next lesson
          </button>
        ) : (
          <button type="button" onClick={goNext}
            disabled={!(canProceed || isDone) || activeIdx + 1 >= total}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold
              transition disabled:opacity-30"
            style={{ backgroundColor: CREAM, color: MAROON,
              border: `1.5px solid ${MAROON}` }}>
            {activeIdx + 1 >= total ? 'Last lesson' : 'Next lesson'}
          </button>
        )}
      </div>

      {/* Compact lesson number pills for direct navigation (up to 30) */}
      {total > 1 && total <= 30 && (
        <div className="no-scrollbar flex flex-wrap gap-1.5 pb-1">
          {lessons.map((l, i) => {
            const done = completedLessons.includes(String(i));
            const active = i === activeIdx;
            return (
              <button key={i} type="button"
                onClick={() => setActiveIdx(i)}
                className="flex h-7 w-7 items-center justify-center rounded-full
                  text-[11px] font-bold transition"
                style={{
                  backgroundColor: active ? MAROON : done ? '#E8F5E9' : '#F5F5F5',
                  color: active ? CREAM : done ? '#2E7D32' : '#888',
                  border: `1.5px solid ${active ? MAROON : done ? '#4CAF50' : '#DDD'}`,
                }}>
                {i + 1}
              </button>
            );
          })}
        </div>
      )}
      {total > 30 && (
        <p className="text-center text-xs text-gray-400">
          Use Previous and Next to navigate all {total} lessons
        </p>
      )}
    </div>
  );
}

// ---- Quiz tile with 30-second timer per question ----------------------
function QuizView({ tile, user, onAward }) {
  const questions = tile.content?.questions || [];
  const [qIdx, setQIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [timeUp, setTimeUp] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [timerKey, setTimerKey] = useState(0); // remount timer per question

  const q = questions[qIdx];

  const submit = (optIdx, expired) => {
    if (submitted) return;
    setPicked(optIdx);
    setSubmitted(true);
    if (expired) { setTimeUp(true); return; }
    const correct = optIdx === q.correct;
    if (correct) {
      const pts = q.points || tile.pointsPerActivity || 15;
      setScore((s) => s + pts);
      onAward(tile.id, pts, `Quiz correct: Q${qIdx + 1}`);
    }
  };

  const handleExpire = () => submit(null, true);

  const next = () => {
    if (qIdx + 1 >= questions.length) { setFinished(true); return; }
    setQIdx((i) => i + 1);
    setPicked(null);
    setTimeUp(false);
    setSubmitted(false);
    setTimerKey((k) => k + 1);
  };

  if (!questions.length) {
    return (
      <div className="surface rounded-xl p-6 text-center text-sm text-gray-500">
        No questions available yet. Check back soon.
      </div>
    );
  }

  if (finished) {
    return (
      <div className="surface rounded-xl p-6 text-center">
        <div className="mb-2 text-4xl">&#127881;</div>
        <h3 className="mb-1 text-lg font-bold" style={{ color: MAROON }}>
          Quiz Complete!
        </h3>
        <p className="mb-4 text-sm text-gray-600">
          You earned{' '}
          <strong style={{ color: AMBER }}>{score} points</strong>
          {' '}from {questions.length} questions.
        </p>
        <button type="button" onClick={() => {
          setQIdx(0); setPicked(null); setTimeUp(false);
          setSubmitted(false); setScore(0); setFinished(false);
          setTimerKey((k) => k + 1);
        }}
          className="rounded-lg px-5 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: MAROON }}>
          Play again
        </button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div className="surface rounded-xl p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Question {qIdx + 1} of {questions.length}
        </span>
        <span style={{ color: AMBER, fontWeight: 700 }}>{score} pts</span>
      </div>

      {/* Timer - remounts with a fresh key for each question */}
      {!submitted && (
        <div className="mb-3">
          <QuizTimer key={timerKey} onExpire={handleExpire} />
        </div>
      )}

      <h3 className="mb-4 font-bold" style={{ color: MAROON }}>{q.q}</h3>
      <div className="flex flex-col gap-2">
        {q.options.map((opt, oi) => {
          let bg = '#F9F9F9';
          let border = '#E5E5E5';
          let fg = '#333';
          if (submitted) {
            if (oi === q.correct) {
              bg = '#E8F5E9'; border = '#4CAF50'; fg = '#2E7D32';
            } else if (oi === picked) {
              bg = '#FFEBEE'; border = '#E53935'; fg = '#B71C1C';
            }
          }
          return (
            <button key={oi} type="button" onClick={() => submit(oi, false)}
              disabled={submitted}
              className="rounded-lg px-4 py-3 text-left text-sm
                font-medium transition disabled:cursor-default"
              style={{ backgroundColor: bg,
                border: `2px solid ${border}`, color: fg }}>
              {opt}
            </button>
          );
        })}
      </div>

      {submitted && (
        <>
          <div className={`mt-3 rounded-lg p-3 text-sm font-semibold
            ${timeUp && picked === null
              ? 'bg-gray-100 text-gray-600'
              : picked === q.correct
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-800'}`}>
            {timeUp && picked === null
              ? 'Time ran out. No points.'
              : picked === q.correct
                ? `Correct! +${q.points || tile.pointsPerActivity || 15} pts`
                : 'Incorrect. No points — but keep going!'}
          </div>
          <button type="button" onClick={next}
            className="mt-4 w-full rounded-lg py-2 text-sm font-semibold
              text-white"
            style={{ backgroundColor: AMBER }}>
            {qIdx + 1 >= questions.length ? 'See results' : 'Next question'}
          </button>
        </>
      )}
    </div>
  );
}

// ---- Manifestation / Affirmation (timed gate) ------------------------
function ManifestView({ tile, user, onAward }) {
  const affirmations = tile.content?.affirmations || [];
  const [idx, setIdx] = useState(0);
  const [affirmed, setAffirmed] = useState({});
  const [readSecs, setReadSecs] = useState(8);
  const [readReady, setReadReady] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    setReadReady(false);
    setReadSecs(8);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setReadSecs((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          setReadReady(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [idx]);

  const a = affirmations[idx];
  if (!a) return null;

  const doAffirm = () => {
    if (affirmed[idx] || !readReady) return;
    setAffirmed((prev) => ({ ...prev, [idx]: true }));
    const pts = a.points || tile.pointsPerActivity || 5;
    onAward(tile.id, pts, 'Affirmation read');
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="surface w-full rounded-xl p-6 text-center">
        <div className="mb-3 text-3xl">&#127775;</div>
        <p className="mb-4 text-base font-medium italic leading-relaxed"
          style={{ color: MAROON }}>
          &ldquo;{a.text}&rdquo;
        </p>
        <PointsBadge pts={a.points || tile.pointsPerActivity || 5} />
      </div>
      <div className="flex gap-3">
        <button type="button"
          disabled={idx === 0}
          onClick={() => setIdx((i) => i - 1)}
          className="rounded-lg px-4 py-2 text-sm font-semibold
            transition disabled:opacity-30"
          style={{ backgroundColor: CREAM, color: MAROON }}>
          Previous
        </button>
        {affirmed[idx] ? (
          <span className="rounded-lg px-5 py-2 text-sm font-semibold
            bg-green-100 text-green-800">
            &#10003; Affirmed
          </span>
        ) : readReady ? (
          <button type="button" onClick={doAffirm}
            className="rounded-lg px-5 py-2 text-sm font-semibold
              text-white transition"
            style={{ backgroundColor: MAROON }}>
            I affirm this
          </button>
        ) : (
          <span className="rounded-lg bg-amber-50 px-5 py-2 text-sm
            text-amber-700">
            Read in {readSecs}s...
          </span>
        )}
        <button type="button"
          disabled={idx >= affirmations.length - 1}
          onClick={() => setIdx((i) => i + 1)}
          className="rounded-lg px-4 py-2 text-sm font-semibold
            transition disabled:opacity-30"
          style={{ backgroundColor: CREAM, color: MAROON }}>
          Next
        </button>
      </div>
      <span className="text-xs text-gray-400">
        {idx + 1} of {affirmations.length}
      </span>
    </div>
  );
}

// ---- Comic (timed view gate) ------------------------------------------
function ComicView({ tile, user, onAward }) {
  const strips = tile.content?.strips || [];
  const [viewed, setViewed] = useState({});
  const [viewSecs, setViewSecs] = useState({});
  const [viewReady, setViewReady] = useState({});

  const startTimer = (i) => {
    if (viewReady[i] || viewSecs[i] != null) return;
    setViewSecs((prev) => ({ ...prev, [i]: 6 }));
    const iv = setInterval(() => {
      setViewSecs((prev) => {
        const next = Math.max(0, (prev[i] || 6) - 1);
        if (next <= 0) {
          clearInterval(iv);
          setViewReady((r) => ({ ...r, [i]: true }));
        }
        return { ...prev, [i]: next };
      });
    }, 1000);
  };

  const markViewed = (i) => {
    if (viewed[i] || !viewReady[i]) return;
    setViewed((prev) => ({ ...prev, [i]: true }));
    const pts = strips[i]?.points || tile.pointsPerActivity || 5;
    onAward(tile.id, pts, `Viewed: ${strips[i]?.title}`);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {strips.map((s, i) => (
        <div key={i} className="surface overflow-hidden rounded-xl">
          {s.imageUrl && (
            <div className="relative aspect-[4/3] w-full bg-gray-100"
              onMouseEnter={() => startTimer(i)}
              onTouchStart={() => startTimer(i)}>
              <img src={s.imageUrl} alt={s.title}
                className="h-full w-full object-cover"
                onLoad={() => startTimer(i)}
                onError={(e) => { e.target.style.display = 'none'; }} />
            </div>
          )}
          <div className="flex items-center justify-between p-3">
            <span className="text-sm font-semibold" style={{ color: MAROON }}>
              {s.title}
            </span>
            {viewed[i] ? (
              <span className="rounded-full bg-green-100 px-3 py-1
                text-xs font-bold text-green-700">
                &#10003; Viewed
              </span>
            ) : viewReady[i] ? (
              <button type="button" onClick={() => markViewed(i)}
                className="rounded-full px-3 py-1 text-xs font-bold
                  text-white transition"
                style={{ backgroundColor: AMBER }}>
                +{s.points || tile.pointsPerActivity || 5} pts
              </button>
            ) : (
              <span className="rounded-full bg-gray-100 px-3 py-1
                text-xs text-gray-500">
                {s.imageUrl ? `View (${viewSecs[i] ?? 6}s)` : 'No image'}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Tarot (expand + timed study) ------------------------------------
function TarotView({ tile, user, completedLessons, onLessonComplete }) {
  const cards = tile.content?.cards || [];
  const [expanded, setExpanded] = useState(null);
  const [readSecs, setReadSecs] = useState({});
  const [readReady, setReadReady] = useState({});
  const timerRefs = useRef({});

  const expand = (i) => {
    setExpanded(expanded === i ? null : i);
    if (expanded !== i && !readReady[i]) {
      setReadSecs((prev) => ({ ...prev, [i]: 12 }));
      clearInterval(timerRefs.current[i]);
      timerRefs.current[i] = setInterval(() => {
        setReadSecs((prev) => {
          const next = Math.max(0, (prev[i] || 12) - 1);
          if (next <= 0) {
            clearInterval(timerRefs.current[i]);
            setReadReady((r) => ({ ...r, [i]: true }));
          }
          return { ...prev, [i]: next };
        });
      }, 1000);
    }
  };

  const markStudied = (i) => {
    if (completedLessons.includes(String(i)) || !readReady[i]) return;
    const pts = cards[i]?.points || tile.pointsPerActivity || 10;
    onLessonComplete(i, pts, `Tarot: ${cards[i]?.name}`);
  };

  return (
    <div className="flex flex-col gap-3">
      {cards.map((c, i) => {
        const done = completedLessons.includes(String(i));
        return (
          <div key={i} className="surface rounded-xl overflow-hidden">
            <button type="button"
              onClick={() => expand(i)}
              className="flex w-full items-center justify-between p-4 text-left">
              <span className="font-bold" style={{ color: MAROON }}>
                {done && <span className="mr-1.5 text-green-600">&#10003;</span>}
                {c.name}
              </span>
              <span className="text-lg">{expanded === i ? '−' : '+'}</span>
            </button>
            {expanded === i && (
              <div className="border-t px-4 pb-4 pt-3"
                style={{ borderColor: CREAM }}>
                <div className="mb-2">
                  <span className="text-xs font-semibold uppercase"
                    style={{ color: AMBER }}>Upright</span>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">
                    {c.meaning}
                  </p>
                </div>
                {c.reversedMeaning && (
                  <div className="mb-3">
                    <span className="text-xs font-semibold uppercase"
                      style={{ color: MAROON }}>Reversed</span>
                    <p className="mt-1 text-sm leading-relaxed text-gray-700">
                      {c.reversedMeaning}
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <PointsBadge pts={c.points || tile.pointsPerActivity || 10} />
                  {done ? (
                    <span className="rounded-lg bg-green-100 px-4 py-2
                      text-xs font-bold text-green-700">
                      &#10003; Studied
                    </span>
                  ) : readReady[i] ? (
                    <button type="button" onClick={() => markStudied(i)}
                      className="rounded-lg px-4 py-2 text-xs font-semibold
                        text-white transition"
                      style={{ backgroundColor: MAROON }}>
                      Mark as studied
                    </button>
                  ) : (
                    <span className="rounded-lg bg-amber-50 px-4 py-2
                      text-xs text-amber-700">
                      Read for {readSecs[i] ?? 12}s...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- TILE ICON MAP (same key convention as in Icons.js) ---------------
const TILE_ICON_MAP = {
  learn_astrology:   Icon.LearnAstrology,
  vedic_astrology:   Icon.VedicAstrology,
  quiz_game:         Icon.QuizGame,
  manifestation:     Icon.Manifestation,
  astro_comic:       Icon.AstroComic,
  tarot_learning:    Icon.TarotLearning,
  numerology_basics: Icon.NumerologyBasics,
  crystal_guide:     Icon.CrystalGuide,
  gemstone_guide:    Icon.Gemstone,
  daily_rituals:     Icon.DailyRituals,
  palm_reading:      Icon.PalmReading,
  face_reading:      Icon.FaceReading,
  understanding:     Icon.Understanding,
  learn:    Icon.LearnAstrology,
  quiz:     Icon.QuizGame,
  manifest: Icon.Manifestation,
  comic:    Icon.AstroComic,
  tarot:    Icon.TarotLearning,
};

// ---- Main page ----------------------------------------------------------
export default function EngagePage() {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading } = useOptionalClient();
  const { openLogin } = useAuthModal();
  const [tile, setTile] = useState(null);
  const [err, setErr] = useState(false);
  // Per-lesson completion state (loaded from Firestore).
  const [completedLessons, setCompletedLessons] = useState([]);
  const [progressLoaded, setProgressLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    engagementService.getEngagementConfig().then(({ tiles }) => {
      const found = (tiles || []).find((t) => t.id === id);
      if (found) setTile(found);
      else setErr(true);
    }).catch(() => setErr(true));
  }, [id]);

  // Load per-user lesson progress once tile + user are both known.
  useEffect(() => {
    if (!id || !user) { setProgressLoaded(true); return; }
    engagementService.getLessonProgress(user.uid, id)
      .then((p) => {
        setCompletedLessons(p.completedLessons || []);
        setProgressLoaded(true);
      }).catch(() => setProgressLoaded(true));
  }, [id, user?.uid]);

  // Called by LearnView / TarotView when a lesson is done.
  const handleLessonComplete = (lessonIdx, pts, reason) => {
    if (!user) { openLogin(); return; }
    engagementService.completeLessonAndAward(
      user.uid, id, lessonIdx, pts, reason)
      .then((res) => {
        if (res && !res.alreadyDone) {
          setCompletedLessons((prev) =>
            prev.includes(String(lessonIdx))
              ? prev : [...prev, String(lessonIdx)]);
        }
      }).catch(() => {});
  };

  // Simple fire-and-forget award for non-lesson tiles (quiz, manifest, comic).
  const handleAward = (tileId, pts, reason) => {
    if (!user) { openLogin(); return; }
    engagementService.awardPoints(user.uid, tileId, pts, reason)
      .catch(() => {});
  };

  if (loading || (!tile && !err)) {
    return <Layout><SkeletonList /></Layout>;
  }

  if (err || !tile) {
    return (
      <Layout>
        <div className="mx-auto max-w-2xl p-4">
          <BackLink />
          <div className="surface mt-4 rounded-xl p-8 text-center">
            <div className="mb-2 text-3xl">&#128269;</div>
            <h2 className="mb-1 font-bold" style={{ color: MAROON }}>
              Activity not found
            </h2>
            <p className="text-sm text-gray-500">
              This activity may have been removed or disabled.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  const isLearnType = tile.type === 'learn' || !tile.type;
  const isTarotType = tile.type === 'tarot';
  const needsProgress = isLearnType || isTarotType;
  const TileIcon = TILE_ICON_MAP[tile.id] || TILE_ICON_MAP[tile.type]
    || Icon.Star;

  const renderContent = () => {
    if (needsProgress && !progressLoaded) {
      return <SkeletonList count={3} />;
    }
    switch (tile.type) {
      case 'learn':
        return (
          <LearnView tile={tile} user={user}
            completedLessons={completedLessons}
            onLessonComplete={handleLessonComplete} />
        );
      case 'quiz':
        return <QuizView tile={tile} user={user} onAward={handleAward} />;
      case 'manifest':
        return <ManifestView tile={tile} user={user} onAward={handleAward} />;
      case 'comic':
        return <ComicView tile={tile} user={user} onAward={handleAward} />;
      case 'tarot':
        return (
          <TarotView tile={tile} user={user}
            completedLessons={completedLessons}
            onLessonComplete={handleLessonComplete} />
        );
      default:
        return (
          <LearnView tile={tile} user={user}
            completedLessons={completedLessons}
            onLessonComplete={handleLessonComplete} />
        );
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl p-4">
        <BackLink />
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center
            rounded-xl" style={{ backgroundColor: CREAM }}>
            <TileIcon className="h-6 w-6" style={{ color: MAROON }} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold" style={{ color: MAROON }}>
              {tile.name}
            </h1>
            <p className="text-sm text-gray-500">{tile.description}</p>
          </div>
          <span className="shrink-0 text-right">
            <PointsBadge pts={tile.pointsPerActivity || 0} />
            <span className="ml-1 text-[10px] text-gray-400">per activity</span>
          </span>
        </div>

        {!user && (
          <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm
            text-amber-800">
            <b>Sign in</b> to save your progress and earn points.{' '}
            <button type="button" onClick={() => openLogin()}
              className="font-bold underline">
              Sign in now
            </button>
          </div>
        )}

        {renderContent()}
      </div>
    </Layout>
  );
}
