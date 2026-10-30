#!/usr/bin/env node
// The Morning Watch demo, one command: seed the throwaway portfolio (scripts/morning-demo.mjs, unless --keep) and start bp's
// web on 127.0.0.1 with every edge that could spend or touch real state pointed at a stand-in:
//   BP_PRODUCTS_FILE=.demo/morning/products.json   the demo registry, never bp.products.local.json
//   BP_HOME=.demo/morning/home                       the shared focus, the companion's files: throwaway
//   BP_CLAUDE_BIN=scripts/fixtures/fake-claude.mjs   no job can start a real claude
//   BP_GH_BIN=scripts/fixtures/fake-gh.mjs           decisions are signed user:morning-demo, gh is never asked
// With --server it also starts apps/server on port + 100 and points the web's companion and session routes at it
// (BP_COMPANION_URL), so the VR table's BpLink and the web share one shared-focus record. With --prod it builds the web
// first (NEXT_DIST_DIR=.next-morning, git-ignored, about half a minute) and serves the build: every page opens at once.
//   node scripts/morning-up.mjs [--port 3010] [--keep] [--server] [--prod]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt('--port', '3010')), SERVER = argv.includes('--server'), PROD = argv.includes('--prod'), SPORT = PORT + 100;
const BASE = path.join(ROOT, '.demo', 'morning');
if (!argv.includes('--keep') || !fs.existsSync(path.join(BASE, 'products.json'))) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/morning-demo.mjs'), '--root', BASE], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  fs.rmSync(path.join(BASE, 'home'), { recursive: true, force: true }); // a fresh morning: no readers, no shared place
}
const env = {
  ...process.env,
  BP_PRODUCTS_FILE: path.join(BASE, 'products.json'), BP_HOME: path.join(BASE, 'home'),
  BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs'), BP_GH_BIN: path.join(ROOT, 'scripts/fixtures/fake-gh.mjs'),
  ...(SERVER ? { BP_COMPANION_URL: `http://127.0.0.1:${SPORT}` } : {}),
};
const kids = [];
if (SERVER) kids.push(spawn(process.execPath, ['--import', '@bp/core/register', 'apps/server/src/main.ts', '--port', String(SPORT), '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] }));
const next = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
if (PROD) {
  env.NEXT_DIST_DIR = '.next-morning';
  console.log('building the web (next build, .next-morning) ...');
  const b = spawnSync(process.execPath, [next, 'build', 'apps/web'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
  if (b.status !== 0) { console.error('next build failed'); for (const k of kids) k.kill(); process.exit(1); }
}
kids.push(spawn(process.execPath, [next, PROD ? 'start' : 'dev', 'apps/web', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: 'inherit' }));
const u = `http://127.0.0.1:${PORT}`;
console.log(`\nMorning Watch demo\n  the deck:        ${u}/?product=kettle-web   (press M)\n  a follower:      ${u}/?product=kettle-web&follow=1\n  the VR stand-in: node --import @bp/core/register scripts/focus-standin.ts --base ${SERVER ? `http://127.0.0.1:${SPORT}` : u}\n${SERVER ? `  apps/server:     http://127.0.0.1:${SPORT} (BpLink's base; the web's /api/companion and /api/session go there)\n` : ''}`);
const stop = () => { for (const k of kids) { try { k.kill(); } catch { /* gone */ } } process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const k of kids) k.on('exit', (c) => { if (c) console.error(`a demo process exited with ${c}`); });
