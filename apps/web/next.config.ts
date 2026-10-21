import type { NextConfig } from 'next';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev would otherwise write an AGENTS.md at the repo root on every run
  agentRules: false,
  // NEXT_DIST_DIR lets several builds run side by side (one per variant author) without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // the repo root: packages/* and docs/ sit inside it, and a package-lock.json one directory up would
  // otherwise be taken as the workspace root. Derived from THIS FILE, not from process.cwd(): the cwd
  // form built only when invoked from the repo root, and `npx next build` run inside apps/web failed
  // outright with "The workspace root is incorrect ... files outside of the workspace root are not
  // compiled" (measured 2026-10-22: 1 of 2 invocation directories built).
  turbopack: { root: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') },
  // @bp/core ships TypeScript source (packages/core), compiled as part of the app
  transpilePackages: ['@bp/core'],
};

export default nextConfig;
