/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Static export ONLY for the Capacitor APK/iOS build (writes ./out).
  // On Vercel (no CAPACITOR env) it stays a normal Next app -> .next,
  // matching vercel.json so web deployments keep working.
  ...(process.env.CAPACITOR === 'true' ? { output: 'export' } : {}),
};

module.exports = nextConfig;
