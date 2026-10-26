#!/usr/bin/env node
// Stop the server YOU started on a port: kills the process tree of the one PID listening on it, and nothing else - the
// allowed way to free a port (scripts/guard-kill.mjs refuses kills by image name, which reach other sessions' servers).
// Refuses a PID that is not a node/next/python process unless --any, and says what it killed.
// Run: node scripts/kill-port.mjs <port> [--any]
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('usage: node scripts/kill-port.mjs <port> [--any]'); process.exit(2); }
const any = process.argv.includes('--any');
const win = process.platform === 'win32';

function listener() {
  if (win) {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const row = out.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).find((c) => c[3] === 'LISTENING' && c[1]?.endsWith(`:${port}`));
    return row ? Number(row[4]) : null;
  }
  try { return Number(execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n')[0]) || null; } catch { return null; }
}
function imageOf(pid) {
  try {
    return win
      ? (execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).split(',')[0] ?? '').replace(/"/g, '').trim()
      : execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

const pid = listener();
if (!pid) { console.log(`nothing listens on ${port}`); process.exit(0); }
if (pid === process.pid || pid === process.ppid) { console.error('refusing to kill this process or its parent'); process.exit(1); }
const image = imageOf(pid);
if (!any && !/^(node|next|python|py)(\.exe)?$/i.test(image)) {
  console.error(`port ${port} is held by PID ${pid} (${image || 'unknown'}), not a node/python server; pass --any if it is yours`);
  process.exit(1);
}
if (win) execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
else process.kill(pid, 'SIGTERM');
console.log(`killed PID ${pid} (${image}) listening on ${port}`);
