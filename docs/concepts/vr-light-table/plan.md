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
| 1 Check chain and perf | `npm run check` with 44 or more passed and 0 failed; `python scripts/perf.py` holds 60 fps at `?scale=4` | **not evaluated** (check chain red only in this worktree, perf not run) | `npm run check`: `43 passed, 1 failed, 0 skipped of 44`. The one failure is `typecheck`: `scripts/check-waves.ts(164,102): error TS2322: Type 'import(".../worktrees/bp/03dafca1/packages/core/src/model/scan-sim").ScanSim' is not assignable to type 'import("C:/Users/kazda/kiro/bp/packages/core/src/model/scan-sim").ScanSim'. Types have separate declarations of a private property 'now'.` The junction resolves `@bp/core` to the main checkout's copy, so two copies of one class meet. That is the worktree layout, not the code (`isolated-gate.mjs` exists for this case). Perf: `python scripts/perf.py` exits 1 with `ModuleNotFoundError: No module named 'playwright'`, and nothing listens on :3000. No perf number was taken. |
| 2 `apps/server` serves Kettle | with no products file, GET `/api/products/kettle/structure` answers 200 with the wing count of `packages/core/data`, and a Kettle write answers 4xx | **pass** | `npm run check:server`: `ok GET /api/products/kettle/structure: 200 with no products file (13 wings)`, `ok kettle structure: wing count equals the data's 13`, `ok a Kettle write: 4xx`, `ok Kettle stays unlisted: GET /api/products still []`, `check-server: 14 passed, 0 failed` (`bfc8e66`) |
| 3 TS types decided and enforced | a dated decision in `tech-stack.md` §3 and `packages/schema/README.md`; `check:schema` fails on its seeded control | **pass** | `tech-stack.md` §3: *Decided 2026-10-20 (WP1.5 follow-up).*, with **TS types.** `types.ts` stays the hand-written source. `packages/schema/README.md`: `### Decision (2026-10-20): hand-written TS types, generated TS as a parity artifact`. `npm run check:schema`: `ok types.ts agrees with the generated types on every field and its optionality (29 shapes ...)` and `ok control: Rule.reason made optional in the generated types fails the parity` (`bc7cdfb`) |
| 4 The 5 unmapped fields carried | `check:schema` fails when a schema field is neither mapped in `BpSchema.h` nor carried by the generated fix-up, shown by its seeded control | **pass** | `npm run check:schema`: `ok every schema field is held in UE: 197 mapped, 5 renamed and 2 raw carried by FixUp` and `ok control: deleting Rule.short's fix-up fails the coverage`. The five fields are `short`, `default`, `$schema` (renamed) and `glyph`, `cross_refs` (raw JSON text, `BpSchemaFixups.h:101` for `cross_refs`). The read-through line: `FixUp carries AppStructure.Schema_ 2, LensManifest.Schema_ 23, LensManifest.Short_ 23, Rule.Short_ 132, Health.Default_ 23, Presentation.Glyph_ 23` (`624d15e`) |
| 5 Kettle source path | `scripts/kettle-to-v3.ts` and the provenance in `packages/core/data/kettle.app-structure.json` name `packages/core/data/kettle.json`; `check:data` green | **pass** | `scripts/kettle-to-v3.ts:1` and `:62` read `packages/core/data/kettle.json`. The data's `provenance` is `{"source":"packages/core/data/kettle.json","converter":"scripts/kettle-to-v3.ts"}`. `npm run check:data`: `ok: packages/core/data/kettle.app-structure.json and packages/core/data/kettle.events.jsonl reproduce exactly (as of 2026-10-08T09:00:00Z)` (`5efb461`) |

Milestone 1 is not closed yet. Goals 2 to 5 pass. Goal 1 has two gaps:

- **Check chain green from a clean install.** In the junctioned worktree, `typecheck` is red only
  because `@bp/core` resolves to two copies. To close it, run `npm run check` once on master in a
  tree with its own install: the merge gate's `isolated-gate.mjs`, or the main checkout with no
  uncommitted work. It needs `44 passed, 0 failed`. The builder did not replace the junction,
  because the brief rules out reinstalling.
- **Perf budget.** Not evaluated: `playwright` (listed in `requirements-tools.txt`) is not installed
  on Lynx, and no web app is serving on :3000. To close it, the operator installs the Python tools
  from `requirements-tools.txt` (a tool change, so it is the operator's decision), starts the web
  app, and records the fps that `python scripts/perf.py` reports at `?scale=4` against the 60 fps
  budget.
- Observation, not a gate: none of the 15 sample documents carries `cross_refs`, so the FixUp read-through
  never exercises its raw copy. Only the coverage check holds it. A sample or fixture containing
  `cross_refs` would close that.

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

## P3 Greybox slice

The first VR session on real data, ugly on purpose.

| Package | Work | Acceptance |
|---|---|---|
| WP3.1 `apps/vr` project | UE 5.8 project with Meta XR v207 and the Interaction SDK; a `BpLink` module (HTTP + SSE client over `apps/server`, structs from `packages/schema`) | the editor and a Win64 build boot; a `BpLink` log line prints Kettle's 13 wings from the server |
| WP3.2 the table | table mesh, a blueprint paper material, wing footprints into a render target from `core`'s layout | the 13 wings in chronological order, readable names, at a natural standing height |
| WP3.3 volumes | instanced rooms and fixtures; edge-glow material v0 | 29 rooms and 133 fixtures as instances; one draw call per instance batch |
| WP3.4 hands and zoom | Meta hand tracking; point to highlight; pinch-pull lifts a room (L0 to L2); a breadcrumb and a way back | every level reachable and reversible; tracking loss handled as a state (registry `hand-tracked-timing-windows`) |
| WP3.5 lenses | lens switch on the wrist; a lens changes what places say, never where they are | all 8 lenses switch without moving any wing |
| WP3.6 render spike | forward + MSAA versus deferred + Lumen at Quest 3 resolution | frame time for both on the box, recorded in `machine.md`; forward chosen unless Lumen fits 11.1 ms |

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

## P5 The loop: scan, wave, voice

| Package | Work | Acceptance |
|---|---|---|
| WP5.1 scan | sweep gesture or voice starts `scan.place` for the pointed scope; the scan line runs; pins rise from the stream | findings appear at their fixtures; a sweep that matches no scope is a visible reject, not a silent no-op |
| WP5.2 packages | pinch a pin onto the wrist to add it to a package; set model (Sonnet 5.5 or Opus 5.5) and effort (low to xhigh) | the server's wave contract (`waves.ts`) holds; one finding in one draft wave at most |
| WP5.3 dispatch and jobs | dispatch is athena's GATED `wave.dispatch`; jobs run, at most 3 at once; progress on the wrist and as light in the room being built | a wave dispatched by voice and by pinch both land as the same jobs |
| WP5.4 Athena host | `apps/server` registers bp's tools (`tech-stack.md` §4); UE streams the microphone to `/voice`; the lamp's states follow athena's events; cards come from `/decisions` | the seam smoke: a spoken "dispatch the wave" files a card, "approve" runs exactly that wave once |
| WP5.5 live product | run the loop on a live product listed in `bp.products.local.json`, not only Kettle | the live smoke passes (repo law: fixture-green never proves the store seam) |

**Gate:** the full loop by voice alone and by hand alone, on Kettle and on a live product.

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
