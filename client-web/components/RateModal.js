import { useState } from 'react';
import { reviewService } from '@astro/shared';

// Post-session rating (blueprint 4.20 / 10.x).
// `reason` (optional) tells the customer WHY the session ended:
//   - 'balance' -> "Your balance ran out, so the session ended."
//   - 'astrologer' -> "The astrologer ended the session."
//   - 'self' / unset -> generic "Session ended."
export default function RateModal({
  uid, astroId, sessionId, onDone, reason,
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await reviewService.addReview(uid, astroId, sessionId, rating, comment);
    } finally { onDone(); }
  }

  const reasonText = reason === 'balance'
    ? 'Your balance ran out, so the consultation has ended. '
      + 'Recharge any time from the wallet to start a new session.'
    : reason === 'astrologer'
      ? 'The astrologer has ended this consultation.'
      : 'The consultation has ended.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black/50 px-4">
      <div className="card w-full max-w-sm text-center">
        <h2 className="text-lg font-bold">Consultation ended</h2>
        <p className="mb-3 mt-1 text-sm text-sub-text">{reasonText}</p>
        <div className="mb-2 text-sm font-semibold">
          How was your experience?
        </div>
        <div className="mb-3 text-3xl text-gold">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(n)}
              className={n <= rating ? '' : 'opacity-30'}>★</button>
          ))}
        </div>
        <textarea className="input mb-3" rows={3}
          placeholder="Optional comment" value={comment}
          onChange={(e) => setComment(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={onDone} className="btn-ghost flex-1">Skip</button>
          <button onClick={submit} disabled={busy}
            className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
