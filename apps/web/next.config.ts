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
  // One companion per machine: its bus, focus, cards and turn locks live in ONE process, and VR's BpLink talks to
  // apps/server (:3100). With BP_COMPANION_URL set (a loopback origin, e.g. http://127.0.0.1:3100), this app hands every
  // /api/companion request to that process instead of serving its own (beforeFiles: the app's own companion routes would
  // otherwise answer first), so a focus from the desk reaches the headset and back. Unset: this process is the companion.
  async rewrites() {
    const url = companionUrl();
    return url ? { beforeFiles: [{ source: '/api/companion/:path*', destination: `${url}/api/companion/:path*` }], afterFiles: [], fallback: [] } : [];
  },
};

function companionUrl(): string | null {
  const raw = process.env.BP_COMPANION_URL?.trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`BP_COMPANION_URL is not a URL: ${raw}`); }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    throw new Error(`BP_COMPANION_URL must be a loopback http origin (the companion is loopback-only): ${raw}`);
  }
  return u.origin;
}

export default nextConfig;
