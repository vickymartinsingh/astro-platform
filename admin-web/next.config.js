/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared service layer is a workspace package, Next must transpile it.
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Static export ONLY for the Capacitor APK/iOS build (writes ./out).
  // On Vercel (no CAPACITOR env) it stays a normal Next app -> .next.
  ...(process.env.CAPACITOR === 'true' ? { output: 'export' } : {}),
};
module.exports = nextConfig;
