/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared service layer is a workspace package, Next must transpile it.
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Audit log uses this to label every event - see admin-web
  // next.config.js for the operator report (2026-06-06).
  env: { NEXT_PUBLIC_APP: 'astrologer' },
  // Static export ONLY for the Capacitor APK/iOS build (writes ./out).
  // On Vercel (no CAPACITOR env) it stays a normal Next app -> .next.
  // trailingSlash so every route exports as a folder/index.html - the
  // Capacitor WebView then resolves a hard "/route/" (e.g. a
  // notification deep-link) instead of 404ing the extensionless path.
  ...(process.env.CAPACITOR === 'true'
    ? { output: 'export', trailingSlash: true } : {}),
};
// Deploy marker: 2026-05-27T14:00 - re-push after quota reset.
module.exports = nextConfig;
