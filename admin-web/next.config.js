/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared service layer is a workspace package, Next must transpile it.
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // Static export -> ./out, packaged into the Android APK by Capacitor.
  output: 'export',
};
module.exports = nextConfig;
