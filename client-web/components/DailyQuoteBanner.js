import { useEffect, useState } from 'react';
import { dailyQuoteService } from '@astro/shared';

// Daily quote banner ("Hey, Cosmic Explorer" + a rotating quote).
// Default off; only renders when settings/dailyQuotes.enabled === true.
// Subscribes via onSnapshot so the moment the admin flips the toggle
// in /admin-daily-quotes the customer sees it (or it disappears)
// without a refresh.
export default function DailyQuoteBanner() {
  const [state, setState] = useState(null);
  useEffect(() => dailyQuoteService.listenDailyQuotes(setState), []);
  if (!state || !state.enabled) return null;
  const quote = dailyQuoteService.quoteForToday(state.quotes,
    new Date());
  return (
    <div
      className="mt-4 overflow-hidden rounded-2xl text-white shadow-sm"
      style={{
        background: 'linear-gradient(135deg, #2A1410 0%, #4a1212 45%, '
          + '#7F2020 100%)',
      }}>
      <div className="relative px-5 py-4 sm:px-6 sm:py-5">
        {/* Soft star sparkle accent in the top-right. */}
        <span aria-hidden style={{
          position: 'absolute', top: 8, right: 14,
          fontSize: 14, opacity: 0.65,
        }}>✦</span>
        <span aria-hidden style={{
          position: 'absolute', top: 22, right: 30,
          fontSize: 9, opacity: 0.45,
        }}>✦</span>
        <span aria-hidden style={{
          position: 'absolute', top: 36, right: 18,
          fontSize: 7, opacity: 0.35,
        }}>✦</span>
        <div className="text-[11px] font-bold uppercase tracking-widest
          text-[#D4A12A]">
          {state.subtitle || 'Quote for the day'}
        </div>
        <h3 className="mt-1 text-lg font-bold sm:text-xl">
          {state.title || 'Hey, Cosmic Explorer'}
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-snug
          text-white/90 sm:text-base">
          {quote}
        </p>
      </div>
    </div>
  );
}
