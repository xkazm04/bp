# WP3.1: the `apps/vr` project and the BpLink module

**Status: not yet run on any UE host.** The module source in `Source/BpLink/` was written on Lynx (Windows ARM64), which has
no Unreal Engine and no clang. It has not been compiled against Unreal and has not been syntax-checked. Every step below
is for a UE-equipped host; none has been run.

Acceptance (plan P3, WP3.1): the editor and a Win64 build boot, and a `BpLink` log line prints Kettle's 13 wings from the server.

## Steps

| # | Step | Observable proof |
|---|---|---|
| 1 | P0: install UE 5.8.2, Meta XR v207 and the Interaction SDK with `install-xr.ps1` adapted to `apps/vr` (mage-arena-vr's `apps/vr/tools/install-xr.ps1`). | The Epic launcher lists 5.8.2; the Meta XR plugins show in the editor's Plugins window. |
| 2 | Start the server from the repo root: `npm run server`. | `listening on http://127.0.0.1:3100`; `curl http://127.0.0.1:3100/api/products/kettle/structure` answers 200 JSON with `structure`, `events`, `rev`. (`npm run check:bplink` is green on the same tree.) |
| 3 | Create the UE 5.8 project in `apps/vr` (a C++ project, VR template or blank, `bp` as its name). The `.uproject` is made by the editor, never by hand. | `apps/vr/bp.uproject` exists and the editor opens it. |
| 4 | Add the module to the `.uproject` (`"Modules": [{ "Name": "BpLink", "Type": "Runtime", "LoadingPhase": "PostEngineInit" }]`) and to the project's `*.Target.cs` / `*Editor.Target.cs` `ExtraModuleNames`. Generate project files. | The solution shows `BpLink` under `Source/`. |
| 5 | Resolve the UHT include question (see Risks): UHT must process `packages/schema/generated/ue/BpSchema.h`. | UHT writes `BpSchema.generated.h` for the module with no error. |
| 6 | Build the editor target and the `Win64` Development Game target. | Both builds exit 0. Record the UE and compiler versions in `docs/concepts/vr-light-table/machine.md`. |
| 7 | With the server up, start the editor (or the Win64 game), or run `BpLink.Fetch` in the console. Override the server with `-BpLinkUrl=http://host:3100` or `BP_LINK_URL`. | `LogBpLink` prints one line `BpLink: Kettle wings=13 [<13 wing names>] lenses=8 events=N rev=...`, then `Kettle has no live stream (405); using rev ... read once`. The 13 matches `structure.domains` in `packages/core/data`. |
| 8 | Stop the server and run `BpLink.Fetch`. | `LogBpLink` errors `GET .../structure failed ... Is npm run server running?` and nothing else crashes. |

Step 7's line is WP3.1's acceptance. Copy it into the commit that records the first real run.

## The requests BpLink makes

All three are pinned by `scripts/check-bplink.mjs` and the README's BpLink contract:

| Source (`Private/BpLink.cpp`) | Pinned request |
|---|---|
| `GET {base}/api/products/kettle/structure`, `Accept: application/json` | structure: 200 `{ structure, events, rev }`; wings = `structure.domains`, lens manifests = `structure.lenses` |
| the `events` string of that payload, split by line, each line through `BpSchema::FromJson` | events: the payload's JSONL, one valid JSON object per line |
| `GET {base}/api/products/kettle/stream`, `Accept: text/event-stream` | stream: 405 JSON `error`; fallback is the `rev` read once from structure |

## Risks to settle on the UE host (unverified)

- **UHT and the external header.** UHT scans a module's own `Public/` and `Private/` folders for `USTRUCT`s. `BpSchema.h` lives in
  `packages/schema/generated/ue/` and `Build.cs` only adds it to the include path, so UHT may not generate its
  `BpSchema.generated.h`. If so, the fix must keep `packages/schema` the single source (no copy): try a directory
  junction or symlink `Source/BpLink/Public/Schema` pointing at `packages/schema/generated/ue`, and record the result here.
  The headers' own README says UHT acceptance is unproven.
- **`override` as a field name.** `FBpFacet` holds `FBpFacetOverride override;`. `override` is only a contextual keyword in C++, but
  UHT may still dislike it. If it does, the change is in `packages/schema` (the generator), not here.
- **Startup read.** `StartupModule` fires the request at `PostEngineInit`; `HTTP` must be loaded by then. If the line does not appear
  on boot, `BpLink.Fetch` is the manual trigger.
- **API names** (`FHttpModule`, `FJsonObjectConverter`, `FPlatformMisc::GetEnvironmentVariable`) are used as in UE 5.x; any 5.8
  rename shows up at step 6.
