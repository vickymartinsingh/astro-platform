import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  drawCards, tarotReading, aspectReading, TAROT_ASPECTS,
  tarotService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useOptionalClient } from '../lib/useAuth';
import { useSettings } from '../lib/useSettings';
import useScrollLock from '../lib/useScrollLock';

function BackBar({ onBack }) {
  return (
    <button type="button" onClick={onBack}
      className="mb-3 inline-flex items-center gap-1 rounded-full
        border border-gray-200 px-3 py-1.5 text-sm font-semibold
        text-dark-text hover:border-primary hover:text-primary">
      <span className="text-base leading-none">‹</span> Back
    </button>
  );
}

// Two presets, switched from the admin (features.tarot_mode):
//  - 'classic' (default): the original pick-a-card flow (unchanged, so
//    you can always switch back).
//  - 'guided': aspect -> (question 10-50 words, saved for admin only)
//    -> single or 3 cards -> aspect-specific reading in a popup that
//    stays on the page until you leave / refresh.
const DECK_SIZE = 9;

function CardGrid({ count, drawn, revealed, onPick, labels }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
      {Array.from({ length: DECK_SIZE }).map((_, slot) => {
        const order = revealed.indexOf(slot);
        const open = order !== -1;
        const card = open ? drawn[order] : null;
        return (
          /* eslint-disable-next-line react/no-array-index-key */
          <button key={slot} onClick={() => onPick(slot)}
            className={`aspect-[2/3] overflow-hidden rounded-xl
              transition ${open ? 'card-face shadow-lg'
              : 'card-back shadow-md hover:-translate-y-1'}`}>
            {open ? (
              <div className="relative z-10 flex h-full flex-col
                justify-between p-2 text-center">
                <div className="text-[10px] font-semibold uppercase
                  tracking-wide text-primary">
                  {labels[order] || ''}
                </div>
                <div>
                  <div className="text-[15px] leading-none
                    text-primary">✦</div>
                  <div className="mt-1 text-[13px] font-bold
                    leading-tight text-dark-text">{card.name}</div>
                </div>
                <div className="text-[10px] text-sub-text">
                  {card.keywords}
                </div>
              </div>
            ) : (
              <div className="relative z-10 flex h-full items-center
                justify-center text-2xl text-white/80">✦</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ReadingBody({ reading }) {
  return (
    <div>
      <div className="space-y-3">
        {reading.rows.map((r) => (
          <div key={r.position + r.name}
            className="rounded-xl bg-bg-light p-3">
            <div className="text-xs font-semibold uppercase
              tracking-wide text-primary">{r.position}</div>
            <div className="font-bold">{r.name}</div>
            <div className="text-sm text-sub-text">{r.text}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-xl bg-bg-light p-4 text-sm">
        {reading.summary}
      </p>
    </div>
  );
}

function Classic() {
  const router = useRouter();
  const [count, setCount] = useState(1);
  const [drawn, setDrawn] = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [done, setDone] = useState(false);

  function reset(n) {
    setCount(n); setDrawn(drawCards(n)); setRevealed([]); setDone(false);
  }
  useEffect(() => { reset(1); }, []);
  function pick(slot) {
    if (done || revealed.includes(slot) || revealed.length >= count) return;
    const next = [...revealed, slot];
    setRevealed(next);
    if (next.length === count) setDone(true);
  }
  const reading = done ? tarotReading(drawn) : null;
  const labels = count === 3
    ? ['Past', 'Present', 'Future'] : ['Your card'];
  const remaining = count - revealed.length;

  return (
    <>
      <BackBar onBack={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
        } else { router.replace('/dashboard'); }
      }} />
      <h1 className="text-2xl font-bold md:text-3xl">Pick your card</h1>
      <p className="mb-4 text-sub-text">
        Take a breath, focus on your question, and choose your card
        {count > 1 ? 's' : ''} for the day.
      </p>
      <div className="mb-5 flex gap-2">
        {[[1, 'Card of the day'], [3, '3 card reading']].map(([n, l]) => (
          <button key={n} onClick={() => reset(n)}
            className={count === n ? 'pill pill-active' : 'pill'}>
            {l}
          </button>
        ))}
      </div>
      <CardGrid count={count} drawn={drawn} revealed={revealed}
        onPick={pick} labels={labels} />
      {!done && (
        <p className="mt-4 text-sm text-sub-text">
          Choose {remaining} more card{remaining === 1 ? '' : 's'}.
        </p>
      )}
      {reading && (
        <div className="surface mt-6 p-5">
          <h2 className="mb-3 text-lg font-bold">Your reading</h2>
          <div className="space-y-3">
            {reading.rows.map((r) => (
              <div key={r.position + r.name}
                className="rounded-xl bg-bg-light p-3">
                <div className="text-xs font-semibold uppercase
                  tracking-wide text-primary">{r.position}</div>
                <div className="font-bold">{r.name}</div>
                <div className="text-sm text-sub-text">{r.meaning}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-xl bg-bg-light p-4 text-sm">
            {reading.summary}
          </p>
          <button onClick={() => reset(count)} className="btn-grad mt-4">
            Draw again
          </button>
        </div>
      )}
    </>
  );
}

function Guided({ features }) {
  const { user, profile } = useOptionalClient();
  const router = useRouter();
  // The step lives in the URL (?tstep=...). That makes EVERY back
  // (on-screen button, browser, Android hardware via useNativeBack ->
  // router.back()) move exactly one screen, and only leave /tarot when
  // already on the first step. No fragile history traps.
  const step = String(router.query.tstep || 'aspect');
  const go = (next) => router.push(
    { pathname: '/tarot', query: { tstep: next } },
    undefined, { shallow: true });
  const [aspect, setAspect] = useState('');
  // 2026-06-08: question step removed - operator wants Aspect ->
  // Spread -> Pick -> Reading. Keeping the state vars commented so
  // the saveTarotQuestion side-effect below cleanly no-ops without
  // touching the service signature.
  const [count, setCount] = useState(1);
  const [drawn, setDrawn] = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [reading, setReading] = useState(null);
  const [showPopup, setShowPopup] = useState(false);
  useScrollLock(showPopup);

  // Refresh / deep-link straight to a later step with no aspect chosen:
  // send them back to the start so the flow is never half-built.
  useEffect(() => {
    if (step !== 'aspect' && !aspect) {
      router.replace({ pathname: '/tarot', query: { tstep: 'aspect' } },
        undefined, { shallow: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Top-left Back: close the reading popup first, otherwise step back
  // one screen via real history (leaves /tarot only at the first step).
  const back = () => {
    if (showPopup) { setShowPopup(false); return; }
    router.back();
  };

  const singleDef = features.tarot_single_def
    || 'One card focused on your question - a clear, direct answer.';
  const threeDef = features.tarot_three_def
    || 'Three cards - Past, Present and Future - for a fuller story.';

  function chooseAspect(a) {
    setAspect(a);
    // All aspects go straight to the spread picker - the question
    // step was dropped per 2026-06-08 operator instruction.
    go('spread');
  }
  function chooseSpread(n) {
    setCount(n);
    setDrawn(drawCards(n));
    setRevealed([]);
    // We still log the aspect for admin analytics (was previously
    // gated on question.trim()) - useful for "what reading types
    // are people drawing the most". The empty question field
    // signals the new flow to anyone reading the log.
    if (aspect !== 'General') {
      tarotService.saveTarotQuestion({
        userId: user?.uid, name: profile?.name,
        aspect, question: '', spread: n === 3 ? 'three' : 'single',
      });
    }
    go('pick');
  }
  function pick(slot) {
    if (revealed.includes(slot) || revealed.length >= count) return;
    const next = [...revealed, slot];
    setRevealed(next);
    if (next.length === count) {
      setReading(aspectReading(next.map((_, i) => drawn[i]), aspect));
      setShowPopup(true);
    }
  }
  function startOver() {
    setAspect('');
    setRevealed([]); setReading(null); setShowPopup(false);
    go('aspect');
  }

  const labels = count === 3
    ? ['Past', 'Present', 'Future'] : ['Your card'];

  return (
    <>
      <BackBar onBack={back} />
      <h1 className="text-2xl font-bold md:text-3xl">Pick your card</h1>
      <p className="mb-4 text-sub-text">
        {features.tarot_intro
          || 'Choose an area, focus your mind, and let the cards '
            + 'guide you.'}
      </p>

      {step === 'aspect' && (
        <div className="surface p-5">
          <div className="mb-2 font-semibold">
            1. What is this reading about?
          </div>
          <div className="flex flex-wrap gap-2">
            {TAROT_ASPECTS.map((a) => (
              <button key={a} onClick={() => chooseAspect(a)}
                className="rounded-full border border-gray-200 px-4
                  py-2 text-sm hover:border-primary hover:text-primary">
                {a}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'spread' && (
        <div className="surface space-y-3 p-5">
          <div className="font-semibold">
            2. Choose your reading
          </div>
          <button onClick={() => chooseSpread(1)}
            className="w-full rounded-card border border-gray-200 p-4
              text-left hover:border-primary">
            <div className="font-bold">Single card</div>
            <div className="text-sm text-sub-text">{singleDef}</div>
          </button>
          <button onClick={() => chooseSpread(3)}
            className="w-full rounded-card border border-gray-200 p-4
              text-left hover:border-primary">
            <div className="font-bold">3 cards</div>
            <div className="text-sm text-sub-text">{threeDef}</div>
          </button>
        </div>
      )}

      {step === 'pick' && (
        <>
          <p className="mb-3 text-sm text-sub-text">
            {aspect === 'General' ? 'General reading' : aspect}
            {' '}- pick {count} card{count > 1 ? 's' : ''}.
          </p>
          <CardGrid count={count} drawn={drawn} revealed={revealed}
            onPick={pick} labels={labels} />
          {reading && (
            <button onClick={startOver} className="btn-grad mt-5">
              Start a new reading
            </button>
          )}
        </>
      )}

      {reading && !showPopup && (
        <div className="surface mt-5 p-5">
          <div className="mb-3 text-lg font-bold">
            {aspect === 'General' ? 'Your reading' : `${aspect} reading`}
          </div>
          <ReadingBody reading={reading} />
        </div>
      )}

      {showPopup && reading && (
        <div className="fixed inset-0 z-[120] flex items-center
          justify-center bg-black/60 px-4">
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto
            rounded-2xl bg-white p-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-bold">
                {aspect === 'General'
                  ? 'Your reading' : `${aspect} reading`}
              </div>
              <button onClick={() => setShowPopup(false)}
                className="rounded-lg border border-gray-200 px-2.5
                  py-1 text-sm">✕</button>
            </div>
            <ReadingBody reading={reading} />
            <button onClick={() => setShowPopup(false)}
              className="btn-primary mt-4 w-full">Close</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Tarot() {
  const { loading } = useOptionalClient();
  const { features } = useSettings();
  if (loading) {
    return <Layout><div className="surface p-6">Loading...</div></Layout>;
  }
  // Guided is the DEFAULT now; admin can switch back to Classic by
  // setting features.tarot_mode = 'classic'.
  const guided = features.tarot_mode !== 'classic';
  return (
    <Layout>
      {guided ? <Guided features={features} /> : <Classic />}
    </Layout>
  );
}
