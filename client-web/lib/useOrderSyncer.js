import { useEffect } from 'react';
import { kundliService } from '@astro/shared';

// Background sync trigger mounted by _app.js so it runs on every
// customer-facing page. Fires the relay's action:'sweepPending'
// endpoint, which walks every *_generating order across all
// customers, polls AstroSeer's status endpoint for each, and
// flips Firestore status:'ready' (+ fetches PDF + emails the
// customer) as soon as AstroSeer reports the job done.
//
// Why mount globally instead of only on /orders?
//
//   - Customer might be on /kundli or /discover when their report
//     finishes generating. Without a global trigger they would not
//     see the "Ready" state until they navigate to /orders or wait
//     for the next manual visit.
//
//   - Each sweep is cheap (one collectionGroup query + a few
//     AstroSeer pings + Firestore writes) and batched at 50 per
//     call so we never blow Vercel's 60s function cap.
//
//   - For full 24/7 automation independent of any customer being
//     in the app, the user should also point an external cron
//     service (cron-job.org, EasyCron) at the same endpoint.
//
// Schedule:
//   - Fire ONCE 3s after mount so we don't pile onto the initial
//     page-render network burst.
//   - Then every 60s while the app stays open.
//
// This is purely background. Errors are swallowed.
export function useOrderSyncer({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined') return undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      kundliService.triggerSweepPending().catch(() => { /* */ });
    };
    // Sweep cadence dropped from 60s -> 5min on 2026-05-29 to
    // protect Firestore quota. At 60s, the sweep was reading 500
    // docs/minute = ~720K reads/day, easily blowing the Spark plan
    // 50K/day cap. At 5min it's ~144K/day. Combined with the docs
    // being capped at 100 per sweep (was 500), total reads drop
    // ~25x. The webhook from AstroSeer API (when env vars are set)
    // makes most orders flip to ready WITHOUT needing the sweep at
    // all, so this slower cadence is purely the safety net.
    const t1 = setTimeout(tick, 5000);
    const t2 = setInterval(tick, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearInterval(t2);
    };
  }, [enabled]);
}
