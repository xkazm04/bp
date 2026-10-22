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
  run's to edit). Because the fatal error is at line 11, `cl.exe` read `BpLink.h`, all of `BpSchema.h` (with its
  generated header) and `BpSchemaFixups.h` before it, with no error on them.
- **Include spelling.** UHT's generated `BpSchema.gen.cpp` includes `"Schema/BpSchema.h"` (through the junction), while
  `BpLink.h` keeps `#include "BpSchema.h"` (through `PublicIncludePaths`); both resolved in this reading, so no spelling
  change was **required** to get this far. Not measured: whether one translation unit that reaches the header by both
  paths (a unity build, or an include of both spellings) trips `#pragma once`, which MSVC keys on the path. If it does,
  the change belongs in BpLink (`#include "Schema/BpSchema.h"`) and in `packages/schema/generate.mjs`, whose
  `BpSchemaFixups.h` line 19 is `#include "BpSchema.h"`, never in a copied header.

### What this does NOT establish

Unmeasured on Lynx: that `bpEditor` builds to exit 0 (it does not yet; see reading 2), that the editor boots `bp.uproject`,
that a Win64 Game target links, that PIE or automation runs, that Meta XR v207 or the Interaction SDK load, that the Quest 3
over Link works, and any frame time (the 90 Hz budget). None of these readings say anything about Wolf.

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
