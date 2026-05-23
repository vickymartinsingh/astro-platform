// Home page. The whole AstroSeer site is browsable without an account,
// so the URL stays `/` (no redirect to /dashboard) - we just render the
// dashboard content here. This keeps astroseer.in clean in the browser
// bar AND keeps Google's OAuth domain crawler happy (the Layout footer
// links to privacy / terms / contact in static HTML).
export { default } from './dashboard';
