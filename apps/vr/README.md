# apps/vr: the VR Light Table client (placeholder)

This folder will hold the Unreal Engine 5.8 project for bp's VR channel: a PC-tethered Quest 3 app
with Meta XR v207 and the Meta Interaction SDK, drawing the product at a backlit light table
(`docs/concepts/vr-light-table/`).

There is no Unreal project here yet, on purpose. Unreal is not installed on the machine this was laid out on, and
the project is created in phase P3 (WP3.1) on the GPU workstation, after P0 has installed UE 5.8.2
and the Meta plugins (mage-arena-vr's `apps/vr/tools/install-xr.ps1`, adapted to this folder). Do not
add a `.uproject` by hand.

> **Correction 2026-10-22 (Lynx).** "Unreal is not installed on the machine this was laid out on" is out of date: since
> 2026-10-22 Lynx has Unreal Engine 5.8.4-58902052, a complete installed build, at `C:/Program Files/Epic Games/UE_5.8`
> ([`machine.md`](../../docs/concepts/vr-light-table/machine.md)). It has no `Engine/Templates`, so the editor's New
> Project route still cannot make the project here, and the rule stands: no `.uproject` by hand, none in this folder.

On Wolf (the x64 box with UE 5.8), follow [`docs/concepts/vr-light-table/wolf-plan.md`](../../docs/concepts/vr-light-table/wolf-plan.md): setup, WP3.1 to P7 in order, the merge gates and the known compile risks.

What is here: the `BpLink` module source, `Source/BpLink/` (`BpLink.Build.cs`, `Public/`, `Private/`), and the ordered
UE-host steps with their proofs, [`WP3.1.md`](WP3.1.md). **The module has not built against Unreal: two editor builds on
Lynx (2026-10-22) both failed.** *Correction 2026-10-22: this paragraph said "no C++ compiler has read it (Lynx has no
Unreal and no clang)"; that was true when written and is now wrong.* UE 5.8.4's MSVC 14.44.35207 (`Hostx64` `cl.exe`,
emulated on ARM64) read `BpLink.cpp`, `BpLink.h`, `BpSchema.h` and `BpSchemaFixups.h` in a host project synthesized
outside the repo, and stopped at a fatal error each time (**Not compiled**, below). WP3.1 is not run on any UE host. The
module includes the generated headers by path from `packages/schema/generated/ue` (no copy), so `check:schema` stays the
single source.

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
a Win64 Game target. The other C++ front end in this repo's record is outside `apps/vr`: per `packages/schema/README.md`, the generated headers in
`packages/schema/generated/ue` were put through `clang++ -fsyntax-only` against stand-in Unreal declarations
(`packages/schema/ue-standin/check.cpp`), when that smoke read 3 of the 6 roots, so `FBpPlan` (which BpLink parses),
`FBpStructureEnvelope` and `FBpScanWire` have never been through it. No gate runs that command: `check:schema` asserts
only that `check.cpp` names all six roots.

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
