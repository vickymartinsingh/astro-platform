import { useEffect } from 'react';
import { kundliService } from '@astro/shared';

// ----------------------------------------------------------------
// Client-side sweep gate (localStorage).
//
// Problem: every browser tab that has the app open fires a sweep
// independently on its own 5-minute timer. With N tabs across M
// users, the relay receives N*M sweep calls every 5 minutes. Each
// call runs a collectionGroup('orders').limit(100) Firestore query
// = 100 reads. With just 3 users (6 tabs) open: 6 * 100 * 288
// sweeps/day = 172 800 reads/day, 3.5x the Spark plan 50K limit.
//
// Fix: before firing a sweep we check a localStorage timestamp. If
// the last sweep was less than _SWEEP_LS_MS ago we skip silently.
// localStorage is shared across all tabs on the same device/user,
// so only ONE tab per device actually fires per sweep window. The
// relay also has a server-side gate for cases where different users
// on different devices call simultaneously (see kundliReport.js).
// ----------------------------------------------------------------
const _SWEEP_LS_KEY = 'ast_sweep_ts';
const _SWEEP_LS_MS = 4 * 60 * 1000; // 4-minute client-side gate

function _claimSweepSlot() {
  try {
    const last = +(localStorage.getItem(_SWEEP_LS_KEY) || 0);
    if (Date.now() - last < _SWEEP_LS_MS) return false;
    localStorage.setItem(_SWEEP_LS_KEY, String(Date.now()));
    return true;
  } catch (_) {
    return true; // if localStorage is blocked, allow the sweep
  }
}

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
//   - For full 24/7 automation independent of any customer being
//     in the app, the user should also point an external cron
//     service (cron-job.org, EasyCron) at the same endpoint.
//     If a cron is configured, the client sweep is purely a
//     backup and the long interval does not matter at all.
//
// Schedule:
//   - Fire ONCE 5s after mount (with localStorage gate check).
//   - Then every 15 min while the app stays open.
//
// Quota analysis (2026-06-11 revision):
//   Previously 5-min interval per tab. With the localStorage gate
//   only 1 tab per device fires per window, and the interval is
//   15 min instead of 5 min. Impact: ~3x fewer sweep calls.
//   Server-side gate in the relay further reduces actual Firestore
//   reads when multiple devices happen to sweep near-simultaneously.
//
// This is purely background. Errors are swallowed.
export function useOrderSyncer({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined') return undefined;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      // Only one tab per device fires per _SWEEP_LS_MS window.
      if (!_claimSweepSlot()) return;
      kundliService.triggerSweepPending().catch(() => { /* */ });
    };
    // Interval increased from 5 min to 15 min on 2026-06-11.
    // localStorage gate ensures only 1 sweep fires per device per
    // 4-minute window regardless of how many tabs are open.
    const t1 = setTimeout(tick, 5000);
    const t2 = setInterval(tick, 15 * 60 * 1000);
    return () => {
      alive = false;
      clearTimeout(t1);
      clearInterval(t2);
    };
  }, [enabled]);
}
