import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@astro/shared';
import {
  callService, liveService, walletService, astrologerService,
  offerService, reviewService,
} from '@astro/shared';
import {
  requestJoinLiveV2, moveToWaitlist, addToWishlist, removeFromWishlist,
  listenConnectedUsers,
  listenLiveQuiz, answerLiveQuiz, listenLiveQuizAnswers,
} from '@astro/shared/services/liveService';
import { useOptionalClient } from '../../lib/useAuth';
import { useSettings } from '../../lib/useSettings';

// -----------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------

function IconHeart({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <path
        d="M12 21s-7.5-4.5-9.5-9C1 8.5 3.5 5 7 5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.5 0 6 3.5 4.5 7-2 4.5-9.5 9-9.5 9z"
        fill={filled ? '#FF3B5C' : 'none'}
        stroke={filled ? '#FF3B5C' : 'white'}
        strokeWidth="2"
      />
    </svg>
  );
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMic({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M12 14a3 3 0 003-3V7a3 3 0 00-6 0v4a3 3 0 003 3zM19 11a7 7 0 11-14 0M12 18v3M8 21h8"
        stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"
      />
      {off && (
        <path d="M4 4l16 16" stroke="#FF3B5C" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

function IconMicLarge() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <path
        d="M12 14a3 3 0 003-3V7a3 3 0 00-6 0v4a3 3 0 003 3zM19 11a7 7 0 11-14 0M12 18v3M8 21h8"
        stroke="#D4A12A" strokeWidth="2" strokeLinecap="round" fill="none"
      />
    </svg>
  );
}

function IconCameraLarge() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <path
        d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm13 4l5-3v10l-5-3"
        stroke="#D4A12A" strokeWidth="2" fill="none" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconVideo({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M3 7a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm13 4l5-3v10l-5-3"
        stroke="white" strokeWidth="2" fill="none" strokeLinejoin="round"
      />
      {off && (
        <path d="M4 4l16 16" stroke="#FF3B5C" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

function IconEndCall() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"
        fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"
        transform="rotate(135 12 12)"
      />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"
        fill="none" stroke="white" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M19 12H5M12 19l-7-7 7-7"
        fill="none" stroke="white" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" fill="white" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" fill="white" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" fill="white" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" fill="white" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCloseBlack() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="#333" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCheckPill() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M20 6L9 17l-5-5"
        fill="none" stroke="white" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function IconHeart2() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 21s-7.5-4.5-9.5-9C1 8.5 3.5 5 7 5c2 0 3.5 1 5 3 1.5-2 3-3 5-3 3.5 0 6 3.5 4.5 7-2 4.5-9.5 9-9.5 9z"
        fill="#D4A12A" stroke="#D4A12A" strokeWidth="1.5"
      />
    </svg>
  );
}

// -----------------------------------------------------------------------
// Avatar
// -----------------------------------------------------------------------

function Avatar({ name, photo, size = 36 }) {
  if (photo) {
    return (
      <img
        src={photo} alt={name || ''}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  const ch = (name || '?').trim().charAt(0).toUpperCase();
  const cols = ['#7F2020', '#D4A12A', '#5A6E32', '#B45309', '#2A1408', '#1A1A2E'];
  const bg = cols[(name || 'x').charCodeAt(0) % cols.length];
  return (
    <span
      style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
    >
      {ch}
    </span>
  );
}

// -----------------------------------------------------------------------
// Desktop redirect screen
// -----------------------------------------------------------------------

function DesktopRedirectScreen({ downloadUrl, onBack }) {
  const url = downloadUrl || 'https://play.google.com/store/apps/details?id=com.astroseer.mobile';
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6"
      style={{ background: '#0D0508' }}
    >
      {/* Decorative ring */}
      <div
        className="mb-8 flex h-28 w-28 items-center justify-center rounded-full"
        style={{ border: '3px solid #D4A12A', background: 'rgba(212,161,42,0.08)' }}
      >
        <svg viewBox="0 0 24 24" width="52" height="52" aria-hidden="true">
          <rect x="5" y="1" width="14" height="22" rx="3"
            fill="none" stroke="#D4A12A" strokeWidth="2" />
          <circle cx="12" cy="18.5" r="1" fill="#D4A12A" />
          <rect x="9" y="3.5" width="6" height="1.5" rx="0.75" fill="#D4A12A" />
        </svg>
      </div>

      <h1
        className="mb-3 text-center text-2xl font-bold"
        style={{ color: '#FFF8E7' }}
      >
        Download AstroSeer App
      </h1>
      <p
        className="mb-8 max-w-xs text-center text-base leading-relaxed"
        style={{ color: 'rgba(255,248,231,0.65)' }}
      >
        For the best live experience, please download our mobile app.
      </p>

      {/* Google Play button */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-4 flex items-center gap-3 rounded-2xl px-7 py-4 text-base font-bold"
        style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)', color: '#FFF8E7', minWidth: 220 }}
      >
        {/* Google Play icon (simplified) */}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path d="M3 20.5v-17a.5.5 0 01.77-.42l16 8.5a.5.5 0 010 .84l-16 8.5A.5.5 0 013 20.5z"
            fill="#FFF8E7" />
        </svg>
        Get it on Google Play
      </a>

      <button
        onClick={onBack}
        className="rounded-full px-6 py-2.5 text-sm font-semibold"
        style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,248,231,0.7)' }}
      >
        Go Back
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------
// KBC Quiz overlay
// -----------------------------------------------------------------------

function QuizOverlay({ quiz, userId, userName, astroId, onDismiss }) {
  const [myAnswer, setMyAnswer] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState(null); // 'correct' | 'wrong'
  const [pointsAnim, setPointsAnim] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const prevStatusRef = useRef(quiz?.status);

  // Listen to answers
  useEffect(() => {
    if (!astroId) return undefined;
    const unsub = listenLiveQuizAnswers(astroId, (answers) => {
      const correct = (answers || [])
        .filter((a) => a.isCorrect)
        .sort((a, b) => (a.answeredAt?.toMillis?.() || 0) - (b.answeredAt?.toMillis?.() || 0))
        .slice(0, 5);
      setQuizAnswers(correct);
    });
    return () => unsub && unsub();
  }, [astroId]);

  // When quiz transitions to ended, show leaderboard then dismiss
  useEffect(() => {
    if (prevStatusRef.current === 'active' && quiz?.status === 'ended') {
      setShowLeaderboard(true);
      const t = setTimeout(() => {
        setShowLeaderboard(false);
        onDismiss();
      }, 5000);
      return () => clearTimeout(t);
    }
    prevStatusRef.current = quiz?.status;
    return undefined;
  }, [quiz?.status, onDismiss]);

  async function handleSubmit() {
    if (myAnswer === null || submitted) return;
    setSubmitted(true);
    try {
      await answerLiveQuiz(astroId, userId, userName, myAnswer);
      const isCorrect = myAnswer === quiz.correctAnswer;
      setQuizResult(isCorrect ? 'correct' : 'wrong');
      if (isCorrect) {
        setPointsAnim(true);
        setTimeout(() => setPointsAnim(false), 1400);
      }
    } catch (_) {
      setSubmitted(false);
    }
  }

  if (!quiz || quiz.status === 'ended') {
    if (!showLeaderboard) return null;
  }

  const options = Array.isArray(quiz?.options) ? quiz.options : [];
  const pts = quiz?.points || 10;

  // Leaderboard view
  if (showLeaderboard) {
    return (
      <div
        className="fixed inset-0 z-[9000] flex flex-col items-center justify-center px-5"
        style={{ background: 'rgba(0,0,0,0.88)' }}
      >
        <div
          className="w-full max-w-sm rounded-3xl px-5 py-6"
          style={{ background: '#1A0A0A', border: '1.5px solid #D4A12A55' }}
        >
          <h2
            className="mb-1 text-center text-xl font-bold"
            style={{ color: '#D4A12A' }}
          >
            Quiz Results
          </h2>
          <p className="mb-4 text-center text-[12px]" style={{ color: 'rgba(255,248,231,0.5)' }}>
            Top correct answers
          </p>
          {quizAnswers.length === 0 ? (
            <p className="text-center text-[13px]" style={{ color: 'rgba(255,248,231,0.5)' }}>
              No correct answers this round.
            </p>
          ) : (
            <div className="space-y-2">
              {quizAnswers.map((a, i) => (
                <div
                  key={a.id || i}
                  className="flex items-center gap-3 rounded-xl px-3 py-2"
                  style={{ background: i === 0 ? 'rgba(212,161,42,0.18)' : 'rgba(255,255,255,0.05)' }}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                    style={{ background: '#7F2020', color: '#FFF8E7' }}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-[14px] font-semibold" style={{ color: '#FFF8E7' }}>
                    {a.userName || 'Guest'}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}
                  >
                    Correct
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9000] flex flex-col px-4 pt-10 pb-6"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      {/* Question */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div
          className="w-full max-w-sm rounded-2xl px-5 py-4 text-center"
          style={{ background: 'rgba(127,32,32,0.25)', border: '1.5px solid #7F202055' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#D4A12A' }}>
            Quiz Time
          </p>
          <p className="text-[18px] font-bold leading-snug" style={{ color: '#FFF8E7' }}>
            {quiz?.question || ''}
          </p>
          <p className="mt-2 text-[12px]" style={{ color: 'rgba(255,248,231,0.5)' }}>
            +{pts} points for correct answer
          </p>
        </div>

        {/* Options */}
        <div className="w-full max-w-sm space-y-3">
          {options.map((opt, i) => {
            const isSelected = myAnswer === i;
            const isCorrectOpt = submitted && i === quiz.correctAnswer;
            const isWrongOpt = submitted && isSelected && quizResult === 'wrong';
            let bg = 'rgba(255,255,255,0.08)';
            let borderColor = 'rgba(255,255,255,0.12)';
            let textColor = '#FFF8E7';
            if (isCorrectOpt && submitted) {
              bg = 'rgba(34,197,94,0.2)';
              borderColor = '#22c55e';
              textColor = '#4ade80';
            } else if (isWrongOpt) {
              bg = 'rgba(239,68,68,0.2)';
              borderColor = '#ef4444';
              textColor = '#f87171';
            } else if (isSelected) {
              bg = 'rgba(212,161,42,0.22)';
              borderColor = '#D4A12A';
              textColor = '#D4A12A';
            }
            return (
              <button
                key={i}
                onClick={() => !submitted && setMyAnswer(i)}
                disabled={submitted}
                className="w-full rounded-full px-5 py-3.5 text-left text-[15px] font-semibold transition-all"
                style={{ background: bg, border: `2px solid ${borderColor}`, color: textColor }}
              >
                <span className="mr-3 text-[13px] opacity-60">
                  {String.fromCharCode(65 + i)}.
                </span>
                {opt}
              </button>
            );
          })}
        </div>

        {/* Result feedback */}
        {submitted && quizResult && (
          <div
            className="flex flex-col items-center gap-1"
          >
            {quizResult === 'correct' ? (
              <>
                <span
                  className="text-[22px] font-bold"
                  style={{ color: '#4ade80' }}
                >
                  Correct!
                </span>
                <span
                  className="text-[15px] font-bold transition-all"
                  style={{
                    color: '#D4A12A',
                    transform: pointsAnim ? 'scale(1.35)' : 'scale(1)',
                    transition: 'transform 0.3s ease',
                  }}
                >
                  +{pts} points
                </span>
              </>
            ) : (
              <span className="text-[22px] font-bold" style={{ color: '#f87171' }}>
                Incorrect
              </span>
            )}
          </div>
        )}

        {/* Submit button */}
        {!submitted && (
          <button
            onClick={handleSubmit}
            disabled={myAnswer === null}
            className="w-full max-w-sm rounded-full py-3.5 text-[15px] font-bold transition-opacity"
            style={{
              background: myAnswer !== null
                ? 'linear-gradient(135deg,#D4A12A,#7F2020)'
                : 'rgba(255,255,255,0.12)',
              color: '#FFF8E7',
              opacity: myAnswer !== null ? 1 : 0.5,
            }}
          >
            Submit Answer
          </button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// CallType Modal - shown before sending join request
// -----------------------------------------------------------------------

function CallTypeModal({ info, onClose, onConfirm }) {
  const [selected, setSelected] = useState(null); // 'audio' or 'video'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 pt-4 pb-3"
          style={{ borderBottom: '1px solid #f0e8d8' }}
        >
          <h3 className="text-base font-bold" style={{ color: '#7F2020' }}>
            Join as Live Guest
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-gray-100"
            aria-label="Close"
          >
            <IconCloseBlack />
          </button>
        </div>

        <div className="px-4 pt-4 pb-2">
          <p className="text-[12px] text-gray-500 mb-4 leading-relaxed">
            Choose how you want to join. Your voice or video will be heard and seen by all viewers.
          </p>

          {/* Option cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Audio Only */}
            <button
              onClick={() => setSelected('audio')}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition-all"
              style={{
                borderColor: selected === 'audio' ? '#D4A12A' : '#e5e7eb',
                background: selected === 'audio' ? '#FFF8E7' : '#fafafa',
              }}
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{ background: selected === 'audio' ? '#D4A12A22' : '#f3f4f6' }}
              >
                <IconMicLarge />
              </span>
              <span className="text-[13px] font-bold" style={{ color: '#7F2020' }}>
                Audio Only
              </span>
              <span className="text-[11px] text-gray-400 text-center leading-tight">
                Your voice will be heard by viewers
              </span>
            </button>

            {/* Video + Audio */}
            <button
              onClick={() => setSelected('video')}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition-all"
              style={{
                borderColor: selected === 'video' ? '#D4A12A' : '#e5e7eb',
                background: selected === 'video' ? '#FFF8E7' : '#fafafa',
              }}
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{ background: selected === 'video' ? '#D4A12A22' : '#f3f4f6' }}
              >
                <IconCameraLarge />
              </span>
              <span className="text-[13px] font-bold" style={{ color: '#7F2020' }}>
                Video + Audio
              </span>
              <span className="text-[11px] text-gray-400 text-center leading-tight">
                Your face and voice will be visible
              </span>
            </button>
          </div>

          {/* Warning */}
          <div
            className="rounded-xl px-3 py-2 mb-4 text-[11px] leading-relaxed"
            style={{ background: '#FFF8E7', color: '#7F2020', border: '1px solid #D4A12A44' }}
          >
            Warning: Your voice{selected === 'video' ? '/video' : ''} will be heard
            {selected === 'video' ? '/seen' : ''} by all viewers in this live session.
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-gray-400 leading-relaxed mb-4">
            By continuing you agree that you are responsible for your content. Only minutes
            you attend after both parties accept will be charged to your wallet.
          </p>
        </div>

        {/* Actions */}
        <div
          className="flex gap-2 px-4 pb-4"
          style={{ borderTop: '1px solid #f0e8d8', paddingTop: '12px' }}
        >
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            className="flex-1 rounded-full py-2.5 text-sm font-bold text-white transition-opacity"
            style={{
              background: selected
                ? 'linear-gradient(135deg,#D4A12A,#7F2020)'
                : '#d1d5db',
              opacity: selected ? 1 : 0.7,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Desktop detection helper
// -----------------------------------------------------------------------

function isDesktopDevice() {
  if (typeof window === 'undefined') return false;
  const mobileKeywords = /android|iphone|ipad|ipod|mobile|blackberry|opera mini|iemobile|wpdesktop/i;
  const isMobileUA = mobileKeywords.test(navigator.userAgent);
  const isWideScreen = window.screen.width >= 1024;
  return isWideScreen && !isMobileUA;
}

// -----------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------

export default function LiveView() {
  const router = useRouter();
  const { id: astroUid } = router.query;
  const { user, profile } = useOptionalClient();
  const { cfg, features } = useSettings();

  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [fakes, setFakes] = useState([]);
  const [dp, setDp] = useState('');
  const [, setTick] = useState(0);
  const [text, setText] = useState('');
  const [following, setFollowing] = useState(false);
  const [myRequest, setMyRequest] = useState(null);
  const [otherLives, setOtherLives] = useState([]);
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [wishlisted, setWishlisted] = useState(false);

  // Sheets: 'profile' | 'grid' | 'estimate'
  const [sheet, setSheet] = useState(null);
  // Call type modal
  const [showCallTypeModal, setShowCallTypeModal] = useState(false);
  // Selected call type for the pending request
  const [callType, setCallType] = useState('audio');

  const [profileData, setProfileData] = useState(null);
  const [walletBal, setWalletBal] = useState(0);
  const [offer, setOffer] = useState(null);
  const [callRemain, setCallRemain] = useState(0);
  const [callElapsed, setCallElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // Desktop redirect
  const [showDesktopRedirect, setShowDesktopRedirect] = useState(false);

  // KBC Quiz
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [userQuizPoints, setUserQuizPoints] = useState(0);

  // Agora autoplay policy
  const [needsUnmute, setNeedsUnmute] = useState(false);

  // Local tracks for when user becomes a co-host
  const [localMicTrack, setLocalMicTrack] = useState(null);
  const [localCamTrack, setLocalCamTrack] = useState(null);

  // Follow state (separate from the existing `following` which uses liveService listener)
  const [isFollowing, setIsFollowing] = useState(false);

  // Kicked state
  const [kickedOut, setKickedOut] = useState(false);

  // Session elapsed for connected panel
  const [sessionElapsed, setSessionElapsed] = useState(0);

  const videoRef = useRef(null);
  const joinedRef = useRef(false);
  const cRef = useRef(null);
  const inputRef = useRef(null);
  const announced = useRef(false);
  const stickRef = useRef(true);
  // Track when the current pending request was created for auto-waitlist
  const requestCreatedAtRef = useRef(null);
  // Track dial tone state
  const dialTonePlayedRef = useRef(false);
  // Agora client ref for co-host publish/unpublish
  const agoraClientRef = useRef(null);

  // -----------------------------------------------------------------------
  // Desktop redirect detection (runs once after settings load)
  // -----------------------------------------------------------------------

  useEffect(() => {
    // Wait until cfg is available (non-empty object from settings)
    if (!cfg || typeof cfg !== 'object') return;
    const mode = cfg.live_desktop_mode || 'redirect';
    if (mode === 'redirect' && isDesktopDevice()) {
      setShowDesktopRedirect(true);
    }
  }, [cfg]);

  // -----------------------------------------------------------------------
  // Auto-scroll to newest comments
  // -----------------------------------------------------------------------

  useEffect(() => {
    const el = cRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [comments, fakes]);

  function onCommentsScroll(e) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stickRef.current = atBottom;
  }

  // -----------------------------------------------------------------------
  // Announce join
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (announced.current || !astroUid) return;
    if (user && !profile) return;
    announced.current = true;
    liveService.announceJoin(astroUid, {
      uid: user?.uid || null,
      name: profile?.name || 'Guest',
    });
  }, [astroUid, user, profile]);

  // -----------------------------------------------------------------------
  // Live listeners
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!astroUid) return undefined;
    const u1 = liveService.listenLive(astroUid, setInfo);
    const u2 = liveService.listenLiveComments(astroUid, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [astroUid]);

  useEffect(() => liveService.watchComplianceDp(setDp), []);

  useEffect(() => liveService.listenLiveAstrologers((arr) => {
    setOtherLives((arr || []).filter((a) => a.astroUid !== astroUid));
  }), [astroUid]);

  useEffect(() => {
    if (!astroUid || !user?.uid) return undefined;
    return liveService.listenIsFollowing(astroUid, user.uid, setFollowing);
  }, [astroUid, user?.uid]);

  // Check initial follow status for isFollowing state (Fix 3)
  useEffect(() => {
    if (!astroUid || !user?.uid) return;
    (async () => {
      try {
        const { doc: fDoc, getDoc: fGet } = await import('firebase/firestore');
        const followRef = fDoc(db, 'users', user.uid, 'following', astroUid);
        const snap = await fGet(followRef);
        setIsFollowing(snap.exists());
      } catch (_) {}
    })();
  }, [astroUid, user?.uid]);

  useEffect(() => {
    if (!astroUid || !user?.uid) return undefined;
    return liveService.listenMyJoinRequest(astroUid, user.uid, setMyRequest);
  }, [astroUid, user?.uid]);

  // Connected users listener (for wishlist gate)
  useEffect(() => {
    if (!astroUid) return undefined;
    return listenConnectedUsers(astroUid, setConnectedUsers);
  }, [astroUid]);

  useEffect(() => {
    if (!astroUid) return undefined;
    return offerService.listenAstroOffer(astroUid, setOffer);
  }, [astroUid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return walletService.listenWallet(user.uid, setWalletBal);
  }, [user?.uid]);

  useEffect(() => {
    if (sheet !== 'profile' || !astroUid || profileData) return;
    astrologerService.getAstrologer(astroUid)
      .then(setProfileData).catch(() => setProfileData({}));
  }, [sheet, astroUid, profileData]);

  // Filler tick
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);

  // Filler comments
  useEffect(() => {
    if (!features || !features.live_fake_enabled) return undefined;
    if (info && info.live === false) return undefined;
    const ms = Math.max(3, Number(features.live_fake_every_sec) || 12) * 1000;
    const t = setInterval(() => {
      setFakes((arr) => {
        if (comments.length >= 12) return arr;
        return [...arr, liveService.nextFillerComment(features)].slice(-25);
      });
    }, ms);
    return () => clearInterval(t);
  }, [features, info, comments.length]);

  // -----------------------------------------------------------------------
  // KBC Quiz listener - active once live is joined
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!astroUid) return undefined;
    const unsub = listenLiveQuiz(astroUid, (quiz) => {
      setActiveQuiz(quiz);
      if (quiz && quiz.status === 'active') {
        setShowQuiz(true);
      }
    });
    return () => unsub && unsub();
  }, [astroUid]);

  // -----------------------------------------------------------------------
  // User quiz points listener
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setUserQuizPoints(Number(snap.data().quizPoints || 0));
      }
    });
    return () => unsub && unsub();
  }, [user?.uid]);

  // -----------------------------------------------------------------------
  // Agora join - audience mode with autoplay policy handling
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!astroUid || joinedRef.current) return undefined;
    joinedRef.current = true;
    let agoraClient = null;

    (async () => {
      try {
        const ch = liveService.liveChannel(astroUid);
        const watcherId = user?.uid || `v${Math.floor(Math.random() * 1e6)}`;
        const tok = await callService.fetchAgoraToken(ch, watcherId).catch(() => ({}));
        const appId = tok.appId || callService.AGORA_APP_ID;

        // Dynamically import Agora SDK
        const mod = await import('agora-rtc-sdk-ng');
        const AgoraRTC = mod.default;

        // Handle autoplay policy - browsers block unmuted autoplay
        AgoraRTC.on('autoplay-failed', () => {
          setNeedsUnmute(true);
        });

        // Create client in live/audience mode
        agoraClient = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
        agoraClientRef.current = agoraClient;
        await agoraClient.setClientRole('audience');
        await agoraClient.join(appId, ch, tok.token || null, watcherId);

        // Subscribe to remote user tracks
        agoraClient.on('user-published', async (remoteUser, mediaType) => {
          await agoraClient.subscribe(remoteUser, mediaType);
          if (mediaType === 'video' && videoRef.current) {
            remoteUser.videoTrack.play(videoRef.current);
          }
          if (mediaType === 'audio') {
            remoteUser.audioTrack.play();
          }
        });

        agoraClient.on('user-unpublished', (remoteUser, mediaType) => {
          if (mediaType === 'audio' && remoteUser.audioTrack) {
            remoteUser.audioTrack.stop();
          }
          if (mediaType === 'video' && remoteUser.videoTrack) {
            remoteUser.videoTrack.stop();
          }
        });

        liveService.bumpViewers(astroUid, 1);
      } catch (_) { /* stream may not be up yet */ }
    })();

    return () => {
      agoraClientRef.current = null;
      if (agoraClient) {
        agoraClient.leave().catch(() => {});
      } else {
        callService.leaveAgoraChannel().catch(() => {});
      }
      liveService.bumpViewers(astroUid, -1).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [astroUid]);

  // -----------------------------------------------------------------------
  // Publish user tracks when accepted as co-host (Fix 2)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (myRequest?.status !== 'connected' || !agoraClientRef.current) return undefined;
    let micTrack = null;
    let camTrack = null;

    (async () => {
      try {
        const mod = await import('agora-rtc-sdk-ng');
        const AgoraRTC = mod.default;
        const ac = agoraClientRef.current;
        await ac.setClientRole('host');

        if (callType === 'video') {
          [micTrack, camTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
          await ac.publish([micTrack, camTrack]);
          setLocalMicTrack(micTrack);
          setLocalCamTrack(camTrack);
          // Show own video in a local cam container if the element exists
          const localCamEl = document.getElementById('local-cam-container');
          if (localCamEl) camTrack.play(localCamEl);
        } else {
          micTrack = await AgoraRTC.createMicrophoneAudioTrack();
          await ac.publish([micTrack]);
          setLocalMicTrack(micTrack);
        }
      } catch (_) { /* camera/mic permission denied or track error */ }
    })();

    return () => {
      // Cleanup on disconnect
      try { if (micTrack) micTrack.close(); } catch (_) {}
      try { if (camTrack) camTrack.close(); } catch (_) {}
      setLocalMicTrack(null);
      setLocalCamTrack(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequest?.status]);

  // -----------------------------------------------------------------------
  // Cleanup local tracks on unmount
  // -----------------------------------------------------------------------

  useEffect(() => () => {
    try { if (localMicTrack) localMicTrack.close(); } catch (_) {}
    try { if (localCamTrack) localCamTrack.close(); } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Auto-waitlist: if request has been pending for 2+ minutes, move to queue
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!myRequest) {
      requestCreatedAtRef.current = null;
      return undefined;
    }
    if (myRequest.status !== 'pending') {
      requestCreatedAtRef.current = null;
      return undefined;
    }
    // Record when we first saw this pending request
    if (!requestCreatedAtRef.current) {
      const createdMs = myRequest.createdAt?.toMillis
        ? myRequest.createdAt.toMillis()
        : Date.now();
      requestCreatedAtRef.current = createdMs;
    }
    const t = setInterval(() => {
      const elapsed = Date.now() - requestCreatedAtRef.current;
      if (elapsed >= 2 * 60 * 1000 && myRequest.id) {
        moveToWaitlist(myRequest.id).catch(() => {});
      }
    }, 10000);
    return () => clearInterval(t);
  }, [myRequest]);

  // -----------------------------------------------------------------------
  // Dial tone when request is pending (Fix 5)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (myRequest?.status !== 'pending') {
      dialTonePlayedRef.current = false;
      return;
    }
    if (dialTonePlayedRef.current) return;
    dialTonePlayedRef.current = true;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const playBurst = (startTime) => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.5);
        osc1.start(startTime);
        osc1.stop(startTime + 1.5);
        osc2.start(startTime);
        osc2.stop(startTime + 1.5);
      };
      playBurst(ctx.currentTime);
      playBurst(ctx.currentTime + 2);
      playBurst(ctx.currentTime + 4);
    } catch (_) {}
  }, [myRequest?.status]);

  // -----------------------------------------------------------------------
  // Session elapsed timer for connected panel (Fix 7)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (myRequest?.status !== 'connected') {
      setSessionElapsed(0);
      return undefined;
    }
    const startMs = myRequest.connectedAt?.toMillis
      ? myRequest.connectedAt.toMillis()
      : Date.now();
    const t = setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [myRequest?.status, myRequest?.connectedAt]);

  // -----------------------------------------------------------------------
  // Listen for kicked status (Fix 8)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (myRequest?.status === 'kicked') {
      // Cleanup any published tracks
      try { if (localMicTrack) localMicTrack.close(); } catch (_) {}
      try { if (localCamTrack) localCamTrack.close(); } catch (_) {}
      setKickedOut(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequest?.status]);

  // -----------------------------------------------------------------------
  // Call countdown + elapsed timer
  // -----------------------------------------------------------------------

  useEffect(() => {
    const startMs =
      myRequest && myRequest.status === 'connected' && myRequest.connectedAt?.toMillis
        ? myRequest.connectedAt.toMillis()
        : 0;
    if (!startMs) { setCallRemain(0); setCallElapsed(0); return undefined; }
    const totalSec = Math.floor((Number(walletBal || 0) / livePrice) * 60);
    function tick() {
      const el = Math.floor((Date.now() - startMs) / 1000);
      setCallElapsed(el);
      const rem = Math.max(0, totalSec - el);
      setCallRemain(rem);
      if (rem === 0 && myRequest.id) {
        liveService.endJoinRequest(myRequest.id, 'user').catch(() => {});
      }
    }
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRequest, walletBal]);

  // -----------------------------------------------------------------------
  // Swipe up to next live
  // -----------------------------------------------------------------------

  const touchY = useRef(null);
  function onTouchStart(e) { touchY.current = e.touches[0].clientY; }
  function onTouchEnd(e) {
    const start = touchY.current;
    if (start == null) return;
    const end = e.changedTouches[0].clientY;
    touchY.current = null;
    if (start - end > 80 && otherLives[0]) {
      router.replace(`/live-view/${otherLives[0].astroUid}`);
    }
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const ended = info && info.live === false;
  const feed = [
    ...comments.map((c) => ({
      ...c, _t: c.createdAt?.toMillis ? c.createdAt.toMillis() : 0,
    })),
    ...fakes.map((f) => ({ ...f, _t: f._ts })),
  ].sort((a, b) => a._t - b._t);

  const vcount = liveService.liveSimViewers(info, features);
  const baseLivePrice = Number(info?.livePrice || info?.priceCall || 30);
  const rate = offerService.computeRate(baseLivePrice, offer, 'live');
  const livePrice = rate.final;
  const maxMins = livePrice > 0 ? Math.floor(Number(walletBal || 0) / livePrice) : 0;
  const MIN_JOIN_MINS = 3;
  const canJoin = maxMins >= MIN_JOIN_MINS;

  // Wishlist gate: show when 5+ connected users or astro is busy
  const astroBusy = !!(info?.busy);
  const showWishlist = connectedUsers.length >= 5 || astroBusy;

  // -----------------------------------------------------------------------
  // Simple in-page notification helper
  // -----------------------------------------------------------------------

  function notify(msg) {
    // Basic approach: alert on mobile, can be swapped for a toast library
    if (typeof window !== 'undefined' && msg) {
      // Non-blocking toast via a temporary DOM element
      try {
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = [
          'position:fixed', 'bottom:80px', 'left:50%',
          'transform:translateX(-50%)', 'background:rgba(0,0,0,0.8)',
          'color:#FFF8E7', 'padding:8px 18px', 'border-radius:20px',
          'font-size:13px', 'z-index:99999', 'pointer-events:none',
          'white-space:nowrap',
        ].join(';');
        document.body.appendChild(el);
        setTimeout(() => { try { document.body.removeChild(el); } catch (_) {} }, 3000);
      } catch (_) {}
    }
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  async function sendComment() {
    const v = text.trim();
    if (!v || !astroUid) return;
    setText('');
    stickRef.current = true;
    await liveService.addLiveComment(
      astroUid,
      { uid: user?.uid, name: profile?.name || 'Guest' },
      v,
    );
  }

  async function onFollow() {
    if (!user?.uid) { router.push('/login'); return; }
    await liveService.toggleFollow(astroUid, {
      uid: user.uid,
      name: profile?.name || 'Guest',
    });
  }

  async function handleFollow() {
    if (!user?.uid || !astroUid) {
      if (!user?.uid) router.push('/login');
      return;
    }
    try {
      const { doc: fDoc, setDoc: fSet, deleteDoc: fDel, getDoc: fGet }
        = await import('firebase/firestore');
      const followRef = fDoc(db, 'users', user.uid, 'following', astroUid);
      const snap = await fGet(followRef);
      if (snap.exists()) {
        await fDel(followRef);
        setIsFollowing(false);
      } else {
        await fSet(followRef, {
          astroId: astroUid,
          followedAt: new Date().toISOString(),
          astroName: info?.name || '',
        });
        setIsFollowing(true);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Follow error:', e);
      notify('Could not update follow status. Try again.');
    }
  }

  function onRequestJoin() {
    if (!user?.uid) { router.push('/login'); return; }
    // Show call type modal before opening the estimator
    setShowCallTypeModal(true);
  }

  function onCallTypeConfirm(type) {
    setCallType(type);
    setShowCallTypeModal(false);
    setSheet('estimate');
  }

  async function submitJoinRequest() {
    setSheet(null);
    await requestJoinLiveV2({
      astroUid,
      user: { uid: user.uid, name: profile?.name || 'Guest' },
      astroBusy,
      callType,
    });
  }

  async function onCancelJoin() {
    if (myRequest?.id) await liveService.endJoinRequest(myRequest.id, 'user');
  }

  async function onUserAccept() {
    if (myRequest?.id) await liveService.userAcceptJoin(myRequest.id);
  }

  async function onWishlistToggle() {
    if (!user?.uid) { router.push('/login'); return; }
    if (wishlisted) {
      await removeFromWishlist(astroUid, user.uid).catch(() => {});
      setWishlisted(false);
    } else {
      await addToWishlist(astroUid, user.uid, profile?.name || 'Guest').catch(() => {});
      setWishlisted(true);
    }
  }

  // -----------------------------------------------------------------------
  // Desktop redirect gate
  // -----------------------------------------------------------------------

  if (showDesktopRedirect) {
    return (
      <DesktopRedirectScreen
        downloadUrl={cfg.live_app_download_url}
        onBack={() => router.back()}
      />
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className="relative h-[100dvh] w-screen overflow-hidden bg-black text-white"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Full-bleed astrologer video */}
      <div ref={videoRef} className="absolute inset-0" />

      {/* Top gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent" />

      {/* ----------------------------------------------------------------
          TOP BAR: back button, name, viewer count, LIVE badge, quiz points
      ---------------------------------------------------------------- */}
      <div className="absolute left-3 right-3 top-3 z-30 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label="Back"
        >
          <IconBack />
        </button>

        <button
          onClick={() => setSheet('profile')}
          className="flex items-center gap-2 rounded-full bg-black/40 px-2 py-1 backdrop-blur"
        >
          <Avatar name={info?.name} photo={info?.photo} size={28} />
          <div className="text-left leading-tight">
            <div className="text-[12px] font-bold">
              {info?.name || 'Astrologer'}
            </div>
            <div className="flex items-center gap-1 text-[10px] opacity-90">
              {rate.discounted && (
                <span className="line-through opacity-60">
                  {'₹'}{rate.base}
                </span>
              )}
              <span className={rate.discounted ? 'font-bold text-amber-300' : ''}>
                {'₹'}{livePrice}/min
              </span>
              {rate.discounted && (
                <span className="rounded bg-emerald-500/80 px-1 text-[9px] font-bold">
                  -{rate.percentOff}%
                </span>
              )}
            </div>
          </div>
        </button>

        <button
          onClick={handleFollow}
          className="rounded-full px-3 py-1 text-[11px] font-bold"
          style={isFollowing
            ? { background: 'rgba(255,255,255,0.15)', color: 'white' }
            : { background: 'linear-gradient(135deg,#D4A12A,#7F2020)', color: 'white' }}
        >
          {isFollowing ? (
            <span className="inline-flex items-center gap-1">
              <IconCheckPill />Following
            </span>
          ) : 'Follow'}
        </button>

        <button
          onClick={() => setSheet('grid')}
          className="grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label="More live astrologers"
        >
          <IconGrid />
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Quiz points badge - only shown when user is logged in */}
          {user?.uid && userQuizPoints > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: 'rgba(212,161,42,0.25)', color: '#D4A12A', border: '1px solid #D4A12A55' }}
            >
              {userQuizPoints} pts
            </span>
          )}
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold">
            LIVE
          </span>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px]">
            {vcount}
          </span>
        </div>
      </div>

      {/* ----------------------------------------------------------------
          ENDED overlay
      ---------------------------------------------------------------- */}
      {ended && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85">
          <div className="text-lg font-bold">This live has ended</div>
          <button
            onClick={() => router.push('/live')}
            className="rounded-full bg-white px-5 py-2 font-semibold text-black"
          >
            Back to Live
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          KICKED overlay (Fix 8)
      ---------------------------------------------------------------- */}
      {kickedOut && (
        <div className="absolute inset-0 z-[9999] flex flex-col items-center justify-center gap-4 px-6"
          style={{ background: 'rgba(0,0,0,0.92)' }}>
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: 'rgba(127,32,32,0.35)', border: '2px solid #7F2020' }}
          >
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path d="M18 6L6 18M6 6l12 12" stroke="#7F2020" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="text-center text-base font-bold" style={{ color: '#FFF8E7' }}>
            You have been removed from this live session by the astrologer.
          </div>
          <button
            onClick={() => router.push('/live')}
            className="rounded-full px-6 py-2.5 text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}
          >
            Back to Live
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          AUTOPLAY UNMUTE button (Fix 1)
      ---------------------------------------------------------------- */}
      {needsUnmute && (
        <div
          className="absolute inset-x-0 z-50 flex justify-center"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        >
          <button
            onClick={() => {
              try {
                if (agoraClientRef.current) {
                  agoraClientRef.current.remoteUsers.forEach((u) => {
                    if (u.audioTrack) u.audioTrack.play();
                  });
                }
              } catch (_) {}
              setNeedsUnmute(false);
            }}
            className="flex items-center gap-2 rounded-2xl px-6 py-4 text-base font-bold shadow-2xl"
            style={{
              background: 'linear-gradient(135deg,#D4A12A,#7F2020)',
              color: '#FFF8E7',
              border: '2px solid rgba(212,161,42,0.6)',
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path
                d="M12 14a3 3 0 003-3V7a3 3 0 00-6 0v4a3 3 0 003 3zM19 11a7 7 0 11-14 0M12 18v3M8 21h8"
                stroke="#FFF8E7" strokeWidth="2" strokeLinecap="round" fill="none"
              />
            </svg>
            Tap to Enable Audio
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          RIGHT RAIL: like, phone/call, share, wishlist
      ---------------------------------------------------------------- */}
      <div className="absolute bottom-32 right-2 z-20 flex flex-col items-center gap-3">
        {/* Like */}
        <button
          onClick={() => liveService.likeLive(astroUid)}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Like"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur">
            <IconHeart />
          </span>
          <span className="mt-0.5">{info?.likes || 0}</span>
        </button>

        {/* Phone / call control - morphs through states */}
        {(() => {
          const s = myRequest?.status;
          const inQueue = s === 'pending' || s === 'queued';
          const isConnected = s === 'connected';
          const onTap = () => {
            if (inQueue || s === 'astro_ok') {
              if (myRequest?.id) {
                liveService.endJoinRequest(myRequest.id, 'user').catch(() => {});
              }
              return;
            }
            if (isConnected) return;
            onRequestJoin();
          };
          return (
            <button
              onClick={onTap}
              className="flex flex-col items-center text-[10px] font-semibold"
              aria-label="Live call control"
            >
              <span
                className="grid h-12 w-12 place-items-center rounded-full shadow-lg"
                style={{
                  background: inQueue
                    ? '#DC2626'
                    : 'linear-gradient(135deg,#D4A12A,#7F2020)',
                }}
              >
                <IconPhone />
              </span>
              {isConnected ? (
                <span className="mt-0.5 font-mono text-[11px] text-emerald-300">
                  {fmtClock(callRemain)}
                </span>
              ) : inQueue ? (
                <>
                  <span className="mt-0.5">Cancel</span>
                  <span className="text-[9px] opacity-80">
                    {s === 'queued' ? 'waitlist' : 'waiting...'}
                  </span>
                </>
              ) : s === 'astro_ok' ? (
                <span className="mt-0.5 text-emerald-300 text-[9px]">
                  Tap Accept
                </span>
              ) : (
                <>
                  <span className="mt-0.5">Live call</span>
                  <span className="text-[9px] opacity-80">
                    {rate.discounted && (
                      <span className="line-through mr-0.5 opacity-60">
                        {'₹'}{rate.base}
                      </span>
                    )}
                    {'₹'}{livePrice}/min
                  </span>
                </>
              )}
            </button>
          );
        })()}

        {/* Share */}
        <button
          onClick={() => {
            try {
              navigator.share?.({
                title: `${info?.name || 'Astrologer'} is live now`,
                url: typeof window !== 'undefined' ? window.location.href : '',
              });
            } catch (_) {}
          }}
          className="flex flex-col items-center text-[10px] font-semibold"
          aria-label="Share"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/40 backdrop-blur">
            <IconShare />
          </span>
          <span className="mt-0.5">Share</span>
        </button>

        {/* Wishlist - only shown when 5+ connected users or astro busy */}
        {showWishlist && (
          <button
            onClick={onWishlistToggle}
            className="flex flex-col items-center text-[10px] font-semibold"
            aria-label={wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <span
              className="grid h-11 w-11 place-items-center rounded-full backdrop-blur"
              style={{
                background: wishlisted
                  ? 'rgba(212,161,42,0.35)'
                  : 'rgba(0,0,0,0.4)',
              }}
            >
              <IconHeart2 />
            </span>
            <span className="mt-0.5" style={{ color: wishlisted ? '#D4A12A' : 'white' }}>
              {wishlisted ? 'Wishlisted' : 'Wishlist'}
            </span>
          </button>
        )}
      </div>

      {/* ----------------------------------------------------------------
          JOIN REQUEST BANNERS
      ---------------------------------------------------------------- */}

      {/* Pending / queued / astro_ok banners */}
      {myRequest && myRequest.status !== 'connected' && (
        <div className="absolute left-3 right-3 top-16 z-20 rounded-2xl bg-black/70 px-3 py-2 backdrop-blur">
          {myRequest.status === 'pending' && (
            <div className="text-[12px]">
              <b>Request sent.</b> Waiting for {info?.name || 'astrologer'} to accept...
              <button onClick={onCancelJoin} className="ml-2 underline">
                Cancel
              </button>
            </div>
          )}
          {myRequest.status === 'queued' && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px]">
                <b>You are in the waitlist.</b>{' '}
                {info?.name || 'astrologer'} is on a call - you will be next.
              </div>
              <button
                onClick={onCancelJoin}
                className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
                style={{ background: '#7F2020' }}
              >
                Cancel
              </button>
            </div>
          )}
          {myRequest.status === 'astro_ok' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px]">
                <b>{info?.name || 'Astrologer'} accepted.</b> Connect now?
              </span>
              <div className="flex gap-1">
                <button
                  onClick={onCancelJoin}
                  className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold"
                >
                  Decline
                </button>
                <button
                  onClick={onUserAccept}
                  className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-bold"
                >
                  Accept
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------
          IN-CALL: elapsed + balance row
      ---------------------------------------------------------------- */}
      {myRequest?.status === 'connected' && (
        <div className="absolute inset-x-0 bottom-[calc(28vh+72px+52px)] z-30 flex items-center justify-center gap-3 px-4">
          <span className="rounded-full bg-black/50 px-3 py-1 font-mono text-[12px] text-white backdrop-blur">
            {fmtClock(callElapsed)}
          </span>
          <span
            className={`rounded-full px-3 py-1 font-mono text-[12px] backdrop-blur ${
              callRemain <= 60 && callRemain > 0
                ? 'font-bold'
                : 'bg-black/50 text-white'
            }`}
            style={
              callRemain <= 60 && callRemain > 0
                ? { background: 'rgba(212,161,42,0.8)', color: 'white' }
                : {}
            }
          >
            {fmtClock(callRemain)} left
          </span>
        </div>
      )}

      {/* Low-balance banner */}
      {myRequest?.status === 'connected' && callRemain > 0 && callRemain <= 60 && (
        <div
          className="absolute inset-x-0 bottom-[calc(28vh+72px+52px+40px)] z-30 flex items-center justify-between gap-2 px-4 py-1.5 text-[12px] font-bold text-white backdrop-blur"
          style={{ background: 'rgba(212,161,42,0.9)' }}
        >
          <span>Low balance, about {Math.ceil(callRemain / 60)} min left.</span>
          <button
            onClick={() => router.push(`/wallet?recharge=${Math.max(50, livePrice * 10)}`)}
            className="rounded-full bg-white px-3 py-0.5 text-[11px] font-bold"
            style={{ color: '#D4A12A' }}
          >
            Recharge
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          IN-CALL: local cam preview + connected users (Fix 2 + Fix 7)
      ---------------------------------------------------------------- */}
      {myRequest?.status === 'connected' && (
        <div
          className="absolute left-3 z-30"
          style={{ bottom: 'calc(28vh + 72px + 60px)' }}
        >
          {/* Local cam preview for video calls */}
          {callType === 'video' && (
            <div
              id="local-cam-container"
              style={{
                width: 72, height: 96, borderRadius: 10, background: '#111',
                overflow: 'hidden', border: '2px solid #D4A12A',
                marginBottom: 6,
              }}
            />
          )}
          {/* Session elapsed + connected users count */}
          <div
            className="rounded-xl px-2 py-1 text-center"
            style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(212,161,42,0.4)' }}
          >
            <div className="font-mono text-[11px] font-bold" style={{ color: '#D4A12A' }}>
              {fmtClock(sessionElapsed)}
            </div>
            {connectedUsers.length > 0 && (
              <div className="text-[9px]" style={{ color: 'rgba(255,248,231,0.7)' }}>
                {connectedUsers.length} on call
              </div>
            )}
          </div>
          {/* Mini connected users list */}
          {connectedUsers.length > 0 && (
            <div className="mt-1 space-y-1">
              {connectedUsers.slice(0, 3).map((cu) => (
                <div
                  key={cu.uid || cu.userId}
                  className="flex items-center gap-1 rounded-lg px-1.5 py-1"
                  style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style={{ background: '#7F2020' }}
                  >
                    {(cu.name || cu.displayName || 'U').charAt(0).toUpperCase()}
                  </span>
                  <span className="max-w-[56px] truncate text-[9px]" style={{ color: '#FFF8E7' }}>
                    {cu.name || cu.displayName || 'Guest'}
                  </span>
                </div>
              ))}
              {connectedUsers.length > 3 && (
                <div className="text-center text-[9px]" style={{ color: 'rgba(255,248,231,0.6)' }}>
                  +{connectedUsers.length - 3} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------
          IN-CALL CONTROLS: mic, camera, recharge, end
      ---------------------------------------------------------------- */}
      {myRequest?.status === 'connected' && (
        <div className="absolute inset-x-0 bottom-[calc(28vh+72px)] z-30 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              const next = !micOn;
              setMicOn(next);
              try {
                if (localMicTrack) {
                  localMicTrack.setEnabled(next);
                } else {
                  callService.setMuted(!next);
                }
              } catch (_) {}
            }}
            className="grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur"
            aria-label="Mic"
          >
            <IconMic off={!micOn} />
          </button>
          <button
            onClick={() => {
              const next = !camOn;
              setCamOn(next);
              try {
                if (localCamTrack) {
                  localCamTrack.setEnabled(next);
                } else {
                  callService.setCameraEnabled(next);
                }
              } catch (_) {}
            }}
            className="grid h-12 w-12 place-items-center rounded-full bg-white/15 backdrop-blur"
            aria-label="Camera"
          >
            <IconVideo off={!camOn} />
          </button>
          <button
            onClick={() => router.push(`/wallet?recharge=${Math.max(50, livePrice * 10)}`)}
            className="grid h-12 px-3 place-items-center rounded-full text-[11px] font-bold backdrop-blur"
            style={{ background: 'rgba(34,197,94,0.9)' }}
            aria-label="Recharge"
          >
            + Recharge
          </button>
          <button
            onClick={() => {
              if (myRequest?.id) {
                liveService.endJoinRequest(myRequest.id, 'user').catch(() => {});
              }
            }}
            className="grid h-14 w-14 place-items-center rounded-full bg-red-600 shadow-lg"
            aria-label="End call"
          >
            <IconEndCall />
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------
          CHAT OVERLAY: transparent, bottom 80% of screen
      ---------------------------------------------------------------- */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{ height: '80%', pointerEvents: 'none' }}
      >
        {/* Gradient background: transparent at top, semi-dark at bottom */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Comments scroll area - takes up most of the overlay */}
        <div
          ref={cRef}
          onScroll={onCommentsScroll}
          className="absolute left-0 right-0 px-3"
          style={{
            top: 0,
            bottom: '60px',
            overflowY: 'auto',
            scrollbarWidth: 'none',
            pointerEvents: 'auto',
            paddingTop: '12px',
            maskImage: 'linear-gradient(to bottom, transparent 0%, #000 30%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 30%)',
          }}
        >
          <div className="space-y-1.5 pr-14">
            {feed.map((c) => (
              <CommentRow key={c.id} c={c} dp={dp} />
            ))}
          </div>
        </div>

        {/* Scroll to newest pill */}
        {!stickRef.current && (
          <button
            onClick={() => {
              stickRef.current = true;
              const el = cRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold backdrop-blur"
            style={{ bottom: '70px', pointerEvents: 'auto' }}
          >
            Newest
          </button>
        )}

        {/* Input pill */}
        <div
          className="absolute left-0 right-0 bottom-0 flex items-center gap-2 px-3 pb-3"
          style={{ pointerEvents: 'auto' }}
        >
          <input
            ref={inputRef}
            className="h-11 flex-1 rounded-full px-4 text-[15px] text-white placeholder-white/60 outline-none"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            placeholder="Add comment..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendComment()}
          />
          <button
            onClick={sendComment}
            className="h-11 rounded-full px-4 font-bold text-white text-[13px]"
            style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}
          >
            Send
          </button>
        </div>
      </div>

      {/* Swipe hint */}
      {otherLives[0] && (
        <div
          className="absolute inset-x-0 text-center text-[11px] opacity-70"
          style={{ bottom: '6px' }}
        >
          Swipe up for {otherLives[0].name || 'next live'}
        </div>
      )}

      {/* ----------------------------------------------------------------
          OVERLAYS
      ---------------------------------------------------------------- */}

      {/* Call type modal */}
      {showCallTypeModal && (
        <CallTypeModal
          info={info}
          onClose={() => setShowCallTypeModal(false)}
          onConfirm={onCallTypeConfirm}
        />
      )}

      {sheet === 'profile' && (
        <ProfileSheet
          astroUid={astroUid}
          info={info}
          profile={profileData}
          following={following}
          onFollow={onFollow}
          onCall={onRequestJoin}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'grid' && (
        <GridSheet
          lives={otherLives}
          onPick={(uid) => router.replace(`/live-view/${uid}`)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'estimate' && (
        <EstimateSheet
          info={info}
          rate={rate}
          walletBal={walletBal}
          maxMins={maxMins}
          canJoin={canJoin}
          minMins={MIN_JOIN_MINS}
          onClose={() => setSheet(null)}
          onConfirm={submitJoinRequest}
          onRecharge={(amt) => router.push(`/wallet?recharge=${amt}`)}
        />
      )}

      {/* KBC Quiz overlay */}
      {showQuiz && activeQuiz && (
        <QuizOverlay
          quiz={activeQuiz}
          userId={user?.uid || ''}
          userName={profile?.name || 'Guest'}
          astroId={astroUid}
          onDismiss={() => {
            setShowQuiz(false);
            setActiveQuiz(null);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------
// CommentRow - royal palette chat style
// -----------------------------------------------------------------------

function CommentRow({ c, dp }) {
  const isJoin = c.type === 'join' || c.type === 'follow' || c.type === 'join_request';

  if (isJoin) {
    return (
      <div className="flex items-center gap-1.5">
        {c.team && dp ? (
          <img src={dp} alt="Compliance Team" className="h-5 w-5 shrink-0 rounded-full object-cover" />
        ) : (
          <Avatar name={c.name} photo={c.photo} size={20} />
        )}
        <span
          className="text-[12px] italic leading-tight"
          style={{ color: '#FFF8E7' }}
        >
          <span className="font-semibold" style={{ color: '#D4A12A' }}>
            {c.name || 'Guest'}
          </span>
          {c.team && (
            <svg
              width="10" height="10" viewBox="0 0 24 24"
              style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 2 }}
            >
              <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
              <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6 6.4-6.4-1.3-1.3z" />
            </svg>
          )}{' '}
          {c.type === 'join' ? 'joined' : c.type === 'follow' ? 'started following' : (c.text || 'wants to join')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      {c.team && dp ? (
        <img src={dp} alt="Compliance Team" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <Avatar name={c.name} photo={c.photo} size={28} />
      )}
      <div className="min-w-0">
        <div className="text-[12px] leading-tight">
          <span className="font-bold" style={{ color: '#D4A12A' }}>
            {c.name || 'Guest'}
          </span>
          {c.uid && (
            <span className="ml-1 text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
              #{String(c.uid).slice(-6)}
            </span>
          )}
          {c.team && (
            <svg
              width="11" height="11" viewBox="0 0 24 24"
              style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 3 }}
            >
              <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
              <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6 6.4-6.4-1.3-1.3z" />
            </svg>
          )}
        </div>
        <div className="text-[14px] leading-snug text-white">{c.text}</div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// EstimateSheet
// -----------------------------------------------------------------------

function EstimateSheet({ info, rate, walletBal, maxMins, canJoin, minMins,
  onClose, onConfirm, onRecharge }) {
  const ratePerMin = rate.final;
  const need = ratePerMin * minMins;
  const wallet = Number(walletBal || 0);
  const shortfall = Math.max(0, need - wallet);
  const halfMin = need / 2;
  const ten = ratePerMin * 10;
  let recommended = 0;
  if (!canJoin) {
    recommended = wallet >= halfMin
      ? Math.ceil((shortfall + ratePerMin * 2) / 10) * 10
      : Math.ceil(ten / 10) * 10;
  }
  function reason() {
    if (canJoin) return '';
    if (wallet >= halfMin) {
      return `You are ${'₹'}${shortfall} short of the minimum. Add `
        + `${'₹'}${recommended} so you can talk past the first ${minMins} minutes comfortably.`;
    }
    return `Wallet ${'₹'}${wallet} is less than half of the minimum (${'₹'}`
      + `${need}). Add ${'₹'}${recommended} for a ${Math.round(recommended / ratePerMin)}-minute buffer.`;
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-4 text-dark-text shadow-2xl"
        style={{ maxHeight: '80vh', overflowY: 'auto' }}
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-gray-200" />
        <h3 className="text-base font-bold">
          Connect with {info?.name || 'astrologer'}
        </h3>
        <p className="mt-0.5 text-[11px] text-sub-text">
          Live call rate. The timer starts only when both of you accept and the audio connects.
          You can disconnect any time - only minutes you attended are debited.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Tile
            k="Rate"
            v={(
              <span className="flex items-baseline gap-1">
                {rate.discounted && (
                  <span className="text-[12px] text-sub-text line-through">
                    {'₹'}{rate.base}
                  </span>
                )}
                <span className="text-base font-bold">{'₹'}{ratePerMin}</span>
                <span className="text-[11px] text-sub-text">/min</span>
                {rate.discounted && (
                  <span className="rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-700">
                    -{rate.percentOff}%
                  </span>
                )}
              </span>
            )}
          />
          <Tile
            k="Wallet"
            v={(
              <span className="text-base font-bold text-emerald-700">
                {'₹'}{Math.round(walletBal)}
              </span>
            )}
          />
          <Tile
            k="You can talk for"
            v={(
              <span className={`text-base font-bold ${canJoin ? 'text-dark-text' : 'text-rose-700'}`}>
                {canJoin ? `up to ${maxMins} mins` : `${maxMins} mins (need ${minMins})`}
              </span>
            )}
          />
          <Tile k="Minimum balance" v={`${'₹'}${need} (${minMins} min)`} />
        </div>

        {!canJoin && (
          <div className="mt-3 rounded-card border border-rose-200 bg-rose-50 p-3">
            <div className="text-[12px] text-rose-800">{reason()}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[recommended, recommended + ten, recommended + 2 * ten].map((amt, i) => (
                <button
                  key={amt}
                  onClick={() => onRecharge(amt)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${
                    i === 0 ? 'bg-primary text-white' : 'border border-gray-300 text-sub-text'
                  }`}
                >
                  + {'₹'}{amt}
                  {i === 0 && <span className="ml-1 opacity-80">recommended</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-3 text-[10.5px] leading-relaxed text-sub-text">
          You will be added to the astrologer&apos;s waitlist. Once they accept, you have to
          confirm one more time before the call begins. The countdown timer in the call button
          shows your remaining minutes in real time. You can recharge mid-call without
          disconnecting.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold text-sub-text hover:bg-bg-light"
          >
            Cancel
          </button>
          {canJoin ? (
            <button
              onClick={onConfirm}
              className="rounded-full px-5 py-2 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}
            >
              Continue &amp; request
            </button>
          ) : (
            <button
              onClick={() => onRecharge(recommended)}
              className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white"
            >
              + Wallet {'₹'}{recommended}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ k, v }) {
  return (
    <div className="rounded-card bg-bg-light/40 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-sub-text">{k}</div>
      <div className="mt-0.5">{v}</div>
    </div>
  );
}

// -----------------------------------------------------------------------
// ProfileSheet
// -----------------------------------------------------------------------

function ProfileSheet({ astroUid, info, profile, following, onFollow, onCall, onClose }) {
  const p = profile || {};
  const photo = info?.photo || p.photo || p.photoUrl;
  const skills = Array.isArray(p.skills)
    ? p.skills
    : String(p.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
  const langs = Array.isArray(p.languages)
    ? p.languages
    : String(p.languages || '').split(',').map((s) => s.trim()).filter(Boolean);
  const baseCall = Number(p.priceCall || info?.priceCall || 30);
  const callRate = offerService.computeRate(baseCall, p.offer, 'call');
  const baseChat = Number(p.priceChat || 20);
  const chatRate = offerService.computeRate(baseChat, p.offer, 'chat');
  const gallery = Array.isArray(p.gallery) ? p.gallery : (Array.isArray(p.photos) ? p.photos : []);
  const orders = Number(p.orders || p.ordersCount || 0);
  const minutes = Number(p.minutes || p.totalMinutes || 0);
  const rating = Number(p.ratingAvg || p.rating || 4.8);
  const [showFullBio, setShowFullBio] = useState(false);
  const bio = String(p.bio || '');
  const longBio = bio.length > 180;
  const [reviews, setReviews] = useState(null);
  useEffect(() => {
    if (!astroUid) return;
    reviewService.getReviews(astroUid)
      .then((r) => setReviews(r || [])).catch(() => setReviews([]));
  }, [astroUid]);
  function compact(n) {
    if (n >= 1000) return `${Math.floor(n / 1000)}k+`;
    return `${n}`;
  }
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-3xl bg-white text-dark-text shadow-2xl"
        style={{ maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-3xl bg-white/95 px-4 pt-3 pb-2 backdrop-blur">
          <div className="flex items-center gap-1.5 text-[13px] text-dark-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            <b>{info?.name || p.name || 'Astrologer'}</b>
            <span className="text-sub-text">is live now!</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="rounded-full border border-gray-200 px-3 py-1 text-[11px] font-bold text-dark-text"
            >
              Watch
            </button>
            <button
              onClick={() => { onClose(); onCall(); }}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}
            >
              <IconPhone /> Live call
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/10 text-black ml-1"
              aria-label="Close"
            >
              <IconClose />
            </button>
          </div>
        </div>

        <div className="px-4 pt-2">
          <div className="rounded-2xl border border-gray-200 p-3">
            <div className="flex items-start gap-3">
              {photo ? (
                <img
                  src={photo} alt={info?.name || ''}
                  className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-amber-400/60"
                />
              ) : <Avatar name={info?.name} size={64} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-base font-bold">
                  {info?.name || p.name || 'Astrologer'}
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78 1.2-.36 3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3 .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2 1.2-2.78 3 .36L12 1.5z" />
                    <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6 6.4-6.4-1.3-1.3z" />
                  </svg>
                  <button
                    onClick={onFollow}
                    className="ml-auto rounded-full px-3 py-0.5 text-[11px] font-bold"
                    style={following
                      ? { background: '#f3f4f6', color: '#374151' }
                      : { background: 'linear-gradient(135deg,#D4A12A,#7F2020)', color: 'white' }}
                  >
                    {following ? 'Following' : 'Follow'}
                  </button>
                </div>
                {!!skills.length && (
                  <div className="text-[12px] text-sub-text line-clamp-1">{skills.join(', ')}</div>
                )}
                {!!langs.length && (
                  <div className="text-[12px] text-sub-text">{langs.join(', ')}</div>
                )}
                {!!p.experience && (
                  <div className="text-[12px] text-sub-text">Exp: {p.experience} Years</div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[13px]">
                  <span className="text-amber-500">{'★'.repeat(Math.round(rating))}</span>
                  <span className="flex items-baseline gap-1">
                    {callRate.discounted && (
                      <span className="text-[12px] text-sub-text line-through">
                        {'₹'}{callRate.base}
                      </span>
                    )}
                    <span className="font-bold">{'₹'}{callRate.final}</span>
                    <span className="text-[11px] text-sub-text">/min</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 divide-x divide-gray-200 rounded-card border border-gray-200">
              <div className="flex items-center justify-center gap-1 py-2 text-[12px]">
                <span className="text-amber-700">🧾</span>
                <b>{compact(orders)}</b>
                <span className="text-sub-text">orders</span>
              </div>
              <div className="flex items-center justify-center gap-1 py-2 text-[12px]">
                <span className="text-amber-700">💬</span>
                <b>{compact(minutes)}</b>
                <span className="text-sub-text">mins</span>
              </div>
            </div>

            {bio && (
              <div className="mt-3 text-[13px] leading-relaxed">
                {longBio && !showFullBio ? (
                  <>
                    {bio.slice(0, 180)}...{' '}
                    <button
                      onClick={() => setShowFullBio(true)}
                      className="font-bold text-primary hover:underline"
                    >
                      show more
                    </button>
                  </>
                ) : bio}
              </div>
            )}
          </div>
        </div>

        {gallery.length > 0 && (
          <div className="mt-4 px-4">
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              {gallery.slice(0, 8).map((g, i) => (
                <img
                  key={i} src={g} alt={`gallery ${i + 1}`}
                  className="h-32 w-28 shrink-0 rounded-2xl object-cover"
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 px-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold">User Reviews</h4>
            {reviews && reviews.length > 0 && (
              <button
                onClick={onClose}
                className="text-[12px] font-bold text-primary hover:underline"
              >
                View All
              </button>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {reviews === null && (
              <div className="text-[12px] text-sub-text">Loading...</div>
            )}
            {reviews && reviews.length === 0 && (
              <div className="rounded-card bg-bg-light/40 p-3 text-[12px] text-sub-text">
                No reviews yet.
              </div>
            )}
            {reviews && reviews.slice(0, 2).map((r, i) => (
              <div key={r.id || i} className="rounded-2xl border border-gray-200 p-3">
                <div className="flex items-center gap-2">
                  <Avatar name={r.userName || r.name || 'User'} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">
                      {r.userName || r.name || 'Anonymous'}
                    </div>
                    <div className="text-amber-500 text-[12px]">
                      {'★'.repeat(Math.round(r.rating || 5))}
                    </div>
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed">
                  {r.comment || r.text || ''}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
          <button
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-full border border-gray-300 py-2.5 text-sm font-bold text-dark-text hover:bg-bg-light"
          >
            Chat
            <span className="text-[10px] text-sub-text">
              {chatRate.discounted && (
                <span className="line-through mr-0.5">{'₹'}{chatRate.base}</span>
              )}
              {'₹'}{chatRate.final}/min
            </span>
          </button>
          <button
            onClick={() => { onClose(); onCall(); }}
            className="flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#D4A12A,#7F2020)' }}
          >
            <IconPhone /> Call
            <span className="text-[10px] opacity-90">{'₹'}{callRate.final}/min</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// GridSheet
// -----------------------------------------------------------------------

function GridSheet({ lives, onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl p-4 text-white shadow-2xl"
        style={{ background: '#1A0A0A', maxHeight: '75vh', overflowY: 'auto' }}
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/30" />
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-bold">Live astrologers</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/15"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        {lives.length === 0 ? (
          <div className="rounded-card bg-white/10 p-6 text-center text-[12px] opacity-80">
            You&apos;re watching the only live right now. Swipe down to close.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {lives.map((l) => (
              <button
                key={l.astroUid}
                onClick={() => onPick(l.astroUid)}
                className="relative overflow-hidden rounded-2xl bg-black text-left"
                style={{ aspectRatio: '3/4' }}
              >
                {l.photo ? (
                  <img
                    src={l.photo} alt={l.name}
                    className="absolute inset-0 h-full w-full object-cover opacity-80"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-3xl font-bold opacity-70">
                    {(l.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold">
                  LIVE
                </span>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <div className="truncate text-[12px] font-bold">{l.name}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
