import { useEffect, useState } from 'react';
import { dailyQuoteService } from '@astro/shared';
import { useOptionalClient } from '../lib/useAuth';

// Daily quote banner ("Hey, Cosmic Explorer" + a rotating quote).
// Subscribes via onSnapshot so the moment the admin flips the toggle
// in /admin-daily-quotes the customer sees it (or it disappears)
// without a refresh.
//
// 2026-06-08: per-device visibility - same pattern as the home hero
// banner. showMobile / showDesktop both default OFF; the customer
// sees the card only on the devices the admin enabled.
export default function DailyQuoteBanner() {
  const [state, setState] = useState(null);
  const { user, profile } = useOptionalClient();
  useEffect(() => dailyQuoteService.listenDailyQuotes(setState), []);
  if (!state) return null;
  // Logged-in viewer with a usable name -> personalised greeting
  // ("Hello, Vicky"). Guest or nameless profile -> brand greeting
  // ("Hey, Cosmic Explorer"). resolveTitle handles the [Name]
  // substitution + the empty-titleAuthed fallback.
  const headline = dailyQuoteService.resolveTitle(state,
    user ? profile : null);
  const showMobile = state.showMobile !== false;
  const showDesktop = state.showDesktop !== false;
  if (!showMobile && !showDesktop) return null;
  // 2026-06-08: quotes are now scheduled per IST date. If nothing is
  // pinned to today, hide the banner outright - we never show a
  // random fallback (the operator either scheduled today or they
  // didn't).
  const quote = dailyQuoteService.quoteForToday(state.quotes);
  if (!quote) return null;
  const visibility = showMobile && showDesktop ? ''
    : showMobile ? 'md:hidden' : 'hidden md:block';
  return (
    <div
      className={`mt-4 overflow-hidden rounded-2xl text-white shadow-sm
        ${visibility}`}
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
        {state.subtitle && (
          <div className="text-[11px] font-bold uppercase
            tracking-widest text-[#D4A12A]">
            {state.subtitle}
          </div>
        )}
        <h3 className={`${state.subtitle ? 'mt-1' : ''}
          text-lg font-bold sm:text-xl`}>
          {headline}
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-snug
          text-white/90 sm:text-base">
          {quote}
        </p>
      </div>
    </div>
  );
}
