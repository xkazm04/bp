#!/usr/bin/env node
// Start or stop a headless UE 5.8 editor on apps/vr/bp.uproject that serves the editor MCP server at
// http://127.0.0.1:8770/mcp (spark vr-table, 2026-10-23, Lynx). Port 8770, not the plugin default 8000: other local apps
// on Lynx hold 8000 (a uvicorn server did on 2026-10-23); BP_MCP_PORT overrides it. -RenderOffScreen (not -nullrhi) so
// PoFViewportTools.capture_viewport can render. The environment is start-editor.ps1's: the bundled win-x64 dotnet first
// on PATH, so the editor's own UBT and Python calls work on ARM64.
//
//   node apps/vr/tools/mcp-editor.mjs start [--timeout <s>]   # spawn, wait until the server answers, print MCP_READY
//   node apps/vr/tools/mcp-editor.mjs stop                    # kill the editor tree recorded in the pid file
//   node apps/vr/tools/mcp-editor.mjs status
//
// State: apps/vr/Saved/mcp-editor.json (pid, log path); the log is apps/vr/Saved/Logs/mcp-editor.log. Both git-ignored.
// Exit 0 ok, 1 the server did not come up (the log tail is printed), 2 refused.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = process.env.UE_ROOT ?? 'C:/Program Files/Epic Games/UE_5.8';
const STATE = path.join(VR, 'Saved', 'mcp-editor.json');
const LOG = path.join(VR, 'Saved', 'Logs', 'mcp-editor.log');
const PORT = Number(process.env.BP_MCP_PORT ?? 8770);
const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };

const portOpen = () => new Promise((r) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.once('connect', () => { s.destroy(); r(true); });
  s.once('error', () => r(false));
});
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (cmd === 'status') {
  const st = readState();
  console.log(`editor ${st && alive(st.pid) ? `running pid ${st.pid}` : 'not running'}; port ${PORT} ${(await portOpen()) ? 'open' : 'closed'}`);
  process.exit(0);
}
if (cmd === 'stop') {
  const st = readState();
  if (st && alive(st.pid)) spawnSync('taskkill.exe', ['/PID', String(st.pid), '/T', '/F']);
  fs.rmSync(STATE, { force: true });
  console.log('MCP_STOPPED');
  process.exit(0);
}
if (cmd !== 'start') { console.error('usage: mcp-editor.mjs start | stop | status'); process.exit(2); }

if (await portOpen()) { console.error(`REFUSED: something already listens on ${PORT} (node apps/vr/tools/mcp-editor.mjs stop, or close the other editor)`); process.exit(2); }
const uproject = path.join(VR, 'bp.uproject');
const exe = path.join(ENGINE, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe');
const dotnetDir = path.join(ENGINE, 'Engine/Binaries/ThirdParty/DotNet/10.0/win-x64');
for (const f of [uproject, exe, path.join(dotnetDir, 'dotnet.exe')]) if (!fs.existsSync(f)) { console.error(`REFUSED: ${f} is missing`); process.exit(2); }

const env = {
  ...process.env, UE_DOTNET_VERSION: '10.0', UE_DOTNET_ARCH: 'win-x64', DOTNET_ROOT: dotnetDir,
  PATH: `${dotnetDir};${process.env.PATH}`, DOTNET_MULTILEVEL_LOOKUP: '0', DOTNET_ROLL_FORWARD: 'LatestMajor',
};
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const fd = fs.openSync(LOG, 'w');
const args = [uproject, '-RenderOffScreen', '-unattended', '-nosplash', '-nosound', '-stdout', '-FullStdOutLogOutput',
  '-ModelContextProtocolStartServer', `-ModelContextProtocolPort=${PORT}`];
const child = spawn(exe, args, { cwd: path.dirname(exe), env, stdio: ['ignore', fd, fd], detached: true, windowsHide: true });
child.unref();
fs.writeFileSync(STATE, JSON.stringify({ pid: child.pid, log: LOG, started: new Date().toISOString() }, null, 2));
console.log(`started  "${exe}" ${args.map((a) => `"${a}"`).join(' ')} (pid ${child.pid}); log ${LOG}`);

const deadline = Date.now() + Number(opt('--timeout', '900')) * 1000;
while (Date.now() < deadline) {
  if (await portOpen()) { console.log(`MCP_READY http://127.0.0.1:${PORT}/mcp (pid ${child.pid})`); process.exit(0); }
  if (!alive(child.pid)) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const tail = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter((l) => /Error|MCP|ModelContext|Toolset/i.test(l)).slice(-15) : [];
console.error(`MCP_NOT_READY (editor ${alive(child.pid) ? 'still running' : 'exited'}); log ${LOG}`);
for (const l of tail) console.error(`  ${l}`);
process.exit(1);
