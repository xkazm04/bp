import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev would otherwise write an AGENTS.md at the repo root on every run
  agentRules: false,
  // NEXT_DIST_DIR lets several builds run side by side (one per variant author) without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // the repo root: Next is started from it (`next build apps/web`), so packages/* and docs/ sit inside it, and a
  // package-lock.json one directory up would otherwise be taken as the workspace root
  turbopack: { root: process.cwd() },
  // @bp/core ships TypeScript source (packages/core), compiled as part of the app
  transpilePackages: ['@bp/core'],
};

export default nextConfig;
