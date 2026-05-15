import { useState, useEffect } from 'react';
import { drawCards, tarotReading } from '@astro/shared';
import Layout from '../components/Layout';
import { useOptionalClient } from '../lib/useAuth';

// Pick your card for the day. 1 (card of the day) or 3 (past, present,
// future). Cards look like real tarot cards: celestial patterned back,
// ornate framed face. Public, no login needed.
const DECK_SIZE = 9;

export default function Tarot() {
  const { loading } = useOptionalClient();
  const [count, setCount] = useState(1);
  const [drawn, setDrawn] = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [done, setDone] = useState(false);

  function reset(n) {
    setCount(n);
    setDrawn(drawCards(n));
    setRevealed([]);
    setDone(false);
  }
  useEffect(() => { reset(1); }, []);

  function pick(slot) {
    if (done || revealed.includes(slot) || revealed.length >= count) return;
    const next = [...revealed, slot];
    setRevealed(next);
    if (next.length === count) setDone(true);
  }

  if (loading) {
    return <Layout><div className="surface p-6">Loading…</div></Layout>;
  }

  const reading = done ? tarotReading(drawn) : null;
  const labels = count === 3 ? ['Past', 'Present', 'Future'] : ['Your card'];
  const remaining = count - revealed.length;

  return (
    <Layout>
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

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
        {Array.from({ length: DECK_SIZE }).map((_, slot) => {
          const order = revealed.indexOf(slot);
          const open = order !== -1;
          const card = open ? drawn[order] : null;
          return (
            <button key={slot} onClick={() => pick(slot)}
              className={`aspect-[2/3] overflow-hidden rounded-xl
                transition ${open
                  ? 'card-face shadow-lg'
                  : 'card-back shadow-md hover:-translate-y-1'}`}>
              {open ? (
                <div className="relative z-10 flex h-full flex-col
                                justify-between p-2 text-center">
                  <div className="text-[10px] font-semibold uppercase
                                  tracking-wide text-primary">
                    {labels[order] || ''}
                  </div>
                  <div>
                    <div className="text-[15px] leading-none text-primary">
                      ✦
                    </div>
                    <div className="mt-1 text-[13px] font-bold leading-tight
                                    text-dark-text">
                      {card.name}
                    </div>
                  </div>
                  <div className="text-[10px] text-sub-text">
                    {card.keywords}
                  </div>
                </div>
              ) : (
                <div className="relative z-10 flex h-full items-center
                                justify-center text-2xl text-white/80">
                  ✦
                </div>
              )}
            </button>
          );
        })}
      </div>

      {!done && (
        <p className="mt-4 text-sm text-sub-text">
          Choose {remaining} more card{remaining === 1 ? '' : 's'}.
        </p>
      )}

      {reading && (
        <div className="surface mt-6 p-5">
          <h2 className="mb-3 text-lg font-bold">Your reading</h2>
          <div className="space-y-3">
            {reading.rows.map((r, i) => (
              <div key={i} className="rounded-xl bg-bg-light p-3">
                <div className="text-xs font-semibold uppercase
                                tracking-wide text-primary">
                  {r.position}
                </div>
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
    </Layout>
  );
}
