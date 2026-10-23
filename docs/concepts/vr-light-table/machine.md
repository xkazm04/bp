# VR Light Table: machine facts

Facts about the machines that build `apps/vr`, as measured. plan.md P0 and WP3.6 and wolf-plan.md section (a) name this
file. Every line below is a command's own output or a file read on the named host; anything not measured says so.

> **2026-10-23 (owner).** Lynx is now the only build host; Wolf is retired, and the live plan is
> [`lynx-plan.md`](lynx-plan.md). The readings below are unchanged. New Lynx facts go in a new dated section.

## Lynx, 2026-10-24: L3.3 the volumes

Spark `vr-volumes`. `ABpTable` draws /plan's rooms, bays and tiles as three `UInstancedStaticMeshComponent`s (engine
cube, per-instance custom data = the instance's size in cm) with `M_EdgeGlow` (unlit, additive, made through the editor
MCP: `mcp-steps/l33-content.jsonl`, `py/edge_glow.py`, which must run outside PIE). Tile height is the active lens's
reading (bad 2.4, watch 1.4, good 0.6, unmeasured/na 0.1 cm); rooms are 3 cm shells, bays 0.3 cm plates.

- **Getting counters out of a Simulator run.** `stat scenerendering` is an overlay, and `stat dumpmax` logs cycle stats
  only, no draw counts. The CSV profiler does: `-csvCaptureFrames=900` writes per-pass `DrawCall/<pass>` columns and
  `GPUSceneInstanceCount` to `%LOCALAPPDATA%/UnrealEngine/5.8/Saved/Profiling/CSV/` (the uncooked `-game` run writes
  there, not under `apps/vr/Saved`). `run-bplink.mjs` gained `--exec`, `--ue-args` and `--hold` for this.
- **Instanced stereo is off** in `apps/vr/Config/DefaultEngine.ini` (`vr.InstancedStereo=False`; the log says
  `XR: Instanced Stereo Rendering is Disabled`). L3.6 decides it.

| # | What ran | Verbatim result |
|---|---|---|
| 27 | `node apps/vr/tools/run-bplink.mjs --mode game` (uncooked) | `LogBpTable: BpTable: wings=5 order=A,B,C,D,E height_cm=95`, `LogBpTable: BpTable: instances rooms=13 bays=29 tiles=133 lens=business` |
| 28 | `BpTable.Lens performance` in PIE (`py/lens_check.py` compares every tile before and after) | `BpTable: lens=performance tiles=133 moved=0`; 122 tiles re-heighted, heights `{0.1: 114, 0.6: 12, 1.4: 7}` |
| 29 | the capture from the target pose (PoF `capture_viewport`, PIE; `mcp-steps/l33-capture.jsonl`) | [`captures/l33-2026-10-24-lynx.jpg`](captures/l33-2026-10-24-lynx.jpg): shells, plates and blocks, watch/bad tiles visibly taller in B and D, A to E named (lifted wing labels inset 3.2 cm against the parallax) |
| 30 | `run-bplink.mjs --mode game --xr-sim --ue-args "-csvCaptureFrames=900" --hold 60`, volumes shown | Meta XR Simulator 207.0.0; steady state (702 frames): `GPUSceneInstanceCount` 189; `DrawCall/Translucency` p50 11 (p95 11); Basepass 5, Prepass 5, ShadowDepths 20 |
| 31 | the same with `--exec "ShowFlag.InstancedStaticMeshes 0"` | steady state (871 frames): `GPUSceneInstanceCount` 189; `DrawCall/Translucency` p50 8 (p95 8); Basepass 5, Prepass 5, ShadowDepths 20 |

Readings 30 and 31 differ by **3 translucency draws, one per instance batch**, and nothing else in the mesh passes. The
volumes add no base-pass, prepass or shadow draws (additive and `CastShadow` off). `DrawCall/SlateUI` read 52 against 2.
The show flag should not touch widgets, and why it did is not explained.

Not established: whether the CSV counter counts one eye view or both, with instanced stereo off (frames with 22 and 16
appear as maxima); any frame-time judgement (`FrameTime` p50 10.8 ms was read with the CSV, but R5 is judged at L3.6
on the forward path); the greybox fallback at runtime (the asset was present), which in a cooked build would draw an
opaque default, since no engine translucent material is flagged for instanced meshes; the replay of
`l33-content.jsonl` on an empty `Content/`; a cooked build of these volumes.

## Lynx, 2026-10-23 (later): L3.2 the table, made through the editor MCP

Spark `vr-table`, commits `6e002e9` (ABpTable), `167dc92` (the MCP tooling), `88c849b` (two fixes the captures found),
`34a2156` (the content). Host and toolchain as below.

- **The editor MCP on Lynx.** `node apps/vr/tools/mcp-editor.mjs start`: `MCP_READY http://127.0.0.1:8770/mcp` (a headless
  `UnrealEditor-Cmd`, `-RenderOffScreen -ModelContextProtocolStartServer -ModelContextProtocolPort=8770`). Port 8770
  because a local uvicorn server held the plugin default 8000. `list_toolsets` shows EditorToolset's and PoF's toolsets;
  PoFToolset needs GameplayAbilities enabled (its `gas.py` names `unreal.AbilitySystemComponent` at import).
- **Tool facts.** `StaticMeshTools.import_file` refuses `.glb` (`FbxFactory does not support ".glb" files. Allowed:
  ['fbx', 'obj']`); an `AssetImportTask` through Interchange imports it. `TextureTools.import_file` does not save
  (the textures were gone after an editor restart). Material outputs are spelled `MP_BaseColor`, `MP_EmissiveColor`.
  `CaptureViewport` renders the editor world, not PIE; PoF's `capture_viewport` (HighResShot of the active
  viewport) captures the PIE view.

| # | What ran | Verbatim result |
|---|---|---|
| 22 | `StaticMeshTools.get_bounds` on the imported frame | `{"min":{"x":-60.000003814697266,"y":-40,"z":0},"max":{"x":60.000003814697266,"y":40,"z":95}}`; 4 slots; `get_triangle_count` 464 |
| 23 | the first capture (PoF `capture_viewport`, PIE, lit paper) | the frame's long side faced away and the paper washed out white under auto exposure (fixed: `88c849b` yaw 90; unlit paper, manual exposure) |
| 24 | PIE after `BpLink.Fetch` | `LogBpTable: BpTable: wings=5 order=A,B,C,D,E height_cm=95`, no `missing, greybox` line |
| 25 | the capture from the target pose (-80, 0, 165 cm, pitch -45) | [`captures/l32-2026-10-23-lynx.jpg`](captures/l32-2026-10-23-lynx.jpg): A to E left to right, names readable, D's wrapped |
| 26 | `node apps/vr/tools/run-bplink.mjs --mode game --xr-sim` | `LogHMD: Initialized OpenXR on Meta XR Simulator runtime version 207.0.0`, `LogLoad: LoadMap: /Game/Maps/LightTable`, the Kettle line, `LogBpTable: BpTable: wings=5 order=A,B,C,D,E height_cm=95`, 0 greybox warnings |

Not established: any frame time; the text floor in degrees (R4, measured at the P3 walk); a cooked build of this map;
`bp.TableHeightCm` tuned by the owner; the replay of `mcp-steps/l32-content.jsonl` on an empty `Content/`.

## Lynx, 2026-10-23: the editor-made project in `apps/vr`, and WP3.1's acceptance met

Host: Lynx, as below (UE 5.8.4-58902052, MSVC 14.44.35207 `Hostx64`, emulated x64 on ARM64; Node v24.22.0). Every run
here is on the real `apps/vr/bp.uproject` in the repo, not the probe. Commits: `c92f9dc` (junction, install-xr.ps1),
`64a9be3` (Simulator pinned), `8e191b5` (the project, readings 15 to 19), `955fac8` (reading 21's fix).

### Facts, newly measured

- **Templates are installed.** They live at `C:/Program Files/Epic Games/UE_5.8/Templates` (`TP_Blank` with `Source/`,
  32 template folders), where the New Project dialog reads them; the 2026-10-22 bullet below looked under
  `Engine/Templates`.
- **The GUI editor runs** emulated x64 on D3D12: `LogD3D12RHI: Found D3D12 adapter 0: NVIDIA RTX Spark N1X (6144-core
  Blackwell RTX GPU)`, `Max supported Feature Level 12_2, shader model 6.7`, `Adapter has 63986MB of dedicated video
  memory ... UMA:true`, `Driver Version: 617.69`, `LogRHI: RHI D3D12 with Feature Level SM5 is supported and will be used`
  (`%LOCALAPPDATA%/UnrealEngine/5.8/Saved/Logs/Unreal.log`).
- **The editor's own UBT calls fail on ARM64 as shipped.** New Project copied `TP_Blank`, then `Build.bat -projectfiles`
  printed `Using bundled DotNet SDK version: 10.0 win-arm64` and failed, and the editor rolled the project back
  (`Documents/Unreal Projects` left empty). `Engine/Build/BatchFiles/GetDotnetPath.bat` picks `win-arm64` when
  `PROCESSOR_ARCHITECTURE` is `ARM64`, and skips that choice when `UE_DOTNET_VERSION` is already `10.0`.
  `apps/vr/tools/start-editor.ps1` sets it and puts the bundled `win-x64` dotnet first on PATH for the editor's process
  tree only. With that environment, `Build.bat -projectfiles` on a probe project: `Result: Succeeded`, `Total execution
  time: 27.43 seconds`; and New Project, rerun by the owner from that editor, kept the project.
- **EngineAssociation** is `{93FBB54C-42B1-616F-D658-CBAA01C5B0A5}`, which `HKCU\Software\Epic Games\Unreal
  Engine\Builds` maps to `C:/Program Files/Epic Games/UE_5.8` (the engine is registered as a custom build, not through the
  launcher's `LauncherInstalled.dat`). Kept as the editor wrote it.
- **Meta XR v207** (`install-xr.ps1`, `c92f9dc`/`64a9be3`): `SHA256_OK=UnrealMetaXRPlugin.207.0.zip` (472628598 bytes),
  `SHA256_OK=MetaXRInteractionPackage.207.0.0.zip` (690834867 bytes), `PLUGIN_BUILD_ID=55116800`,
  `ENGINE_COMPATIBLE_CHANGELIST=55116800`. **Meta XR Simulator v207.0**: `meta_xr_simulator_v207.0.msi`, 436768768 bytes,
  `Get-AuthenticodeSignature` `Valid`, signer `CN="Meta Platforms, Inc."`, SHA-256 `6751289b...d525`; extracted with
  `msiexec /a` to `%LOCALAPPDATA%/MetaXRSimulatorExtract/PFiles/MetaXRSimulator/v207.0` (no install, no HKLM write).

### Readings 15 to 21

| # | What ran | Verbatim result |
|---|---|---|
| 15 | `bpEditor Win64 Development`, UBT through the x64 dotnet, `apps/vr/bp.uproject` (the template's `bp` module, BpLink, MetaXR, MetaXRInteraction) | `Result: Succeeded`, `Total execution time: 1093.95 seconds`, 0 `: error` lines; `[414/527] Compile [x64] BpLink.cpp`, `[417/527] Link [x64] UnrealEditor-BpLink.dll`. Warnings: C4996 deprecations in the Meta plugins' own sources only |
| 16 | `node apps/vr/tools/run-bplink.mjs --mode editor` (`UnrealEditor-Cmd.exe bp.uproject -nullrhi`, apps/server `--port 0`) | `LogBpLink: BpLink: kettle streams (200); WP3.1 does not consume SSE, so rev 80557561ddf0f4cd read once from structure stands`, then `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd` |
| 17 | the same, `--no-server` (a closed port) | ``LogBpLink: Error: BpLink: GET http://127.0.0.1:62249/api/products/kettle/structure failed (connected=0, status=0). Is `npm run server` running?``; no crash |
| 18 | `--mode game --xr-sim` (`-game -RenderOffScreen`, `XR_RUNTIME_JSON` = the Simulator json for this process only) | `LogHMD: Initialized OpenXR on Meta XR Simulator runtime version 207.0.0`, then reading 16's Kettle line |
| 19 | BuildCookRun (`RunUAT.bat` with start-editor.ps1's environment), Win64 Development, `-build -cook -stage -pak -map=/Engine/Maps/Entry` | `BUILD SUCCESSFUL`, `AutomationTool exiting with ExitCode=0 (Success)`; `Took 637.23s to run dotnet.exe` (the `bp` Game build), `Took 183.13s to run UnrealEditor-Cmd.exe` (the cook) |
| 20 | the staged `bp.exe -nullrhi` from reading 19 | the engine initialises and loads `/Engine/Maps/Entry` (reading 11's `ReaderPos + Num <= ReaderSize` assert is gone with cooked content), then `Unhandled Exception: 0xc06d007e`. The minidump's `DelayLoadInfo`: `szDll` `InteractionSdk.dll`, proc `isdk_ScaledTimeProvider_create`. With `-LogCmds="LogPluginManager Verbose"`: `Ignored optional reference to 'OculusInteraction' plugin; plugin was not built by target.` (and `'OculusXR'`) |
| 21 | after `955fac8` (plain `Enabled` plugin entries), BuildCookRun again (`Took 28.75s to run UnrealEditor-Cmd.exe`, `BUILD SUCCESSFUL`), staged `bp.exe -nullrhi` | `Mounting Project plugin OculusInteraction`, `Mounting Project plugin OculusXR`, `FIsdkOculusXRModuleInstance initialized successfully`, no critical error, and reading 16's Kettle line |

### What this does NOT establish

- Any frame time, and the headset (decision 5: the Simulator only). Reading 18 ran `-RenderOffScreen`; nothing was drawn
  to a window or a view.
- `BpLink.Fetch` and the 405 branch (Kettle answers 200).
- The `bp` Game target built alone through UBT: it was built only inside BuildCookRun (reading 19).
- Side finding, not fixed: BpLink also starts its request inside the cook commandlet (`LogHttp: Warning: ... libcurl
  error: 7 (Could not connect to server)` in reading 19's log). Harmless; a guard on `IsRunningCommandlet()` would stop it.

### How to reproduce

```
powershell -File apps/vr/tools/link-schema.ps1
powershell -File apps/vr/tools/install-xr.ps1
<x64 dotnet> UnrealBuildTool.dll bpEditor Win64 Development -Project=<repo>/apps/vr/bp.uproject -WaitMutex
node apps/vr/tools/run-bplink.mjs --mode editor          # readings 16; --no-server 17; --mode game --xr-sim 18
RunUAT.bat BuildCookRun -project=<repo>/apps/vr/bp.uproject -platform=Win64 -clientconfig=Development -build -cook -stage -pak -map=/Engine/Maps/Entry -stagingdirectory=<dir> -unattended
node apps/vr/tools/run-bplink.mjs --mode staged --exe <dir>/Windows/bp/Binaries/Win64/bp.exe   # reading 21
```

The UBT and RunUAT lines need start-editor.ps1's environment (`-EnvOnly` names the dotnet it puts on PATH): `UE_DOTNET_VERSION=10.0` and the
bundled `win-x64` dotnet first on PATH.

## Lynx, 2026-10-22: Unreal Engine is installed, and the first UHT reading for BpLink

Host: Lynx (Windows 11 Pro 10.0.28000 on ARM64: `uname` reads `MINGW64_NT-10.0-28000-ARM64`, and UBT prints
`Running x64 binary on arm64 system`; UBT reports `20 physical cores` and `63.99 GB physical`). Repo at `4a3353a`.

### The install

- **Unreal Engine 5.8.4, Changelist 58902052**, at `C:/Program Files/Epic Games/UE_5.8`. `Engine/Build/Build.version`
  reads `MajorVersion 5`, `MinorVersion 8`, `PatchVersion 4`, `Changelist 58902052`, `CompatibleChangelist 55116800`,
  `BranchName ++UE5+Release-5.8`.
- **Complete, an installed build**: `Engine/Build/InstalledBuild.txt` and `Engine/Binaries/Win64/UnrealEditor-Cmd.exe`
  are present (UBT runs its header tool with `-installed`). Their files are dated 2026-10-22 15:03 to 15:05 local, so
  the engine arrived on Lynx that day: the "Lynx has no Unreal Engine" lines written on 2026-10-20 and 2026-10-21 were
  true when written and are superseded from 2026-10-22 (corrections dated in plan.md, wolf-plan.md, apps/vr/README.md
  and apps/vr/WP3.1.md).
- `Engine/Templates` does **not** exist in this install (an optional launcher component), so the editor's New Project
  dialog route of wolf-plan W3.1-2 cannot run on Lynx.
  *Correction 2026-10-23: this looked in the wrong folder. The New Project dialog reads `<root>/Templates`
  (`Engine/Source/Editor/GameProjectGeneration/Private/GameProjectGenerationModule.cpp:186`,
  `FPaths::RootDir() / TEXT("Templates")`), and `C:/Program Files/Epic Games/UE_5.8/Templates` exists, read on 2026-10-23:
  35 entries, among them `TP_Blank` with `Source/`, `Config/` and `TP_Blank.uproject`, beside `UE_5.8/FeaturePacks`
  (9 entries), both dated 2026-10-22 15:28. `Engine/Templates` is still absent. The dialog itself has not been opened
  ([`lynx-plan.md`](lynx-plan.md) L4).*
- `UnrealBuildTool.dll` is at `Engine/Binaries/DotNET/UnrealBuildTool/`. The bundled .NET is
  `Engine/Binaries/ThirdParty/DotNet/10.0/win-x64` **only**; there is no `win-arm64`.
- MSVC: `C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207` (folder dated
  2026-10-20). UBT's toolchain line: `Using Visual Studio 14.44.35229 toolchain (C:\Program Files (x86)\Microsoft Visual
  Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207) and Windows 10.0.26100.0 SDK (C:\Program Files (x86)\Windows Kits\10).`
  No clang was used or looked for.

### How UBT runs here, and why every compile is emulated x64

- `Build.bat` is not usable on Lynx: it resolves the bundled .NET by host architecture and dies with `0x80008096` and no
  output, because the `win-arm64` runtime is absent. UBT is driven directly with the bundled **win-x64 dotnet**.
- UBT picks its MSVC host from its own process architecture
  (`Engine/Source/Programs/UnrealBuildTool/Platform/Windows/MicrosoftPlatformSDK.cs:1317`), and it cannot run on a native
  ARM64 .NET because UBT publishes `blake3_dotnet` for win-x64, win-x86 and win-arm but not win-arm64. So UBT runs as an
  emulated x64 process and selects **Hostx64**: every `cl.exe` here is emulated. That is structural (Epic's packaging), not
  a fault of a run. UBT's stdout says so itself: `Running x64 binary on arm64 system. Use arm binaries instead`. (Both
  facts were measured by the pof session's `scripts/diablo/ue_arm_probe.ts` the same day; this run reproduces the Hostx64
  choice.)
- UBT's stdout does not name the host; its own log `%LOCALAPPDATA%/UnrealBuildTool/Log.txt` does:
  `Compiler: C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`.
- UBT used the Unreal Build Accelerator local executor (20 processes).

### The probe: a synthesized host project OUTSIDE the repo

apps/vr/README.md, WP3.1.md and wolf-plan W3.1-2 say the real `.uproject` is made by the editor, never by hand, and that
rule stands: **nothing was added to `apps/vr`** (no `.uproject`, `Config/`, `Content/`, `Binaries/`, `Intermediate/`,
`Saved/`, `.sln` or game module). The probe project was synthesized by `scripts/uht-probe.mjs` under a scratch directory,
`C:/Users/kazda/AppData/Local/Temp/bp-6127dc79/bp-uht-probe/`:

```
bp-uht-probe/
  packages/            directory junction -> <repo>/packages (the worktree at 4a3353a)
  apps/vr/
    bp.uproject        synthesized: FileVersion 3, EngineAssociation 5.8,
                       Modules [ bp (Runtime, Default), BpLink (Runtime, PostEngineInit) ]
    Config/DefaultEngine.ini
    Source/bp.Target.cs, Source/bpEditor.Target.cs   ExtraModuleNames.AddRange({ "bp", "BpLink" })
    Source/bp/         bp.Build.cs, bp.h, bp.cpp (IMPLEMENT_PRIMARY_GAME_MODULE)
    Source/BpLink/     a byte-for-byte COPY of the repo's three files
```

`BpLink.Build.cs` computes its include path as four levels up from `ModuleDirectory`; in the probe that resolves to
`bp-uht-probe/packages/schema/generated/ue`, the same relationship as in the repo. The script prints it and reads
`BpSchema.h` there before it builds.

SHA-256, repo working copy = probe copy (CRLF working copies; for the headers, the LF-normalised text equals the `HEAD` blob):

| File | SHA-256 |
|---|---|
| `apps/vr/Source/BpLink/BpLink.Build.cs` | `c89a35f4a7db207cfa7019912ed622a047063f104663011eef7a56fdbc26d36a` |
| `apps/vr/Source/BpLink/Public/BpLink.h` | `b89df792c069ec619d0f396689f89afad6886fceec04ec2314d9093373985f75` |
| `apps/vr/Source/BpLink/Private/BpLink.cpp` | `71ee42db1007bb347b52e6301053ee8446d39ab19e6c8ed74c89522a65e6c042` |
| `packages/schema/generated/ue/BpSchema.h` (read through the junction) | `e2eb2802c61f96b776c6ca61a8edef1a66542d0779ce3b02d4e21a444396f0a5` (LF: `c09afbb9a866d72abf06064f6116f76539a31c0308779980e35abd1943ff699b`) |
| `packages/schema/generated/ue/BpSchemaFixups.h` | `7b102f5e43dbb5d196f3660c95d4532e93fc2c740635319477077f673564a2ae` |

### Reading 1: `bpEditor Win64 Development`, as is (BpSchema.h only on PublicIncludePaths)

Exit code **6**, **166.1 s** wall clock (UBT: `Total execution time: 164.76 seconds`). Full output:
`C:/Users/kazda/AppData/Local/Temp/bp-6127dc79/bp-uht-probe/uht-probe-asis.log`; UBT's log: `.../ubt-Log-asis.txt`.

- (a) **UHT ran, and BpSchema.h was not in its input.** `UHT processed bpEditor in 5.2567923 seconds (0 generated files
  written)`. UHT's file list, `Intermediate/Build/Win64/bpEditor/bpEditor.uhtmanifest`, holds 579 modules and **no
  `BpLink` module at all**: neither `BpLink` nor `BpSchema` appears in it. UBT hands UHT only the reflected headers under a
  module's own directory, and `BpLink.h` declares no `USTRUCT`/`UCLASS`.
- (b) **No `BpSchema.generated.h` was written** anywhere under the probe's `Intermediate/`.
- (c) The build stopped in the compile of `BpLink.cpp`, verbatim:
  `C:\Users\kazda\AppData\Local\Temp\bp-6127dc79\bp-uht-probe\packages\schema\generated\ue\BpSchema.h(13,1): fatal error C1083: Cannot open include file: 'BpSchema.generated.h': No such file or directory`,
  then `Result: Failed (OtherCompilationError)`. **wolf-plan's prediction was right.** The game module `bp` compiled and
  `UnrealEditor-bp.dll` linked in the same run.
- (d) **A C++ front end has read BpLink**: `[4/12] Compile [x64] BpLink.cpp` with the Hostx64 `cl.exe` above read
  `BpLink.cpp`, its include `BpLink.h`, and `BpSchema.h` up to line 13, where it stopped. `BpSchemaFixups.h` (line 4 of
  `BpLink.cpp`) was not reached in this reading.

### Reading 2: E1's fix, once: junction `Source/BpLink/Public/Schema` -> `packages/schema/generated/ue`

Same probe tree (incremental), the junction made inside the probe only. Exit code **6**, **42.3 s** wall clock (UBT:
`Total execution time: 41.27 seconds`). Full output: `.../bp-uht-probe/uht-probe-junction.log`; UBT's log: `.../ubt-Log-junction.txt`.

- **UHT processed BpSchema.h and the build got past UHT.** `UHT processed bpEditor in 6.3682149 seconds (4 generated
  files written)`. The manifest's `BpLink` entry lists exactly one public header,
  `...\apps\vr\Source\BpLink\Public\Schema\BpSchema.h`. Written:
  `C:\Users\kazda\AppData\Local\Temp\bp-6127dc79\bp-uht-probe\apps\vr\Intermediate\Build\Win64\UnrealEditor\Inc\BpLink\UHT\BpSchema.generated.h`
  (39,404 bytes), beside `BpSchema.gen.cpp`, `BpLink.init.gen.cpp` and `BpLinkClasses.h`.
- `[6/9] Compile [x64] Module.BpLink.gen.cpp` printed no error and left `Module.BpLink.gen.cpp.obj`; its dependency file
  lists `Public\Schema\BpSchema.h` and `BpSchema.generated.h`, so the generated reflection code compiled against the header.
- The build then stopped in `BpLink.cpp`, verbatim:
  `C:\Users\kazda\AppData\Local\Temp\bp-6127dc79\bp-uht-probe\apps\vr\Source\BpLink\Private\BpLink.cpp(11,1): fatal error C1083: Cannot open include file: 'Misc/PlatformMisc.h': No such file or directory`.
  In UE 5.8 that header is `Engine/Source/Runtime/Core/Public/HAL/PlatformMisc.h`; there is no `Misc/PlatformMisc.h`.
  This is a **BpLink source defect, the next one after UHT**, and it is not fixed here (the three files are not this
  run's to edit). *Correction 2026-10-22 (evening): fixed in `72e4fd4`; the build then exits 0 (reading 3 below).* Because the fatal error is at line 11, `cl.exe` read `BpLink.h`, all of `BpSchema.h` (with its
  generated header) and `BpSchemaFixups.h` before it, with no error on them.
- **Include spelling.** UHT's generated `BpSchema.gen.cpp` includes `"Schema/BpSchema.h"` (through the junction), while
  `BpLink.h` keeps `#include "BpSchema.h"` (through `PublicIncludePaths`); both resolved in this reading, so no spelling
  change was **required** to get this far. Not measured: whether one translation unit that reaches the header by both
  paths (a unity build, or an include of both spellings) trips `#pragma once`, which MSVC keys on the path. If it does,
  the change belongs in BpLink (`#include "Schema/BpSchema.h"`) and in `packages/schema/generate.mjs`, whose
  `BpSchemaFixups.h` line 19 is `#include "BpSchema.h"`, never in a copied header.
  *Correction 2026-10-22 (evening): measured, readings 4 to 6 below. It does double-include (MSVC `C1189`), in a
  constructed TU and in a unity build of the module's own files; `ed94a65` fixes it in BpLink's includes alone, and
  reading 6 says why `generate.mjs` did not need to change.*

### What this does NOT establish

Unmeasured on Lynx: that `bpEditor` builds to exit 0 (it does not yet; see reading 2), that the editor boots `bp.uproject`,
that a Win64 Game target links (*Correction 2026-10-22 (night): it does, reading 8 below*), that PIE or automation runs, that Meta XR v207 or the Interaction SDK load, that the Quest 3
over Link works, and any frame time (the 90 Hz budget). None of these readings say anything about Wolf.

*Correction 2026-10-22 (evening): "that `bpEditor` builds to exit 0 (it does not yet; see reading 2)" is superseded:
with the junction it does, from `72e4fd4` (reading 3 below). The rest of this list stands.*

### How to reproduce

```
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch> --variant asis
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch> --variant junction
```

The script builds the layout above under `<scratch>/bp-uht-probe/`, never deletes there (it holds a junction into the
repo), refuses the `asis` variant in a tree where the junction variant already ran, and writes
`uht-probe-<variant>.log`, `ubt-Log-<variant>.txt` and `uht-probe-<variant>.json`. It is wired to no gate. The command it
runs, with the cwd `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\DotNET\UnrealBuildTool`:

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\ThirdParty\DotNet\10.0\win-x64\dotnet.exe" "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" bpEditor Win64 Development "-Project=<scratch>\bp-uht-probe\apps\vr\bp.uproject"
```

## Lynx, 2026-10-22 (evening): BpLink builds, and the include-spelling question measured

Same host, engine, toolchain and probe as above (`Hostx64` `cl.exe` 14.44.35207, emulated; every run's `compiler` line
printed `...\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`). Each reading names its scratch tree under
`C:/Users/kazda/AppData/Local/Temp/`; every tree's `packages` is a junction to this worktree
(`C:/Users/kazda/.personas/headless-masters/worktrees/bp/c469c82e/packages`), and nothing was added to `apps/vr`.
Each log path below is `<tree>/bp-uht-probe/uht-probe-<variant>.log`, beside `ubt-Log-<variant>.txt` and
`uht-probe-<variant>.json`.

### Reading 3: the line-11 fix, junction variant, fresh tree (`bp-c469c82e`, repo at `72e4fd4`)

`72e4fd4` changed `BpLink.cpp:11` to `#include "HAL/PlatformMisc.h"`. Before it, `find .../Engine/Source/Runtime/Core/Public
-iname PlatformMisc.h` printed one path, `.../Runtime/Core/Public/HAL/PlatformMisc.h`, and `Core/Public/Misc/` holds no
`PlatformMisc.h` (its only `*Platform*` entry is `DataDrivenPlatformInfoRegistry.h`).

- Exit code **0**, **72.8 s** wall clock (UBT: `Total execution time: 72.11 seconds`). `Result: Succeeded`.
- `UHT processed bpEditor in 3.063006 seconds (4 generated files written)` (UBT's log, line 67).
- 13 actions, among them `[9/13] Compile [x64] BpLink.cpp`, `[10/13] Compile [x64] Module.BpLink.gen.cpp`,
  `[11/13] Link [x64] UnrealEditor-BpLink.lib` and `[12/13] Link [x64] UnrealEditor-BpLink.dll`. No line of the log holds
  `error` or `: warning`.
- `apps/vr/Binaries/Win64/UnrealEditor-BpLink.dll` (546,816 bytes) and `UnrealEditor-bp.dll` (50,688 bytes) were written
  in the probe tree.
- **Nothing behind line 11 failed**: no further compile error, no link error, no missing module in `BpLink.Build.cs`
  (`Core`, `CoreUObject`, `Engine`, `Json`, `JsonUtilities`, `HTTP` sufficed), no API drift against UE 5.8 in this file.

### Reading 4: one translation unit, both spellings (`--variant spellings`, tree `bp-c469c82e-spellings`)

Sources at `72e4fd4`, probe as committed in `f5c16e0`: two probe-only files beside the byte-for-byte copy,
`Private/BpLinkSpellingAB.cpp` (`#include "BpSchema.h"` then `#include "Schema/BpSchema.h"`) and `BpLinkSpellingBA.cpp`
(the reverse order). Exit code **6**, **72.4 s** (UBT: `Total execution time: 71.77 seconds`). Both stop, verbatim:

```
[4/15] Compile [x64] BpLinkSpellingBA.cpp
C:\Users\kazda\AppData\Local\Temp\bp-c469c82e-spellings\bp-uht-probe\apps\vr\Intermediate\Build\Win64\UnrealEditor\Inc\BpLink\UHT\BpSchema.generated.h(10,1): fatal error C1189: #error:  "BpSchema.generated.h already included, missing '#pragma once' in BpSchema.h"
[5/15] Compile [x64] BpLinkSpellingAB.cpp
...\BpSchema.generated.h(10,1): fatal error C1189: #error:  "BpSchema.generated.h already included, missing '#pragma once' in BpSchema.h"
```

**It does double-include.** `BpSchema.h` has `#pragma once` (line 9); MSVC does not treat
`packages\schema\generated\ue\BpSchema.h` and `Source\BpLink\Public\Schema\BpSchema.h` (the junction) as one file, so the
second spelling re-enters it and UHT's generated header trips its own guard. In the same run `[11/15] BpLink.cpp` and
`[12/15] Module.BpLink.gen.cpp` printed no error: each of them reaches the header by one spelling only.

### Reading 5: the module's own files in a unity build (`--variant unity`)

- **5a, tree `bp-c469c82e-unity`, `bForceUnityBuild` alone**: exit **0**, **80 s** (`Total execution time: 79.24 seconds`),
  but it did not test the merge. UBT's log: `[Adaptive Build] Excluded from BpLink unity file: BpLink.cpp`, and the
  `Module.BpLink.cpp` it wrote includes only `BpLink.init.gen.cpp`, `BpSchema.gen.cpp` and `PerModuleInline.gen.cpp`.
- **5b, tree `bp-c469c82e-unity-noadaptive`, `bForceUnityBuild` and `bUseAdaptiveUnityBuild = false`** (sources at `72e4fd4`):
  `Module.BpLink.cpp` includes `BpLink.init.gen.cpp`, `BpSchema.gen.cpp`, `PerModuleInline.gen.cpp` **and**
  `Source/BpLink/Private/BpLink.cpp`. Exit **6**, **78.8 s** (`Total execution time: 78.02 seconds`):
  `[4/10] Compile [x64] Module.BpLink.cpp` -> `...\BpSchema.generated.h(10,1): fatal error C1189: #error:  "BpSchema.generated.h
  already included, missing '#pragma once' in BpSchema.h"`. So the double include is not only a constructed case: UHT's
  `BpSchema.gen.cpp` line 8 is `#include "Schema/BpSchema.h"`, `BpLink.h` said `#include "BpSchema.h"`, and any unity file
  that merges the two fails. (A default editor build does not merge them here: a game module with fewer than
  `MinGameModuleSourceFilesForUnityBuild` = 32 files is not unity-built, `UEBuildModuleCPP.cs:952` and `TargetRules.cs:1936`,
  which is why reading 3 passed.)

### Reading 6: the spelling fix (`ed94a65`), unity tree `bp-c469c82e-unity-noadaptive` again

`ed94a65`: `BpLink.h` includes `"Schema/BpSchema.h"` and `BpLink.cpp` `"Schema/BpSchemaFixups.h"`. **`packages/schema/generate.mjs`
is not changed**: `BpSchemaFixups.h`'s `#include "BpSchema.h"` (its line 19, from generate.mjs:316) resolves first in the
directory of the file that includes it, so reached as `Public/Schema/BpSchemaFixups.h` it opens `Public/Schema/BpSchema.h`,
the same path as UHT's spelling; and `packages/schema/ue-standin/check.cpp` includes `"BpSchemaFixups.h"` from
`generated/ue` directly, which a `Schema/` spelling inside the generated header would break.

- Exit **0**, **91.2 s** (`Total execution time: 90.15 seconds`); `[4/7] Compile [x64] Module.BpLink.cpp`, then the BpLink
  `.lib` and `.dll` links.
- `Module.BpLink.cpp.dep.json` lists exactly these `BpSchema*` paths: `...\uht\bpschema.gen.cpp`,
  `...\uht\bpschema.generated.h`, `...\source\bplink\public\schema\bpschema.h` and
  `...\source\bplink\public\schema\bpschemafixups.h`. No `packages\schema` path is in it.

### Reading 7: the final source (`9888f95`), junction and unity

`9888f95` adds only comments (dated corrections) to the three BpLink files. SHA-256, repo working copy = probe copy:
`BpLink.Build.cs` `6ae491830e923946d867475f461600064a40d97a31e06606c6a5ebaea558ebba`, `Public/BpLink.h`
`8dd73d58276543b81e50feeaeb2a4db6c9b1b20e05a772f79c0b9389c5d62524`, `Private/BpLink.cpp`
`a381296b333738f64dba824ad4f22cb4f12961d431371f5e9f2ed7ce33dec43c`; `BpSchema.h` and `BpSchemaFixups.h` hash as in the
table above (unchanged).

- **Fresh tree `bp-c469c82e-final`, junction**: exit **0**, **136.5 s** (UBT: `Total execution time: 135.29 seconds`),
  `Result: Succeeded`, `UHT processed bpEditor in 3.7846155 seconds (4 generated files written)`, 13 actions including
  `[4/13] Compile [x64] BpLink.cpp`, `[5/13] Compile [x64] Module.BpLink.gen.cpp` and `[8/13] Link [x64]
  UnrealEditor-BpLink.dll` (546,816 bytes). 0 `: warning` lines. Log:
  `C:/Users/kazda/AppData/Local/Temp/bp-c469c82e-final/bp-uht-probe/uht-probe-junction.log`; UBT's log beside it,
  `ubt-Log-junction.txt`.
- **Incremental, tree `bp-c469c82e`, junction**: exit **0**, **25.3 s** (`Total execution time: 24.86 seconds`), `[4/7]
  Compile [x64] BpLink.cpp`; its `BpLink.cpp.dep.json` lists `bpschema.generated.h`, `public\schema\bpschema.h` and
  `public\schema\bpschemafixups.h`, and no `packages\schema` path. Log:
  `C:/Users/kazda/AppData/Local/Temp/bp-c469c82e/bp-uht-probe/uht-probe-junction.log`.
- **Incremental, unity tree `bp-c469c82e-unity-noadaptive`**: exit **0**, **22.5 s** (`Total execution time: 21.99
  seconds`), `[4/7] Compile [x64] Module.BpLink.cpp`. 0 `: warning` lines.

`npm run check:bplink` now pins the one spelling (`build: BpLink spells every generated header Schema/<header>...`, with a
control that refuses a `BpLink.h` saying `"BpSchema.h"`; seeded into the real `BpLink.h` it read `36 passed, 1 failed`).

### What this does NOT establish

- That the editor boots `bp.uproject` or loads `UnrealEditor-BpLink.dll`; that `StartupModule` runs, that `HTTP` is up at
  `PostEngineInit`, or that `BpLink.Fetch` prints WP3.1 step 7's line. Nothing here ran the module: it compiled and linked.
- That a Win64 **Game** target (`bp Win64 Development`) builds; only `bpEditor` was built.
  *Correction 2026-10-22 (night): measured, reading 8 below. It builds, exit 0, with the junction.*
- The `asis` variant at the final source (not run). Without the junction, `"Schema/BpSchema.h"` has nowhere to resolve,
  so BpLink now **requires** WP3.1's junction; whether that settles R1 is the operator's call, as before.
  *Correction 2026-10-22 (night): measured, reading 9 below. It fails with `C1083 ... 'Schema/BpSchema.h': No such file or directory`.*
- The `spellings` variant at the final source (not re-run): its probe TUs include both spellings on purpose, so they
  measure MSVC, not BpLink.
- That `#pragma once` behaves the same way on clang or on Wolf's MSVC; this is MSVC 14.44.35207 on Lynx, emulated x64.
- Meta XR v207, the Interaction SDK, the Quest 3 over Link, PIE, automation, and any frame time (the 90 Hz budget). None
  of these readings say anything about Wolf.

### How to reproduce

The two commands above, plus, each in a `--work` of its own (the probe refuses to mix them):

```
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-2> --variant spellings
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-3> --variant unity
```

## Lynx, 2026-10-22 (night): the Win64 Game target, and the `asis` variant at the final source

Same host, engine and toolchain as above (`Hostx64` `cl.exe` 14.44.35207, emulated; both runs' `compiler` line printed
`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`, and
UBT printed `Running x64 binary on arm64 system. Use arm binaries instead`). Repo at `52f631c` plus `c3915bf`, which adds
`--target <name>` to `scripts/uht-probe.mjs` (default `bpEditor`; it changes only the UBT argv, the variant markers are
untouched). Each reading is a **fresh** `--work` tree under `C:/Users/kazda/AppData/Local/Temp/`; each tree's `packages` is
a junction into this worktree (`C:/Users/kazda/.personas/headless-masters/worktrees/bp/c972b5c8/packages`); nothing was
added to `apps/vr`. No frame time was measured.

SHA-256, repo working copy = probe copy (both read from the Game-target tree; the `asis` tree's `copied` entries are
checked by the script itself, which throws on a difference). The two `BpLink` headers/sources differ from reading 7's
because `52f631c` (and `9888f95`) changed only comments in them; `BpLink.Build.cs` and the schema headers are unchanged.

| File | SHA-256 |
|---|---|
| `apps/vr/Source/BpLink/BpLink.Build.cs` | `6ae491830e923946d867475f461600064a40d97a31e06606c6a5ebaea558ebba` |
| `apps/vr/Source/BpLink/Public/BpLink.h` | `66f9496a650a0db6d63f583afdb434f1138af8558c7c8b4b15618669b6cf3402` |
| `apps/vr/Source/BpLink/Private/BpLink.cpp` | `aeb936546ab817416cbd3d90bf134a402b5b79c342a55c08d81f996d13fb6535` |
| `packages/schema/generated/ue/BpSchema.h` | `e2eb2802c61f96b776c6ca61a8edef1a66542d0779ce3b02d4e21a444396f0a5` |
| `packages/schema/generated/ue/BpSchemaFixups.h` | `7b102f5e43dbb5d196f3660c95d4532e93fc2c740635319477077f673564a2ae` |

### Reading 8: `bp Win64 Development` (the Game target), junction variant, tree `bp-c972b5c8-game`

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-c972b5c8-game --variant junction --target bp`.
The UBT command was `... UnrealBuildTool.dll "bp" "Win64" "Development" "-Project=...\bp-c972b5c8-game\bp-uht-probe\apps\vr\bp.uproject"`.

- Exit code **0**, **119.3 s** wall clock (UBT: `Total execution time: 118.43 seconds`), `Result: Succeeded`. 0 `: warning`
  lines in the log; the script's `errorLines` was empty.
- `UHT processed bp in 4.6674691 seconds (4 generated files written)` (UBT's log). Written under
  `apps/vr/Intermediate/Build/Win64/UnrealGame/Inc/BpLink/UHT/`: `BpSchema.generated.h` (39,679 bytes; the editor target's
  was 39,404), `BpSchema.gen.cpp`, `BpLink.init.gen.cpp`, `BpLinkClasses.h`.
- 13 actions: `[9/13] Compile [x64] bp.cpp`, `[10/13] Compile [x64] BpLink.cpp`, `[11/13] Compile [x64]
  Module.BpLink.gen.cpp`, `[12/13] Link [x64] bp.exe`, `[13/13] WriteMetadata bp.target [NoUba]`. `Binaries/Win64/bp.exe`
  is 331,998,720 bytes. There is **no** `UnrealEditor-BpLink.dll` here: a Game target without `-Modular` is monolithic, so
  `BpLink` is compiled into `bp.exe` (that is the log's own action list; no per-module link line for BpLink appears).
- The synthesized project already carried everything the Game target needed: the Game `bp.Target.cs` and
  `Config/DefaultEngine.ini` (`GameDefaultMap=/Engine/Maps/Entry`) that the probe wrote for the editor reading. No
  `Content/`, map or extra module was added, and no error about a missing map, config key or module was printed. The build
  does not run the executable, so whether `bp.exe` starts is not measured.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-c972b5c8-game/bp-uht-probe/uht-probe-junction.log`, beside `ubt-Log-junction.txt`
  and `uht-probe-junction.json`.

### Reading 9: `--variant asis` at the final source, tree `bp-c972b5c8-asis` (no junction)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-c972b5c8-asis --variant asis`
(target `bpEditor`, the default).

- Exit code **6**, **94.4 s** wall clock (UBT: `Total execution time: 93.60 seconds`), `Result: Failed (OtherCompilationError)`.
- `UHT processed bpEditor in 4.7879327 seconds (0 generated files written)`; no `BpSchema.generated.h` under `Intermediate/`.
  The tree has no `Source/BpLink/Public/Schema` entry, so UHT again had no `BpSchema.h` in its input.
- The error, verbatim (the only error line in the log):
  `C:\Users\kazda\AppData\Local\Temp\bp-c972b5c8-asis\bp-uht-probe\apps\vr\Source\BpLink\Public\BpLink.h(7,1): fatal error C1083: Cannot open include file: 'Schema/BpSchema.h': No such file or directory`
  with the source line `#include "Schema/BpSchema.h"` echoed under it, in `[4/12] Compile [x64] BpLink.cpp`. The `bp` module
  still compiled and linked (`[8/12] Link [x64] UnrealEditor-bp.lib`, `[9/12] Link [x64] UnrealEditor-bp.dll`).
- Mechanically: `PublicIncludePaths` holds `packages/schema/generated/ue`, so `"BpSchema.h"` would resolve there but
  `"Schema/BpSchema.h"` looks for `<include path>/Schema/BpSchema.h`, which exists only through the junction. The prediction
  in the 2026-10-22 evening "does NOT establish" list (that `asis` fails at the final source) is **measured**, with the
  error above.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-c972b5c8-asis/bp-uht-probe/uht-probe-asis.log`, beside `ubt-Log-asis.txt` and
  `uht-probe-asis.json`.

### What this does NOT establish

- That the Game executable runs: `bp.exe` was linked, never started; `StartupModule`, `HTTP` at `PostEngineInit` and
  `BpLink.Fetch` are unmeasured, as are the editor boot and `UnrealEditor-BpLink.dll` loading.
- Any other Game configuration: only `Development` was built (not `Shipping`, a `-Modular` build, or a cooked/staged
  package), and only with the probe's synthesized `bp` module and one-line `DefaultEngine.ini`, not a real project's.
- The `asis` reading is one MSVC front-end error, in the first translation unit that reached `BpLink.h`; whether further
  errors would follow once that include resolved is not measured (the junction variant, readings 3 to 8, says what happens
  when it does).
- The Game target with the `asis` variant, and the `unity` / `spellings` variants on the Game target (not run).
- This says nothing about R1 (how BpLink gets a header UHT will process), R4 or R5; that is the operator's. These are MSVC
  14.44.35207 readings on Lynx, emulated x64; none say anything about Wolf.

### How to reproduce

```
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-4> --variant junction --target bp
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-5> --variant asis
```

`--target <name>` (default `bpEditor`) is the first UBT argument: `bp` is the synthesized Game target, `bpEditor` the editor
one. Every earlier command keeps its meaning.

## Lynx, 2026-10-22 (night, later): the first RUN, the editor and `bp.exe` started against apps/server

Same host, engine and toolchain as above: Lynx, UE 5.8.4 (Changelist 58902052), and both builds' `compiler` line printed
`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`, with UBT
printing `Running x64 binary on arm64 system. Use arm binaries instead` (emulated x64). Repo at `2422c5d` plus this
section's commit, which adds `--run` to `scripts/uht-probe.mjs`. The BpLink sources and schema headers hash exactly as in
reading 8's table (`BpLink.cpp` `aeb93654...`, `BpLink.h` `66f9496a...`, `BpLink.Build.cs` `6ae49183...`, `BpSchema.h`
`e2eb2802...`, `BpSchemaFixups.h` `7b102f5e...`, from each tree's `uht-probe-junction.json`, repo = probe). Each reading is
a **fresh** `--work` tree under `C:/Users/kazda/AppData/Local/Temp/`, `--variant junction`. Each tree's `packages` is a
junction into this worktree (`C:/Users/kazda/.personas/headless-masters/worktrees/bp/6f1b5327/packages`), and nothing
was added to `apps/vr`. **No frame time, fps or latency was measured, and none can be read from these runs:** `-nullrhi`
renders nothing.

### What `--run` does (the mechanism)

After a build that exited 0, and only with `--run`, the script:

1. starts apps/server the way `check:bplink` does:
   `node --import <repo>/packages/core/register.mjs <repo>/apps/server/src/main.ts --port 0`, in an empty cwd
   `<tree>/bp-uht-probe/run-server-cwd`. It waits for `bp server listening on http://127.0.0.1:<port>` and points BpLink at
   it with `-BpLinkUrl=http://127.0.0.1:<port>` (`BpLink.cpp:68` reads that before `BP_LINK_URL` and the 3100 default).
   The port is ephemeral, so nothing has to be free on 3100.
2. starts the built binary with
   `-nullrhi -unattended -nosplash -nosound -stdout -FullStdOutLogOutput -NoLogTimes -BpLinkUrl=<url>`. For `bpEditor` that
   is the engine's `Engine/Binaries/Win64/UnrealEditor-Cmd.exe <tree>/.../apps/vr/bp.uproject`; for `bp` it is
   `<tree>/.../apps/vr/Binaries/Win64/bp.exe`, with no project argument.
3. **does not ask the process to quit.** FetchKettle is async, so the script watches stdout for a BpLink outcome line
   (`BpLink: Kettle `, `BpLink: GET ... failed` or `BpLink: the ... did not parse`). When one appears it waits 5,000 ms more,
   then runs `taskkill /PID <pid> /T /F` on the whole tree. With no outcome line the same kill fires at a hard timeout of
   900,000 ms. A process that exits by itself is recorded as such. The server is then stopped with the same `taskkill`.
4. writes `run-<target>.log` (the process's stdout and stderr), `run-<target>-Saved.log` (a copy of the project's
   `Saved/Logs/bp.log`) and `run-server-<target>.log`, and records it all under `run` in `uht-probe-junction.json`. It grades
   nothing, and its exit code is 0 whatever the run printed.

Without `--run`, the script's behaviour is unchanged (the code path ends with the same `process.exit` as before); the
usage line now lists `[--run]`. After each reading below, `tasklist` showed no `UnrealEditor*`, `bp.exe`, `zenserver`,
`ShaderCompileWorker` or `CrashReportClient` process.

### Reading 10: the editor boots `bp.uproject`, BpLink loads and asks, and the answer does not parse (tree `bp-6f1b5327-editor-run`)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-6f1b5327-editor-run --variant junction --run`

- **Build**: `bpEditor Win64 Development`, exit **0**, 170.8 s wall clock (UBT: `Total execution time: 169.60 seconds`),
  `Result: Succeeded`, `UHT processed bpEditor in 7.7448759 seconds (4 generated files written)`, `[12/13] Link [x64]
  UnrealEditor-BpLink.dll` (546,816 bytes). 0 `: warning` lines.
- **Server**: `bp server listening on http://127.0.0.1:64183`; its log records no `refused` line.
- **Run**: `"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:\Users\kazda\AppData\Local\Temp\bp-6f1b5327-editor-run\bp-uht-probe\apps\vr\bp.uproject" -nullrhi -unattended -nosplash -nosound -stdout -FullStdOutLogOutput -NoLogTimes -BpLinkUrl=http://127.0.0.1:64183`,
  cwd `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64`. Stopped by `outcome line seen, then 5000 ms`, 68.3 s
  after start. The recorded exit code **1** is the one `taskkill /F` imposes; the editor did not exit by itself.
- **The editor booted** under the Null RHI (`LogCsvProfiler: Display: Metadata set : rhiname="Null"`), opened an empty
  `Untitled` editor world, and printed `LogInit: Display: Engine is initialized. Leaving FEngineLoop::Init()` (stdout line
  1733). There is no `Content/` and no map in the probe; neither stopped it.
- **BpLink loaded, and StartupModule ran FetchKettle** (stdout lines 1662 and 1663, verbatim):
  ```
  LogModuleManager: InternalLoadLibrary: 'BpLink' ('C:/Users/kazda/AppData/Local/Temp/bp-6f1b5327-editor-run/bp-uht-probe/apps/vr/Binaries/Win64/UnrealEditor-BpLink.dll')
  LogBpLink: BpLink: reading Kettle from http://127.0.0.1:64183
  ```
  `HTTP` was up: `LogInit: Creating http thread with maximum 251 concurrent requests` (line 398) came before it.
- **The callback fired, and the first answer did not parse** (stdout line 1774, verbatim; in the Saved log, line 1761):
  ```
  LogBpLink: Error: BpLink: the http://127.0.0.1:64183/api/products/kettle/structure answer did not parse into FBpAppStructure
  ```
  `BpLink.cpp:94-112`: BpLink logs this line only after the request connected and answered **200**. So HTTP from Unreal to
  apps/server worked end to end. Then `FJsonSerializer::Deserialize`, the `structure` field lookup or `BpSchema::FromJson`
  (`FJsonObjectConverter::JsonObjectToUStruct` and then `FixUp`, `BpSchemaFixups.h:174`) returned false. **Which of these
  failed, and on which field, is not measured**: the log says only this line, and finding out needs a change to BpLink or
  to the generated code, which this run may not make. Because the failure returns before `/plan` is requested
  (`OnDone(false, ...)`), **no `BpLink: Kettle wings=...` line was printed**, and neither was the `(no plan read, so no
  wings)` fallback. [Corrected 2026-10-22: this sentence first said the `wings=5 rooms=13 bays=29 tiles=133` line "remains
  pinned from the C++ TEXT by `check:bplink`", which is wrong about the numbers.] The four numbers are a Node-side
  measurement of the live server: `scripts/check-bplink.mjs` starts apps/server on port 0 in an empty temp cwd, GETs
  `/api/products/kettle/plan`, and compares the answer's array lengths with figures derived from `WING_DEFS` and
  `packages/core/data/kettle.app-structure.json`. `BP_CHECK_BPLINK_SEED=plan` shows that comparison can fail. The C++ TEXT
  rule pins no number. It asserts that `BpLink.cpp` requests `<Root> + TEXT("/plan")` in code (not in a comment), parses
  the answer through `BpSchema::FromJson` into `Snapshot.Plan`, and logs each figure as `Snapshot.Plan.<that level>.Num()`.
  That proves only that the code is shaped to print whatever the live answer counts. What Unreal had never executed is the
  LOG LINE. At reading 10 it had never been printed by Unreal; reading 14 below is the first time it was.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-6f1b5327-editor-run/bp-uht-probe/run-bpEditor.log` (1,801 lines),
  `run-bpEditor-Saved.log`, `run-server-bpEditor.log`, beside the build's `uht-probe-junction.log`, `ubt-Log-junction.txt`
  and `uht-probe-junction.json`.

### Reading 11: `bp.exe` (the Game target) starts and asserts before BpLink runs (tree `bp-6f1b5327-game`)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-6f1b5327-game --variant junction --target bp --run`

- **Build**: `bp Win64 Development`, exit **0**, 163.8 s wall clock (UBT: `Total execution time: 162.49 seconds`),
  `Result: Succeeded`, `UHT processed bp in 8.8779521 seconds (4 generated files written)`, `[12/13] Link [x64] bp.exe`.
  `bp.exe` is 331,998,720 bytes, the same size as in reading 8. 0 `: warning` lines.
- **Server**: `bp server listening on http://127.0.0.1:55124`; no `refused` line.
- **Run**: `"C:\Users\kazda\AppData\Local\Temp\bp-6f1b5327-game\bp-uht-probe\apps\vr\Binaries\Win64\bp.exe" -nullrhi -unattended -nosplash -nosound -stdout -FullStdOutLogOutput -NoLogTimes -BpLinkUrl=http://127.0.0.1:55124`,
  cwd `...\apps\vr\Binaries\Win64`. It **exited by itself** after 15.8 s with exit code **3**. Nothing was killed.
- **It did not reach BpLink.** No `LogBpLink` line was printed. The first error, then the crash, verbatim (stdout lines
  704 and 719 to 735):
  ```
  LogAssetRegistry: Error: Failed to load premade asset registry. LoadResult == 1.
  ...
  LogStreaming: Display: FlushAsyncLoading(8): 8 QueuedPackages, 0 AsyncPackages
  LogPackageLocalizationCache: Processed 82 localized package path(s) for 1 prioritized culture(s) in 0.002347 seconds
  LogWindows: Error: appError called: Assertion failed: ReaderPos + Num <= ReaderSize [File:D:\build\++UE5\Sync\Engine\Source\Runtime\Core\Public\Serialization\BufferReader.h] [Line: 52]
  LogThreadingWindows: Error: Runnable thread IOThreadPool #2 crashed.
  LogWindows: Error: === Critical error: ===
  LogWindows: Error: Crash in runnable thread IOThreadPool #2
  LogExit: Executing StaticShutdownAfterError
  LogWindows: FPlatformMisc::RequestExitWithStatus(1, 3, FRunnableThreadWin::GuardedRun.ExceptionHandler)
  LogCore: Engine exit requested (reason: Win RequestExit)
  ```
  This is a monolithic Development Game executable started with no cooked or staged content. The probe has no
  `Content/` and was never cooked, and its only map setting is `GameDefaultMap=/Engine/Maps/Entry`. That the missing cook
  is the cause is a reading of the log, **not measured**. Nothing was added to make it boot, as this run's rules require.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-6f1b5327-game/bp-uht-probe/run-bp.log` (735 lines), `run-bp-Saved.log`,
  `run-server-bp.log`, beside `uht-probe-junction.log`, `ubt-Log-junction.txt` and `uht-probe-junction.json`.

| File (under `C:/Users/kazda/AppData/Local/Temp/`) | SHA-256 |
|---|---|
| `bp-6f1b5327-editor-run/bp-uht-probe/run-bpEditor.log` | `e7be7bcdf6c57a70fb69ac43b739ee33779e472997d9e666fad9c4db58756998` |
| `bp-6f1b5327-editor-run/bp-uht-probe/run-bpEditor-Saved.log` | `cabd59f3c333a2aaf26efa2ab7336c036906d7a6ce2c577e8ee02f7e2d5f014f` |
| `bp-6f1b5327-game/bp-uht-probe/run-bp.log` | `8a45c6363971fb7ccdd919ad0a7579de102ef32d717d81fbb685752d1a70f78b` |
| `bp-6f1b5327-game/bp-uht-probe/run-bp-Saved.log` | `6e2b890183fd2d99cdc80647debdae1f511fffadd1136b606de23c9f0cb28a61` |
| `bp-6f1b5327-game/bp-uht-probe/apps/vr/Binaries/Win64/bp.exe` | `2fba23d337734b670a105522943ecee1009133937d6478d69f0411ed7c97f174` |

One more tree from this session, `bp-6f1b5327-editor`, is **not a reading**. I started it while reading 10's UBT was still
running, and UBT refused it: `Result: Failed (ConflictingInstance)`, exit 10 after 2.1 s. Nothing in it was built or run.

### What this does NOT establish

- **Milestone 4 goal 1 is not met.** Of its measure, this covers one part: the editor boots this synthesized project
  headless on Lynx and loads BpLink, and BpLink's HTTP request reaches apps/server and gets a 200 back. Not covered, or
  measured as failing:
  - no BpLink line printed Kettle's wings: the structure answer did not parse (reading 10);
  - the Win64 Game build does not boot in this project shape (reading 11);
  - the headset, Meta XR v207, the Interaction SDK, the Quest 3 over Link and 90 Hz are untouched.
- Why `/structure` did not parse. Which call returned false, and on which field, is the next measurement. It needs a log
  line or a test inside BpLink or the generated `FixUp`, and that is outside this run's two files. [Measured later the same
  night, reading 12 below: `CopyRaw` at `structure.lenses[0].manifest.presentation.glyph`.]
- That `/plan` parses into `FBpPlan` in Unreal: it was never requested, because `/structure` failed first. The `/stream`
  handling and the `BpLink.Fetch` console command were not run either.
- Whether a cooked or staged `bp.exe` boots, and whether the editor boots with a real `Content/`, a real map or a real game
  mode. Also unmeasured: PIE, `-game`, automation, `Shipping` and `-Modular`.
- Any frame time. R5 (which statistic must be at or under 11.1 ms) is the operator's open question; `-nullrhi` measures
  nothing of the kind, and nothing here is offered as one. Readings 10 and 11 likewise do not settle R1 or R4; that is the
  owner's.
- These are Lynx readings: MSVC 14.44.35207, UE 5.8.4 binaries running emulated x64 on ARM64. None say anything about Wolf.

### How to reproduce

```
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-6> --variant junction --run
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <scratch-7> --variant junction --target bp --run
```

Run them one after the other, not at once: two UBTs on the same host refuse each other (`ConflictingInstance`). Each run
needs a fresh `<scratch>`, and the script never deletes in one. `--run` starts apps/server from this repo and needs
`node_modules`. It leaves no process running: the target's tree is killed after the outcome line plus 5 s, or at 900 s,
and the server is killed when the target is done.

## Lynx, 2026-10-22 (night, last): why `/structure` did not parse, measured, fixed, and the Kettle line printed

Same host, engine and toolchain as readings 10 and 11: Lynx, UE 5.8.4 (Changelist 58902052), every build's `compiler`
line `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe`,
UBT printing `Running x64 binary on arm64 system. Use arm binaries instead` (emulated x64). Each reading is a **fresh**
`--work` tree under `C:/Users/kazda/AppData/Local/Temp/`, `--variant junction`, target `bpEditor`, `--run`. Each tree's
`packages` is a junction into this worktree (`C:/Users/kazda/.personas/headless-masters/worktrees/bp/70637178/packages`).
The UBT runs were one at a time, and none was refused. **No frame time, fps or latency was measured, and none can be read
from these runs:** `-nullrhi` renders nothing.

What each tree built (SHA-256 from its `uht-probe-junction.json`, repo = probe for the copied files):

| Reading | Repo at | `BpLink.cpp` | `BpSchemaFixups.h` | `BpSchema.h` |
|---|---|---|---|---|
| 12 | `47c49ea` | `387e8f86...` | `1ac7baf2...` | `c09afbb9...` |
| 13 | `cd9dd65` | `387e8f86...` | `9ef91bb8...` | `c09afbb9...` |
| 14 | `422d7fa` | `9c5c15ff...` | `9ef91bb8...` | `c09afbb9...` |

`BpSchema.h`'s content did not change in these commits. `c09afbb9...` is the hash of its committed blob, with LF endings,
because `npm run schema:generate` rewrites it with LF. Reading 8's `e2eb2802...` is the same blob with CRLF endings: I
hashed both forms. `387e8f86...` is `47c49ea`'s `BpLink.cpp` with CRLF endings. `9c5c15ff...` is `422d7fa`'s `BpLink.cpp`
with one line ending in CRLF and the rest LF (a stray from my edit). With the CR removed it hashes `e88892cc...`, the
committed blob.

### What changed so a log could say which step failed (the mechanism)

- `packages/schema/generate.mjs` (and so the generated `BpSchemaFixups.h`, `6cc90c1`): `BpSchema::FromJson` now resets a
  per-thread `BpSchema::LastFailure()`. When a step returns false, the first one records its call (`JsonObjectToUStruct`,
  `CopyKey`, `CopyRaw`, `FixUpArray (length)`, `FixUpArray (not an object)`, `FixUpMap (not an object)`) and the key it
  failed on. Each held struct on the way out puts its own key in front, so the path reads from the document root.
- `BpLink.cpp` (`47c49ea`): the single condition reading 10 ran is split into three branches, each with its own reason:
  `FJsonSerializer::Deserialize found no JSON object in it`, `it has no `structure` object field`, and `BpSchema::FromJson
  failed in <call> at structure.<path> (<n> failed steps)`. A second Error line gives the answer's byte length, its
  character length and its first 200 characters. The outcome line keeps `did not parse`, which `--run` watches for.

### Reading 12: the call and the field (tree `bp-70637178-diag`)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-70637178-diag --variant junction --run`

- **Exit 0** (the script grades nothing). Total wall clock **not recorded**: my shell timer called `bc`, which is not on
  this host, so it printed `wall=` empty. The script's own clocks: build `exit 0 after 94.2s`, run 65.1 s.
- **Build**: `bpEditor Win64 Development`, `Result: Succeeded`, `Total execution time: 93.44 seconds`, `[12/13] Link [x64]
  UnrealEditor-BpLink.dll` (560,640 bytes). 0 `: warning` lines. UHT printed only `UHT compiled-in object format Default`.
  There is no `UHT processed ...` line in this log, though readings 10 and 11 had one.
- **Server**: `bp server listening on http://127.0.0.1:61471`; no `refused` line.
- **Run**: the editor, as in reading 10, with `-BpLinkUrl=http://127.0.0.1:61471`. Stopped by `outcome line seen, then
  5000 ms`, 65.1 s after start; exit code **1** is the one `taskkill /F` imposes. `LogInit: Display: Engine is initialized.
  Leaving FEngineLoop::Init()` is stdout line 1730.
- **The finding** (stdout lines 1660, 1771 and 1772, verbatim; Saved log lines 1647, 1758 and 1759):
  ```
  LogBpLink: BpLink: reading Kettle from http://127.0.0.1:61471
  LogBpLink: Error: BpLink: the http://127.0.0.1:61471/api/products/kettle/structure answer did not parse into FBpAppStructure: BpSchema::FromJson failed in CopyRaw at structure.lenses[0].manifest.presentation.glyph (1 failed steps)
  LogBpLink: Error: BpLink: that answer is 469146 bytes, 469144 characters, and begins: {"structure":{"$schema":"app-structure/3","version":3,"generator":"kettle-sample","generated_at":"2026-10-08T09:00:00Z","declared":true,"provenance":{"source":"packages/core/data/kettle.json","convert
  ```
  Measured: `Deserialize` succeeded, the `structure` field was found, and `FJsonObjectConverter::JsonObjectToUStruct`
  succeeded. The failing step is `CopyRaw`, inside FixUp, on the first lens's `presentation.glyph`. The log has no
  `LogJson` line at all (0 matches), consistent with the converter not having failed. `1 failed steps` is not a count of
  bad glyphs: `FixUpArray` stops at the first lens that fails.
- **Why `CopyRaw` returns false: a reading of UE 5.8.4's source, not a measurement.** `CopyRaw` serializes the value
  through a `TJsonStringWriter`, whose `Close()` copies the text into the output string and then returns
  `TJsonWriter::Close()` (`Engine/Source/Runtime/Json/Public/Serialization/JsonWriter.h:361`). That returns true only when
  the last token written was nothing, `}` or `]`. A bare string glyph leaves a string token last, so `Serialize(..., true)`
  returns false even though the text was written. In this worktree's `/structure` answer (fetched with `curl` from a
  Node-only run, below; apps/server is unchanged by these commits), the glyph is a string on 7 of Kettle's 8 lenses (`lenses[0]` is `business`) and an object on one
  (`com.kettle.cost`).
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-70637178-diag/bp-uht-probe/run-bpEditor.log` (1,786 lines),
  `run-bpEditor-Saved.log` (1,773 lines), `run-server-bpEditor.log`, beside `uht-probe-junction.log`,
  `ubt-Log-junction.txt` and `uht-probe-junction.json`.

**The fix** (`cd9dd65`, in the generator, regenerated): `CopyRaw` serializes with `bCloseWriter = false` and then calls
`Writer->Close()` itself, because Close is what copies the text. A scalar is graded by the text it left in `Out`, an
object or array by `Close()`.

### Reading 13: `/structure` no longer refused, and BpLink goes silent (tree `bp-70637178-fixed`)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-70637178-fixed --variant junction --run`

- **Exit 0**, wall clock **976.5 s** (shell timer, 976,474 ms). Build `exit 0 after 71s`.
- **Build**: `Result: Succeeded`, `Total execution time: 70.22 seconds`, `[12/13] Link [x64] UnrealEditor-BpLink.dll`
  (560,640 bytes). 0 `: warning` lines; again only `UHT compiled-in object format Default`.
- **Server**: `bp server listening on http://127.0.0.1:55000`; no `refused` line. The server logs no requests, so it
  cannot say which GET was outstanding.
- **Run**: no outcome line came, so the probe's hard timeout stopped it: `timeout 900000 ms; exit 1 after 904.6s`.
  `Engine is initialized` is stdout line 1730. The **only** `LogBpLink` line in either log is stdout line 1660 (Saved
  line 1647), verbatim:
  ```
  LogBpLink: BpLink: reading Kettle from http://127.0.0.1:55000
  ```
  The editor kept logging until it was killed (its last line is a `LogEOSSDK` config update at `Time: 678.773560`).
  While it ran, `tasklist` showed `CrashReportClientEditor.exe`. That is the companion the editor starts at boot
  (stdout line 8, `LogWindows: Started CrashReportClient (pid=11156)`), not a crash. Nothing in the log asserts or
  crashes, and after the kill `tasklist` showed none of `UnrealEditor*`, `CrashReportClient*`, `zenserver` or
  `ShaderCompileWorker`.
- **Reading of the log against `cd9dd65`'s `BpLink.cpp`, not measured:** with no `did not parse` and no `GET ... failed`
  line, `/structure` parsed and BpLink went on. At that source, the `/structure` and `/plan` success paths print nothing,
  and the Kettle line is printed only from `/stream`'s completion callback. So this log cannot say whether `/plan` or
  `/stream` was outstanding. My hypothesis: Kettle's `/stream` is a live SSE response (200, `text/event-stream`), its
  body never ends, and so `OnProcessRequestComplete` never fires. Reading 14 tests that.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-70637178-fixed/bp-uht-probe/run-bpEditor.log` (1,804 lines),
  `run-bpEditor-Saved.log` (1,791 lines), `run-server-bpEditor.log`.

**The change** (`422d7fa`, `BpLink.cpp`): `/stream` keeps the status from `OnStatusCodeReceived`, logs it, and cancels a
200 on the next core tick (`FTSTicker`). The completion takes the kept status. `/structure` and `/plan` each log a line
when they parse, so the next stall would be located.

### Reading 14: the Kettle line, printed by Unreal (tree `bp-70637178-stream`)

`node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work C:/Users/kazda/AppData/Local/Temp/bp-70637178-stream --variant junction --run`

- **Exit 0**, wall clock **108.0 s** (shell timer, 107,989 ms). Build `exit 0 after 73.4s`.
- **Build**: `Result: Succeeded`, `Total execution time: 72.53 seconds`, `[12/13] Link [x64] UnrealEditor-BpLink.dll`
  (566,272 bytes). 0 `: warning` lines; again only `UHT compiled-in object format Default`.
- **Server**: `bp server listening on http://127.0.0.1:58672`; no `refused` line.
- **Run**: stopped by `outcome line seen, then 5000 ms`, 33.6 s after start; exit code **1** from `taskkill /F`.
  `Engine is initialized` is stdout line 1730.
- **Every `LogBpLink` line**, verbatim (stdout lines 1660, 1771, 1778, 1779, 1783 and 1784; Saved log lines 1647, 1758,
  1765, 1766, 1770 and 1771):
  ```
  LogBpLink: BpLink: reading Kettle from http://127.0.0.1:58672
  LogBpLink: BpLink: the http://127.0.0.1:58672/api/products/kettle/structure answer parsed: rooms=13 lenses=8 events=566 rev=80557561ddf0f4cd; asking /plan
  LogBpLink: BpLink: the http://127.0.0.1:58672/api/products/kettle/plan answer parsed into FBpPlan; asking /stream
  LogBpLink: BpLink: GET http://127.0.0.1:58672/api/products/kettle/stream sent status 200
  LogBpLink: BpLink: kettle streams (200); WP3.1 does not consume SSE, so rev 80557561ddf0f4cd read once from structure stands
  LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd
  ```
  Measured in Unreal: `/structure` parsed into `FBpAppStructure` with all 8 lenses (7 string glyphs and 1 object glyph),
  `/plan` parsed into `FBpPlan`, `/stream` sent 200, the fetch reached `OnDone(true, ...)`, and `LogKettle` printed
  `wings=5 rooms=13 bays=29 tiles=133`. Those are the same four figures `check:bplink` measures from the live server in
  Node. 0 `LogJson` lines.
- **Reading of the log, not measured:** that the completion callback after `sent status 200` came from the cancel. BpLink
  does not log `bConnected` on that path, and the status it reports (200) is the kept one.
- Logs: `C:/Users/kazda/AppData/Local/Temp/bp-70637178-stream/bp-uht-probe/run-bpEditor.log` (1,788 lines),
  `run-bpEditor-Saved.log` (1,775 lines), `run-server-bpEditor.log`, beside `uht-probe-junction.log`,
  `ubt-Log-junction.txt` and `uht-probe-junction.json`.

| File (under `C:/Users/kazda/AppData/Local/Temp/`) | SHA-256 |
|---|---|
| `bp-70637178-diag/bp-uht-probe/run-bpEditor.log` | `cc62169ce95953abcd89d11f2be4ca7c2f262b35e5c753c1ebe22b6427db3472` |
| `bp-70637178-diag/bp-uht-probe/run-bpEditor-Saved.log` | `67df54ed07997d524c5677b9d3178ad63a54819ab4028aceaff012123c0f8ab4` |
| `bp-70637178-diag/bp-uht-probe/apps/vr/Binaries/Win64/UnrealEditor-BpLink.dll` | `924ef91db457c3164776796826eca54986886659eb56985617c22e97a2e4180a` |
| `bp-70637178-fixed/bp-uht-probe/run-bpEditor.log` | `0d31d1a1370c848a4216f3a3bcd5c508891d7f1e1ddc337d4b5c55b79ab1fbec` |
| `bp-70637178-fixed/bp-uht-probe/run-bpEditor-Saved.log` | `af57458073684add8276e3bbce154ffb30f2801b92b332608e680a0aff0b084d` |
| `bp-70637178-fixed/bp-uht-probe/apps/vr/Binaries/Win64/UnrealEditor-BpLink.dll` | `e26913800d6ba6f26c94cd57c53f536ab543e654baded1f2567051fcd25e4514` |
| `bp-70637178-stream/bp-uht-probe/run-bpEditor.log` | `17d3fc3bad1c9e2d68d2d9f0f0c79cbd6e40c3e4b013dff8cdfa6bfadb002f53` |
| `bp-70637178-stream/bp-uht-probe/run-bpEditor-Saved.log` | `9ed821a74dc43ef58abac8873f925e83382577b360a851abad04742042244238` |
| `bp-70637178-stream/bp-uht-probe/apps/vr/Binaries/Win64/UnrealEditor-BpLink.dll` | `ac35877cbe7e2dba617974e89787067ff8341a3f642b36814c29bbee0c748149` |

Two directories from this session are **not readings**. `bp-70637178-srv` holds a Node-only run of apps/server
(`--port 0`), from which I fetched `/structure` and `/plan` with `curl` to read the glyph's JSON types; nothing of
Unreal ran, and I stopped that server with `Stop-Process`. `bp-70637178-tools` holds my edit scripts and the probes'
captured stdout.

Gates beside the runs: `npm run check:schema` is green at each commit. `clang++ -std=c++20 -fsyntax-only -Wall -Wextra`
(LLVM 23.1.4, aarch64-pc-windows-msvc) on `packages/schema/ue-standin/check.cpp` exits 0 against the regenerated header.
`check:bplink` gains an assertion that the three `/structure` branches and the length-and-head line exist.
`BP_CHECK_BPLINK_SEED=source:diag` makes that assertion FAIL, and a permanent control refuses reading 10's
one-condition shape.

### What this does NOT establish

- **Milestone 4 goal 1 is not met as a whole.** WP3.1's acceptance is "the editor and a Win64 build boot, and a `BpLink`
  log line prints Kettle's 5 wings". Reading 14 covers the editor half and the line. The Win64 Game build still does not
  boot in this project shape (reading 11, not re-run here). The headset, Meta XR v207, the Interaction SDK and the Quest 3
  over Link are untouched.
- That the text `CopyRaw` leaves in `Glyph_` (or `CrossRefs_`) is the right text. BpLink logs neither, and Kettle's
  answer has no `cross_refs`. Only the return value was measured, through the parse succeeding.
- That `CopyKey` (`short`, `default`, `$schema`) copied the right values. It returned true; nothing logs what it wrote.
- How the `/stream` 200 completed after the cancel (connected or not), and that cancelling is the right design for SSE.
  WP3.1 consumes no SSE, and nothing here reads an event from the stream.
- The `BpLink.Fetch` console command, a second fetch in one session, and the 405 branch (Kettle answered 200).
- That the generated `LastFailure()` path is right for `FixUpMap` or for a `JsonObjectToUStruct` failure. Neither
  happened. The stand-in smoke only parses them.
- Any frame time. R5 is the operator's open question; `-nullrhi` measures nothing of the kind, and nothing here is
  offered as one. Readings 12 to 14 do not touch R1 or R4.
- These are Lynx readings on emulated x64 (MSVC 14.44.35207, UE 5.8.4 x64 binaries on ARM64).

### How to reproduce

```
node scripts/uht-probe.mjs --engine "C:/Program Files/Epic Games/UE_5.8" --work <fresh scratch> --variant junction --run
```

At `47c49ea` this prints reading 12's `CopyRaw` line, at `cd9dd65` it runs to the 900 s timeout, and from `422d7fa` on
it prints the Kettle line. One UBT at a time, and a fresh `--work` each run, as above.
