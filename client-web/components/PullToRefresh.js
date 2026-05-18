import { useEffect, useRef, useState } from 'react';

// Lightweight pull-to-refresh: drag down from the very top of the page
// past a threshold to reload. Mounted once globally per app.
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);

  useEffect(() => {
    const TH = 80;
    function onStart(e) {
      if (window.scrollY <= 2 && e.touches && e.touches.length === 1) {
        startY.current = e.touches[0].clientY;
      } else startY.current = null;
    }
    function onMove(e) {
      if (startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 2) {
        setPull(Math.min(dy * 0.5, 90));
      }
    }
    function onEnd() {
      if (pull > TH) {
        setRefreshing(true);
        // Soft refresh: re-mount the current page (re-runs its data
        // load) WITHOUT a full reload - so no splash screen and we
        // stay on the exact same menu/route.
        setTimeout(() => {
          window.dispatchEvent(new Event('app:refresh'));
          setTimeout(() => setRefreshing(false), 400);
        }, 150);
      }
      setPull(0);
      startY.current = null;
    }
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [pull]);

  if (!pull && !refreshing) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60]
      flex justify-center" style={{ transform: `translateY(${
      refreshing ? 16 : Math.min(pull, 80)}px)` }}>
      <div className="flex h-9 w-9 items-center justify-center
        rounded-full bg-white shadow-lg ring-1 ring-black/5">
        <span className={`h-4 w-4 rounded-full border-2 border-primary
          border-t-transparent ${refreshing || pull > 80
            ? 'animate-spin' : ''}`} />
      </div>
    </div>
  );
}
