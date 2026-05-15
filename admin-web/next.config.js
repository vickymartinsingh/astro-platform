/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared service layer is a workspace package, Next must transpile it.
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  // For the Capacitor APK build, uncomment the next line and run
  // `next build` (static export -> ./out). See mobile/README.md.
  // output: 'export',
};
module.exports = nextConfig;
