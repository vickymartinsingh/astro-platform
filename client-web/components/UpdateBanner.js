// Legacy thin update banner - retained as a no-op so existing call
// sites (Layout.js) don't break, while the new Play-Store-style
// <UpdateModal> mounted from _app.js owns the in-app update UX
// going forward (operator 2026-06-07 spec). When we delete the
// Layout import in a follow-up cleanup, this file can be removed.
export default function UpdateBanner() { return null; }
