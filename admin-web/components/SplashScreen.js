// Brand launch screen.
//
// The _document.js pre-hydration boot cover (#__boot, on-theme dark
// maroon #1A0F0F) already paints on frame #1 and removes itself the
// instant __next has content. A second React-rendered splash on top
// of that just added 1.8+ seconds of "the app feels stuck" AND
// switched the background mid-load (boot=maroon -> splash=navy
// #0F0A23 — visible colour flash).
//
// Kept as a no-op so a future revisit to the launch-screen story
// (faster/smarter heuristic) is a drop-in replacement instead of a
// refactor of every _app.js.
export default function SplashScreen() {
  return null;
}
