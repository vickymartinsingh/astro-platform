import { useEffect } from 'react';

// Lock body scroll while a modal / sheet is open. Restores the
// previous overflow + position values on unmount so nested modals or
// concurrent locks don't fight each other (the most recently mounted
// one wins; on unmount it puts back whatever was there first).
//
// Why position:fixed + restore scroll-y: on iOS Safari and Android
// Chrome, overflow:hidden alone does NOT block touch scrolling of the
// body. position:fixed pins the viewport, and we re-apply the original
// scrollY on unmount so the user lands back at the same scroll
// position instead of snapped to the top.
//
// Pass `lock = false` to disable (useful when conditionally mounting).
export default function useScrollLock(lock = true) {
  useEffect(() => {
    if (!lock || typeof document === 'undefined') return undefined;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      // Land back where the user was; without this they snap to the
      // top of the page when the modal closes.
      window.scrollTo(0, scrollY);
    };
  }, [lock]);
}
