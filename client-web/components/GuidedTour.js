import { useState } from 'react';
import { userService } from '@astro/shared';

// Blueprint 4.19, shown only when hasSeenTour=false. Skippable at any step.
// On complete OR skip: hasSeenTour=true. Replayable from Profile.
const STEPS = [
  { t: 'Welcome to the platform 👋', m: 'Let us show you around in 30 seconds.' },
  { t: 'Your Wallet', m: 'This is your wallet. Add money to start a consultation.' },
  { t: 'Astrologers', m: 'Browse verified astrologers here. See ratings and pricing.' },
  { t: 'Chat', m: 'Start a text chat and pay only per minute used.' },
  { t: 'Call', m: 'Prefer talking? Start a voice or video call instantly.' },
  { t: 'Kundli', m: 'Save your birth details once for accurate predictions.' },
  { t: 'Horoscope', m: "Check your daily and tomorrow's horoscope here." },
  { t: 'You are all set! 🎉', m: 'Start your first consultation now.' },
];

export default function GuidedTour({ uid, onClose }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  async function finish() {
    try { await userService.updateUser(uid, { hasSeenTour: true }); }
    finally { onClose(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black/50 px-4">
      <div className="card w-full max-w-md text-center">
        <div className="mb-1 text-sm text-sub-text">
          Step {i + 1} of {STEPS.length}
        </div>
        <h2 className="mb-2 text-xl font-bold text-primary">{step.t}</h2>
        <p className="mb-5 text-sub-text">{step.m}</p>
        <div className="flex gap-2">
          <button onClick={finish} className="btn-ghost flex-1">Skip</button>
          {last ? (
            <button onClick={finish} className="btn-primary flex-1">
              Start Exploring
            </button>
          ) : (
            <button onClick={() => setI(i + 1)} className="btn-primary flex-1">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
