#!/usr/bin/env node
// Run what apps/vr builds against apps/server and record what BpLink prints (plan WP3.1 steps 7 to 9, Lynx).
// The probe (scripts/uht-probe.mjs --run) did this for a project synthesized outside the repo; this runs the real
// apps/vr/bp.uproject, or a staged bp.exe. It grades nothing: it prints the BpLink lines and where the full log is.
//
//   node apps/vr/tools/run-bplink.mjs [--mode editor|game|staged] [--exe <staged bp.exe>] [--no-server] [--xr-sim] [--vr]
//                                     [--game-mode <class path>] [--exec <cmd,cmd>] [--ue-args "<a> <b>"] [--hold <s>] [--timeout <s>] [--out <dir>]
//                                     [--product <slug>]
//
// editor  UnrealEditor-Cmd.exe bp.uproject (headless: -nullrhi, unless --xr-sim, which renders off screen instead)
// game    UnrealEditor-Cmd.exe bp.uproject -game (uncooked)
// staged  a cooked, staged bp.exe (--exe)
// --no-server   start nothing; BpLink is pointed at a closed port, so its "is npm run server running?" error is the outcome
// --game-mode   game and staged: the URL option ?game=<class path> (e.g. /Script/bp.BpGameMode, which places the light
//               table when the level has none) on the default map, for runs before config names a game mode
// --xr-sim      XR_RUNTIME_JSON = the Meta XR Simulator v207 json for this process only (install-xr.ps1 -SimulatorOnly);
//               never activate_simulator.ps1, never HKLM. Watches for the OpenXR init line too.
// --vr          game and staged: -vr, so the app opens an XR session (with --xr-sim, the Simulator's; its window and the
//               hands only come alive with one). Without it a -game run never calls xrCreateSession.
// --exec        console commands at startup (-ExecCmds), comma-separated, e.g. "stat scenerendering,stat dumpave -num=600 -ms=0"
// --ue-args     more engine arguments, space-separated, e.g. "-csvCaptureFrames=1200 -csvGpuStats" (CSVs land in
//               apps/vr/Saved/Profiling/CSV)
// --hold        keep running this many seconds after the outcome line instead of 5 (a stat dump over many frames);
//               LogStats lines are printed too
// --product     the product BpLink reads (-BpLinkProduct=<slug>; default kettle). The server's empty cwd gets a copy of the
//               repo's bp.products.local.json, which is where products.server.ts looks for live products.
//
// apps/server starts with `--port 0` in an empty cwd (as check-bplink and the probe do). The process is not asked to quit
// (BpLink's HTTP is async): it is watched until an outcome line, given 5 s to flush, then its tree is killed.
// Exit 0 when an outcome line appeared, 1 when none did, 2 refused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VR = path.resolve(HERE, '..');
const REPO = path.resolve(VR, '..', '..');
const ENGINE = process.env.UE_ROOT ?? 'C:/Program Files/Epic Games/UE_5.8';
const SIM_JSON = path.join(process.env.LOCALAPPDATA ?? '', 'MetaXRSimulatorExtract/PFiles/MetaXRSimulator/v207.0/meta_openxr_simulator.json');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);
const mode = opt('--mode', 'editor');
const timeoutMs = Number(opt('--timeout', '900')) * 1000;
const out = path.resolve(opt('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'bp-run-'))));
const refuse = (why) => { console.error(`REFUSED: ${why}`); process.exit(2); };

const uproject = path.join(VR, 'bp.uproject');
const editorCmd = path.join(ENGINE, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe');
let exe, pre = [];
if (mode === 'editor' || mode === 'game') {
  if (!fs.existsSync(uproject)) refuse(`${uproject} does not exist`);
  if (!fs.existsSync(editorCmd)) refuse(`${editorCmd} does not exist`);
  exe = editorCmd; pre = [uproject, ...(mode === 'game' ? ['-game'] : [])];
} else if (mode === 'staged') {
  exe = opt('--exe'); if (!exe || !fs.existsSync(exe)) refuse('--mode staged needs --exe <an existing staged bp.exe>');
} else refuse(`unknown --mode ${mode}`);
const gameMode = opt('--game-mode');
if (gameMode && mode === 'editor') refuse('--game-mode needs --mode game or staged');
if (gameMode) pre = [...pre, `?game=${gameMode}`];
if (flag('--xr-sim') && !fs.existsSync(SIM_JSON)) refuse(`${SIM_JSON} is missing; run apps/vr/tools/install-xr.ps1 -SimulatorOnly`);
fs.mkdirSync(out, { recursive: true });

const killTree = (pid) => spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });

// apps/server, or a port nothing listens on
let server = null, serverOut = '', port = 0;
if (flag('--no-server')) {
  port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
} else {
  const cwd = path.join(out, 'server-cwd'); fs.mkdirSync(cwd, { recursive: true });
  const products = path.join(REPO, 'bp.products.local.json');
  if (opt('--product') && fs.existsSync(products)) fs.copyFileSync(products, path.join(cwd, 'bp.products.local.json'));
  server = spawn(process.execPath, ['--import', pathToFileURL(path.join(REPO, 'packages/core/register.mjs')).href,
    path.join(REPO, 'apps/server/src/main.ts'), '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => (serverOut += d)); server.stderr.on('data', (d) => (serverOut += d));
  port = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(0), 20000);
    const look = () => { const m = /listening on http:\/\/[^:]+:(\d+)/.exec(serverOut); if (m) { clearTimeout(t); resolve(Number(m[1])); } };
    server.stdout.on('data', look); server.on('exit', () => { clearTimeout(t); resolve(0); });
  });
}
const stopServer = async () => {
  if (server && server.exitCode === null && server.signalCode === null) { const gone = new Promise((r) => server.once('exit', r)); killTree(server.pid); await gone; }
  if (server) fs.writeFileSync(path.join(out, 'server.log'), serverOut);
};
if (!port) { await stopServer(); refuse(`apps/server did not print its port within 20 s (${path.join(out, 'server.log')})`); }
const url = `http://127.0.0.1:${port}`;

const render = flag('--xr-sim') ? ['-RenderOffScreen'] : ['-nullrhi'];
const exec = opt('--exec');
const holdS = Number(opt('--hold', '5'));
const vr = flag('--vr') ? ['-vr'] : [];
const argv = [...pre, ...render, ...vr, '-unattended', '-nosplash', '-nosound', '-stdout', '-FullStdOutLogOutput', '-NoLogTimes', `-BpLinkUrl=${url}`,
  ...(opt('--product') ? [`-BpLinkProduct=${opt('--product')}`] : []),
  ...(exec ? [`-ExecCmds=${exec}`] : []), ...(opt('--ue-args', '').split(' ').filter(Boolean))];
const env = { ...process.env };
if (flag('--xr-sim')) env.XR_RUNTIME_JSON = SIM_JSON;
const runLog = path.join(out, `run-${mode}${flag('--xr-sim') ? '-xrsim' : ''}.log`);
console.log(`server  ${flag('--no-server') ? `none (closed port ${port})` : url}`);
console.log(`start   "${exe}" ${argv.map((a) => `"${a}"`).join(' ')}${flag('--xr-sim') ? `   XR_RUNTIME_JSON=${SIM_JSON}` : ''}`);

const OUTCOME = /BpLink: \w[\w-]* (wings|rooms)=|BpLink: GET .* failed|BpLink: the .* did not parse/;
const fd = fs.openSync(runLog, 'w');
const started = Date.now();
const ran = await new Promise((resolve) => {
  const child = spawn(exe, argv, { cwd: path.dirname(exe), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '', stoppedBy = null, grace = null;
  const stop = (why) => { if (!stoppedBy) { stoppedBy = why; killTree(child.pid); } };
  const hard = setTimeout(() => stop(`timeout ${timeoutMs / 1000} s`), timeoutMs);
  const onData = (d) => { fs.writeSync(fd, d); text += d; if (!grace && OUTCOME.test(text)) grace = setTimeout(() => stop(`outcome line seen, then ${holdS} s`), holdS * 1000); };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', (e) => fs.writeSync(fd, `\nspawn error: ${e.message}\n`));
  child.on('close', (code) => { clearTimeout(hard); clearTimeout(grace); resolve({ code, stoppedBy: stoppedBy ?? 'exited by itself', text }); });
});
fs.closeSync(fd);
await stopServer();

const lines = ran.text.split(/\r?\n/);
const pick = (re) => lines.filter((l) => re.test(l)).map((l) => l.trim());
console.log(`ran     ${((Date.now() - started) / 1000).toFixed(1)} s, exit ${ran.code}, ${ran.stoppedBy}`);
for (const l of pick(new RegExp(`LogBpLink|LogBpTable|LogBpHands|LogHMD: (Initialized OpenXR|.*no runtime)|${exec ? 'LogStats|' : ''}Assertion failed|Critical error|appError`)).slice(0, exec ? 400 : 40)) console.log(`line    ${l}`);
console.log(`log     ${runLog}`);
process.exit(OUTCOME.test(ran.text) ? 0 : 1);
