#!/usr/bin/env node
// DEMO launcher for the owner's standing rules (hackathon pack "Rules you set once"): one command from a fresh shell.
//   1. seeds the throwaway live product .demo/kettle-live (scripts/scan-demo.mjs --reset) and its labelled SYNTHETIC
//      decision history with no rules yet (scripts/seed-rules-history.mjs --clear-rules); --keep skips both
//   2. starts the web app on 127.0.0.1:<port> (default 3311) and the headless server the MCP door talks to on <port+100>,
//      both with BP_CLAUDE_BIN = scripts/fixtures/fake-claude.mjs, so nothing an agent is allowed to start calls a model
//   3. prints the URL and the agent command; Ctrl-C stops both servers (by their own PIDs)
//   node scripts/demo-rules.mjs [--port 3311] [--keep]
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(opt('--port') ?? 3311), API = PORT + 100;
if (!(PORT > 1024 && PORT < 65000)) { console.error('--port must be 1025..64999'); process.exit(2); }
const env = { ...process.env, BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs') };
const node = (script, args) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, stdio: 'inherit', env });

if (!argv.includes('--keep')) {
  if (node('scripts/scan-demo.mjs', ['--reset']).status !== 0) process.exit(1);
  if (node('scripts/seed-rules-history.mjs', ['--clear-rules']).status !== 0) process.exit(1);
}
const kids = [
  spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', 'apps/web', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] }),
  spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'apps/server/src/main.ts'), '--port', String(API)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] }),
];
let ready = 0;
for (const [i, k] of kids.entries()) {
  k.stdout.on('data', (d) => {
    const s = String(d);
    if ((i === 0 && /Ready in/.test(s)) || (i === 1 && /listening on/.test(s))) {
      if (++ready === 2) {
        console.log(`\nbp standing rules demo
  web     http://127.0.0.1:${PORT}/?product=kettle-live&dock=orders
  agent   node scripts/demo-agent.mjs                (the MCP door on the headless server :${API})
          BP_URL=http://127.0.0.1:${PORT} node scripts/demo-agent.mjs --propose   (a rule.propose card, live on the page)
  reader  node scripts/personas-rules-reader.mjs     (the stand-in for Personas' rail)
Ctrl-C stops both servers.`);
      }
    }
  });
  k.on('exit', (c) => { console.error(`[demo] ${i === 0 ? 'web' : 'server'} exited (${c})`); stop(); });
}
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  for (const k of kids) { try { if (k.exitCode === null) process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(k.pid), '/T', '/F'], { stdio: 'ignore' }) : k.kill('SIGTERM'); } catch { /* gone */ } }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
