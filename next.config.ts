import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets several builds run side by side (one per variant author) without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // a package-lock.json one directory up would otherwise be taken as the workspace root
  turbopack: { root: process.cwd() },
};

export default nextConfig;
