// Brand launch screen.
//
// The _document.js pre-hydration boot cover (#__boot) already paints
// the on-theme background on the very first frame and removes itself
// the instant __next has content. That covers the actual "fresh load
// flash" use case. A second React-rendered splash on top of that just
// adds 1.8+ seconds of "the app feels stuck" without any UX benefit,
// which is exactly the bug the user reported.
//
// So this component is intentionally a no-op now. We keep the file +
// the import in _app.js so future revisits to the brand-launch story
// (e.g. a re-implementation with a faster, smarter heuristic) are a
// drop-in replacement instead of a refactor.
export default function SplashScreen() {
  return null;
}
