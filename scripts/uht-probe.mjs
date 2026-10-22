#!/usr/bin/env node
// UHT probe for BpLink (wolf-plan W3.1-4 / risk R1): does UnrealHeaderTool process packages/schema/generated/ue/BpSchema.h
// when the module reaches it only through PublicIncludePaths? A PROBE, wired to no gate: it needs an Unreal Engine install,
// takes minutes, and writes everything outside this repo.
//
//   node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch dir> [--variant asis|junction|spellings|unity] [--target bpEditor|bp] [--run]
//
// It synthesizes a host project under <work>/bp-uht-probe/ (apps/vr says the real .uproject is made by the editor, never by
// hand, so none is added to the repo), copies apps/vr/Source/BpLink in byte for byte, and builds bpEditor Win64 Development.
// The layout reproduces the one relationship BpLink.Build.cs depends on: four up from <probe>/apps/vr/Source/BpLink is
// <work>/bp-uht-probe/, which holds a directory junction `packages` -> this repo's packages/.
// --variant junction adds E1's fix, a junction Source/BpLink/Public/Schema -> packages/schema/generated/ue, before building.
// Two more put the include-spelling question to the compiler (MSVC keys `#pragma once` on the path, and BpSchema.h is now
// reachable as "BpSchema.h" through PublicIncludePaths and as "Schema/BpSchema.h" through the junction). Both add the
// junction, and each needs a --work of its own (a tree remembers its variant and refuses another of these):
//   spellings  two probe-only TUs, Private/BpLinkSpellingAB.cpp and BpLinkSpellingBA.cpp, each including BOTH spellings
//              (one order each); the repo's BpLink files are still copied byte for byte beside them
//   unity      the bpEditor target with bForceUnityBuild and no adaptive unity (which would pull a writable BpLink.cpp
//              back out of the unity file), so UBT merges BpLink.cpp ("BpSchema.h" via BpLink.h) and UHT's
//              BpSchema.gen.cpp ("Schema/BpSchema.h") into one Module.BpLink.cpp translation unit
// Output: <work>/bp-uht-probe/uht-probe-<variant>.log (UBT's combined stdout+stderr), ubt-Log-<variant>.txt (UBT's own log)
// and uht-probe-<variant>.json (the reading). Nothing here grades a pass: it records what the build printed.
//
// Lynx (Windows ARM64): Build.bat cannot run (it picks a win-arm64 .NET the install does not ship, 0x80008096), so UBT is
// driven directly on the bundled win-x64 dotnet; every compile is emulated Hostx64 (docs/concepts/vr-light-table/machine.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const engine = arg('engine');
const work = arg('work');
const variant = arg('variant') ?? 'asis';
const VARIANTS = ['asis', 'junction', 'spellings', 'unity'];
// --target picks the UBT target and changes only the argv: bpEditor (default) is every reading before 2026-10-22; bp is the
// synthesized Game target, built as `bp Win64 Development`. Variant markers and trees are untouched by it.
const target = arg('target') ?? 'bpEditor';
// --run (no value) adds the RUN step at the end; without it the script does exactly what it did before.
const run = process.argv.includes('--run');
if (!engine || !work || !VARIANTS.includes(variant) || !/^\w+$/.test(target)) {
  console.error(`usage: node scripts/uht-probe.mjs --engine <UE root> --work <scratch dir> [--variant ${VARIANTS.join('|')}] [--target <name>] [--run]`);
  process.exit(2);
}

const E = path.resolve(engine);
const ubtDir = path.join(E, 'Engine/Binaries/DotNET/UnrealBuildTool');
const ubtDll = path.join(ubtDir, 'UnrealBuildTool.dll');
const dotnet = path.join(E, 'Engine/Binaries/ThirdParty/DotNet/10.0/win-x64/dotnet.exe');
for (const f of [ubtDll, dotnet, path.join(E, 'Engine/Build/Build.version')]) {
  if (!fs.existsSync(f)) {
    console.error(`REFUSED: ${f} is missing; this probe needs a UE 5.8 install with the bundled win-x64 dotnet`);
    process.exit(1);
  }
}

const base = path.join(path.resolve(work), 'bp-uht-probe');
const root = path.join(base, 'apps', 'vr');
const mod = path.join(root, 'Source', 'BpLink');
const junction = (link, target) => {
  const r = spawnSync('cmd.exe', ['/d', '/c', 'mklink', '/J', link, target], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`mklink /J ${link} ${target} failed: ${r.stdout}${r.stderr}`);
};
const write = (rel, body) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Never delete here: <base>/packages is a junction into this repo, and a recursive delete that follows it empties it.
// A re-run reuses the tree; the as-is reading needs a tree without E1's junction, so that is refused, not cleaned up.
fs.mkdirSync(root, { recursive: true });
const packagesLink = path.join(base, 'packages');
if (!fs.existsSync(packagesLink)) junction(packagesLink, path.join(REPO, 'packages'));
const schemaLink = path.join(mod, 'Public', 'Schema');
if (variant === 'asis' && fs.existsSync(schemaLink)) {
  console.error(`REFUSED: ${schemaLink} exists (the junction variant ran here); use a fresh --work for the as-is reading`);
  process.exit(1);
}
// asis then junction may share a tree (that is how readings 1 and 2 ran); spellings and unity change what is built, so
// each keeps a tree of its own, and asis/junction refuse a tree either of them touched.
const marker = path.join(base, 'uht-probe-variant.txt');
const own = (v) => (v === 'spellings' || v === 'unity' ? v : 'asis/junction');
const prior = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : null;
if (prior && prior !== own(variant)) {
  console.error(`REFUSED: ${base} was built for ${prior}; use a fresh --work for --variant ${variant}`);
  process.exit(1);
}
fs.writeFileSync(marker, `${own(variant)}\n`);

write('bp.uproject', `${JSON.stringify({
  FileVersion: 3,
  EngineAssociation: '5.8',
  Category: '',
  Description: 'Synthesized by bp scripts/uht-probe.mjs outside the repo; never committed (apps/vr/README.md).',
  Modules: [
    { Name: 'bp', Type: 'Runtime', LoadingPhase: 'Default' },
    { Name: 'BpLink', Type: 'Runtime', LoadingPhase: 'PostEngineInit' },
  ],
}, null, 2)}\n`);
for (const [cls, type] of [['bp', 'Game'], ['bpEditor', 'Editor']]) {
  write(`Source/${cls}.Target.cs`, `using UnrealBuildTool;

public class ${cls}Target : TargetRules
{
	public ${cls}Target(TargetInfo Target) : base(Target)
	{
		Type = TargetType.${type};
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "bp", "BpLink" });${variant === 'unity' ? '\n\t\tbForceUnityBuild = true;\n\t\tbUseAdaptiveUnityBuild = false;' : ''}
	}
}
`);
}
write('Source/bp/bp.Build.cs', `using UnrealBuildTool;

public class bp : ModuleRules
{
	public bp(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore" });
	}
}
`);
write('Source/bp/bp.h', '#pragma once\n\n#include "CoreMinimal.h"\n');
write('Source/bp/bp.cpp', '#include "bp.h"\n#include "Modules/ModuleManager.h"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, bp, "bp");\n');
write('Config/DefaultEngine.ini', '[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Engine/Maps/Entry\n');

// BpLink is COPIED (a plain directory, so ModuleDirectory is unambiguous), byte for byte, and hashed against the repo.
const copied = {};
for (const rel of ['BpLink.Build.cs', 'Public/BpLink.h', 'Private/BpLink.cpp']) {
  const from = path.join(REPO, 'apps/vr/Source/BpLink', rel);
  const to = path.join(mod, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied[rel] = { repo: sha(from), probe: sha(to) };
  if (copied[rel].repo !== copied[rel].probe) throw new Error(`copy of ${rel} differs from the repo`);
}
if (variant !== 'asis' && !fs.existsSync(schemaLink)) junction(schemaLink, path.join(REPO, 'packages/schema/generated/ue'));
if (variant === 'spellings') {
  // Probe-only sources, never in the repo. A second include that `#pragma once` does not recognise as the same file
  // re-enters BpSchema.h: its BpSchema.generated.h then stops on its own `#error "BpSchema.generated.h already included"`,
  // or the USTRUCTs redefine. The static_assert proves the struct definitions were actually seen in this TU.
  for (const [name, first, second] of [['AB', 'BpSchema.h', 'Schema/BpSchema.h'], ['BA', 'Schema/BpSchema.h', 'BpSchema.h']]) {
    write(`Source/BpLink/Private/BpLinkSpelling${name}.cpp`, `// Synthesized by scripts/uht-probe.mjs --variant spellings (probe only, not in the repo).
#include "${first}"
#include "${second}"

static_assert(sizeof(FBpPlan) > 0, "FBpPlan is a complete type in this translation unit");
`);
  }
}

// The path BpLink.Build.cs computes, resolved the way it does (Path.GetFullPath over ModuleDirectory + four ..).
const schemaUe = path.resolve(mod, '..', '..', '..', '..', 'packages', 'schema', 'generated', 'ue');
const headers = {};
for (const h of ['BpSchema.h', 'BpSchemaFixups.h']) headers[h] = sha(path.join(schemaUe, h)); // throws if unreadable
console.log(`probe     ${root}`);
console.log(`Build.cs  SchemaUe = ${schemaUe} (BpSchema.h readable there)`);

const log = path.join(base, `uht-probe-${variant}.log`);
const uproject = path.join(root, 'bp.uproject');
const argv = [ubtDll, target, 'Win64', 'Development', `-Project=${uproject}`];
console.log(`run       "${dotnet}" ${argv.map((a) => `"${a}"`).join(' ')}   (cwd ${ubtDir})`);
const fd = fs.openSync(log, 'w');
const started = Date.now();
const exitCode = await new Promise((resolve) => {
  const child = spawn(dotnet, argv, { cwd: ubtDir, stdio: ['ignore', fd, fd] });
  child.on('error', (e) => { fs.writeSync(fd, `\nspawn error: ${e.message}\n`); resolve(null); });
  child.on('close', (code) => resolve(code));
});
const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
fs.closeSync(fd);

// UBT's stdout does not name the MSVC host; its own log does (the `Compiler:` line).
const ubtLogSrc = path.join(process.env.LOCALAPPDATA ?? '', 'UnrealBuildTool', 'Log.txt');
const ubtLog = path.join(base, `ubt-Log-${variant}.txt`);
if (fs.existsSync(ubtLogSrc)) fs.copyFileSync(ubtLogSrc, ubtLog);
const ubtText = fs.existsSync(ubtLog) ? fs.readFileSync(ubtLog, 'utf8') : '';
const compiler = /^\s*Compiler:\s*(.*)$/m.exec(ubtText)?.[1]?.trim() ?? null;

const found = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    else if (e.name === 'BpSchema.generated.h') found.push(p);
  }
};
const inter = path.join(root, 'Intermediate');
if (fs.existsSync(inter)) walk(inter);

const out = fs.readFileSync(log, 'utf8');
const reading = {
  at: new Date().toISOString(), variant, engine: E, buildVersion: JSON.parse(fs.readFileSync(path.join(E, 'Engine/Build/Build.version'), 'utf8')),
  dotnet, command: [dotnet, ...argv], cwd: ubtDir, exitCode, seconds, log, ubtLog, compiler, schemaUe, headers, copied,
  generatedHeaders: found,
  uhtLines: out.split(/\r?\n/).filter((l) => /UnrealHeaderTool|\bUHT\b|Parsing headers|BpSchema/i.test(l)),
  errorLines: out.split(/\r?\n/).filter((l) => /\berror\b|fatal/i.test(l)),
};
fs.writeFileSync(path.join(base, `uht-probe-${variant}.json`), `${JSON.stringify(reading, null, 2)}\n`);
console.log(`exit      ${exitCode} after ${seconds}s`);
console.log(`compiler  ${compiler ?? '(no Compiler: line in UBT log)'}`);
console.log(`generated ${found.length ? found.join(', ') : 'no BpSchema.generated.h under Intermediate'}`);
for (const l of reading.errorLines.slice(0, 20)) console.log(`error     ${l.trim()}`);
console.log(`log       ${log}`);
if (!run || exitCode !== 0) process.exit(exitCode === 0 ? 0 : 1);

// --run: after a build that exited 0, start what was built, headless, and record what it printed. It grades nothing.
// apps/server is started first on an ephemeral port (`--port 0`, in an empty cwd under <base>, as check-bplink does) and
// BpLink is pointed at it with -BpLinkUrl=. FetchKettle's HTTP is async, so the process is NOT asked to quit: it is watched
// until a BpLink outcome line appears (the Kettle line, or one of BpLink's own Error lines), given RUN_GRACE_MS to flush,
// then its whole tree is killed (taskkill /T /F); if no such line appears it is killed at RUN_TIMEOUT_MS. The server is
// stopped the same way. Output: run-<target>.log (the process's stdout+stderr), run-server-<target>.log, and run-<target>-
// Saved.log (a copy of the project's Saved/Logs/bp.log, when one was written); the reading goes into uht-probe-<variant>.json.
const RUN_TIMEOUT_MS = 900_000;
const RUN_GRACE_MS = 5_000;
const killTree = (pid) => spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
const serverCwd = path.join(base, 'run-server-cwd');
fs.mkdirSync(serverCwd, { recursive: true });
const serverLog = path.join(base, `run-server-${target}.log`);
const serverArgv = ['--import', pathToFileURL(path.join(REPO, 'packages/core/register.mjs')).href, path.join(REPO, 'apps/server/src/main.ts'), '--port', '0'];
const server = spawn(process.execPath, serverArgv, { cwd: serverCwd, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));
const port = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(0), 20000);
  const look = () => { const m = /listening on http:\/\/[^:]+:(\d+)/.exec(serverOut); if (m) { clearTimeout(t); resolve(Number(m[1])); } };
  server.stdout.on('data', look);
  server.on('exit', () => { clearTimeout(t); resolve(0); });
});
const stopServer = async () => {
  if (server.exitCode === null && server.signalCode === null) { const gone = new Promise((r) => server.once('exit', r)); killTree(server.pid); await gone; }
  fs.writeFileSync(serverLog, serverOut);
};
if (!port) {
  await stopServer();
  console.error(`REFUSED: apps/server did not print its port within 20 s; its output is in ${serverLog}`);
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;
const exe = target.endsWith('Editor')
  ? path.join(E, 'Engine/Binaries/Win64/UnrealEditor-Cmd.exe')
  : path.join(root, 'Binaries/Win64', `${target}.exe`);
const runArgv = [
  ...(target.endsWith('Editor') ? [uproject] : []),
  '-nullrhi', '-unattended', '-nosplash', '-nosound', '-stdout', '-FullStdOutLogOutput', '-NoLogTimes', `-BpLinkUrl=${url}`,
];
const runLog = path.join(base, `run-${target}.log`);
console.log(`server    ${url} (pid ${server.pid}, cwd ${serverCwd})`);
console.log(`start     "${exe}" ${runArgv.map((a) => `"${a}"`).join(' ')}   (cwd ${path.dirname(exe)})`);
const OUTCOME = /BpLink: Kettle |BpLink: GET .* failed|BpLink: the .* did not parse/;
const runFd = fs.openSync(runLog, 'w');
const runStarted = Date.now();
const ran = await new Promise((resolve) => {
  let child;
  try {
    child = spawn(exe, runArgv, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) { fs.writeSync(runFd, `\nspawn error: ${e.message}\n`); resolve({ exitCode: null, stoppedBy: 'spawn error', pid: null }); return; }
  let text = '', stoppedBy = null, graceTimer = null;
  const stop = (why) => { if (stoppedBy) return; stoppedBy = why; killTree(child.pid); };
  const hard = setTimeout(() => stop(`timeout ${RUN_TIMEOUT_MS} ms`), RUN_TIMEOUT_MS);
  const onData = (d) => {
    fs.writeSync(runFd, d);
    text += d;
    if (!graceTimer && OUTCOME.test(text)) graceTimer = setTimeout(() => stop(`outcome line seen, then ${RUN_GRACE_MS} ms`), RUN_GRACE_MS);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => { fs.writeSync(runFd, `\nspawn error: ${e.message}\n`); });
  child.on('close', (code, signal) => {
    clearTimeout(hard); clearTimeout(graceTimer);
    resolve({ exitCode: code, signal, stoppedBy: stoppedBy ?? 'exited by itself', pid: child.pid });
  });
});
const runSeconds = Number(((Date.now() - runStarted) / 1000).toFixed(1));
fs.closeSync(runFd);
await stopServer();

const savedSrc = path.join(root, 'Saved/Logs/bp.log');
const savedLog = path.join(base, `run-${target}-Saved.log`);
if (fs.existsSync(savedSrc)) fs.copyFileSync(savedSrc, savedLog);
const runText = fs.readFileSync(runLog, 'utf8');
reading.run = {
  at: new Date().toISOString(), target, command: [exe, ...runArgv], cwd: path.dirname(exe), timeoutMs: RUN_TIMEOUT_MS, graceMs: RUN_GRACE_MS,
  server: { command: [process.execPath, ...serverArgv], cwd: serverCwd, url, log: serverLog },
  ...ran, seconds: runSeconds, log: runLog, savedLog: fs.existsSync(savedLog) ? savedLog : null,
  bpLinkLines: runText.split(/\r?\n/).filter((l) => /BpLink/.test(l)),
  errorLines: runText.split(/\r?\n/).filter((l) => /\berror\b|fatal/i.test(l)).slice(0, 50),
  serverRefusals: serverOut.split(/\r?\n/).filter((l) => /^refused /.test(l)),
};
fs.writeFileSync(path.join(base, `uht-probe-${variant}.json`), `${JSON.stringify(reading, null, 2)}\n`);
console.log(`ran       ${ran.stoppedBy}; exit ${ran.exitCode} after ${runSeconds}s`);
for (const l of reading.run.bpLinkLines.slice(0, 20)) console.log(`bplink    ${l.trim()}`);
for (const l of reading.run.errorLines.slice(0, 20)) console.log(`error     ${l.trim()}`);
console.log(`run log   ${runLog}`);
process.exit(0);
