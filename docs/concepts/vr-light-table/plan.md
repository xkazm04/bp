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
- UE 5.8.2 plus Meta XR v207 and the Interaction SDK, installed with mage-arena-vr's
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

| Goal | Result | Command and output line |
|---|---|---|
| `check:bplink` green on master | **pass** | `npm run check:bplink`: `check-bplink: 8 passed, 0 failed` |
| `check:schema` green | **pass** | `npm run check:schema`: `ok packages/schema/generated/ue/BpSchema.h is current (29 structs from 3 schemas)` and every control `ok` |
| `check:schema` fails on a stale `BpSchema.h` | **pass** | one line appended to `packages/schema/generated/ue/BpSchema.h`, then `npm run check:schema` exit 1: `FAIL  packages/schema/generated/ue/BpSchema.h is stale: run npm run schema:generate (first difference at line 910: committed "// seeded stale", fresh "")`. Reverted with `git checkout`; nothing seeded is committed. |
| `apps/vr` holds the BpLink Source and WP3.1.md says it is uncompiled | **pass** | `apps/vr/Source/BpLink/{BpLink.Build.cs,Private/BpLink.cpp,Public/BpLink.h}` exist. `apps/vr/WP3.1.md` line 3: `**Status: not yet run on any UE host.**`, and: `It has not been compiled against Unreal and has not been syntax-checked.` |
| WP3.1 acceptance (editor and Win64 build boot, a `BpLink` log line prints 13 wings) | **not evaluated** | needs a UE-equipped host; none here |

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
| WP3.1 `apps/vr` project | UE 5.8 project with Meta XR v207 and the Interaction SDK; a `BpLink` module (HTTP + SSE client over `apps/server`, structs from `packages/schema`) | the editor and a Win64 build boot; a `BpLink` log line prints Kettle's 5 wings from `GET /api/products/kettle/plan` |
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
