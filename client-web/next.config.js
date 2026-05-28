/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Static export ONLY for the Capacitor APK/iOS build (writes ./out).
  // On Vercel (no CAPACITOR env) it stays a normal Next app -> .next,
  // matching vercel.json so web deployments keep working.
  // trailingSlash so every route exports as a folder/index.html - the
  // Capacitor WebView then resolves a hard "/route/" (e.g. a
  // notification deep-link) instead of 404ing the extensionless path.
  ...(process.env.CAPACITOR === 'true'
    ? { output: 'export', trailingSlash: true } : {}),
};

// Deploy marker: 2026-05-27 - force Vercel rebuild after webhook miss on c41c9d2.
// Deploy marker: 2026-05-27T13:00 - webhook stuck again at 2a9f8ca, force second redeploy.
// Deploy marker: 2026-05-27T13:30 - user-requested redeploy.
module.exports = nextConfig;
