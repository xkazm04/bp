# apps/vr: the VR Light Table client

> **Current state, 2026-10-23 (Lynx, the only build host).** This folder **is** the UE 5.8 project now: `bp.uproject`,
> `Config/`, `Source/bp` and both Targets, made by the editor's New Project (Blank, C++) and copied in (`8e191b5`), with
> BpLink added and Meta XR v207 + the Interaction SDK enabled. WP3.1's acceptance is met: the editor (reading 16) and a
> cooked, staged `bp.exe` (reading 21) print `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money,
> Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd`, and the game boots on
> the Meta XR Simulator v207 (reading 18). Readings: `docs/concepts/vr-light-table/machine.md`, 'Lynx, 2026-10-23'; plan:
> `docs/concepts/vr-light-table/lynx-plan.md`. The text below this box is the history and is kept as written.
>
> **Run it** (Lynx, from the repo root; every UE step uses the bundled x64 dotnet, emulated on ARM64):
>
> 1. `powershell -File apps/vr/tools/link-schema.ps1` (the git-ignored junction `Source/BpLink/Public/Schema`).
> 2. `powershell -File apps/vr/tools/install-xr.ps1` (Meta XR v207, Interaction SDK, Simulator; pinned SHA-256).
> 3. `powershell -File apps/vr/tools/start-editor.ps1` opens the editor on `bp.uproject`. Never start the editor
>    another way: its own UBT calls need this script's environment.
> 4. `node apps/vr/tools/run-bplink.mjs --mode editor` starts apps/server and the editor headless and prints BpLink's
>    lines (`--no-server`, `--mode game --xr-sim`, `--mode staged --exe <bp.exe>`).
> 5. Content is made through UE 5.8's editor MCP: `powershell -File apps/vr/tools/link-pof-toolset.ps1` once (pof's
>    toolset, a junction to the pof checkout), then `node apps/vr/tools/mcp-editor.mjs start` (headless editor, MCP on
>    `127.0.0.1:8770`) and `node apps/vr/tools/mcp-call.mjs toolsets | call | python | replay`. The calls that made
>    `Content/` are logged in `tools/mcp-steps/`. The map is `/Game/Maps/LightTable` (L3.2, `machine.md` readings 22-26).

This folder will hold the Unreal Engine 5.8 project for bp's VR channel: a PC-tethered Quest 3 app
with Meta XR v207 and the Meta Interaction SDK, drawing the product at a backlit light table
(`docs/concepts/vr-light-table/`).

There is no Unreal project here yet, on purpose. Unreal is not installed on the machine this was laid out on, and
the project is created in phase P3 (WP3.1) on the GPU workstation, after P0 has installed UE 5.8.2
and the Meta plugins (`apps/vr/tools/install-xr.ps1`). Do not
add a `.uproject` by hand.

> **Correction 2026-10-22 (Lynx).** "Unreal is not installed on the machine this was laid out on" is out of date: since
> 2026-10-22 Lynx has Unreal Engine 5.8.4-58902052, a complete installed build, at `C:/Program Files/Epic Games/UE_5.8`
> ([`machine.md`](../../docs/concepts/vr-light-table/machine.md)). It has no `Engine/Templates`, so the editor's New
> Project route still cannot make the project here, and the rule stands: no `.uproject` by hand, none in this folder.
>
> **Correction 2026-10-22 (night, Lynx).** "There is no Unreal project here yet" still holds for this folder, but not
> for the work: the project is synthesized **outside the repo** by `scripts/uht-probe.mjs` (UE 5.8.4, not 5.8.2, and no
> Meta plugins), built there, and from `machine.md` reading 10 booted there; reading 14 is the editor running BpLink to
> the Kettle line. P0's install and WP3.1's project in `apps/vr` are still not done.

On Wolf (the x64 box with UE 5.8), follow [`docs/concepts/vr-light-table/wolf-plan.md`](../../docs/concepts/vr-light-table/wolf-plan.md): setup, WP3.1 to P7 in order, the merge gates and the known compile risks.

What is here: the `BpLink` module source, `Source/BpLink/` (`BpLink.Build.cs`, `Public/`, `Private/`), and the ordered
UE-host steps with their proofs, [`WP3.1.md`](WP3.1.md). **The module has not built against Unreal: two editor builds on
Lynx (2026-10-22) both failed.** *Correction 2026-10-22: this paragraph said "no C++ compiler has read it (Lynx has no
Unreal and no clang)"; that was true when written and is now wrong.* UE 5.8.4's MSVC 14.44.35207 (`Hostx64` `cl.exe`,
emulated on ARM64) read `BpLink.cpp`, `BpLink.h`, `BpSchema.h` and `BpSchemaFixups.h` in a host project synthesized
outside the repo, and stopped at a fatal error each time (**Not compiled**, below). WP3.1 is not run on any UE host. The
module includes the generated headers by path from `packages/schema/generated/ue` (no copy), so `check:schema` stays the
single source.

> **Correction 2026-10-22 (evening, Lynx).** "The module has not built against Unreal" is out of date: from `72e4fd4`
> (`HAL/PlatformMisc.h`) the same probe's `bpEditor Win64 Development` build, with the junction, exits **0** and links
> `UnrealEditor-BpLink.dll`; at `9888f95` a fresh tree reads `Result: Succeeded`, `Total execution time: 135.29 seconds`
> ([`machine.md`](../../docs/concepts/vr-light-table/machine.md), readings 3 to 7). The module now includes the headers
> as `"Schema/BpSchema.h"` and `"Schema/BpSchemaFixups.h"` (`ed94a65`), so it **needs** the junction
> `Source/BpLink/Public/Schema`: reaching `BpSchema.h` by both spellings in one translation unit fails with `C1189`
> (readings 4 and 5). The headers are still not copied. Nothing has booted the editor or run the module.
>
> **Correction 2026-10-22 (night, Lynx).** "WP3.1 is not run on any UE host" and "Nothing has booted the editor or run
> the module" are out of date for the editor half. In the probe project outside the repo, `UnrealEditor-Cmd.exe` booted
> `bp.uproject` headless under `-nullrhi` and loaded BpLink (`machine.md` reading 10), and after `cd9dd65` and `422d7fa`
> BpLink parsed `/structure` into `FBpAppStructure` and `/plan` into `FBpPlan`, saw `/stream` answer 200, and printed
> (reading 14, verbatim): `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach,
> Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd`. The Win64 Game target links but `bp.exe`
> asserts before BpLink runs (reading 11). WP3.1's acceptance is not met as a whole; no frame time of any kind was
> measured. These are Lynx readings on emulated x64 (MSVC 14.44.35207, UE 5.8.4 x64 binaries on ARM64).

What the client will consume, already in this repo:

- `apps/server`: the product over HTTP and SSE (`npm run server`, `http://127.0.0.1:3100`), the same
  handlers apps/web mounts (`packages/core/src/server/api`).
- Kettle, read-only, with no product registered: `GET /api/products/kettle/structure` answers
  `{ structure, events, rev }` from `packages/core/data` (13 domains in `structure.domains`, capabilities and features, the 8 lens manifests in `structure.lenses`, the event log in `events`). Kettle is not in
  `GET /api/products`. Its map is read-only; its scans, waves, dispatch and stream answer from the sims `apps/server`
  hosts in memory (below), and its other write routes answer it 405.
- `packages/schema`: the app-structure v3 JSON Schemas and the UE `USTRUCT` headers generated from
  them, so `FJsonObjectConverter` fills the structs with no hand-written parsing.

- `GET /api/products/kettle/plan` (BpLink reads it, WP3.1): the derived plan, `{ rev, lenses, wings, rooms, bays, tiles }`, schema
  `packages/schema/schema/plan-1.schema.json`. VR uses the web's levels, wing, room, bay and tile (decision 2026-10-21,
  `docs/architecture-review-2026-10-21.md`): Kettle is 5 wings, 13 rooms, 29 bays and 133 tiles, read from this endpoint,
  not from `structure.domains`.

It never computes a health rule or a layout rule; those stay in `packages/core`.

**Not compiled.** Nothing in `apps/vr` has compiled. *Correction 2026-10-22: this said "nothing ... has been compiled or
syntax-checked: Lynx has no Unreal Engine and no clang"; Lynx has had UE 5.8.4 since 2026-10-22, and BpLink has been
through a compiler there.* Two `bpEditor Win64 Development` builds on Lynx, in a probe project outside the repo
(`scripts/uht-probe.mjs`, readings in [`machine.md`](../../docs/concepts/vr-light-table/machine.md)), both exit 6: as is,
UHT never sees `BpSchema.h` (it is only on `PublicIncludePaths`) and `cl.exe` stops at `BpSchema.h(13,1): fatal error C1083:
Cannot open include file: 'BpSchema.generated.h'`; with WP3.1's junction `Source/BpLink/Public/Schema`, UHT writes
`BpSchema.generated.h` and `cl.exe` stops at `BpLink.cpp(11,1): fatal error C1083: Cannot open include file:
'Misc/PlatformMisc.h'` (UE 5.8 has it as `HAL/PlatformMisc.h`). Unmeasured: a clean build, the editor booting the module,
a Win64 Game target. *Correction 2026-10-22 (evening): the editor target now builds clean with the junction (exit 0,
readings 3 to 7 in `machine.md`); the editor booting the module and a Win64 Game target are still unmeasured.*
*Correction 2026-10-22 (night): "Nothing in `apps/vr` has compiled" holds only for this folder in place (it has no
`.uproject`); BpLink's sources compile, link and run in the probe project outside the repo. The Win64 Game target builds,
exit 0 (`machine.md` readings 8 and 11), and `bp.exe` asserts before BpLink runs (reading 11); the editor boots the module
and prints the Kettle line (readings 10 and 14).* The other C++ front end in this repo's record is outside `apps/vr`: per `packages/schema/README.md`, the generated headers in
`packages/schema/generated/ue` were put through `clang++ -fsyntax-only` against stand-in Unreal declarations
(`packages/schema/ue-standin/check.cpp`), when that smoke read 3 of the 6 roots, so `FBpPlan` (which BpLink parses),
`FBpStructureEnvelope` and `FBpScanWire` have never been through it. No gate runs that command: `check:schema` asserts
only that `check.cpp` names all six roots.

## MetaHuman hands (built locally, never committed)

The capture hands can be MetaHuman Creator's forearms and hands with its skin (spark vr-fidelity-40 FT/FT2). MetaHuman is
licensed under the Unreal Engine EULA (UE 5.6 and later), and bp is a public repository, so the owner ruled on
2026-10-26: **the code is public, and the MetaHuman content stays out of git.** `.gitignore` excludes
`Content/Bp/Art/MetaHuman/` and `Content/Bp/Art/MetaHumanHands/`; the intermediate FBX and GLB live in `Saved/`. Each
machine builds the content from its own Epic-licensed engine, with the MetaHuman Creator plugin and its Core Data
installed:

1. `node apps/vr/tools/mcp-call.mjs python apps/vr/tools/mcp-steps/py/ft_metahuman.py --log apps/vr/tools/mcp-steps/ft-metahuman.jsonl`
   creates the character `MHC_CaptureHands`, sets the skin and exports the body (offline; start the editor with
   `mcp-editor.mjs start --ue-args -NoMetaHumanAccountPortalLoginFallback` for headless work).
2. `blender -b -P scripts/art/hands/build_mh_hands.bpy -- <body.fbx> <Saved/MetaHumanHands/hands.glb> <Saved/MetaHumanHands>`
   poses and cuts the forearms and hands.
3. `import_mh_hands.py`, then `studio_level.py`, through `mcp-call.mjs` as above.

A checkout without these assets falls back to the MakeHuman pair (`studio_level.py` logs `hands=hands-capture`). Never
commit anything under those two folders, and never push the local branch `local/metahuman-hands`: it holds the
original commit with the assets.

## BpLink contract

The requests the `BpLink` module will make for Kettle, against `apps/server` with no products file. `npm run check:bplink`
(`scripts/check-bplink.mjs`) starts the server and guards each answer; the counts are read from `packages/core/data`.

- `GET /api/products/kettle/structure`: 200 JSON `{ structure, events, rev }`, `structure.domains` = the domains (not
  the wings), `structure.lenses` = the lens manifests.
- `GET /api/products/kettle/plan` (BpLink parses it into `FBpPlan` and logs its wing, room, bay and tile counts): 200 JSON
  `{ rev, lenses, wings, rooms, bays, tiles }`; 5 wings, 13 rooms, 29 bays, 133 tiles, derived from `WING_DEFS` and the data;
  `rev` equals the structure's.
- The events BpLink reads: the `events` string of that payload (JSONL, one valid JSON object per line, the same lines as
  `kettle.events.jsonl`).
- `GET /api/products/kettle/stream`: 200 `text/event-stream` (since wolf-plan L5.2: `apps/server` hosts Kettle's scan sim
  in memory, nothing written to disk). The first event is a `snapshot` (`runs`, `measurements`, `proposals` = the sample's
  findings, `activity`, ...); `jobs` and `delta` events follow a scan, `ping` every 15 s. Kettle's map never changes, so
  there is no `map` event: `rev` is still read once from the structure payload (it is stable across reads). Kettle no
  longer answers 405; BpLink still lives with 405 for a product with no live stream, and reads SSE only from step (W5.1).
  `npm run check:kettle-sim` shows `snapshot` then `delta` after a scan POST.
- Kettle writes on the sim's routes answer as for a live product: `POST /api/products/kettle/scans` 202 (the scan job),
  `GET .../scans`, `DELETE .../scans/<job>`, `GET .../scan`, `GET`/`POST .../waves`, `PATCH`/`DELETE .../waves/<wave>`,
  `POST .../waves/<wave>/dispatch` and `POST .../dispatch`. The sim's state lasts as long as the server process. Other
  Kettle writes (triage, releases, lenses) still answer 405.
