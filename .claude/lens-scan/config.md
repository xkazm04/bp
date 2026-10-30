---
context_map: context-map.json
standard_lenses: C:/Users/kazda/kiro/bp/docs/standard/lenses
project_slug: bp
project_name: "bp"
default_lens: development
bundle_stats: .ai/lens-scan/bundle-stats.json
---

# lens-scan overlay - written by /adopt-bp 1.3.0 on 2026-10-25

The product tree in .ai/lens-scan/app-structure.json is declared (provenance.product_tree: adopt-bp): lens-scan
phase 1 merges into it and never remaps contexts 1:1. standard_lenses is a machine path to the bp checkout.

Building and serving any checkout (main, builder worktree, lens-scan pack worktree) goes through ONE script,
`node scripts/lens-serve.mjs build | start --port <n> | where`. A worktree's `node_modules` is a link (or per-entry
junctions) into the main checkout and Turbopack refuses to resolve outside its root; `turbopack.root` is derived from
`apps/web/next.config.ts`'s own location, so `next build <worktree>/apps/web` run from the main checkout fails the same
way ("Could not find the Next.js package", measured 2026-10-30), and `next build --webpack` has no loader for
`packages/core/data/kettle.events.jsonl`. lens-serve.mjs therefore mirrors the checkout's own files (tracked and
untracked-not-ignored, `apps/vr/` left out) into `%TEMP%/bp-lens/<checkout>-<hash>/` with a real copy of the main
`node_modules` whose `@bp/*` junctions point into the mirror, runs the real Turbopack `next build apps/web` there
(`NEXT_DIST_DIR=.next-lens`), and puts back the tsconfig include the build appends. The main checkout (a real
`node_modules`) builds in place. A build whose inputs (apps/web, apps/server, packages, root manifests) are unchanged is
skipped. First build of a new worktree: ~20 s mirror + ~45 s build; then ~45 s per changed build.

Python scripts here (lens-probe.py, harness.py, perf.py) need Playwright, which lives in the user site-packages on
this machine: run them as `python <script>`, not `python -I` (it hides the user site).

## Gates

An execute pack runs these in its pack worktree, verbatim, and keeps the commit only when all pass:

- `npm run typecheck` - bp's builder gate; green prints nothing past the npm banner.
- `npm run check` - every `check:*` script plus typecheck and validate:structure; green ends `N passed, 0 failed`
  with no SKIP line (a SKIP fails the suite by design).
- `npm run check:lens-health` - already inside `npm run check`; run it on its own when the pack touches a lens
  manifest or `docs/standard/lenses`, to read its lines.
- `node scripts/lens-serve.mjs build` - the production build, standing in for `npm run build` (which cannot run in a
  pack worktree, see above): the same `next build apps/web` with Turbopack, on this worktree's source in its mirror.
  Exit 0 and a last stderr line `{"lens-serve":{"step":"build",...}}` (or `"skipped":"unchanged since the last
  build"`). Required whenever the pack touches `apps/web`, `apps/server`, `packages/` or a root manifest.
- When the pack touches rendering or the engine (`apps/web/src/engine`, `apps/web/src/variants`, the canvas paths
  of `packages/core`): `node scripts/lens-serve.mjs start --port 4773` in the background, then
  `BP_BASE=http://127.0.0.1:4773 python scripts/perf.py` (60 fps budget at `?scale=4`, docs/perf.md; exit 0), then
  `node scripts/kill-port.mjs 4773`.
- Never `apps/vr` in a pack: the UE build runs in the main checkout only (spark overlay, Repo law).

## Harness

The production build of the checkout under test, on a private port, sample data (Kettle). `ready_timeout` covers a
first mirror and build. Shots at 1600x800, where bp's UI scale is exactly 1 (docs/blueprint-ui.md). The scan menu
opens only on a right-click on the plan and harness steps are text clicks, so scan-launcher is driven by the probe
alone. Features with no UI of their own are `unscreenable "n/a: ..."` with the reason.

command: node scripts/lens-serve.mjs start --port 4771
url: http://127.0.0.1:4771
ready: /
ready_timeout: 600
nav_timeout: 60
click_timeout: 20
sizes: 1600x800
themes: dark, light
theme: query ?theme=
features:
  blueprint-canvas: route /?intro=0
  workspace-and-projects: steps goto /?intro=0 > click "Kettle (sample)"
  feature-detail-sheet: route /?intro=0#open=failed-payment-dunning
  timeline-replay: steps goto /?intro=0 > click "▴TIMELINET"
  legend-variant-framework: route /v/subtle?intro=0
  bold-and-shaped-legends: route /v/bold?intro=0
  ledger-triage-and-waves: route /?intro=0#page=ledger
  release-train-decisions: steps goto /?intro=0#page=ledger > click "In packs 8"
  release-item-comparison: steps goto /?intro=0#page=ledger > click "In packs 8" > click "Show a refused booking in the class sheet with a retry"
  release-packaging: route /?intro=0#page=ledger&lv=release
  scan-launcher: unscreenable "the scan menu opens only on a right-click on the plan (no key or text button reaches it); lens-probe.py drives it"
  agent-workbench: steps goto /?intro=0 > click "Agents"
  domain-model-and-simulation: unscreenable "n/a: the model and simulators have no screen; they render through blueprint-canvas and timeline-replay"
  product-rest-api: unscreenable "n/a: JSON routes, no page"
  standalone-server: unscreenable "n/a: node:http API for the VR client, no page"
  structure-schema-and-lens-catalog: unscreenable "n/a: schemas and generated types"
  kettle-sample-data: unscreenable "n/a: generators and fixtures; the sample renders through every UI feature"
  vr-blueprint-link: unscreenable "n/a: an Unreal module; its captures are PoF capture_viewport in PIE (spark overlay)"
  vr-art-and-lookdev: unscreenable "n/a: art manifests and lookdev images, no web page"
  quality-gate: unscreenable "n/a: the npm run check CLI"
  visual-fidelity-contracts: unscreenable "n/a: a CLI that drives the UI; no UI of its own"

The `In packs 8` and row-title clicks read the Kettle sample's pack table, which is deterministic; a change to the
sample's packs moves them (the click then fails and the feature is reported unscreenable, never shot elsewhere).

## Probes

One script, `scripts/lens-probe.py` (`--list` prints every feature, its interaction and the metrics that apply; the
docstring says how each metric is read). `--serve 4772` builds when stale, serves the checkout on 4772, refuses a port
that already answers, and kills its server at the end. It prints one JSON line per metric
(`{"metric","feature","samples","unit","n"}`): 20 samples for startupMs and interactionP95Ms (each startup sample a
fresh context with an empty cache), every rAF delta of the path for frameP95Ms, 5 passes for the per-pass totals.
**Every entry of one feature is the same command: run it once and take each metric's line.** A full feature run takes
1.5 to 3 minutes. Chromium is headless (as scripts/perf.py), 1600x800, the Kettle sample.

frameP95Ms sits on the display interval (16.7 ms) on a smooth path: it is a floor, not a reading. Propose against
blockingMs, jankFrames or interactionP95Ms unless the frames are actually slow (they are on the canvas features at
`?scale=4` and during a lens switch, which docs/perf.md accepts as a ~30 fps spring). idleWakeups is never ~0 on
the plan: the simulated swarm's live clock keeps it ticking by design (~60/s); the ledger and timeline settle.
startupMs exists only for features with a route of their own; a panel opened by a click on the plan (timeline,
pack table, compare, scan menu, Agents) has the plan's cold start plus its interaction, both read elsewhere.

blueprint-canvas startupMs: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas interactionP95Ms: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas frameP95Ms: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas blockingMs: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas jankFrames: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas idleWakeups: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
blueprint-canvas memoryMb: python scripts/lens-probe.py --feature blueprint-canvas --serve 4772
workspace-and-projects startupMs: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
workspace-and-projects interactionP95Ms: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
workspace-and-projects blockingMs: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
workspace-and-projects jankFrames: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
workspace-and-projects idleWakeups: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
workspace-and-projects memoryMb: python scripts/lens-probe.py --feature workspace-and-projects --serve 4772
feature-detail-sheet startupMs: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet interactionP95Ms: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet frameP95Ms: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet blockingMs: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet jankFrames: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet idleWakeups: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
feature-detail-sheet memoryMb: python scripts/lens-probe.py --feature feature-detail-sheet --serve 4772
timeline-replay interactionP95Ms: python scripts/lens-probe.py --feature timeline-replay --serve 4772
timeline-replay frameP95Ms: python scripts/lens-probe.py --feature timeline-replay --serve 4772
timeline-replay blockingMs: python scripts/lens-probe.py --feature timeline-replay --serve 4772
timeline-replay jankFrames: python scripts/lens-probe.py --feature timeline-replay --serve 4772
timeline-replay idleWakeups: python scripts/lens-probe.py --feature timeline-replay --serve 4772
timeline-replay memoryMb: python scripts/lens-probe.py --feature timeline-replay --serve 4772
legend-variant-framework startupMs: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework interactionP95Ms: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework frameP95Ms: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework blockingMs: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework jankFrames: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework idleWakeups: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
legend-variant-framework memoryMb: python scripts/lens-probe.py --feature legend-variant-framework --serve 4772
bold-and-shaped-legends startupMs: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends interactionP95Ms: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends frameP95Ms: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends blockingMs: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends jankFrames: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends idleWakeups: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
bold-and-shaped-legends memoryMb: python scripts/lens-probe.py --feature bold-and-shaped-legends --serve 4772
ledger-triage-and-waves startupMs: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves interactionP95Ms: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves frameP95Ms: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves blockingMs: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves jankFrames: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves idleWakeups: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
ledger-triage-and-waves memoryMb: python scripts/lens-probe.py --feature ledger-triage-and-waves --serve 4772
release-train-decisions interactionP95Ms: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-train-decisions frameP95Ms: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-train-decisions blockingMs: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-train-decisions jankFrames: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-train-decisions idleWakeups: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-train-decisions memoryMb: python scripts/lens-probe.py --feature release-train-decisions --serve 4772
release-item-comparison interactionP95Ms: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-item-comparison frameP95Ms: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-item-comparison blockingMs: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-item-comparison jankFrames: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-item-comparison idleWakeups: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-item-comparison memoryMb: python scripts/lens-probe.py --feature release-item-comparison --serve 4772
release-packaging startupMs: python scripts/lens-probe.py --feature release-packaging --serve 4772
release-packaging interactionP95Ms: python scripts/lens-probe.py --feature release-packaging --serve 4772
release-packaging blockingMs: python scripts/lens-probe.py --feature release-packaging --serve 4772
release-packaging jankFrames: python scripts/lens-probe.py --feature release-packaging --serve 4772
release-packaging idleWakeups: python scripts/lens-probe.py --feature release-packaging --serve 4772
release-packaging memoryMb: python scripts/lens-probe.py --feature release-packaging --serve 4772
scan-launcher interactionP95Ms: python scripts/lens-probe.py --feature scan-launcher --serve 4772
scan-launcher blockingMs: python scripts/lens-probe.py --feature scan-launcher --serve 4772
scan-launcher jankFrames: python scripts/lens-probe.py --feature scan-launcher --serve 4772
scan-launcher idleWakeups: python scripts/lens-probe.py --feature scan-launcher --serve 4772
scan-launcher memoryMb: python scripts/lens-probe.py --feature scan-launcher --serve 4772
agent-workbench interactionP95Ms: python scripts/lens-probe.py --feature agent-workbench --serve 4772
agent-workbench blockingMs: python scripts/lens-probe.py --feature agent-workbench --serve 4772
agent-workbench jankFrames: python scripts/lens-probe.py --feature agent-workbench --serve 4772
agent-workbench idleWakeups: python scripts/lens-probe.py --feature agent-workbench --serve 4772
agent-workbench memoryMb: python scripts/lens-probe.py --feature agent-workbench --serve 4772

No probe metric applies to: domain-model-and-simulation (no screen of its own; it runs inside the plan, read through
blueprint-canvas and timeline-replay), product-rest-api and standalone-server (JSON over HTTP: no frame or paint, and
request latency is not in the probe catalogue), structure-schema-and-lens-catalog, kettle-sample-data and
vr-art-and-lookdev (data, nothing runs), quality-gate and visual-fidelity-contracts (CLIs), vr-blueprint-link (an
Unreal module: its frame cost is the CSV profiler's draw delta, spark overlay Gates, not a browser probe).

## Bundle stats

`bundle_stats` (frontmatter) is written by `node scripts/lens-bundle-stats.mjs` (add `--structure <main
checkout>/.ai/lens-scan/app-structure.json` in a pack worktree, which has no structure of its own). It builds when
stale, runs Turbopack's analyzer over the production build (`next analyze -o apps/web`, same config and dist dir),
and attributes every client chunk part of route `/` (first-load and async chunks; JS, CSS and emitted media) to the
features whose context `file_paths` own its source file; the parts sum to Next's own route summary or the script
fails. It writes `.ai/lens-scan/bundle-stats.json` and prints one `measure` row per feature
(`{"feature","metric":"bundleKb","value","unit":"KB","method":"static","evidence"}`); KB = 1024 bytes minified,
before transfer compression (the file also holds `compressedKb`). A part no feature owns is `unowned` (react-dom,
Next's polyfills, the Kettle data JSON under `packages/core/data/`, fonts, and `components/crossing/*`, which no
context claims), never spread over the features; a file two features share counts for both (`shared_files`).
Features with no client bytes get no row (unmeasured, never 0).

## Skill improvement log

- 2026-10-30: a pack worktree's whole-`node_modules` junction carries `@bp/*` symlinks back to the main checkout, so `tsc` in the worktree sees two copies of every core type and fails; junction each top-level entry instead and point `@bp/{core,schema,server,web}` at the worktree's own packages. `npm run build` cannot run there at all (Turbopack refuses a linked `node_modules`, and `next build --webpack` has no `.jsonl` loader), so with no `## Gates` here the execute gate was `npm run check` per pack head, the build unrun. Playwright for drive/shot scripts lives in the user site-packages: run them without `python -I`.
- 2026-10-30: a pack worktree cannot serve the web app at all (Turbopack: "Could not find the Next.js package" through the junctions; `--webpack`: no `.jsonl` loader for kettle.events.jsonl). For an item that changes only a drive/check script, serve `npx next dev apps/web -p <free port>` from the main checkout when it sits at the pack's base sha, and say so in the commit. drive.py's athena half needs a registered `athena` product, which bp.products.local.json does not list: drive the Kettle half by importing `drive.kettle`.
