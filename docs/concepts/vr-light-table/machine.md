# VR Light Table: machine facts

Facts about the machines that build `apps/vr`, as measured. plan.md P0 and WP3.6 and wolf-plan.md section (a) name this
file. Every line below is a command's own output or a file read on the named host; anything not measured says so.

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
that a Win64 Game target links, that PIE or automation runs, that Meta XR v207 or the Interaction SDK load, that the Quest 3
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
- The `asis` variant at the final source (not run). Without the junction, `"Schema/BpSchema.h"` has nowhere to resolve,
  so BpLink now **requires** WP3.1's junction; whether that settles R1 is the operator's call, as before.
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
