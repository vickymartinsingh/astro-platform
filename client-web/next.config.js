/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@astro/shared'],
  images: { unoptimized: true },
  output: 'export'
};

module.exports = nextConfig;
