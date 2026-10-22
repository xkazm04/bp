# VR Light Table: project plan

Goal: a PC-tethered Quest 3 workspace in which a person stands at the Light Table, reads a real
product (Kettle first, then a live product), scans a place, composes and dispatches a wave, and
answers the agent by voice, at the quality of `target-light-table.jpg`, as measured by the fidelity
method in `art-breakdown.md`.

Executed on the GPU workstation by agent sessions (Claude Code driving UE 5.8 through its editor MCP
toolsets plus pof's gap-fillers, and ComfyUI / TRELLIS.2 as local services) under the owner's review.
The owner is the only judge of look and comfort, in the headset.

## Phases at a glance

| Phase | Outcome | Gate |
|---|---|---|
| P0 Box ready | every tool installed and booting on the GPU box | the tool check below passes |
| P1 Monorepo | bp split into `packages/*` and `apps/*`; the web app unchanged | all of bp's gates green, perf budget held, `apps/server` smoke |
| P2 Look-dev | style block locked; approved style frames for every state | owner-approved reference sheet |
| P3 Greybox slice | the table in VR from real data, hands, L0 to L2, lenses | 90 Hz on the box, text legible, owner walk-through |
| P4 Assets | lamp agent, table, pins, studio kit, city backdrop through the gated pipeline | every asset passes its gates and budget |
| P5 The loop | scan, packages, wave dispatch, jobs, voice and cards through Athena | end-to-end on Kettle and on a live product |
| P6 Beauty pass | light, materials, post, text layers | fidelity score passes |
| P7 Comfort and hardening | an hour-long session plan, failure states, docs | owner's one-hour session |

P2 can run beside P1 (different tools, same box, never at the same time as a UE VR session).

## P0 Box ready

Owner and agent, about a day.

- Confirm GPU (24 GB minimum, 32 GB preferred) and RAM (64 GB minimum) and record them in
  `docs/concepts/vr-light-table/machine.md`.
- UE 5.8.x (5.8.2 when this was written; Wolf read 5.8.3 on 2026-10-07, and the installed patch is used and
  recorded, wolf-plan R2) plus Meta XR v207 and the Interaction SDK, installed with mage-arena-vr's
  `apps/vr/tools/install-xr.ps1`, adapted to bp's `apps/vr`.
- Meta Quest Link (owner: account sign-in, developer mode on the headset).
- ComfyUI with FLUX.2 [klein] 9B, FLUX.2 [dev] and Qwen-Image; TRELLIS.2 with its own environment;
  Blender for headless finishing.
- The Athena daemon (`uv run athena serve`), voice installed through `/voice/install` (Kokoro, a
  Whisper model).
- A local vision-language model for grading, chosen by a ten-image bake-off (registry
  `generated-output-grading`).
- Re-check every model's licence and VRAM against its model card; record each in a vendor fact
  ledger (registry `generative-provider-routing`).

**Tool check:** one FLUX.2 [klein] image, one TRELLIS.2 GLB, the UE editor booting the empty
project with both Meta plugins loaded, the Meta XR Simulator or the headset showing a test level,
Athena speaking one line through `/voice/preview`.

## P1 The monorepo

Builder sessions in bp, gated by bp's own checks. Detail in `tech-stack.md` §3.

| Package | Work | Acceptance |
|---|---|---|
| WP1.1 workspace skeleton | npm workspaces; move the Next app to `apps/web` with no code change | `npm run build`, `npm run typecheck` and every `check:*` script green from the new root; `python scripts/perf.py` holds 60 fps at `?scale=4` |
| WP1.2 `packages/core` | move `src/lib/standard` and `src/lib/model` whole; split `src/lib/scan` into `core` (pure), `core/server` (Node) and `apps/web` (client) | `apps/web` imports only `@bp/core`; a check fails if `core` imports React, the DOM or Next |
| WP1.3 handlers out of routes | each `app/api/products/[slug]/*` route becomes a thin mount of a handler in `core/server`; the local-only and JSON-only guards move with them | route-guard and local-only checks green; the web app behaves the same (scan-demo smoke) |
| WP1.4 `apps/server` | a small Node HTTP server mounting the same handlers, plus SSE for `stream` | the scan-demo smoke runs against `apps/server` with the web app stopped |
| WP1.5 `packages/schema` | app-structure v3 schemas to TS types (as today) and to UE `USTRUCT` headers | a parity check fails when generated C++ is stale |

Stubs-first, as bp's last four sparks did: commit the workspace layout and compilable stubs before
the fan-out. Repo law applies: the Kettle-only tables move unchanged and are smoke-tested on a live
product.

### P1 closure measured 2026-10-20

Back-measured on master at `bc7cdfb` (the P1 closure commits are `bfc8e66`, `5efb461`, `624d15e` and
`bc7cdfb`), on Lynx (Windows ARM64) in a builder worktree whose `node_modules` is a junction to the
main checkout's. Nothing was fixed while measuring.

| Goal | Measure | Result | Evidence |
|---|---|---|---|
| 1 Check chain and perf | `npm run check` with 44 or more passed and 0 failed; `python scripts/perf.py` holds 60 fps at `?scale=4` | **check chain pass; perf p50 pass on a near-idle host** (6 of 6 runs p50 16.7 ms, re-measured 2026-10-21, see 'Milestone 1 idle re-measure'; p95 33.3 to 33.4 ms in 4 of 6 runs; the 2026-10-20 loaded reading failed) | Check chain: `node .../isolated-gate.mjs npm run check` (it replaces the worktree junction with `npm ci`), on `82a0743`: `45 passed, 0 failed, 0 skipped of 45`, typecheck included. Perf: `python scripts/perf.py` at `?scale=4`, three runs, p50 33.3, 16.7 and 33.2 ms (30, 60, 30 fps), p95 66.7, 66.6 and 50 ms. The 60 fps budget did not hold in these runs.**2026-10-21 ruling (operator):** budget is p50 only, at or under 16.7 ms at `?scale=4` on Lynx while idle of builds; p95 reported, not a budget line. Goal 1 passed on the `1443c3b` evidence (6 of 6 idle runs at p50 16.7 ms); `npm run check` 46 passed, 0 failed of 46 on `4ef913b` (isolated gate). |
| 2 `apps/server` serves Kettle | with no products file, GET `/api/products/kettle/structure` answers 200 with the wing count of `packages/core/data`, and a Kettle write answers 4xx | **pass** | `npm run check:server`: `ok GET /api/products/kettle/structure: 200 with no products file (13 wings)`, `ok kettle structure: wing count equals the data's 13`, `ok a Kettle write: 4xx`, `ok Kettle stays unlisted: GET /api/products still []`, `check-server: 14 passed, 0 failed` (`bfc8e66`) |
| 3 TS types decided and enforced | a dated decision in `tech-stack.md` §3 and `packages/schema/README.md`; `check:schema` fails on its seeded control | **pass** | `tech-stack.md` §3: *Decided 2026-10-20 (WP1.5 follow-up).*, with **TS types.** `types.ts` stays the hand-written source. `packages/schema/README.md`: `### Decision (2026-10-20): hand-written TS types, generated TS as a parity artifact`. `npm run check:schema`: `ok types.ts agrees with the generated types on every field and its optionality (29 shapes ...)` and `ok control: Rule.reason made optional in the generated types fails the parity` (`bc7cdfb`) |
| 4 The 5 unmapped fields carried | `check:schema` fails when a schema field is neither mapped in `BpSchema.h` nor carried by the generated fix-up, shown by its seeded control | **pass** | `npm run check:schema`: `ok every schema field is held in UE: 197 mapped, 5 renamed and 2 raw carried by FixUp` and `ok control: deleting Rule.short's fix-up fails the coverage`. The five fields are `short`, `default`, `$schema` (renamed) and `glyph`, `cross_refs` (raw JSON text, `BpSchemaFixups.h:101` for `cross_refs`). The read-through line: `FixUp carries AppStructure.Schema_ 2, LensManifest.Schema_ 23, LensManifest.Short_ 23, Rule.Short_ 132, Health.Default_ 23, Presentation.Glyph_ 23` (`624d15e`) |
| 5 Kettle source path | `scripts/kettle-to-v3.ts` and the provenance in `packages/core/data/kettle.app-structure.json` name `packages/core/data/kettle.json`; `check:data` green | **pass** | `scripts/kettle-to-v3.ts:1` and `:62` read `packages/core/data/kettle.json`. The data's `provenance` is `{"source":"packages/core/data/kettle.json","converter":"scripts/kettle-to-v3.ts"}`. `npm run check:data`: `ok: packages/core/data/kettle.app-structure.json and packages/core/data/kettle.events.jsonl reproduce exactly (as of 2026-10-08T09:00:00Z)` (`5efb461`) |

Milestone 1 reading (2026-10-20, later run): goals 2 to 5 pass; goal 1's check chain passes and its perf
measure **fails** on this host, see below. The measure is therefore not met by this reading; it is not
evidence that the engine regressed (see the caveats).

- **Check chain.** Run through `isolated-gate.mjs` (isolated `npm ci` in the worktree), not the junction:
  `45 passed, 0 failed, 0 skipped of 45` (the chain has grown from 44 to 45 checks). The earlier red
  typecheck was the junction's two copies of `@bp/core`. `npm run build` also fails with the junction
  (`Symlink node_modules could not be resolved`), so the build needed the isolated install too.
- **Perf budget (taken, not estimated).** Tools: `python -m pip install --user -r requirements-tools.txt`
  (playwright 1.64.0, Pillow 13.0.0) and `python -m playwright install chromium`, both exit 0 on Lynx;
  no repo file changed. Web app: `npm run build`, then `PORT=3217 npm start`; `BP_BASE=http://localhost:3217
  python scripts/perf.py` (gesture mode, default URL `/v/subtle?intro=0&scale=4`, viewport 1920x1080 @1,
  headless Chromium, 3 runs). Output lines:
  - `{"n": 61, "p50": 33.3, "p95": 66.7, "p99": 166.6, "max": 166.6, "rasters": 2, "engineFrames": 63, "lastRasterMs": 121.5}`
  - `{"n": 113, "p50": 16.7, "p95": 66.6, "p99": 133.3, "max": 133.3, "rasters": 5, "engineFrames": 112, "lastRasterMs": 116.1}`
  - `{"n": 115, "p50": 33.2, "p95": 50, "p99": 66.7, "max": 66.7, "rasters": 5, "engineFrames": 114, "lastRasterMs": 37.1}`

  Verdict: **fail** against 60 fps (p50 16.7 ms in 1 of 3 runs). Caveats: `docs/perf.md` took its baseline
  (p50 and p95 16.7 ms) on a different machine; this is a Windows ARM64 laptop-class host with a headless
  Chromium that probably rasterises in software, and other builders may have been running on it at the
  same time, so the load was not controlled. The run is a true reading of this host, not a verdict on the
  budget on the reference machine. Closing it needs a rerun on an idle machine with a GPU browser.
- Observation, not a gate: none of the 15 sample documents carries `cross_refs`, so the FixUp read-through
  never exercises its raw copy. Only the coverage check holds it. A sample or fixture containing
  `cross_refs` would close that.

### Milestone 1 idle re-measure (2026-10-21)

Retake of the loaded `d110384` perf reading, on Lynx (Windows ARM64), master tip `cd0272a`, in a builder worktree
with an isolated install (`isolated-gate.mjs`: the junction replaced by `npm ci`). No file other than this one changed.

- **Idle-state evidence.** Check used: `Get-CimInstance Win32_Process` filtered for node, chrome, chromium, claude,
  python and next, plus `Get-Counter '\Processor(_Total)\% Processor Time'`. Result: no other builder run (the
  only node processes were the fleet runner and this run's own await), no `next` server, no Playwright Chromium.
  **The host was not fully idle:** the operator's own session was up (desktop Chrome with about 20 renderer
  processes, several interactive `claude` sessions, a ComfyUI python and two uvicorn servers). Total CPU was 8 to 12 % before the build, 14.9 to 23.6 % when the server had just started (before set 1)
  and 13.1 to 15.2 % before set 2 (1 to 2 s samples). So this is a near-idle reading, not an exclusive one. Nothing of the operator's
  was stopped.
- **Build and serve.** `npm run build` (isolated install), `PORT=3217 npm start` (HTTP 200 on `/v/subtle`),
  `BP_BASE=http://localhost:3217 RUNS=3 python scripts/perf.py` (default `/v/subtle?intro=0&scale=4`, 1920x1080 @1,
  headless Chromium). Set 2 ran about 4 minutes after set 1 on the same server. Output lines, verbatim:
  - Set 1, run 1: `{"n": 159, "p50": 16.7, "p95": 33.4, "p99": 50.1, "max": 66.6, "rasters": 7, "engineFrames": 159, "lastRasterMs": 26.8}`
  - Set 1, run 2: `{"n": 175, "p50": 16.7, "p95": 16.8, "p99": 33.4, "max": 33.4, "rasters": 7, "engineFrames": 176, "lastRasterMs": 11.7}`
  - Set 1, run 3: `{"n": 178, "p50": 16.7, "p95": 16.8, "p99": 33.4, "max": 33.4, "rasters": 8, "engineFrames": 179, "lastRasterMs": 12.1}`
  - Set 2, run 1: `{"n": 144, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 100, "rasters": 6, "engineFrames": 144, "lastRasterMs": 49.2}`
  - Set 2, run 2: `{"n": 165, "p50": 16.7, "p95": 33.3, "p99": 33.4, "max": 33.4, "rasters": 7, "engineFrames": 165, "lastRasterMs": 22.8}`
  - Set 2, run 3: `{"n": 166, "p50": 16.7, "p95": 33.3, "p99": 33.5, "max": 50, "rasters": 8, "engineFrames": 166, "lastRasterMs": 17.5}`
- **Check chain.** `node .../isolated-gate.mjs npm run check`: `45 passed, 0 failed, 0 skipped of 45`.
- **Verdict.** Against 60 fps as the budget is written (p50 at or under 16.7 ms): **pass in all 6 runs, and overall**
  (p50 16.7 ms every run; the loaded `d110384` reading had it in 1 of 3 runs, with p50 33.3, 16.7 and 33.2 ms).
  Not a clean pass on the tail: p95 was 33.3 to 33.4 ms in 4 of 6 runs (16.8 ms in 2), and `docs/perf.md` reports p95
  16.7 ms on its reference machine; p99 was 33.4 to 66.7 ms and the worst frame 100 ms. The loaded reading's p95 was 50 to
  66.7 ms, so the tail also improved. Frame counts (144 to 178 against the 182 to 184 in `docs/perf.md`) are
  lower, meaning some gesture time is spent in frames longer than one tick. The idle reading shows the budget as
  written holds on this headless-Chromium Windows ARM64 host once it is not loaded; the earlier fail was load.
  Open: the host was near-idle and not exclusive, and p95 does not match the reference table, so whether the
  budget should also carry a p95 line, and whether it is to be measured on the reference machine, is left to the
  operator.
  **Resolved 2026-10-21 by the operator's ruling** (see 'Milestone 1 re-measure after L5.2', Ruling): the budget is p50 only,
  p95 is reported and is not a budget line, and it is measured on Lynx while idle of builds.

### Milestone 1 re-measure after L5.2 (2026-10-21, later)

Read-only re-measure on master `caa3231` (L5.2 is `61181b2`), Lynx (Windows ARM64), builder worktree with an isolated install
(`isolated-gate.mjs` replaced the junction by `npm ci`). Nothing was fixed; this entry is the only file changed.

- **Check chain.** Plain `npm run check` on the junction: `45 passed, 1 failed of 46`, the failure `typecheck` only (the junction's two
  copies of `@bp/core`, the known artefact). `node .../isolated-gate.mjs npm run check`: **`46 passed, 0 failed, 0 skipped of 46`**
  (the chain grew from 45 to 46 with `check:kettle-sim`, `PASS check:kettle-sim`). No FAIL by name.
- **Goal status.**

| Goal | Status | Evidence (this run) |
|---|---|---|
| 1 Check chain and perf | **done** (check chain 46/46, perf p50 16.7 ms in 5 of 6 runs, 4 of 4 clean) | see above and below |
| 1 Check chain and perf, ruling 2026-10-21 | **passed** (closed by the operator's ruling; 6 of 6 idle runs at p50 16.7 ms on `1443c3b`; `npm run check` 46/46 on `4ef913b`) | Ruling below |
| 2 `apps/server` serves Kettle | **done**, and wider than the goal | `check:server` 22 passed: `GET /api/products/kettle/structure: 200 with no products file (13 domains)`, `a Kettle write to /plan: 4xx`, `a Kettle scan write: 202, the hosted sim queues it`, `Kettle stream: 200 SSE, a snapshot first`, `Kettle stays unlisted`. `check:kettle-sim` 21 passed (stream snapshot, deltas, scans, waves, dispatch, `packages/core/data unchanged`). Host: `apps/server/src/kettle-sim.ts:1`, `main.ts:20` |
| 3 TS types decided and enforced | **done** | `tech-stack.md:89` `Decided 2026-10-20 (WP1.5 follow-up).`; `packages/schema/README.md:34` `Decision (2026-10-20): hand-written TS types, generated TS as a parity artifact`; `check:schema`: `ok ... types.ts agrees with the generated types ... (43 shapes ...)` and `ok control: Rule.reason made optional in the generated types fails the parity` (plus Proposal.title and ScanJob.exit_code controls) |
| 4 The 5 unmapped fields carried | **done** | `check:schema`: `ok every schema field is held in UE: 394 mapped, 5 renamed and 2 raw carried by FixUp`, `ok control: deleting Rule.short's fix-up fails the coverage` (counts grew with the wire schemas; the five fields are mapped or carried) |
| 5 Kettle source path | **done** | `scripts/kettle-to-v3.ts:1` and `:62` read `packages/core/data/kettle.json`; `:517` and `kettle.app-structure.json:8` provenance `source` is `packages/core/data/kettle.json`; `check:data`: `ok: ... reproduce exactly (as of 2026-10-08T09:00:00Z)` |

- **Perf at `?scale=4`.** `npm run build` (isolated install, exit 0), `PORT=3217 npm start`, `BP_BASE=http://localhost:3217 RUNS=1
  python scripts/perf.py`, default `/v/subtle?intro=0&scale=4`, 1920x1080 @1, headless Chromium. Before every run: ComfyUI
  `GET /queue` read-only (`queue_running` and `queue_pending` empty) and no `blender.exe`; the same check after each run. CPU 8 to 12 %
  before the first run. Output lines, verbatim:
  - Run 1 (idle before and after): `{"n": 149, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 100.1, "rasters": 6, "engineFrames": 149, "lastRasterMs": 49.9}`
  - Run 2 (idle before; **not clean**, a ComfyUI TRELLIS job was found running at the next check, so it probably started during this run): `{"n": 86, "p50": 33.3, "p95": 66.8, "p99": 166.7, "max": 166.7, "rasters": 3, "engineFrames": 86, "lastRasterMs": 72.3}`
  - Two further runs were skipped because the machine was busy. After waiting, four runs with idle checks before and after each:
  - Run 3: `{"n": 151, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 83.3, "rasters": 7, "engineFrames": 152, "lastRasterMs": 25}`
  - Run 4: `{"n": 151, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 83.4, "rasters": 6, "engineFrames": 151, "lastRasterMs": 34}`
  - Run 5: `{"n": 149, "p50": 16.7, "p95": 33.4, "p99": 83.3, "max": 83.4, "rasters": 6, "engineFrames": 149, "lastRasterMs": 36.7}`
  - Run 6: `{"n": 157, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 83.3, "rasters": 7, "engineFrames": 157, "lastRasterMs": 19.6}`

  Verdict: p50 16.7 ms in all 5 runs taken on a machine idle before and after (run 2, the only 33.3 ms, overlapped the start of
  a ComfyUI job and is not counted). This confirms the 2026-10-21 idle reading. The tail is as before: p95 33.4 ms every run
  against 16.7 ms in `docs/perf.md`; worst frame 83 to 100 ms. Caveat: the operator's own session (Chrome, claude, ComfyUI process
  loaded) stays up, so the host is idle of builds, not exclusive.
- **Still owed.** (1) The operator's call on whether the budget carries a p95 line and whether it is to be measured on the
  reference machine (open since the earlier idle entry). (2) No sample carries `cross_refs`, so the FixUp read-through never
  exercises its raw copy. (3) The junction makes plain `npm run check` fail `typecheck`; only the isolated gate is a true reading.

- **Ruling (operator, 2026-10-21): goal 1 passed.** The bp canvas perf budget is p50 only, at or under 16.7 ms at `?scale=4`, measured with `python scripts/perf.py` on Lynx while the machine is idle of builds. p95 is reported but is not a budget line. Goal 1 passes on the existing `1443c3b` evidence, 6 of 6 idle runs at p50 16.7 ms; no perf run was made for this entry (another builder was loading the CPU). Check chain, run for this entry: plain `npm run check` on the junction `45 passed, 1 failed of 46` (typecheck only, the known junction artefact); `node .../isolated-gate.mjs npm run check` on `4ef913b` (the security fixes `b1d8513`, `529f289`, `4ef913b` merged): **`46 passed, 0 failed, 0 skipped of 46`**. Earlier readings above are unchanged.

### P3-prep readings 2026-10-20

Back-measure of the milestone 2 goals (`f8c79e6`, `9f58e0a`, `fb937a3`), on `82a0743`, on Lynx
(Windows ARM64). **No Unreal Engine build was run on this machine; Lynx has no Unreal Engine and no
clang.** These readings cover the TypeScript and Node checks only.

> **Correction 2026-10-22 (Lynx).** "Lynx has no Unreal Engine" was true when this entry and the two below that repeat it
> (Milestone 2 on `947597c`, Milestones 1 and 2 on `b45f11a`) were written, and it is wrong from 2026-10-22: Unreal Engine
> **5.8.4-58902052** is installed, complete, at `C:/Program Files/Epic Games/UE_5.8` (`Engine/Build/Build.version`,
> `InstalledBuild.txt` and `UnrealEditor-Cmd.exe` present, dated 2026-10-22 15:03 to 15:05), and MSVC 14.44.35207 has been
> on the box since 2026-10-20. "No clang" still holds and is beside the point: a UE 5.8 editor build of BpLink ran on Lynx
> on 2026-10-22, emulated Hostx64 `cl.exe`, in a project synthesized outside the repo, and failed (as is: the predicted
> `BpSchema.generated.h` C1083; with E1's junction: past UHT, then `Misc/PlatformMisc.h` C1083). Evidence and the
> reproduction: [`machine.md`](machine.md). The readings in these entries are not re-graded.
> *Correction 2026-10-22 (evening): "and failed" is superseded; from `72e4fd4` and `ed94a65` that editor build exits 0
> (`machine.md` readings 3 to 7). Nothing has run the module.*
> *Correction 2026-10-22 (night): "Nothing has run the module" is superseded for the editor: in the same probe project the
> editor booted headless and BpLink printed the Kettle line (`machine.md` reading 14). The Win64 Game target links but
> `bp.exe` asserts before BpLink runs (reading 11). See 'WP3.1 re-graded after readings 12 to 14' below.*

| Goal | Result | Command and output line |
|---|---|---|
| `check:bplink` green on master | **pass** | `npm run check:bplink`: `check-bplink: 8 passed, 0 failed` |
| `check:schema` green | **pass** | `npm run check:schema`: `ok packages/schema/generated/ue/BpSchema.h is current (29 structs from 3 schemas)` and every control `ok` |
| `check:schema` fails on a stale `BpSchema.h` | **pass** | one line appended to `packages/schema/generated/ue/BpSchema.h`, then `npm run check:schema` exit 1: `FAIL  packages/schema/generated/ue/BpSchema.h is stale: run npm run schema:generate (first difference at line 910: committed "// seeded stale", fresh "")`. Reverted with `git checkout`; nothing seeded is committed. |
| `apps/vr` holds the BpLink Source and WP3.1.md says it is uncompiled | **pass** | `apps/vr/Source/BpLink/{BpLink.Build.cs,Private/BpLink.cpp,Public/BpLink.h}` exist. `apps/vr/WP3.1.md` line 3: `**Status: not yet run on any UE host.**`, and: `It has not been compiled against Unreal and has not been syntax-checked.` |
| WP3.1 acceptance (editor and Win64 build boot, a `BpLink` log line prints 13 wings) | **not evaluated** | needs a UE-equipped host; none here |

### Milestone 2 measured 2026-10-22

Milestone 2, 'P3 prepared on Lynx: apps/vr and BpLink planned against real data', back-measured on master `947597c`
(`947597cf56052c3d314873a0d123a87ea4353381`), on Lynx (Windows ARM64), in a builder worktree with an isolated install
(`isolated-gate.mjs`: the `node_modules` junction replaced by `npm ci`; the checks below ran on that install). Nothing was
fixed; this entry is the only file changed. **No Unreal Engine build was run: Lynx has no Unreal Engine.** Every reading
below is of TypeScript, Node and C++ source text.

| Goal | Measure | Result | Evidence |
|---|---|---|---|
| 1 BpLink contract smoke green against `apps/server` | a check run by `npm run check` makes BpLink's requests (structure, events, lens manifests, plan, stream) against a started `apps/server`, and fails on its seeds | **pass** | `node .../isolated-gate.mjs npm run check:bplink`: `check-bplink: 31 passed, 0 failed`, including `ok    structure: 8 lens manifests in structure.lenses (packages/core/data)`, `ok    plan: 5 wings, 13 rooms, 29 bays, 133 tiles (WING_DEFS and packages/core/data)`, `ok    events: the payload's JSONL has the data file's 566 lines, each valid JSON`, `ok    stream: 200 text/event-stream`. It starts `apps/server/src/main.ts --port 0` in an empty temp directory (`scripts/check-bplink.mjs:184`). Reached by `npm run check`: `package.json:49` `"check:bplink": "node scripts/check-bplink.mjs"`, and `scripts/check-all.mjs:25` takes every `check:*` key of `package.json`. Seeds (`scripts/check-bplink.mjs:169-170`), each exit 1: `BP_CHECK_BPLINK_SEED=schema:plan` → `FAIL  schema: the live /plan body conforms to plan-1  (/tiles/0/health/business must be equal to one of the allowed values)`, `check-bplink: 30 passed, 1 failed`; `BP_CHECK_BPLINK_SEED=plan` → `FAIL  plan: 5 wings, 13 rooms, 29 bays, 134 tiles (WING_DEFS and packages/core/data)  ({"wings":5,"rooms":13,"bays":29,"tiles":133})`, `check-bplink: 30 passed, 1 failed`; `BP_CHECK_BPLINK_SEED=events` → `FAIL  events: the payload's JSONL has the data file's 567 lines, each valid JSON  (566 lines, parsed=true)`, `check-bplink: 30 passed, 1 failed` |
| 2 `apps/vr` WP3.1 written as plan items with BpLink source | `apps/vr` holds the BpLink module source (C++ against `BpSchema.h`) and a WP3.1 checklist naming the UE-host steps; the README states no UE build has been run | **pass** | Source: `apps/vr/Source/BpLink/BpLink.Build.cs`, `Public/BpLink.h`, `Private/BpLink.cpp`. `Public/BpLink.h:6` `#include "BpSchema.h"`, `Private/BpLink.cpp:4` `#include "BpSchemaFixups.h"`, `BpLink.Build.cs:17-18` adds `packages/schema/generated/ue` to `PublicIncludePaths` (no copy). Checklist: `apps/vr/WP3.1.md:3` `**Status: not yet run on any UE host.**`, `:5` `Every step below is for a UE-equipped host; none has been run.`; steps 1 to 8 (`:13-20`) each carry an "Observable proof" cell. README: `apps/vr/README.md:15-16` `**The module source has not been compiled against Unreal, and it has not been syntax-checked either: the machine it was written on has no clang.** WP3.1 is not run on any UE host.`, and `:38` `**Not compiled.** Nothing in apps/vr has been compiled on this machine: Lynx has no Unreal Engine.` As strong as WP3.1.md's status line. |
| 3 `check:schema` parity stays green with BpLink in the tree | `npm run check:schema` green on master, and it fails on a seeded stale header | **fail** (green half passes; no carried control seeds a stale header) | `node .../isolated-gate.mjs`-installed tree, `npm run check:schema` exit 0: `ok    packages/schema/generated/ue/BpSchema.h is current (54 structs from 6 schemas)`, `ok    packages/schema/generated/ue/BpSchemaFixups.h is current (54 structs from 6 schemas)`, `ok    every schema field is held in UE: 394 mapped, 5 renamed and 2 raw carried by FixUp`, `ok    control: deleting Rule.short's fix-up fails the coverage`, `ok    control: Rule.reason made optional in the generated types fails the parity`, and every other line `ok`. **Gap in the measure:** none of the controls it carries seeds a stale committed header. The nearest, `ok    control: a field added to feature changes both outputs` (`packages/schema/generate.mjs:701-706`), proves the generator's output moves with the schema, not that the "is current" comparison (`generate.mjs:519-526`) reports a stale file. The only stale-header evidence is the manual seed of the 2026-10-20 P3-prep reading on `82a0743` (`FAIL  packages/schema/generated/ue/BpSchema.h is stale: ...`); it was not re-run here, because seeding means editing a repo file. |

- **Smallest fix for goal 3 (plan item, not a patch).** `packages/schema/generate.mjs`: lift the "is current" comparison
  (`:519-526`) into a function and add `control: a line appended to a fresh BpSchema.h is reported stale`, run in memory on
  `fresh.ue + '\n// seeded stale'`, so `check:schema` carries the stale-header proof itself.
- **Drift seen while reading goal 2 (recorded, not scored; the measure as written passes).** `apps/vr/WP3.1.md:32` still marks
  the plan request "(planned)" and `:33` pins `/stream` as `405`, while `check:bplink` now pins `plan: 200 JSON` and
  `stream: 200 text/event-stream`; step 7's proof (`:19`) expects `wings=5` and the `(405)` line, but `BpLink.cpp` makes no
  `/plan` request (only `/structure` `:86` and `/stream` `:119`) and logs `rooms=` (`:162`) and, for Kettle, the `streams (200)`
  line (`:125`). `apps/vr/README.md:38-39` says the structs "have only been syntax-checked with clang against stand-in
  declarations" next to `:15-16` "not ... syntax-checked either ... no clang". The WP3.1 host is named once for all steps
  ("a UE-equipped host", `:5`), not per step or as Wolf. Plan item: `apps/vr/WP3.1.md` rows `:19`, `:32`, `:33` brought to the
  server's current answers, and a WP3.1 step that adds the `/plan` request to `BpLink.cpp`; `apps/vr/README.md:38-39` reconciled
  with `:15-16`.
- **Owed next.** When the app is up, reconcile: milestone 2's three goal rows, which read open 0% while goals 1 and 2 pass
  here (and all three passed the 2026-10-20 P3-prep reading); goal 3 stays open on the stale-header control above. Milestone 1's
  goals 1 to 5 all passed (goal 1 by the 2026-10-21 ruling); any of those rows still reading open 0% is owed the same
  reconcile. The app's goal rows were not read in this run.

### Milestone 3 measured 2026-10-22

Milestone 3, 'P2 look-dev reference sheet approved', back-measured read-only on master `7f82b7b`
(`7f82b7b62cd5d67db3e5ea9d75cf2e2786c4cfb8`), on Lynx (Windows ARM64), in a builder worktree with an isolated install
(`isolated-gate.mjs`: the `node_modules` junction replaced by `npm ci`). Nothing was fixed and no image was generated;
this entry is the only file changed. Log counts were taken with a throwaway node script over `lookdev/log.jsonl`
(a slot counts as restated when the prompt contains its exact `style-block.json` text, every palette name and hex
included).

| Goal | Measure | Result | Evidence |
|---|---|---|---|
| 1 Style block as a pipeline-readable file | the `art-breakdown.md` style block exists as a file the image pipeline reads, and every recorded generation call restates it | **pass for every style-frame call; the 18 prop calls restate part of it, by design** | File: `lookdev/style-block.json`. Slot by slot against `art-breakdown.md:49-55` ('## The style block' table), string-compared: Technique, Subject treatment (`subject` in the json), Palette with roles (5 roles, every name and hex), Finish and Never all identical; **no slot differs**. The json adds one slot, `subjectLock`: `"the plan is the wings, rooms and fixtures of a software product, drawn as an architect's site plan; no buildings, no trees, no landscape, no readable text or labels"`, which the table does not carry (its `$comment`: added after the Director's 2026-10-20 test, where a generic prompt drew a campus). Read: `scripts/lookdev/leonardo.mjs:58` `const style = readJson(path.join(DIR, 'style-block.json'));`, and `composePrompt` (`:75-81`) appends `styleText()` (`:63-73`: technique, subject, subject lock, palette, finish, never) to every state prompt; `scripts/lookdev/check-leonardo.mjs:62` reads the same file. Log: **66 calls in `log.jsonl`; 48 restate the whole block (all 48 style-frame calls, `00-hero` to `08-lamp-speaking`); 18 do not**, each missing technique, subject and subjectLock and restating palette, finish and never: lines 49-52 `lamp-agent` A to D, 53-54 `studio-shelves` A, B, 55-56 `studio-desk-lamp` A, B, 57-58 `studio-mug` A, B, 59-60 `studio-drawing-tubes` A, B, 61-62 `studio-pinned-drawings` A, B, 63-66 `city-backdrop` A, B, A, A (MEDIUM). These are P4 prop calls through `composePropPrompt` (`leonardo.mjs:84-98`), which leaves the scene framing out on purpose (`art-breakdown.md:57` "Prop sheets for image-to-3D follow the registry's input gating, not the style block"; `check-leonardo.mjs:82` asserts `!text.includes(style.technique) && !text.includes(style.subjectLock)` for them). So "every recorded call restates it" holds for 48 of 66 as worded, and for every P2 call. Gate: reached by `npm run check`, not a hand-run: `package.json:99` `"check:leonardo": "node scripts/lookdev/check-leonardo.mjs"`, `scripts/check-all.mjs:26` takes every `check:*` key, and this run printed `PASS  check:leonardo              0.9s`. |
| 2 Style frames for every listed state from a trial matrix | one graded frame per state listed in `art-breakdown.md` | **pass on the lists that exist; the lists disagree in shape** | The two lists are not the same list. `lookdev/states.json` lists 9 states: `00-hero, 01-l0-rest, 02-room-lifted, 03-scan-sweeping, 04-pins-risen, 05-wrist-composer, 06-wave-running, 07-decision-asking, 08-lamp-speaking`. **`art-breakdown.md` lists no P2 state frames**: its only state list is the lamp agent's, `art-breakdown.md:23` "states from athena's events: resting, reading, working, asking, speaking". The eight P2 states are listed in this file ('## P2 Look-dev', second bullet), and they are `states.json`'s `01` to `08`; `00-hero` is the target frame. The lamp's five states each appear in a `states.json` text: resting (`01` "resting, bowed low and still"), reading (`02` "as if reading it"), working (`03`, `06`), asking (`07`), speaking (`08`). Picks: `picks.json` holds one pick per `states.json` id, **no state without a pick**, each file present in `lookdev/` and each `generationId` found in `log.jsonl`. Grades (0 to 3): `00-hero` 3, `01-l0-rest` **2**, `02-room-lifted` 3, `03-scan-sweeping` 3, `04-pins-risen` 3, `05-wrist-composer` 3, `06-wave-running` 3, `07-decision-asking` 3, `08-lamp-speaking` 3; the three alternates grade 2. Matrix, from `log.jsonl`: every state ran variants a and b at seeds 1001 and 2002 at LOW, then 1 or 2 MEDIUM draws (48 calls). The model axis has one value: every call is `openai/gpt-image-2.5-flare`. |
| 3 Owner approval of the reference sheet recorded | the sheet is delivered and the owner's approval is recorded with its date in `docs/concepts/vr-light-table` | **pass** | `reference-sheet.md:255` `Owner approval: approved 2026-10-20 by the owner (operator, terminal note 21:46Z), on the sheet as merged in 82a0743. From here on this sheet is the art bible for P3 to P6.`; mirrored in this file, '## P2 Look-dev', `2026-10-20: gate met.`. `git log 82a0743..HEAD -- docs/concepts/vr-light-table/reference-sheet.md`: `d2d3b0b docs(vr): close R7 with the lamp pick's proof, and stop listing the lamp design as open` and `49de2e7 docs(vr-light-table): record owner approval of the P2 reference sheet`, two commits, `13 insertions(+), 6 deletions(-)` in total. `49de2e7` changes one line, `Owner approval: pending` to the approval line. `d2d3b0b` rewrites the two bullets of '## Open questions for the owner' only: the lamp-design bullet becomes the owner's 2026-10-21 answer (option A, proof `apps/vr/ArtSource/lamp-agent/manifest.json`), and the scan-line-colour bullet stays open, reworded, with a pointer to risk R6 in `wolf-plan.md`. Since the approval, then, the sheet changed only by the approval record, the R7 lamp closure and a reworded, still-open scan-colour question, with no frame, pick, grade or spend line changed, so the approval still covers the sheet as it stands. `git diff --stat 82a0743 HEAD -- docs/concepts/vr-light-table/lookdev/` shows only `log.jsonl` (+18, the prop calls) and `props.json` (+65) changed, insertions only: no frame and no `picks.json` entry changed. |

- **Standing lines (taken from the records above, not re-scored).** Milestone 1: goals 2 to 5 passed in the 2026-10-20
  reading, and goal 1 passed by the operator's 2026-10-21 perf ruling; its check-chain half is now red for the inherited
  reason below. Milestone 2: both recommended items landed, `132ea13` for the stale-header control and `b7eda8d` and
  `7f82b7b` for the WP3.1 and `/plan` drift.
- **Milestone 2 goal 3 not re-scored here.** A second builder is extending `check:schema`'s controls in parallel this
  wake, so that reading belongs to the next wake.
- **Check chain (base's inherited state, not fixed).** `node .../isolated-gate.mjs npm run check`, run once, on `7f82b7b`,
  exit 1. Failure list, verbatim:

  ```
  FAIL  check:store-triage exited 0 but printed SKIP, which fails the suite (a skip is an unrun check):
    SKIP TRIAGE_FROM against store.mjs (lens-scan not installed here and nothing requires it; set BP_LENS_SCAN_DIR)

  FAIL  check:store-compare exited 0 but printed SKIP, which fails the suite (a skip is an unrun check):
    SKIP compareOf and packItems against store.mjs (lens-scan not installed here and nothing requires it; set BP_LENS_SCAN_DIR)

  FAIL  check:scan-jobs exited 0 but printed SKIP, which fails the suite (a skip is an unrun check):
    SKIP triage and release-create through store.mjs (lens-scan not installed, and nothing here requires it; set BP_LENS_SCAN_DIR)

  82 passed, 3 failed, 0 skipped of 85; 3 check(s) printed 3 SKIP line(s), 3 not opted out and failing: check:store-triage, check:store-compare, check:scan-jobs
  ```

  It matches the base's state in counts (82 passed, 3 failed of 85) and in the three names, and it holds no failure beyond
  them. Whether it is character-identical can't be said: the base was handed over as names and a summarised
  `SKIP ... (lens-scan not installed here; set BP_LENS_SCAN_DIR)`, not as a verbatim log, and the real SKIP texts differ
  from that summary and from each other (`check:scan-jobs` reads "not installed, and nothing here requires it"). The rule is
  `ed1e8d0`'s (a skip is an unrun check). `BP_LENS_SCAN_DIR` and `BP_REQUIRE_LENS_SCAN` were not set and nothing was
  opted out; the decision is the operator's. `typecheck` passed in the same run.
- **Perf not run.** The perf budget is p50 on a host idle of builds, and a second builder was running, so a loaded reading
  would be worthless; `scripts/perf.py` was not run. No UE build and no 90 Hz measurement were made.
- **Owed next.** Nothing here can write the app, so when it is up: milestone 3's three goal rows are owed done (goals 1 to 3
  pass above; goal 1 with the prop-call note, goal 2 with the list note); milestone 1's goals 2 to 5 are owed done and goal 1
  done by the ruling, with its check-chain half recorded red for the inherited lens-scan SKIPs; milestone 2's goals 1 and 2
  are owed done, and goal 3 waits for the next wake's reading after the parallel `check:schema` work. The app's goal rows
  were not read in this run.

### Milestones 1 and 2 back-measured 2026-10-22 (Lynx)

Read and run on Lynx (Windows ARM64) at branch base `b45f11a`, in a builder worktree whose `node_modules` is the junction
to the main checkout's (the checks below do not need the isolated install; `npm run typecheck` and the whole suite were not
run here). Nothing was fixed; this entry is the only file changed. **No Unreal Engine build was run: Lynx has no Unreal Engine
and no clang.** Every reading is of TypeScript, Node and C++ source text. Earlier entries above are unchanged and not
re-graded; this one adds what the tree demonstrates today, so a reader can tell finished from unstarted.

| Goal | Result | Command, printed numbers, commit |
|---|---|---|
| M1 goal 1 check chain and perf hold | **open, not measured this wake** | A parallel run is changing how the suite resolves lens-scan in a worktree, so a suite or perf number taken now would be stale on arrival. `npm run check` and `scripts/perf.py` were not run. Goal 1 stays open pending that run. |
| M1 goal 2 `apps/server` serves Kettle for P3 | **met** | `npm run check:server`: `ok    GET /api/products/kettle/structure: 200 with no products file (13 domains)`, `ok    kettle structure: domain count equals the data's 13`, `ok    GET /api/products/kettle/plan: 200 with 5 wings, 13 rooms, 29 bays, 133 tiles`, `ok    a Kettle write to /plan: 4xx`, `ok    Kettle stays unlisted: GET /api/products still []`; `check-server: 33 passed, 0 failed`. `npm run check:kettle-sim`: `ok    disk: packages/core/data unchanged (5 entries, hashes and mtimes)`, `ok    disk: the server's working directory unchanged (nothing written)`, `ok    self-proof: with a write planted mid-run the check fails on the disk rule (child exit 1)`, and the three listing controls (`an untouched copy lists the same`, `a file planted in the working directory is seen`, `a data file whose bytes changed (same size and mtime) is seen`); `check-kettle-sim: 25 passed, 0 failed`. The run prints ok lines, not the listings themselves: the before/after comparison is shown only by those pass lines. Landed: `4900874` (server and its check), `61181b2` (kettle-sim), `421e340` (`/plan`). |
| M1 goal 3 TS types decided and enforced | **met** | Decision: `packages/schema/README.md:43` `### Decision (2026-10-20): hand-written TS types, generated TS as a parity artifact`; `tech-stack.md:89` `*Decided 2026-10-20 (WP1.5 follow-up).*` (§3), with `types.ts` staying the hand-written source. `npm run check:schema` (exit 0): `ok    packages/core/src/standard/types.ts agrees with the generated types on every field, its optionality and its string enum, and packages/core/src/scan/ on the scan wire types and the plan (49 shapes and 48 enum fields ...; 0 known divergences allowed)`. The parity arm compares the hand-written types with `packages/schema/generated/ts/app-structure.ts`. Seeded control seen: `ok    control: Rule.reason made optional in the generated types fails the parity` (so it fails when inverted), with `Proposal.title`, `ScanJob.exit_code`, `waveEffort` and a wave status value as further controls. Landed `bc7cdfb`; guard on the generated TS staying unexported `780f6c0`. The controls run in memory inside the check; no repo file was edited to see one fail. |
| M1 goal 4 the 5 unmapped fields carried to UE | **met** | Same `check:schema` run: `ok    every schema field is held in UE: 394 mapped, 5 renamed and 2 raw carried by FixUp`, `ok    control: deleting Rule.short's fix-up fails the coverage`, and `ok    the UE mapping reads 17 documents and 571 events as FJsonObjectConverter + FixUp would (FixUp carries AppStructure.Schema_ 4, LensManifest.Schema_ 25, LensManifest.Short_ 24, Rule.Short_ 133, Health.Default_ 25, Presentation.Glyph_ 25)`. That line names Short_, Default_, Schema_ and Glyph_; the fifth carry, `CrossRefs_`, is named by `ok    the UE mapping carries cross_refs and both forms of glyph as FixUp would (Context.CrossRefs_ [{"to":"x","kind":"uses"},"y"]; Presentation.Glyph_ "pulse" or {"path":"M2 3h12v10H2z"})` and `ok    control: with the cross_refs copy or the glyph copy removed from FixUp, or cross_refs dropped from the document, the raw read-through fails (3 of 3)` (`b45f11a`, closing the 'no sample carries `cross_refs`' observation above). Stale-header controls (`132ea13`): `ok    control: packages/schema/generated/ue/BpSchema.h with one line mutated is reported stale at line 912` and the same for one line deleted, for `BpSchemaFixups.h` (line 92) and `generated/ts/app-structure.ts` (line 349). Landed `624d15e`. |
| M1 goal 5 Kettle source path correct | **met** | `scripts/kettle-to-v3.ts:1` and `:63` read `packages/core/data/kettle.json`; `:518` writes `provenance: { source: 'packages/core/data/kettle.json', converter: 'scripts/kettle-to-v3.ts' }`; `packages/core/data/kettle.app-structure.json:7-10` carries the same. The check that fails if they disagree is `npm run check:data` (`node scripts/kettle-to-v3.ts --check`, which regenerates and compares): `ok: packages/core/data/kettle.app-structure.json and packages/core/data/kettle.events.jsonl reproduce exactly from scripts/kettle-to-v3.ts (as of 2026-10-08T09:00:00Z)`. Not shown failing here; no disagreement was seeded. Landed `5efb461`. |
| M2 goal 1 BpLink contract smoke against `apps/server` | **met** | `npm run check:bplink`: `check-bplink: 35 passed, 0 failed`. It starts `apps/server` and makes GET `/structure` (`structure: 200 JSON`, `{ structure, events, rev }`, `13 domains`, `8 lens manifests`; events as the payload's JSONL, `566 lines`), GET `/plan` (`plan: 200 JSON`, `5 wings, 13 rooms, 29 bays, 133 tiles`), GET `/stream` (`stream: 200 text/event-stream`, the first event a snapshot) and GET `/waves`, and checks the live `/structure`, `/plan`, `/stream` snapshot and `/waves` bodies against their ajv schemas, each with a refusal control (`structure-envelope-1`, `plan-1`, `scan-wire-1`). What it pins from the C++ text: BpLink.cpp branches on the `/stream` status (200); the per-line events warning is capped with a "skipped N of M" summary; no `BindLambda` copies `Snapshot`; `StreamStatus` tells 5 outcomes apart; the domains count is logged as "rooms" (13); BpLink.cpp requests GET `.../plan`, parses it into `FBpPlan` and logs its wings/rooms/bays/tiles (`wings=5 rooms=13 bays=29 tiles=133`); `BpLink.Build.cs`'s include path resolves to `packages/schema/generated/ue` and holds `BpSchema.h` and `BpSchemaFixups.h`. Landed `f8c79e6`, `421e340`, `b7eda8d`. The seeds (`BP_CHECK_BPLINK_SEED`) were not re-run; see 'Milestone 2 measured 2026-10-22'. |
| M2 goal 2 `apps/vr` WP3.1 as plan items with BpLink source | **met as a plan; WP3.1 itself not run** | Source: `apps/vr/Source/BpLink/BpLink.Build.cs`, `Public/BpLink.h`, `Private/BpLink.cpp` (requests `/structure` `:86`, `/plan` `:118`, `/stream` `:143`). `apps/vr/WP3.1.md:3` `**Status: not yet run on any UE host.**`, `:4` `It has not been compiled against Unreal and has not been syntax-checked.`; steps 1 to 8 (`:13-20`) each with an observable proof; step 7 (`:19`) now expects the `/plan` line `wings=5 rooms=13 bays=29 tiles=133` and `:33` pins `/stream` as 200 (the drift noted in 'Milestone 2 measured' is reconciled by `b7eda8d` and `7f82b7b`). `apps/vr/README.md:16-17` `has not been syntax-checked either: no C++ compiler has read it (Lynx has no Unreal and no clang)` and `:39` `Nothing in apps/vr has been compiled or syntax-checked`, now consistent with each other. Only text was read; the WP3.1 acceptance (editor and Win64 build boot, a `BpLink` log line prints Kettle's 5 wings) is **not evaluated**: it needs a UE-equipped host. *Correction 2026-10-22 (night): "WP3.1 itself not run" is out of date. In the probe project outside the repo the Win64 Game target builds (`machine.md` readings 8 and 11) and the editor printed the Kettle line (reading 14); `bp.exe` asserts before BpLink (reading 11). Re-graded in 'WP3.1 re-graded after readings 12 to 14' below; this row's own verdict is not changed.* |
| M2 goal 3 `check:schema` parity stays green with BpLink in the tree | **met** | The `check:schema` run above, exit 0, with BpLink in the tree: `ok    packages/schema/generated/ue/BpSchema.h is current (54 structs from 6 schemas)`, the parity line (`0 known divergences allowed`) and every control `ok`. The gap recorded in 'Milestone 2 measured' (no carried control seeded a stale committed header) is closed by `132ea13`, whose controls print `... BpSchema.h with one line mutated is reported stale at line 912`. |

- **Goals this reading does not fully satisfy.** (1) M1 goal 1: open, not measured (above). (2) M2 goal 2 and the WP3.1 acceptance:
  the plan and source are in the tree, but nothing is built or run; open until a UE host runs WP3.1. *Correction
  2026-10-22 (night): "nothing is built or run" is out of date (readings 8, 11 and 14 in `machine.md`; see 'WP3.1
  re-graded after readings 12 to 14' below). WP3.1's acceptance is still open.* (3) M1 goal 2:
  `check:kettle-sim` proves "nothing written" by a before/after comparison it does not print as a listing, only as `ok` lines.
  (4) M1 goal 5: `check:data` was shown passing, not failing on a seeded disagreement. (5) M1 goal 3 and M2 goal 3: the
  inverted-parity and stale-header controls are the check's own in-memory controls, not a hand edit of a repo file.
- **Doc check.** No check in the repo reads this file's tables (the scripts that name `plan.md` only cite it in comments), so
  nothing validates this entry beyond reading it.
- **Owed next.** The app's goal rows still read open for the goals marked met above; this run cannot write the app.

### Milestone 1 goal 1 measured 2026-10-22 at `989b4a5` (Lynx)

Run on Lynx (Windows ARM64) from a builder worktree on master `989b4a5` (HEAD there, clean), whose `node_modules` is a
junction to the main checkout's. Nothing was fixed; this entry is the only file changed. Earlier entries are unchanged and
not re-graded. This reading covers the three CI-only commits `146e6ee`, `1abd5f2` and `989b4a5`, because it was taken at
`989b4a5`; gate.yml's CI run is not a substitute for this local reading.

| Goal | Result | Command, printed numbers, commit |
|---|---|---|
| M1 goal 1 check chain and perf hold after the P1 closure | **open: arm 1 red, arm 2 not measured** | Arm 1: `npm run check` printed `84 passed, 1 failed, 0 skipped of 85`, exit code 1. The one FAIL is `FAIL  typecheck                  12.8s`: 7 `error TS` lines, all in `scripts/check-waves.ts` (159, 160, 167, 173, 174), all the same shape, e.g. `Type 'import("C:/Users/kazda/.personas/headless-masters/worktrees/bp/04d71af7/packages/core/src/model/scan-sim").ScanSim' is not assignable to type 'import("C:/Users/kazda/kiro/bp/packages/core/src/model/scan-sim").ScanSim'. Types have separate declarations of a private property 'now'.` No check SKIPPED (0 skipped), and `check:lens-health`, `check:data`, `check:scan-wire`, `check:waves` and the other 83 passed, so the lens-scan resolution that blocked the 13:14Z reading did not skip anything. Arm 2: **not measured**. `python scripts/perf.py` exited 1 with `playwright._impl._errors.Error: Page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/v/subtle?intro=0&scale=4` (no server on port 3000). docs/perf.md prescribes `npm run build && npm start` first; `npm run build` exited 1 with `FATAL: An unexpected Turbopack error occurred` / `Symlink node_modules could not be resolved: the symlink target leaves the filesystem root or its parent directory could not be resolved`. No frame-time number was printed, so none is recorded against the p50 <= 16.7 ms budget. |

- **Why the red is a worktree reason, not graded as a code reading.** The typecheck errors name two different copies of
  `packages/core` (this worktree's and `C:/Users/kazda/kiro/bp/`'s), which exist only because `node_modules` is a junction
  into the main checkout (its workspace links resolve `packages/core` there). Both Turbopack's symlink error and the
  typecheck split come from that junction. That is my reading of the printed errors; it was not confirmed by running the same
  check in the main checkout, which this run does not touch. So the goal is not graded green and not graded as a code
  failure either.
- **Owed next.** Run `npm run check`, then `npm run build && npm start` and `python scripts/perf.py` (idle host, `?scale=4`),
  from a tree with its own `node_modules` (the main checkout, or the isolated install via `isolated-gate.mjs`). Goal 1
  stays open until both arms print numbers inside their budgets there.

### Milestone 1 goal 1 retaken 2026-10-22 at `087c8bb` (Lynx, isolated gate)

Retake of the `989b4a5` reading above, whose two arms were both blocked by the worktree's `node_modules` junction. Taken on Lynx
(Windows ARM64) in a builder worktree on master `087c8bbf309fbe2c7bae5af3f626087d7a159a65` (clean), with BOTH arms routed
through `node C:/Users/kazda/kiro/personas/.claude/master/bp/isolated-gate.mjs` (the junction link replaced by `npm ci`; no
package.json or lockfile touched). Nothing was fixed; this entry is the only file changed. Earlier entries are unchanged.

| Goal | Result | Command, printed numbers, commit |
|---|---|---|
| M1 goal 1 check chain and perf hold after the P1 closure | **met** (arm 2 carries a load caveat, below) | Arm 1: `node .../isolated-gate.mjs npm run check` printed `85 passed, 0 failed, 0 skipped of 85`, exit code 0 (typecheck included; 85 PASS lines, no FAIL). Arm 2: `node .../isolated-gate.mjs npm run build` exit 0, `PORT=3217 npm start` answered 200 on `/v/subtle?intro=0`, then `BP_BASE=http://localhost:3217 python scripts/perf.py` (gesture mode, `/v/subtle?intro=0&scale=4`, 3 runs), printing `gesture p50 16.70 ms over 3 run(s) ... budget 16.7 ms (docs/perf.md): ok`. |

- **Perf lines (verbatim, the final invocation).**
  - `{"n": 143, "p50": 16.7, "p95": 33.4, "p99": 66.7, "max": 99.9, "rasters": 6, "engineFrames": 143, "lastRasterMs": 60.1}`
  - `{"n": 170, "p50": 16.7, "p95": 33.3, "p99": 50, "max": 50.1, "rasters": 8, "engineFrames": 171, "lastRasterMs": 26.6}`
  - `{"n": 173, "p50": 16.7, "p95": 33.3, "p99": 33.4, "max": 33.4, "rasters": 8, "engineFrames": 174, "lastRasterMs": 12.7}`

  Three earlier invocations the same session (output cut to its last 3 lines, so one run line per invocation was not kept)
  each ended `gesture p50 16.70 ms ... ok`; their 6 kept lines all read p50 16.7, p95 33.4 (one 50). p95 is reported, not a
  budget line.
- **Host state, not idle.** Before measuring, the host was at 100% CPU (three samples) with free memory 32.5 GB of 67.1 GB.
  The load was other sessions' work, not builds of this repo: two `pytest` runs and about ten helper python processes from
  another session's scratchpad venv, a `grinex-portal` uvicorn on :8000, ComfyUI resident, Chrome and Edge. No build was
  running during the measurement (mine had finished). CPU sampled 28 to 30% right after the first three invocations and 13 to
  20% after the last; the 100% reading was before them. The operator's ruling asks for a host idle of builds; this one was
  idle of builds but not idle of other work. A p50 at the 60 fps floor under partial load is the harder case, and the
  loaded 2026-10-20 failure sat at 30 fps, so I read it as holding; a reader who wants a strictly quiet host should retake.
- **Skips inside passing checks.** The check output carries no 'not a full run' or skip text (grep of the whole log), and the
  tally is 0 skipped; check:scan-jobs printed nothing of that kind this time.
- **Claim versus reading.** `.github/workflows/gate.yml`'s commit message ('85 passed / 0 failed / 0 skipped verified
  locally') was a claim when it was written and the last worktree attempt got 84/1. This entry is the first local reproduction
  of 85/0/0, and it needed the isolated gate: plain `npm run check` in a worktree still hits the junction's two `@bp/core`.
  CI was not used as evidence.
- **What held it open before.** The 84/1 and the failed build were the junction (see the `989b4a5` entry), not the code;
  the goals-table row for Milestone 1 already reads passed, so its verdict is unchanged.

### WP3.1 re-graded after readings 12 to 14 (2026-10-22, night, Lynx)

Read on Lynx (Windows ARM64) at master `105184f`, from [`machine.md`](machine.md) readings 8 to 14; no Unreal and no
`scripts/uht-probe.mjs` was run for this entry. It re-grades WP3.1's acceptance only. Earlier entries are not re-graded;
the stale present-tense sentences in them, in `apps/vr/README.md` and in `apps/vr/WP3.1.md` carry dated corrections
pointing here, and `npm run check:claims` now fails if one of those files says BpLink is uncompiled or unrun without a
correction citing reading 14 in the same block.

| Goal | Result | Reading, printed line, commit |
|---|---|---|
| WP3.1 acceptance (the editor and a Win64 build boot; a `BpLink` log line prints Kettle's 5 wings) | **not met as a whole; the editor half and the line met** | Reading 14 (tree `bp-70637178-stream`, repo at `422d7fa`): `UnrealEditor-Cmd.exe ... bp.uproject -nullrhi -unattended ...` booted the probe project and BpLink printed `LogBpLink: BpLink: Kettle wings=5 [Foundations, Studio operations, Money, Members & reach, Frontier] rooms=13 bays=29 tiles=133 lenses=8 events=566 rev=80557561ddf0f4cd`, after `/structure` parsed into `FBpAppStructure` (all 8 lenses), `/plan` parsed into `FBpPlan` and `/stream` sent 200. The four figures equal the ones `check:bplink` measures from the live server in Node. The Win64 half: `bp Win64 Development` builds, exit 0 (readings 8 and 11), but `bp.exe` asserts (`Assertion failed: ReaderPos + Num <= ReaderSize`) before any `LogBpLink` line (reading 11, not re-run). Fixes on the way: `cd9dd65` (generator: `CopyRaw` no longer fails a bare-scalar glyph, reading 12's `CopyRaw at structure.lenses[0].manifest.presentation.glyph`), `422d7fa` (BpLink finishes on `/stream`'s 200 instead of waiting for the SSE body to end, reading 13's silence). |
| WP3.1 steps 1 to 8 | **per step, in `apps/vr/WP3.1.md`** | 1 not run; 2 in the probe's form (`--port 0`); 3 not run (no `.uproject` in `apps/vr`); 4 not run as written (the probe's synthesized `.uproject` carries the entry); 5 proved with the junction; 6 both targets exit 0 in the probe; 7 the editor at startup proved, the Win64 game not reached, `BpLink.Fetch` not run; 8 not run. |
| M2 goal 2 `apps/vr` WP3.1 as plan items with BpLink source | **met (unchanged)** | The goal is the plan and the source, and its row above stands. Only that row's "WP3.1 itself not run" is out of date, and it carries a dated correction. |

- **What this does NOT establish** (from `machine.md`'s list after reading 14, which is authoritative). Milestone 4 goal 1
  is not met as a whole: reading 14 covers the editor half and the log line only. The Win64 Game build still does not boot
  in this project shape (reading 11). The headset, Meta XR v207, the Interaction SDK and the Quest 3 over Link are
  untouched. No frame time of any kind was measured, and `-nullrhi` measures none; R5, R1 and R4 are not touched. The text
  `CopyRaw` left in `Glyph_` and `CrossRefs_` was never read, only the return value. How the `/stream` 200 completed after
  the cancel is a reading of the log, not a measurement. `BpLink.Fetch`, a second fetch and the 405 branch were not run.
- **Where it ran.** A project synthesized outside the repo by `scripts/uht-probe.mjs`; `apps/vr` still has no
  `.uproject`. Lynx readings on emulated x64 (MSVC 14.44.35207, UE 5.8.4 x64 binaries on ARM64); none say anything about
  Wolf.
- **Owed next.** A Win64 Game boot (a cooked or staged `bp.exe`, or a project shape the Game target boots in), then Meta XR
  v207 and the Interaction SDK on a UE host that has them; R1 (the junction) is the operator's.

## P2 Look-dev

Image work on the GPU box, judged by the owner.

- Write the style block (`art-breakdown.md`) as a file the pipeline reads; restate it in every call.
- Produce style frames for each state, from the same first-person pose as the target: L0 at rest;
  a room lifted (L2 to L3); a scan sweeping; pins risen; the wrist composer with three packages; a
  wave running; a decision card asking; the lamp speaking. Use a trial matrix (seed, model, prompt
  variant) rather than one-off draws.
- Make concept sheets for each prop in P4: one object per sheet on a plain background, canonical
  pose, no text on the object.
- **Gate:** the owner approves one reference sheet: the target plus the state frames. It becomes
  the art bible for P3 to P6.
  - 2026-10-20: gate met. The owner approved `reference-sheet.md` (82a0743), which is now the art
    bible for P3 to P6. The prop concept sheets for P4 (the third bullet above) are still open and
    were not part of this gate.

## P3 Greybox slice

The first VR session on real data, ugly on purpose.

| Package | Work | Acceptance |
|---|---|---|
| WP3.1 `apps/vr` project | UE 5.8 project with Meta XR v207 and the Interaction SDK; a `BpLink` module (HTTP + SSE client over `apps/server`, structs from `packages/schema`) | the editor and a Win64 build boot; a `BpLink` log line prints Kettle's 5 wings from `GET /api/products/kettle/plan`. *2026-10-22 (night, Lynx): **not met**. Editor half and the line met in the probe project outside the repo (`machine.md` reading 14); the Win64 Game build links but does not boot (reading 11); no Meta XR v207, no Interaction SDK. See 'WP3.1 re-graded after readings 12 to 14'.* |
| WP3.2 the table | table mesh, a blueprint paper material, wing footprints into a render target from `core`'s layout | the 5 wings, from the plan endpoint's layout, in chronological order, readable names, at a natural standing height |
| WP3.3 volumes | instanced rooms and fixtures; edge-glow material v0 | 13 rooms, 29 bays and 133 fixtures (the web's tiles) as instances; one draw call per instance batch |
| WP3.4 hands and zoom | Meta hand tracking; point to highlight; pinch-pull lifts a room (L0 to L2); a breadcrumb and a way back | every level reachable and reversible; tracking loss handled as a state (registry `hand-tracked-timing-windows`) |
| WP3.5 lenses | lens switch on the wrist; a lens changes what places say, never where they are | all 8 lenses switch without moving any wing |
| WP3.6 render spike | forward + MSAA versus deferred + Lumen at Quest 3 resolution | frame time for both on the box, recorded in `machine.md`; forward chosen unless Lumen fits 11.1 ms |

- 2026-10-21: VR uses the web's levels, wing, room, bay and tile, and reads them from the derived-plan endpoint
  (`GET /api/products/[slug]/plan`, schema `plan-1`), never from `structure.domains`. Kettle is 5 wings (`WING_DEFS`
  groups its 13 domains), 13 rooms (domains), 29 bays (capabilities) and 133 tiles. This replaces the earlier "13 wings",
  "29 rooms" and "133 fixtures" counts in WP3.1 to WP3.3. Reason and evidence: `docs/architecture-review-2026-10-21.md`,
  findings 1 and 2 ("one logic, three channels", tech-stack.md section 3). The endpoint is not on master yet: it needs a
  two-line change in `packages/core/src/model/aggregates.ts` first (see the delivery report), because apps/server runs
  core under Node's type stripping.

**Gate:** 90 Hz on the box on the forward path with the full Kettle plan; text legible at the
standing distance (an angular-size floor recorded as the VR equivalent of bp's 12 px); the owner
walks it.

## P4 Assets through the gated pipeline

Each asset passes the same chain, from the registry: concept sheet, then an input gate
(reconstructability), then TRELLIS.2, then mesh acceptance, scale normalisation, finishing (low-poly
retopology and UV, PBR baked), a poly budget, and finally UE import through the editor MCP.

| Asset | Budget (triangles, guide) | Notes |
|---|---|---|
| Lamp agent: head, two-joint arm, base | 30k | rigged for look-at and state poses; the head carries an emissive slot |
| Light table frame | 10k | the glass and paper stay procedural |
| Survey pin | 500, instanced | the tag is a text layer |
| Studio kit (shelves, desk lamp, mug, drawing tubes, pinned drawings) | 80k total | static, baked light |
| City backdrop | n/a | a FLUX.2 [klein] matte panorama behind the windows |
| Materials: vellum, blueprint paper, brushed aluminium, warm wood | n/a | tiling textures checked for seams (registry `tiling-texture-acceptance`) |

Scene budget for the whole slice, borrowed from mage-arena's numbers as a start and re-measured in
P3: 150 draw calls and 350k visible triangles or fewer.

**Gate:** every asset carries its gate results; nothing imported without them.

### P4 Lynx-side back-measure (2026-10-22)

Read-only run on master `a9bfe8f`; no code, script, asset or manifest changed. Every figure is read from the
committed `manifest.json` files or from git, except the two check runs.

**Checks.** Both through `isolated-gate.mjs`.

- `npm run check`: 69 passed, 0 failed, 0 skipped of 69. One passing check, `check:scan-jobs`, skipped part of its own
  work, so the gate's own words are "a green run here is NOT a full run".
- `npm run check:art`: exit 0, 14 asset folders, 59.6 MB committed under ArtSource, 0 violations, all five seeded
  controls failed as expected.

**Hand-off folders.** "Gates" is the manifest's `gates.*.pass` values (materials carry a sixth gate, `tiling`).
"Trailer" is `git log --format=%(trailers:key=Host)` on the `lynx_commit`; `git cat-file -e` resolved every commit.

| Folder | Class | Tris | Budget (plan.md P4) | Gates | `lynx_commit` | Resolves | `Host: Lynx` trailer |
|---|---|---|---|---|---|---|---|
| lamp-agent | character-prop | 26,035 | 30,000 | 5 of 5 true | `2dad0ad` | yes | no |
| light-table-frame | prop-hero | 586 | 10,000 | 5 of 5 true | `60db9b6` | yes | no |
| survey-pin | prop-instanced | 420 | 500 | 5 of 5 true | `474731d` | yes | no (see gap 1) |
| fixture-kit | prop-instanced-kit | 452 in five meshes, largest 164 | 300 per mesh (manifest `budget_tris`; not in the P4 table) | 5 of 5 true | `474731d` | yes | no (see gap 1) |
| studio-shelves | set-dressing | 1,092 | 24,000 (manifest) of 80,000 kit | 5 of 5 true | `ca2fa38` | yes | no |
| studio-desk-lamp | set-dressing | 1,296 | 16,000 (manifest) of 80,000 kit | 5 of 5 true | `dea248c` | yes | no |
| studio-mug | set-dressing | 1,008 | 8,000 (manifest) of 80,000 kit | 5 of 5 true | `a74a648` | yes | no |
| studio-drawing-tubes | set-dressing | 2,976 | 20,000 (manifest) of 80,000 kit | 5 of 5 true | `13018a0` | yes | no |
| studio-pinned-drawings | set-dressing | 804 | 12,000 (manifest) of 80,000 kit | 5 of 5 true | `6d95122` | yes | no |
| city-backdrop | backdrop-matte | 72 | n/a (manifest 200) | 5 of 5 true | `47230b9` | yes | no |
| mat-vellum | material | n/a | n/a | 6 of 6 true | `b31a649` | yes | no |
| mat-blueprint-paper | material | n/a | n/a | 6 of 6 true | `b31a649` | yes | no |
| mat-brushed-aluminium | material | n/a | n/a | 6 of 6 true | `b31a649` | yes | no |
| mat-warm-wood | material | n/a | n/a | 6 of 6 true | `b31a649` | yes | no |

Studio kit total: 7,176 of 80,000 tris (1,092 + 1,296 + 1,008 + 2,976 + 804). Every measured count is inside its budget.

**Scene total (Lynx side).** Summed triangles of the assets that have a count: 26,035 (lamp) + 586 (frame) + 420 (pin)
+ 452 (fixture kit) + 7,176 (studio kit) + 72 (backdrop) = **34,741**, against the 350k scene budget (about 9.9%).
This is the sum of the source meshes with each counted once. Instancing, the number of pins or tiles placed, the
in-scene triangle count and the draw calls (150 budget) are Wolf's import reading (`import` block, `stat rhi`) and are
not measured here. No manifest carries an `import` block yet.

**Gaps found** (recorded, not fixed):

1. No `lynx_commit` carries a parsed `Host: Lynx` trailer. Across the 14 folders there are 10 distinct commits
   (`2dad0ad`, `60db9b6`, `474731d`, `ca2fa38`, `dea248c`, `a74a648`, `13018a0`, `6d95122`, `47230b9`, `b31a649`);
   `%(trailers:key=Host)` is empty for all ten. Only `474731d` has a `Host: Lynx` line at all, in its body, followed
   by the `Co-Authored-By` line, so git does not read it as a trailer. The close-out commit `f7c6f1d` has the same shape
   (body line, not a parsed trailer). The plan.md P4 proof "committed with `Host: Lynx`" is therefore met in the
   strict sense by none of them. The wolf-plan L4.1 line that said the close-out commits do carry it is corrected there.
2. No null `lynx_commit` and no failing gate: none found.
3. Every one of the 14 assets has a dated line in wolf-plan.md L4.1: none missing.

## P5 The loop: scan, wave, voice

| Package | Work | Acceptance |
|---|---|---|
| WP5.1 scan | sweep gesture or voice starts `scan.place` for the pointed scope; the scan line runs; pins rise from the stream | findings appear at their fixtures; a sweep that matches no scope is a visible reject, not a silent no-op |
| WP5.2 packages | pinch a pin onto the wrist to add it to a package; set model (Sonnet 5.5 or Opus 5.5) and effort (low to xhigh) | the server's wave contract (`waves.ts`) holds; one finding in one draft wave at most |
| WP5.3 dispatch and jobs | dispatch is athena's GATED `wave.dispatch`; jobs run, at most 3 at once; progress on the wrist and as light in the room being built | a wave dispatched by voice and by pinch both land as the same jobs |
| WP5.4 Athena host | `apps/server` registers bp's tools (`tech-stack.md` §4); UE streams the microphone to `/voice`; the lamp's states follow athena's events; cards come from `/decisions` | the seam smoke: a spoken "dispatch the wave" files a card, "approve" runs exactly that wave once |
| WP5.5 live product | run the loop on a live product listed in `bp.products.local.json`, not only Kettle | the live smoke passes (repo law: fixture-green never proves the store seam) |

**Gate:** the full loop by voice alone and by hand alone, on Kettle and on a live product.

2026-10-21, operator decision: `apps/server` hosts the Kettle swarm and scan simulations (SwarmSim, ScanSim) behind the same routes, in memory and never written to disk; the P5 gate above stays as written.

## P6 Beauty pass

- Light: the table as the key light on hands and props; warm practicals against the cool table;
  haze and bloom tuned against text legibility.
- Materials: edge glow v1, glass, paper fibre, the lamp's warm head; pins and tags.
- Text: every readable string a compositor layer or a high-resolution widget.
- Capture the fidelity frame through pof's `capture_viewport` from the target's pose and score it
  per `art-breakdown.md`.

**Gate:** the fidelity pass (no element below 2; the six key elements at 3), owner's verdict in
the headset, and the P3 frame-time gate still held.

## P7 Comfort and hardening

- Comfort plan: no artificial locomotion (you stand, the table moves under your hands); a seated
  mode that lowers the table; snap re-centre; reduced motion honoured; a session timer and a rest
  pose.
- Failure states drawn on purpose: the server down, Athena down, voice not ready, tracking lost,
  a job failed, the token cap reached.
- Docs: `apps/vr/README.md` (run it), bp's `README.md` channel table, a registry lead for what
  tethered VR and generated props taught.

**Gate:** the owner works one hour in it and wants to come back.

## Risks

| Risk | Mitigation |
|---|---|
| The monorepo move breaks Next or Turbopack resolution | WP1.1 moves nothing but the layout and proves build and perf first |
| Translucent volumes in VR sort badly and cost overdraw | edge-glow with very low face opacity, dithered where needed; measured in WP3.6 |
| The concept's bounce light needs Lumen, which does not fit 90 Hz | fake with rect lights and baked bounce; Lumen only if the fidelity score needs it and the frame fits |
| TRELLIS.2 props need heavy cleanup | input gating before generation; a manual finishing pass budgeted per asset |
| FLUX.2 [dev] licence | look-dev only; shipped textures and backdrops use FLUX.2 [klein] or Qwen-Image |
| Athena's host model assumes a web page | settle the non-browser host in WP5.4 with a smoke across the real seam before any card UI |
| Generation and VR fight for the GPU | one at a time, by rule; the agent session checks no UE VR session is running before a generation job |
| Hand tracking misses fast pinches | judge from motion onset; controllers as a fallback input |

## Owner-only steps

- Buy or confirm the GPU workstation and the Quest 3 with a Link cable.
- Sign in to Meta Quest Link and enable developer mode.
- Accept model licences where a download asks for it.
- Approve the P2 reference sheet, walk P3, judge P6, and do the P7 hour.
