# WP3.1: the `apps/vr` project and the BpLink module

**Status: not yet run on any UE host.** The module source in `Source/BpLink/` was written on Lynx (Windows ARM64), which had
no Unreal Engine and no clang. It has not built against Unreal. Every step below is for a UE-equipped host; none has been run
as written.

> **Correction 2026-10-22 (Lynx).** "Lynx has no Unreal Engine" and "has not been syntax-checked" are out of date. Lynx has
> had Unreal Engine 5.8.4-58902052, complete, since 2026-10-22, and two `bpEditor Win64 Development` builds of this module
> ran there in a host project synthesized **outside the repo** (`scripts/uht-probe.mjs`; this folder still has no
> `.uproject`), on emulated `Hostx64` MSVC 14.44.35207. Both exit 6: the readings for step 5 are under Risks below and in
> [`machine.md`](../../docs/concepts/vr-light-table/machine.md). Steps 1, 3, 4 and 6 to 8 are not run. Lynx cannot run
> step 3 as written (its install has no `Engine/Templates`, so no New Project dialog), nor `Build.bat` (it needs a
> win-arm64 .NET the install does not ship); the probe drives UnrealBuildTool directly.
>
> **Correction 2026-10-22 (evening, Lynx).** "Both exit 6" is superseded for the junction variant: after `72e4fd4`
> (`HAL/PlatformMisc.h`) and `ed94a65` (one include spelling, `Schema/<header>`), `bpEditor Win64 Development` exits **0**
> in the probe, fresh tree and unity build alike (`machine.md` readings 3 to 7). That is step 5 and the editor half of
> step 6 measured outside the repo, not this table run as written: steps 1 to 4 and 7 to 8, and the Win64 Game target,
> are still not run.
>
> **Correction 2026-10-22 (night, Lynx).** "Not yet run on any UE host" and "steps ... 7 to 8, and the Win64 Game target,
> are still not run" are out of date. In the same probe project outside the repo (`scripts/uht-probe.mjs --run`, so still
> not this table run as written): the Win64 Game target `bp` builds, exit 0 (`machine.md` readings 8 and 11), but `bp.exe`
> asserts before BpLink runs (reading 11); and the editor, booted headless under `-nullrhi`, printed step 7's two lines
> (reading 14, verbatim in the table below). Each step now carries its own verdict in the table. These are Lynx readings
> on emulated x64 (MSVC 14.44.35207, UE 5.8.4 x64 binaries on ARM64).

Acceptance (plan P3, WP3.1): the editor and a Win64 build boot, and a `BpLink` log line prints Kettle's 5 wings, which `BpLink.cpp` reads from `GET /api/products/kettle/plan` (that request and the line's figures are pinned against the live server by `npm run check:bplink`; the code is not compiled). *Correction 2026-10-22 (evening): it compiles and links in a `bpEditor` build on Lynx, outside the repo (`machine.md`); it has not run.* *Correction 2026-10-22 (night): "it has not run" is out of date for the editor half. In `machine.md` reading 14 the editor booted the probe project headless (`-nullrhi`), BpLink ran at startup, and Unreal printed `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd`. The acceptance is **not met as a whole**: the Win64 Game build links but does not boot in this project shape (reading 11), and the project is the probe's, outside the repo, with no Meta XR v207 and no Interaction SDK.*

## Steps

| # | Step | Observable proof | Verdict 2026-10-22 (night, Lynx; readings in `machine.md`) |
|---|---|---|---|
| 1 | P0: install UE 5.8.2, Meta XR v207 and the Interaction SDK with `install-xr.ps1` adapted to `apps/vr` (mage-arena-vr's `apps/vr/tools/install-xr.ps1`). | The Epic launcher lists 5.8.2; the Meta XR plugins show in the editor's Plugins window. | **Not run.** Lynx has UE 5.8.4-58902052 (not 5.8.2), installed outside this step; Meta XR v207 and the Interaction SDK are not installed. |
| 2 | Start the server from the repo root: `npm run server`. | `listening on http://127.0.0.1:3100`; `curl http://127.0.0.1:3100/api/products/kettle/structure` answers 200 JSON with `structure`, `events`, `rev`. (`npm run check:bplink` is green on the same tree.) | **Proved in the probe's form, not as written:** `uht-probe.mjs --run` starts apps/server with `--port 0` in an empty cwd, not `npm run server` on 3100; reading 14: `bp server listening on http://127.0.0.1:58672`, and BpLink's `/structure` came back 200 and parsed. |
| 3 | Create the UE 5.8 project in `apps/vr` (a C++ project, VR template or blank, `bp` as its name). The `.uproject` is made by the editor, never by hand. | `apps/vr/bp.uproject` exists and the editor opens it. | **Not run.** `apps/vr` has no `.uproject`. The probe writes `bp.uproject` outside the repo by script, not by the editor; Lynx's install has no `Engine/Templates`, so no New Project dialog. |
| 4 | Add the module to the `.uproject` (`"Modules": [{ "Name": "BpLink", "Type": "Runtime", "LoadingPhase": "PostEngineInit" }]`) and to the project's `*.Target.cs` / `*Editor.Target.cs` `ExtraModuleNames`. Generate project files. | The solution shows `BpLink` under `Source/`. | **Not run as written.** The probe's synthesized `bp.uproject` carries this exact `BpLink` entry and both `*.Target.cs` list it in `ExtraModuleNames`; no project files were generated. Reading 10: `LogModuleManager: InternalLoadLibrary: 'BpLink'`. |
| 5 | Resolve the UHT include question (see Risks): UHT must process `packages/schema/generated/ue/BpSchema.h`. | UHT writes `BpSchema.generated.h` for the module with no error. | **Proved with the junction** `Source/BpLink/Public/Schema` (readings 2, 3 to 8: `4 generated files written`); as is, UHT never sees `BpSchema.h` (readings 1 and 9 fail). Whether the junction settles R1 is the operator's. |
| 6 | Build the editor target and the `Win64` Development Game target. | Both builds exit 0. Record the UE and compiler versions in `docs/concepts/vr-light-table/machine.md`. | **Both exit 0 in the probe:** `bpEditor` (readings 3 to 7, 10, 12 to 14) and `bp Win64 Development` (readings 8 and 11). UE 5.8.4, MSVC 14.44.35207 `Hostx64`, emulated x64 on ARM64. |
| 7 | With the server up, start the editor (or the Win64 game), or run `BpLink.Fetch` in the console. Override the server with `-BpLinkUrl=http://host:3100` or `BP_LINK_URL`. | `LogBpLink` prints `BpLink: kettle streams (200); WP3.1 does not consume SSE, so rev ... read once from structure stands`, then one line `BpLink: Kettle wings=5 [<5 wing names>] rooms=13 bays=29 tiles=133 lenses=8 events=N rev=...`. The wings, rooms, bays and tiles are the counts of `/plan`'s own arrays (`WING_DEFS` groups the 13 `structure.domains` into 5 wings); lenses, events and rev come from `/structure`. A product with no live stream logs `has no live stream (405)` in place of the first line. If `/plan` fails, an Error `GET .../plan failed` precedes a line with no wings: that is not a pass. | **Editor: proved at startup** (reading 14, `UnrealEditor-Cmd.exe ... -nullrhi`): `LogBpLink: BpLink: kettle streams (200); WP3.1 does not consume SSE, so rev 80557561ddf0f4cd read once from structure stands`, then `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd`. **Win64 game: not reached**, `bp.exe` asserts before BpLink (reading 11). `BpLink.Fetch` and the 405 branch: not run. |
| 8 | Stop the server and run `BpLink.Fetch`. | `LogBpLink` errors `GET .../structure failed ... Is npm run server running?` and nothing else crashes. | **Not run.** |

Step 7's line is WP3.1's acceptance. Copy it into the commit that records the first real run.

## The requests BpLink makes

Every row is pinned by `scripts/check-bplink.mjs` against the live server (and, where the source can be read without a compiler, against `BpLink.cpp`'s text) and by the README BpLink contract:

| Source (`Private/BpLink.cpp`) | Pinned request |
|---|---|
| `GET {base}/api/products/kettle/structure`, `Accept: application/json` | structure: 200 `{ structure, events, rev }`; domains = `structure.domains`, lens manifests = `structure.lenses` |
| the `events` string of that payload, split by line, each line through `BpSchema::FromJson` | events: the payload's JSONL, one valid JSON object per line |
| `GET {base}/api/products/kettle/plan`, `Accept: application/json`, parsed into `FBpPlan` | plan: 200 `{ rev, lenses, wings, rooms, bays, tiles }`; 5 wings, 13 rooms, 29 bays, 133 tiles; the log line's `wings`/`rooms`/`bays`/`tiles` are these arrays' counts |
| `GET {base}/api/products/kettle/stream`, `Accept: text/event-stream` | stream: 200 `text/event-stream` for Kettle, first event a `snapshot`; 405 stays an answer BpLink lives with, for a product with no live stream. SSE is consumed in neither case: `rev` is the one read once from structure |

## Risks to settle on the UE host (unverified)

- **UHT and the external header.** UHT scans a module's own `Public/` and `Private/` folders for `USTRUCT`s. `BpSchema.h` lives in
  `packages/schema/generated/ue/` and `Build.cs` only adds it to the include path, so UHT may not generate its
  `BpSchema.generated.h`. If so, the fix must keep `packages/schema` the single source (no copy): try a directory
  junction or symlink `Source/BpLink/Public/Schema` pointing at `packages/schema/generated/ue`, and record the result here.
  The headers' own README says UHT acceptance is unproven.
  *Reading 2026-10-22, Lynx, probe project outside the repo (not this folder):* as is, UHT ran (`0 generated files
  written`) with no `BpLink` module in its manifest, and the build failed `BpSchema.h(13,1): fatal error C1083: Cannot open
  include file: 'BpSchema.generated.h'`. With the junction `Source/BpLink/Public/Schema` (made in the probe only), UHT listed
  `Public\Schema\BpSchema.h`, wrote `BpSchema.generated.h` (`4 generated files written`), the generated
  `Module.BpLink.gen.cpp` compiled, and the build stopped next at `BpLink.cpp(11,1): fatal error C1083: Cannot open include
  file: 'Misc/PlatformMisc.h'` (in UE 5.8 it is `HAL/PlatformMisc.h`; not changed here). `#include "BpSchema.h"` did not
  have to change to get that far. Whether this settles the risk is the operator's call (wolf-plan R1); nothing here is
  ticked.
  *Reading 2026-10-22 (evening), Lynx:* `HAL/PlatformMisc.h` fixed (`72e4fd4`), and the junction build exits 0. But the
  two spellings cannot share a translation unit: one that includes both, or a unity file merging UHT's `BpSchema.gen.cpp`
  (`"Schema/BpSchema.h"`) with `BpLink.cpp` (`"BpSchema.h"`), stops at `BpSchema.generated.h(10,1): fatal error C1189`
  (`machine.md` readings 4 and 5). So `#include "BpSchema.h"` **did** have to change: BpLink spells both headers
  `Schema/<header>` (`ed94a65`), which makes the junction required. The `PublicIncludePaths` entry is left as it is
  (wolf-plan E1 suggests repointing or dropping it; that is the R1 decision, not taken here).
- **`override` as a field name.** `FBpFacet` holds `FBpFacetOverride override;`. `override` is only a contextual keyword in C++, but
  UHT may still dislike it. If it does, the change is in `packages/schema` (the generator), not here.
  *Reading 2026-10-22, Lynx (junction variant above):* UHT, run with `-WarningsAsErrors`, reflected it (`NewProp_override`
  in `BpSchema.gen.cpp`) with no warning, and that file compiled. A use of the field from BpLink's own code is not measured.
- **Startup read.** `StartupModule` fires the request at `PostEngineInit`; `HTTP` must be loaded by then. If the line does not appear
  on boot, `BpLink.Fetch` is the manual trigger.
- **API names** (`FHttpModule`, `FJsonObjectConverter`, `FPlatformMisc::GetEnvironmentVariable`) are used as in UE 5.x; any 5.8
  rename shows up at step 6.
  *Reading 2026-10-22 (evening), Lynx:* none did for the editor target; `BpLink.cpp` compiled with no error and no
  warning against UE 5.8.4 once `Misc/PlatformMisc.h` was corrected to `HAL/PlatformMisc.h` (`machine.md` reading 3).
