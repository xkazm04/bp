# VR Light Table: the Lynx execution plan

Written 2026-10-23 on Lynx, at master `dcd5062`. This is the **live execution plan** for `apps/vr`: it takes the BpLink
module from the probe readings in [`machine.md`](machine.md) to an editor-made project in the repo, then through P3 to P7
of [`plan.md`](plan.md). Lynx is the only build host. [`wolf-plan.md`](wolf-plan.md) is retired (owner, 2026-10-23) and
kept as the record: its readings, its ticked L-steps and its dated history stay there, and this file points at them.

**Nothing in the run order below has been run as written.** What has run on Lynx ran in a project synthesized outside the
repo by [`scripts/uht-probe.mjs`](../../../scripts/uht-probe.mjs) (`machine.md` readings 1 to 14). Every step says which
probe reading bears on it, and every unrun thing says **not run**. Items marked **[verify on Lynx]** are things this plan
could not check by reading.

Inputs: [`wolf-plan.md`](wolf-plan.md) (all 701 lines), [`machine.md`](machine.md) (readings 1 to 14), [`plan.md`](plan.md),
[`tech-stack.md`](tech-stack.md), [`art-breakdown.md`](art-breakdown.md), [`reference-sheet.md`](reference-sheet.md),
[`../../../apps/vr/README.md`](../../../apps/vr/README.md), [`../../../apps/vr/WP3.1.md`](../../../apps/vr/WP3.1.md),
[`../../../packages/schema/README.md`](../../../packages/schema/README.md) and the repo's [`CLAUDE.md`](../../../CLAUDE.md).

---

## Owner decisions, 2026-10-23

1. **Lynx only; Wolf is retired.** In the owner's words: "Wolf will not participate in the implementation. We have UE and
   capable device here." Lynx is Windows 11 Pro on ARM64, an NVIDIA RTX Spark N1X, 64 GB, UE 5.8.4-58902052
   (CompatibleChangelist 55116800) at `C:/Program Files/Epic Games/UE_5.8`, MSVC 14.44.35207 Hostx64 (emulated x64), and
   Node v24.22.0. Epic documents the UE 5.8 editor as unsupported on Windows ARM64 (game targets only). It runs here as
   emulated x64 and has booted headless (`machine.md` reading 14). `Build.bat` and `RunUAT.bat` fail (no win-arm64 .NET),
   so UnrealBuildTool and AutomationTool are driven through the bundled win-x64 dotnet, as `scripts/uht-probe.mjs` does.
2. **The editor makes the project, on Lynx.** The owner adds "Templates and Feature Packs" to UE 5.8 in the Epic launcher.
   Then New Project: Games, Blank, C++, Desktop, Maximum, no Starter Content, no raytracing, at `%TEMP%\bp-ue`, name `bp`.
   It is then moved into `apps/vr` as wolf-plan W3.1-2 step 2 describes. *Reading 2026-10-23, for this plan: the
   templates may already be there; see L4 in section (b).*
3. **R1 CLOSED: the junction.** "Adjust structure to Lynx only, no need to share anymore." BpLink reaches
   `packages/schema/generated/ue` only through the git-ignored junction `apps/vr/Source/BpLink/Public/Schema`, made by
   `apps/vr/tools/link-schema.ps1`. There is one include path. Evidence: `machine.md` readings 2 to 14.
4. **R5 CLOSED: p50 at or under 11.1 ms**, for the GPU and the game thread. p95 and max are reported; they are not budget
   lines. This matches the 2026-10-21 web ruling (plan.md, 'Ruling (operator, 2026-10-21): goal 1 passed').
5. **Headset: the Meta XR Simulator v207 only, for now.** No Quest Link in this phase: Meta's Link requirements list Intel
   and AMD CPUs only. A headset route on ARM64 is a later decision. Never run `activate_simulator.ps1`; point
   `XR_RUNTIME_JSON` at the Simulator per process.
6. **The Win64 boot proof is a cooked and staged `bp.exe`** that prints the Kettle line, with AutomationTool driven
   directly through the x64 dotnet. Fallback: record the failure and the `-game` reading.
7. **Asset sharing is parked**: the ArtSource hand-off where Lynx made assets and Wolf imported them, and the Host
   trailers. "We will resolve asset sharing once the project is successful as afterthought." The P4 import becomes a Lynx
   step, deferred.
8. **R13 is moot.** bp is registered for Lynx in ai-registry `projects.json` (`"bp": { "Lynx": "kiro/bp" }`, ai-registry
   `64d3dbda`, "fleet: register bp on Lynx", 2026-10-23). R4, R6 and R8b were answered by the owner later the same day (section (f), Closed).

---

## (a) How a Lynx session uses this file

- [ ] **Read first, in this order:** this file; [`machine.md`](machine.md) (how UBT runs here, readings 10 to 14);
      `apps/vr/WP3.1.md`; `apps/vr/README.md` (the BpLink contract); plan.md P3 to P7; `packages/schema/README.md`.
      Read `art-breakdown.md` and `reference-sheet.md` before P4 or P6.
- [ ] **Follow the steps in order.** Each step names what it needs. Do not start a step whose needs are not ticked.
- [ ] **Tick a box only when its proof exists.** A proof is a command plus its verbatim output line, or a file at the
      named path. "It built" without the line is not a proof. A blocked or skipped run is recorded as **not evaluated**,
      with the reason. It is never a pass. A probe reading outside the repo is evidence for a step, not a tick.
- [ ] **One run note per step:** `docs/concepts/vr-light-table/runs/<YYYY-MM-DD>-lynx-<step>.md` (the folder does not
      exist yet; the first run creates it). It holds the commands, the verbatim lines and what was not run.
- [ ] **Name the host in a parsed trailer.** The commit body ends with `Host: Lynx (UE 5.8.4-58902052, MSVC 14.44.35207
      Hostx64 emulated, Node v24.22.0)` in the same trailer block as `Co-Authored-By`, so that
      `git log -1 --format=%(trailers:key=Host)` prints it. A `Host:` line higher up the body is not a trailer (plan.md
      'P4 Lynx-side back-measure (2026-10-22)', gap 1). Subject example: `feat(vr): L3.1 the editor-made project prints
      Kettle's 5 wings (Lynx)`.
- [ ] **Keep heavy output local.** UE logs, `Binaries/`, `Intermediate/`, `Saved/` (staged builds land there),
      `DerivedDataCache/`, `.sln`, the Meta plugin trees, `apps/vr/.cache/` and the schema junction are git-ignored
      (`.gitignore`, the "VR client" block). Commit the excerpt in the run note, not the log. Captures go to
      `docs/concepts/vr-light-table/captures/` as JPEG, 1 MB or less each.
- [ ] **Machine facts** go to [`machine.md`](machine.md), in a new dated Lynx section. Never edit an old reading; correct
      it with a dated note.
- [ ] **One UBT at a time.** Two on one host refuse each other (`Result: Failed (ConflictingInstance)`, `machine.md`
      after reading 11). Other sessions share this checkout and this engine: check `tasklist` for `dotnet`,
      `UnrealEditor*` and `ShaderCompileWorker` first.
- [ ] **One GPU job at a time.** UE and generation (ComfyUI, TRELLIS.2) now share Lynx's GPU. Check that no generation job
      runs before a frame-time reading, and that no UE session runs before a generation job (risk R12).
- [ ] **Push verified work, never force** ([`CLAUDE.md`](../../../CLAUDE.md), "Git"): `npm run check` green and the
      secret scan clean (`.env` is git-ignored; never commit or print it). Then `git fetch`, rebase onto
      `origin/master` (or merge it when a rebase would rewrite shared history), and push to `origin master`. Stage only
      the step's paths.

---

## (b) Lynx setup (P0 for this repo)

Each state was read on Lynx on 2026-10-23 for this plan, unless a reading is cited. Record each verify output in
`runs/<date>-lynx-p0.md`.

| # | Item | State on Lynx, 2026-10-23 | Verify command (PowerShell) | Expected |
|---|---|---|---|---|
| L0 | bp checkout, fleet registration | **Present.** `C:\Users\kazda\kiro\bp`, master. ai-registry `projects.json` lists `"bp": { "Lynx": "kiro/bp" }` (`64d3dbda`). | `git -C C:\Users\kazda\kiro\bp log -1 --format=%h; git -C C:\Users\kazda\kiro\bp status --short` | the SHA; only the step's paths in the status |
| L1 | Node | **Present.** `node --version` reads `v24.22.0`; `package.json` asks for >= 22.18. | `node --version` | `v24.22.0` |
| L2 | Root install and check chain | **Present.** | `npm ci`, then `npm run check` | `npm ci` exit 0; `N passed, 0 failed, 0 skipped of N` |
| L3 | Unreal Engine 5.8.4 | **Present** (`machine.md`, "The install"). | `Get-Content 'C:\Program Files\Epic Games\UE_5.8\Engine\Build\Build.version'` | `"PatchVersion": 4`, `"Changelist": 58902052`, `"CompatibleChangelist": 55116800` (read 2026-10-23) |
| L4 | Templates and Feature Packs | **Owner action (decision 2). Read 2026-10-23: the files look present.** `C:\Program Files\Epic Games\UE_5.8\Templates` holds 35 entries, among them `TP_Blank` with `Source\`, `Config\` and `TP_Blank.uproject`. `UE_5.8\FeaturePacks` holds 9. Both folders are dated 2026-10-22 15:28. The New Project dialog reads `<root>/Templates` (`Engine/Source/Editor/GameProjectGeneration/Private/GameProjectGenerationModule.cpp:186`, `FPaths::RootDir() / TEXT("Templates")`), not `Engine/Templates`, which is where `machine.md` looked. The dialog itself is **not run**. | `Test-Path 'C:\Program Files\Epic Games\UE_5.8\Templates\TP_Blank\TP_Blank.uproject'`; then the editor's New Project dialog | `True`; the dialog lists Games, Blank with a C++ option. If it does not, the owner adds the launcher component |
| L5 | MSVC and the Windows SDK | **Present** (`machine.md`): VS 2022 BuildTools, MSVC 14.44.35207, Windows SDK 10.0.26100.0. | the first L3.1-6 build | UBT's line `Using Visual Studio 14.44.35229 toolchain (...\MSVC\14.44.35207) and Windows 10.0.26100.0 SDK`, and `Running x64 binary on arm64 system` |
| L6 | UBT and AutomationTool, driven directly | **Present.** `Engine\Binaries\ThirdParty\DotNet\10.0\win-x64\dotnet.exe` is the only bundled .NET; `UnrealBuildTool.dll` and `AutomationTool.dll` are under `Engine\Binaries\DotNET\`. `Build.bat` dies with `0x80008096` (`machine.md`). AutomationTool **not run**. | none on its own: L3.1-6 and L3.1-10 | as in those steps |
| L7 | Meta XR plugin v207 and Interaction SDK v207 | **Not installed.** `apps/vr/tools/install-xr.ps1` is new on 2026-10-23 (a parallel work package) and not run. No zip cache on Lynx (`kiro/mage-arena/apps/vr/.cache/xr` is absent), so the 1.1 GB download runs. | `powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/install-xr.ps1` (`-PluginsOnly` or `-SimulatorOnly` runs one half), then `Select-String -Path apps\vr\Plugins\MetaXR\OculusXR.uplugin,apps\vr\Plugins\MetaXRInteraction\OculusInteraction.uplugin -Pattern '"VersionName"'` | `SHA256_OK=` for both zips, `UPROJECT_ENABLED=OculusXR`, `UPROJECT_ENABLED=OculusInteraction`, and `PLUGIN_BUILD_ID=55116800` equal to `ENGINE_COMPATIBLE_CHANGELIST` (no `PLUGIN_BUILD_ID_MISMATCH`); `VersionName` `1.207.0` |
| L8 | Meta XR Simulator v207 | **Not installed.** `%LOCALAPPDATA%\MetaXRSimulatorExtract` is absent. It comes with `install-xr.ps1`, which extracts it with `msiexec /a` (no install, no registry) and prints `SIMULATOR_JSON=`. | `Test-Path` on the path after `SIMULATOR_JSON=` (the script's default is `$env:LOCALAPPDATA\MetaXRSimulatorExtract\PFiles\MetaXRSimulator\v207.0\meta_openxr_simulator.json`) | `True`. Used per process through `$env:XR_RUNTIME_JSON`; `activate_simulator.ps1` is never run |
| L9 | Quest Link and a headset | **Out of scope** (decision 5). | none | none. The headset route is an open risk, section (f) |
| L10 | athena-portable (from P5) | **Checked out** at `C:\Users\kazda\kiro\athena-portable`, HEAD `9beaef31`. The L5.3 smoke ran green against it on 2026-10-22 (wolf-plan L5.3). Voice (`/voice/install`, Kokoro, Whisper) is **not run** on Lynx. | `node scripts/smoke-athena.mjs --no-turn`; `/voice/preview` | `0 failed`; one spoken line (plan.md P0 tool check) |
| L11 | pof and the UE 5.8 editor MCP (from P4) | **pof checked out** at `C:\Users\kazda\kiro\pof`, HEAD `c833782a`. The editor MCP is **not run** against bp: there is no project yet. | per `pof/docs/ue58-mcp-phase2-tool-map.md` **[verify on Lynx]** | the session lists editor actors and calls `capture_viewport` |
| L12 | Blender (P4 and P6 art only) | **Not on PATH**: `which blender` finds nothing and there is no `C:\Program Files\Blender Foundation`. L4.1 used Blender 5.2.2 on Lynx (`scripts/art/city-backdrop/write_manifest.mjs:96`); where that binary lives is not recorded. | `blender --version` | `Blender 5.2.2`, or the path recorded in `machine.md` |
| L13 | ComfyUI and TRELLIS.2 | **Present, per plan.md readings**: a ComfyUI TRELLIS job ran during 'Milestone 1 re-measure after L5.2' run 2, and ComfyUI was resident in later perf readings. Not re-read for this plan. | the ComfyUI service answers on its port | needed only when an asset is re-made |
| L14 | GPU | `nvidia-smi --query-gpu=name,memory.total --format=csv` reads `NVIDIA RTX Spark N1X (6144-core Blackwell RTX GPU), 64000 MiB`. Whether that memory is shared with the CPU is not measured here. | the same command | the same line, recorded in `machine.md` |

**The UBT command on Lynx** (the measured form, `machine.md` "How to reproduce"; never `Build.bat`):

```
$ue = 'C:\Program Files\Epic Games\UE_5.8'
$dotnet = "$ue\Engine\Binaries\ThirdParty\DotNet\10.0\win-x64\dotnet.exe"
$repo = 'C:\Users\kazda\kiro\bp'
Push-Location "$ue\Engine\Binaries\DotNET\UnrealBuildTool"
& $dotnet .\UnrealBuildTool.dll bpEditor Win64 Development "-Project=$repo\apps\vr\bp.uproject"
& $dotnet .\UnrealBuildTool.dll bp Win64 Development "-Project=$repo\apps\vr\bp.uproject"
Pop-Location
```

**The AutomationTool command on Lynx** (not run). `RunUAT.bat` runs `dotnet AutomationTool.dll` from
`Engine\Binaries\DotNET\AutomationTool` (`RunUAT.bat:84-85`); on Lynx that `dotnet` is the bundled win-x64 one:

```
Push-Location "$ue\Engine\Binaries\DotNET\AutomationTool"
& $dotnet .\AutomationTool.dll BuildCookRun "-project=$repo\apps\vr\bp.uproject" -platform=Win64 -clientconfig=Development -build -cook -stage -pak -unattended -utf8output -nop4
Pop-Location
```

**[verify on Lynx]** whether UAT's own UBT and cook child processes find the x64 .NET. If its `-build` step fails that
way, build `bp` with the UBT command above and run BuildCookRun without `-build`.

---

## (c) Phased run order

Order: section (b), then L3.1, L3.2 to L3.6, the P3 gate, P4 (the import is deferred), P5 (L5.4 to L5.8), P6, P7.
Effort is agent time, plus the owner's where named. The step names follow wolf-plan's, with `W` replaced by `L`; the
retired Wolf steps keep their old names in wolf-plan.md.

### P3 L3.1: the editor-made `apps/vr` project and BpLink (Lynx, 1 to 2 days)

This replaces wolf-plan W3.1-1 to W3.1-10 and the run-order rows 0 to 11. It expands `apps/vr/WP3.1.md`; where the two
differ, this file is newer.

| # | Step | Needs | Command or editor action | Proof that it passed | State 2026-10-23 |
|---|---|---|---|---|---|
| L3.1-1 | Server up and contract green | L0 to L2 | `npm run check:bplink`; `npm run server` in its own shell; `curl.exe -s http://127.0.0.1:3100/api/products/kettle/plan` | `check-bplink: N passed, 0 failed` (35 on 2026-10-22, plan.md 'Milestones 1 and 2 back-measured'); `bp server listening on http://127.0.0.1:3100`; JSON with 5 `wings` | **not run as written.** The probe ran apps/server with `--port 0` (reading 14). The server answers 403 to a non-loopback Host or peer (`packages/core/src/scan/local-only.ts`), so UE and the server stay on Lynx |
| L3.1-2 | Create the project with the editor | L3, L4, L5 | decision 2: `UnrealEditor.exe` with no project; Games, Blank, C++, Desktop, Maximum, no Starter Content, no raytracing; location `%TEMP%\bp-ue`; name `bp`. Close the editor. Then the move, from the repo root: `robocopy "$env:TEMP\bp-ue\bp" apps\vr bp.uproject /COPY:DAT; robocopy "$env:TEMP\bp-ue\bp\Config" apps\vr\Config /E; robocopy "$env:TEMP\bp-ue\bp\Content" apps\vr\Content /E; robocopy "$env:TEMP\bp-ue\bp\Source" apps\vr\Source /E /XD BpLink`; then delete `%TEMP%\bp-ue` | `apps/vr/bp.uproject` exists with `EngineAssociation` `5.8`; `git status --short` shows only `bp.uproject`, `Config/`, `Content/` (if any), `Source/bp/` and the two `*.Target.cs` | **not run.** **[verify on Lynx]**: the editor with a real RHI (not `-nullrhi`) on emulated x64; and the dialog's C++ compile, which runs `Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe` itself (`DesktopPlatformBase.cpp:2073`, `:710`), not `Build.bat`. If that compile fails, the files the dialog wrote still count as editor-made, and L3.1-6 builds them. Never write a `.uproject` by hand |
| L3.1-3 | Add BpLink to the project | L3.1-2 | in `apps/vr/bp.uproject` `Modules`, after the template's `bp` entry: `{ "Name": "BpLink", "Type": "Runtime", "LoadingPhase": "PostEngineInit" }`. In `Source/bp.Target.cs` and `Source/bpEditor.Target.cs`: `ExtraModuleNames.AddRange(new string[] { "bp", "BpLink" });`. Optional, for an IDE: `& $dotnet .\UnrealBuildTool.dll -projectfiles "-project=$repo\apps\vr\bp.uproject" -game -engine` | the diff shows exactly those lines; with project files, `bp.sln` (git-ignored) lists `BpLink` | **not run** in the repo. The probe's synthesized `.uproject` carried this exact entry, and the editor loaded the module (reading 10: `LogModuleManager: InternalLoadLibrary: 'BpLink'`). `-projectfiles` is not tried on Lynx |
| L3.1-4 | The schema junction (R1, decision 3) | L3.1-3 | `powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/link-schema.ps1` | `SCHEMA_JUNCTION=<link> -> <target> (created)` or `(already present)`, and no `REFUSED:` line; `Get-Item apps\vr\Source\BpLink\Public\Schema` shows `LinkType` `Junction` to `packages\schema\generated\ue`; `git status --short` shows nothing under `Public/Schema`; `BpLink.Build.cs` names that one include path | **not run** in the repo; the script is new on 2026-10-23 (parallel work package). The junction itself is what readings 2 to 14 built with |
| L3.1-5 | Meta XR v207, Interaction SDK, Simulator | L3.1-2 (the script edits `bp.uproject`) | `powershell -NoProfile -ExecutionPolicy Bypass -File apps/vr/tools/install-xr.ps1` | L7's and L8's expected lines | **not run** |
| L3.1-6 | Both targets build | L3.1-3, L3.1-4, L3.1-5 | the UBT command in section (b): `bpEditor`, then `bp` (Win64 Development), one at a time | both exit 0; each build's last `Total execution time` line and the toolchain line in the run note; 0 `: warning` lines, or each warning quoted. The run note records each of E2 to E8 (section e) as seen or not seen | **not run** in the repo. In the probe both exit 0: `bpEditor` (readings 3 to 7, 10, 12 to 14) and `bp` (readings 8 and 11). The real project adds the template's `bp` module, its config and the Meta plugins, none of which the probe had |
| L3.1-7 | The Kettle line, editor, headless | L3.1-6, the server up (L3.1-1) | `& "$ue\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "$repo\apps\vr\bp.uproject" -nullrhi -unattended -nosplash -nosound -stdout -FullStdOutLogOutput -NoLogTimes`. The editor does not quit by itself: after the outcome line, wait 5 s and stop it with `taskkill /PID <pid> /T /F` (reading 10's mechanism) | `LogBpLink: BpLink: kettle streams (200); WP3.1 does not consume SSE, so rev <rev> read once from structure stands`, then `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=<rev>`; `<rev>` equals the curl's `.rev`; no `skipped` warning | **not run** in the repo. The probe printed both lines at `422d7fa` (reading 14) |
| L3.1-8 | Server down | L3.1-7 | stop the server; run L3.1-7's command again (BpLink fetches at startup); optionally `-ExecCmds="BpLink.Fetch"` | ``LogBpLink: Error: BpLink: GET http://127.0.0.1:3100/api/products/kettle/structure failed (connected=0, status=0). Is `npm run server` running?`` (`BpLink.cpp:98`) and no crash | **not run** anywhere. `BpLink.Fetch` is not run either (reading 14's "does NOT establish" list) |
| L3.1-9 | Simulator boot | L3.1-7, L8 | `$env:XR_RUNTIME_JSON='<the SIMULATOR_JSON= path>'; & "$ue\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "$repo\apps\vr\bp.uproject" -game -unattended -nosplash -log "-abslog=$repo\apps\vr\Saved\Logs\sim-boot.log"`, server up | `LogHMD: Initialized OpenXR on Meta XR Simulator runtime version 207.0.0` (wolf-plan's expected spelling, **[verify on Lynx]**) and L3.1-7's Kettle line in the same log | **not run.** Needs a real RHI, so `-nullrhi` cannot be used; no D3D12 run of the emulated editor is measured |
| L3.1-10 | Cooked and staged `bp.exe` (decision 6) | L3.1-6, server up | the AutomationTool command in section (b); then the staged `bp.exe` under `apps\vr\Saved\StagedBuilds\Windows\` with `-nullrhi -unattended -nosplash -nosound -stdout -FullStdOutLogOutput -NoLogTimes` | UAT's `BUILD SUCCESSFUL`; the staged `bp.exe` prints L3.1-7's Kettle line. **Fallback:** the failure verbatim, and the `-game` reading: L3.1-7's command with `-game` added, printing the Kettle line | **not run.** The uncooked Game build asserts before BpLink: `Assertion failed: ReaderPos + Num <= ReaderSize` (reading 11). That the missing cook is the cause is a reading of that log, not measured |
| L3.1-11 | Record and tick | L3.1-1 to L3.1-10 | a new dated Lynx section in `machine.md`; `apps/vr/README.md` and `WP3.1.md` flipped to the dated reading, with what was and was not run; tick here; `npm run check` | `N passed, 0 failed, 0 skipped of N`; the commit's `Host: Lynx (...)` trailer | **not run** |

**L3.1 acceptance** (plan.md P3, WP3.1): the editor and a Win64 build boot, and a `BpLink` log line prints Kettle's 5
wings. Here that is L3.1-7 and L3.1-10 (or its fallback, recorded as such), in the editor-made project in `apps/vr`, with
Meta XR v207 and the Interaction SDK installed (L3.1-5).

**Verdict 2026-10-23 (late, Lynx): L3.1's acceptance is met as a whole** (`machine.md`, 'Lynx, 2026-10-23', readings 15 to
21). The "State" column above is the morning's and is kept as written. Per step:

- L3.1-1: apps/server ran with `--port 0` through `apps/vr/tools/run-bplink.mjs`, not `npm run server` on 3100.
- L3.1-2: **done**, but not as written. New Project ran from an editor started by `apps/vr/tools/start-editor.ps1`
  (without it, the dialog's `Build.bat -projectfiles` fails on the missing `win-arm64` dotnet and the editor rolls the
  project back). It was made in `Documents/Unreal Projects/bp` and copied in. `EngineAssociation` is this machine's GUID,
  not `5.8` (`machine.md`). The template's `GameDefaultMap` is now `/Engine/Maps/Entry` until L3.2.
- L3.1-3, L3.1-4, L3.1-5: **done** (`8e191b5`). The Meta entries are plain `Enabled`, not `Optional` (reading 20, `955fac8`).
- L3.1-6: **done.** `bpEditor` exits 0 (reading 15); the `bp` Game target exits 0 inside BuildCookRun (reading 19), not
  alone through UBT.
- L3.1-7: **done** (reading 16). L3.1-8: **done** (reading 17); `BpLink.Fetch` not run. L3.1-9: **done**, `-game
  -RenderOffScreen` (reading 18).
- L3.1-10: **done**, the primary proof, not the fallback: the cooked, staged `bp.exe` prints the Kettle line (reading 21)
  after the plugin fix (reading 20).
- L3.1-11: this entry, `machine.md`, `apps/vr/README.md` and `apps/vr/WP3.1.md`.

Next: L3.2, the table.

### P3 L3.2 to L3.6 and the gate (Lynx, about 1.5 to 2 weeks)

All of these need L3.1. The geometry always comes from `FBpPlan` (wing, room, bay and tile boxes in world units;
`parentId` links). VR never computes a layout or health rule (tech-stack.md §1). If a number is needed and `/plan` lacks
it, that is a change to the plan handler and `plan-1.schema.json`, not C++ logic. The Meta XR Simulator stands in for the
headset (decision 5); "in the Simulator" means the Simulator's window on Lynx, not a headset.

- [x] **L3.2 The table (3 to 4 days).** *Done 2026-10-23 (Lynx, spark `vr-table`): [`captures/l32-2026-10-23-lynx.jpg`](captures/l32-2026-10-23-lynx.jpg) from the target pose shows A to E left to right with readable names, the grid, the scale bar and the "Kettle · lens: business" title block (the compass rose is drawn, top right, too small to judge in this capture); `LogBpTable: BpTable: wings=5 order=A,B,C,D,E height_cm=95` in PIE and on the Meta XR Simulator (`machine.md` readings 22 to 26). The content was made through the editor MCP (`apps/vr/tools/mcp-steps/`).* Table mesh (greybox), a blueprint-paper material, and the wing footprints drawn
      into a runtime render target from `Plan.wings[*].box`, in `order` left to right, with the names as text (a
      high-resolution world-space widget or a Meta compositor layer, never text baked onto the mesh; tech-stack.md §2).
      The table top starts at 95 cm behind one named constant and the console variable `bp.TableHeightCm`, and the
      owner tunes it in the Simulator (R4 option A, owner 2026-10-23). Map plan units to centimetres with one named constant.
      Proof: a capture `captures/l32-<date>-lynx.jpg` from the target pose (standing, about 45° down at the near edge)
      showing A to E left to right with readable names; the log line `BpTable: wings=5 order=A,B,C,D,E height_cm=<n>`.
- [ ] **L3.3 Volumes (2 to 3 days).** Instanced rooms (13), bays (29) and tiles (133), one
      `UInstancedStaticMeshComponent` (or HISM) per kind, and an edge-glow v0 material (fresnel plus edge mask, low
      face opacity). Heights carry stage or lens reading, never position.
      Proof: `BpTable: instances rooms=13 bays=29 tiles=133`; `stat scenerendering` (mesh draw calls) shows one draw
      per instance batch per eye pass, numbers in the run note; a capture.
- [ ] **L3.4 Hands and zoom (3 to 5 days).** Meta Interaction SDK hand poses, driven by the Simulator's synthetic hands
      **[verify on Lynx]** what v207's Simulator offers. Point to highlight; pinch-pull lifts a room (L0 to L2); a
      breadcrumb and a way back. Tracking loss is a state (registry `hand-tracked-timing-windows`): pinch is judged from
      motion onset, and controllers are the fallback.
      Proof: `BpLevel: L0 -> L1 wing=<id>`, `L1 -> L2 room=<id>` and the reverse for every level;
      `BpHands: tracking lost -> held` / `tracking back` when the hands are hidden in the Simulator; the owner's note in
      the run file (in the Simulator).
- [ ] **L3.5 Lenses (1 to 2 days).** A lens switch on the wrist over `Plan.lenses` (8 ids). A lens changes what places
      say (tile `health[<lens>]`, `general`), never where they are.
      Proof: an automation test or console command `BpLens.Cycle` that switches all 8 and logs `BpLens: <id> moved=0`
      for each (wing, room, bay and tile transforms compared before and after); a capture of two lenses side by side.
- [ ] **L3.6 Render spike (2 days).** Forward + MSAA (`r.ForwardShading=1`, `r.AntiAliasingMethod=3`, `r.MSAACount=4`,
      `vr.InstancedStereo=1` in `apps/vr/Config/DefaultEngine.ini`, **[verify on Lynx]** the 5.8 names) against
      deferred + Lumen + TSR, at Quest 3 resolution (2064x2208 per eye; **[verify on Lynx]** that the Simulator's device
      is set to Quest 3), on the full Kettle plan, in the Simulator.
      Proof: GPU and Game/Draw frame times for both in `machine.md` (from `stat unit` and `stat gpu`, plus an Unreal
      Insights trace `-trace=default,gpu` of a 60 s scripted look-around), with **p50, p95 and max**. Forward stays
      chosen unless Lumen's p50 fits 11.1 ms (R5, decision 4).
- [ ] **P3 gate (Lynx + owner, half a day).** All of these, in `runs/<date>-lynx-p3-gate.md`:
  - **The 11.1 ms bar on the forward path with the full Kettle plan, in the Simulator.** Over a 60 s scripted walk the
    app GPU time and the game thread are each **11.1 ms or less at p50** (R5, closed 2026-10-23). p95 and max are
    recorded, not judged. Say in the note whether the reading is from the cooked `bp.exe` or from `-game`. Every Lynx
    frame time includes x64 emulation of the game thread (risk H2); a headset's refresh, ASW and dropped frames are not
    measured in this phase.
  - **Draw calls and triangles** from `stat rhi` / `stat scenerendering`, recorded as the baseline for P4's budget
    (150 draw calls, 350k visible triangles).
  - **Text legibility.** The owner reads every wing name and the smallest label at standing distance in the Simulator.
    Record that label's angular height in degrees (2·atan(h / 2d)) from the scene geometry. It becomes the VR
    equivalent of bp's 12 px floor from then on (R4 option A, owner 2026-10-23): written into this file and plan.md P3
    with the owner's height; a headset reading waits for the headset route.
  - **Owner walk-through** in the Simulator: L0 to L2 and back, 8 lenses. The owner's verdict line in the note.

### P4 Assets (made on Lynx; the import is deferred)

The chain per asset and the ArtSource rules are in [`wolf-plan.md`](wolf-plan.md) P4 and stay the record: concept
sheet, input gate, TRELLIS.2, mesh acceptance, scale, finishing, poly budget, then UE import through the editor MCP. The
Lynx-to-Wolf hand-off and its Host trailers are parked (decision 7).

- [x] **L4.0 Lamp design lock.** Done 2026-10-21: option A, the spring-arm cone (wolf-plan L4.0, R7 closed).
- [x] **L4.1 Props.** Done 2026-10-21: 14 ArtSource folders, every gate `pass: true`, `npm run check:art` green and in
      `npm run check` (wolf-plan L4.1, with every asset's dated line; plan.md 'P4 Lynx-side back-measure (2026-10-22)').
- [ ] **L4.2 Import (Lynx, half a day per asset; deferred).** Import each `final.*` through the editor MCP into
      `apps/vr/Content/Bp/Art/<asset-id>/`. Nothing is imported without its gate results (the plan.md P4 gate). The
      lamp is imported as it stands (R8b allowed, owner 2026-10-23). Deferred by the owner on 2026-10-23 until the project succeeds (decision 7).
      Proof: the manifest's `import` block; `stat rhi` and `stat scenerendering` with the asset in the greybox.
- [ ] **P4 gate (Lynx; deferred with L4.2).** Every asset carries its gate results, and the slice stays at **150 draw
      calls and 350k visible triangles or fewer** at the target pose, with the P3 frame time still held (p50, R5).
      Proof: `runs/<date>-lynx-p4-gate.md` with the `stat` lines and the frame times.

### P5 The loop: scan, wave, voice (3 to 4 weeks)

The rule stands: anything that is a rule, a route or a wire shape is Node or TS work in `packages/*` or `apps/server`,
gated by `npm run check`. UE only draws, gestures, streams audio and calls routes.

- [x] **L5.1 Wire schema.** Done (`73d5dec`; wolf-plan L5.1).
- [x] **L5.2 Kettle sim host in apps/server.** Done 2026-10-21 (`61181b2`; wolf-plan L5.2). Kettle's `/stream` answers
      200, and BpLink finishes on that 200 (`422d7fa`, reading 14).
- [x] **L5.3 Athena host.** Done 2026-10-22 on Lynx against athena-portable `9beaef31`: `smoke-athena: 22 passed, 0
      failed` (wolf-plan L5.3, which also holds the hand-run rule for `scripts/smoke-athena.mjs`).
- [ ] **L5.4 Scan (4 to 5 days; was W5.1).** A sweep gesture or voice starts `scan.place` for the pointed scope (core's
      `scopesAt` gives the scope, via a route or the wire). The scan-line band is a material parameter collection. Pins
      rise from the SSE stream: a BpLink SSE reader over the UE HTTP module's streaming response **[verify on Lynx]** the
      5.8 API, parsed through the wire USTRUCTs. Proof: findings appear at their fixtures
      (`BpScan: pin <finding> at tile <id>`); a sweep with no scope is a visible reject (`BpScan: reject ...`). The band is
      cyan (R6, owner 2026-10-23); pins and the agent head stay amber.
- [ ] **L5.5 Packages (3 days; was W5.2).** Pinch a pin onto the wrist; set model (Sonnet 5.5 or Opus 5.5) and effort
      (low to xhigh). BpLink writes with `Content-Type: application/json` and a loopback Host (`local-only.ts`). Proof:
      the server's wave contract holds (`npm run check:waves` stays green; one finding in one draft wave at most, shown
      by trying to add it twice).
- [ ] **L5.6 Dispatch and jobs (3 days; was W5.3).** Dispatch is athena's GATED `wave.dispatch`; at most 3 jobs run at
      once; progress shows on the wrist and as light in the room. Proof: a wave dispatched by voice and one by pinch
      land as the same job shape (`GET /api/products/<slug>/scans` or the jobs event).
- [ ] **L5.7 Voice and cards (4 to 5 days; was W5.4; needs L10).** UE streams the microphone as PCM16 to athena's
      `/voice` websocket (UE `WebSockets` module) and plays the reply. The lamp's states follow athena's events. The
      cards come from `/decisions` and are answered by `POST /decisions/<id>`. Proof: the L5.3 seam smoke run from the
      Simulator, with log lines. Lynx's microphone is the input.
- [ ] **L5.8 Live product (2 days; was W5.5).** The loop on a product in `bp.products.local.json` (git-ignored), not
      only Kettle. Proof: `node scripts/smoke-live.mjs` green against `npm run server`, plus the run in the Simulator.
- [ ] **P5 gate.** The full loop by voice alone and by hand alone, on Kettle and on a live product
      (`runs/<date>-lynx-p5-gate.md`).

### P6 Beauty pass (Lynx; 2 to 3 weeks)

- [ ] **L6.1 Light, materials, post and text** per plan.md P6: the table as key light (rect lights and baked bounce on
      the forward path, R14), edge glow v1, glass, paper fibre, the lamp's warm head; fog and bloom tuned against text
      legibility; every readable string a compositor layer or a high-resolution widget.
- [ ] **L6.2 Fidelity capture.** pof's `capture_viewport` from the target pose (standing, about 45° down at the near
      edge, lamp in the upper third). Save it as `captures/p6-<date>-lynx.jpg`, next to `target-light-table.jpg`. The
      lamp in the frame needs L4.2, which is deferred: until then the capture says what stands in for it.
- [ ] **L6.3 Score.** Score all 15 elements in `art-breakdown.md` 0 to 3, with a vision-model pre-score as advice only,
      in `runs/<date>-lynx-p6-fidelity.md`. **Pass:** no element below 2, and elements 1, 4, 7, 9, 10 and 11 at 3; the
      owner's verdict (in the Simulator; in a headset once the headset route is decided); the P3 frame-time gate re-run
      and still held (11.1 ms at p50, R5).

### P7 Comfort and hardening (Lynx + owner; 1 to 2 weeks)

- [ ] **L7.1 Comfort.** No artificial locomotion; a seated mode that lowers the table; snap re-centre; reduced motion
      honoured; a session timer and a rest pose.
- [ ] **L7.2 Failure states drawn on purpose.** Server down (L3.1-8 extended to a drawn state), Athena down, voice not
      ready, tracking lost, a job failed, the token cap reached. Proof: one capture and one log line each.
- [ ] **L7.3 Docs.** `apps/vr/README.md` ("run it", replacing the placeholder text), bp's `README.md` channel table, and
      a registry lead for what tethered VR and generated props taught.
- [ ] **P7 gate (owner).** The owner works one hour in it and wants to come back. Where that hour is spent (the
      Simulator or a headset) follows the headset route, section (f).

---

## (d) Gates on Lynx before merging, and the schema parity rule

Run before every commit that touches code (`apps/vr`, `packages/*`, `apps/server`, `scripts/`):

- [ ] `npm run check` at the repo root: `N passed, 0 failed, 0 skipped of N` (only `check:python-deps` may be skipped).
      It includes `typecheck`, `check:schema`, `check:bplink`, `check:server` and `check:claims`.
- [ ] Once L3.1-6 has run: the UBT `bpEditor Win64 Development` build, exit 0.
- [ ] Once L3.1-6 has run: the UBT `bp Win64 Development` build, exit 0.
- [ ] Once L3.1-7 has run: the Kettle line, verbatim, from L3.1-7's headless command, whenever BpLink, the schema or the
      server's Kettle routes changed.
- [ ] `git status --short` shows only the step's paths: no `Binaries/`, `Intermediate/`, `Saved/`, `.sln`, plugin
      trees, or files under the schema junction.
- [ ] The secret scan is clean, and `.env` is neither staged nor printed (CLAUDE.md "Git").

**The parity rule for `packages/schema/generated/ue`** (unchanged from wolf-plan section d, with R1 closed):

- Both headers are generated by `packages/schema/generate.mjs` from `packages/schema/schema/*.schema.json`. They are
  never edited by hand, never copied into `apps/vr`, and never patched to make UHT or MSVC happy.
- A UE-side fault in a generated header is fixed in `generate.mjs` (or the schema). Then run `npm run schema:generate`
  and `npm run check:schema`, and commit the generator, the schema and both regenerated files (TS and UE) in **one**
  commit, with the UE build that proves it (`cd9dd65` is the example, reading 12).
- BpLink reaches the headers only through the git-ignored junction `apps/vr/Source/BpLink/Public/Schema`, as
  `Schema/<header>` (decision 3; `ed94a65`). The bytes compiled are the bytes `check:schema` checks.
- Any UE-only header BpLink needs lives in `apps/vr/Source/BpLink/`, never in `packages/schema/generated/`.

---

## (e) Known gaps

- **E1 UHT and `BpSchema.h`: closed 2026-10-23** by decision 3. Readings 1 and 9 show UHT never sees the header
  through `PublicIncludePaths` alone; readings 2 to 14 show it does through the junction.
- **E2 to E8: still unmeasured as questions of their own.** They are in wolf-plan section (e) and stay as written there:
  E2 `override` as a field name (`BpSchema.h:797`), E3 the module name and API macro (`BPLINK_API`, the template's
  `BP_API`), E4 the module dependencies, E5 `FJsonObjectConverter` usage, E6 the fix-up header under `/permissive-`,
  E7 the `BpLink.cpp` details, E8 PCH and the include path. The probe readings bear on several: UHT wrote
  `BpSchema.generated.h` with `FBpFacetOverride override;` in its input (readings 2 to 14), both targets compiled with
  0 warnings (readings 8, 10 to 14), and `CopyRaw` (E5) failed and was fixed (readings 12 and 14). But the probe's
  project is synthesized, its `bp` module is not the template's, and no reading put an E line to a test of its own. Each
  stays open until L3.1-6 builds the editor-made project; that run note records each one.
- **Not measured by any reading** (reading 14's "does NOT establish" list): `BpLink.Fetch`, a second fetch in one session,
  the 405 branch, what text `CopyRaw` leaves in `Glyph_` and `CrossRefs_`, and how the `/stream` 200 completes after the
  cancel.

---

## (f) Risks and owner decisions

### Open

| # | Risk or ask | Owner? | State (2026-10-23), and the default if nobody decides |
|---|---|---|---|
| R14 | The forward path cannot fake the concept's bounce light well enough for the fidelity score (plan.md risks). | owner, at P6 | rect lights and baked bounce first; Lumen only if the score needs it and its p50 fits 11.1 ms |
| H1 | **The headset route.** No headset in this phase (decision 5). Meta's Link requirements list Intel and AMD CPUs only, so Quest Link on Lynx's ARM64 CPU is not an option as published. What needs a headset: the P3 gate's legibility reading and walk-through as a headset reading, R4 option B, the P6 verdict "in the headset" (plan.md P6), the P7 hour, and any refresh-rate, ASW or dropped-frame measure. | **owner, later** | **Open, deferred.** Until decided: the Simulator stands in, and every such reading says "in the Simulator" |
| H2 | **The emulated editor.** Epic documents the UE 5.8 editor as unsupported on Windows ARM64 (decision 1). Here it runs as emulated x64. Measured: UBT builds (readings 3 to 14) and a headless `-nullrhi` editor boot to the Kettle line (readings 10 and 14). Not measured: the editor with a real RHI, the New Project dialog, PIE, the Simulator, the editor MCP, cooking, and any frame time. The game thread's frame time includes emulation. | agent, then owner | **Open.** Each L3.1 step records what the emulated editor did. If a step fails for a reason that is the emulation, that is a finding for the owner, not a workaround |
| R12 | Generation and VR share Lynx's GPU. | agent | one at a time: no generation job during a UE frame-time reading, and no UE session during a generation job (section a) |

### Closed

| # | Closed by | Record |
|---|---|---|
| R4 | owner, 2026-10-23: option A, measure then fix | L3.2 starts the table top at 95 cm behind one named constant and `bp.TableHeightCm`; the owner tunes it in the Simulator. The text floor is the angular height of the smallest label the owner reads without leaning at the P3 walk, and it is the floor from then on (L3.6 gate). Comfort defaults: L7.1's list (no artificial locomotion, a seated mode that lowers the table, snap re-centre, reduced motion honoured) |
| R6 | owner, 2026-10-23: cyan | The scan band is cyan, as the target, art-breakdown #8 and frame 03 show. `art-breakdown.md`'s style-block palette moves "scan" out of the amber attention role, which keeps pins and the agent head (L5.4) |
| R8b | owner, 2026-10-23: allowed | Leonardo images may be the image-to-3D input for shipped meshes. The image stays in ArtSource as provenance; the shipped bytes are TRELLIS.2 output (MIT) plus Lynx's own finishing. `lamp-agent` imports as it stands (L4.2); `tech-stack.md` §5 carries the rule |
| R1 | owner, 2026-10-23 (decision 3): the junction | wolf-plan R1; `machine.md` readings 2 to 14 |
| R2 | default, 2026-10-22: the installed 5.8.x, recorded | UE 5.8.4-58902052 (L3); `PLUGIN_BUILD_ID` against `ENGINE_COMPATIBLE_CHANGELIST` is L3.1-5's proof |
| R3 | agent: Blank C++, plus the Meta plugins | L3.1-2 |
| R5 | owner, 2026-10-23 (decision 4): p50 at or under 11.1 ms; p95 and max reported | P3 gate above |
| R7 | owner, 2026-10-21: lamp option A | wolf-plan R7 |
| R8 | the Director for the operator, 2026-10-21: Leonardo for look-dev and the backdrop | wolf-plan R8; tech-stack.md §5 |
| R9 | decided: no LFS; the 50 MB rule, enforced by `npm run check:art` | wolf-plan R9 |
| R10 | operator, 2026-10-22: athena runs on Lynx | L10 |
| R11 | done: L5.2 and BpLink's 200 handling (`422d7fa`, reading 14) | wolf-plan R11 |
| R13 | moot, 2026-10-23 (decision 8): bp is registered for Lynx | ai-registry `64d3dbda` |
