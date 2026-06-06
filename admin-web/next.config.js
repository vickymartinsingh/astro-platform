/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared service layer is a workspace package, Next must transpile it.
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Audit log uses this to label every event with the originating
  // app. Operator 2026-06-06: "showing vickymartinsing as customer
  // but it is admin" - prior detectApp() relied on the hostname
  // containing 'admin' which is true in prod but NOT on localhost /
  // Vercel preview domains. Hardcoding NEXT_PUBLIC_APP per workspace
  // fixes both environments.
  env: { NEXT_PUBLIC_APP: 'admin' },
  // Static export ONLY for the Capacitor APK/iOS build (writes ./out).
  // On Vercel (no CAPACITOR env) it stays a normal Next app -> .next.
  // trailingSlash so every route exports as a folder/index.html - the
  // Capacitor WebView then resolves a hard "/route/" (e.g. a
  // notification deep-link) instead of 404ing the extensionless path.
  ...(process.env.CAPACITOR === 'true'
    ? { output: 'export', trailingSlash: true } : {}),
};
// Deploy marker: 2026-05-27 - force Vercel rebuild after webhook miss on c41c9d2.
// Deploy marker: 2026-05-27T14:00 - re-push after quota reset.
module.exports = nextConfig;
