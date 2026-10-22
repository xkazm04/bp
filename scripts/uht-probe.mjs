#!/usr/bin/env node
// UHT probe for BpLink (wolf-plan W3.1-4 / risk R1): does UnrealHeaderTool process packages/schema/generated/ue/BpSchema.h
// when the module reaches it only through PublicIncludePaths? A PROBE, wired to no gate: it needs an Unreal Engine install,
// takes minutes, and writes everything outside this repo.
//
//   node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch dir> [--variant asis|junction]
//
// It synthesizes a host project under <work>/bp-uht-probe/ (apps/vr says the real .uproject is made by the editor, never by
// hand, so none is added to the repo), copies apps/vr/Source/BpLink in byte for byte, and builds bpEditor Win64 Development.
// The layout reproduces the one relationship BpLink.Build.cs depends on: four up from <probe>/apps/vr/Source/BpLink is
// <work>/bp-uht-probe/, which holds a directory junction `packages` -> this repo's packages/.
// --variant junction adds E1's fix, a junction Source/BpLink/Public/Schema -> packages/schema/generated/ue, before building.
// Output: <work>/bp-uht-probe/uht-probe-<variant>.log (UBT's combined stdout+stderr), ubt-Log-<variant>.txt (UBT's own log)
// and uht-probe-<variant>.json (the reading). Nothing here grades a pass: it records what the build printed.
//
// Lynx (Windows ARM64): Build.bat cannot run (it picks a win-arm64 .NET the install does not ship, 0x80008096), so UBT is
// driven directly on the bundled win-x64 dotnet; every compile is emulated Hostx64 (docs/concepts/vr-light-table/machine.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const engine = arg('engine');
const work = arg('work');
const variant = arg('variant') ?? 'asis';
if (!engine || !work || !['asis', 'junction'].includes(variant)) {
  console.error('usage: node scripts/uht-probe.mjs --engine <UE root> --work <scratch dir> [--variant asis|junction]');
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
		ExtraModuleNames.AddRange(new string[] { "bp", "BpLink" });
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
if (variant === 'junction' && !fs.existsSync(schemaLink)) junction(schemaLink, path.join(REPO, 'packages/schema/generated/ue'));

// The path BpLink.Build.cs computes, resolved the way it does (Path.GetFullPath over ModuleDirectory + four ..).
const schemaUe = path.resolve(mod, '..', '..', '..', '..', 'packages', 'schema', 'generated', 'ue');
const headers = {};
for (const h of ['BpSchema.h', 'BpSchemaFixups.h']) headers[h] = sha(path.join(schemaUe, h)); // throws if unreadable
console.log(`probe     ${root}`);
console.log(`Build.cs  SchemaUe = ${schemaUe} (BpSchema.h readable there)`);

const log = path.join(base, `uht-probe-${variant}.log`);
const uproject = path.join(root, 'bp.uproject');
const argv = [ubtDll, 'bpEditor', 'Win64', 'Development', `-Project=${uproject}`];
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
process.exit(exitCode === 0 ? 0 : 1);
