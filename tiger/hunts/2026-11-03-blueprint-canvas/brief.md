# Territory dossier - the Blueprint canvas

Area: `apps/web/src/engine/**`, `apps/web/src/components/{BlueprintApp,FeatureSheet,Legend}.tsx`,
`apps/web/src/components/{sheet,page,timeline}/`, `apps/web/src/variants/` (read-only context:
`packages/core/src/model`, `packages/core/src/standard`, `docs/blueprint-ui.md`, `docs/perf.md`).

Commit: 466353624d - written 2026-11-03

## Why this area

The README's first sentence is this area: "A canvas that draws a whole software product as an
architect's drawing set: domains as wings, capabilities as rooms, and features as fixtures. Stage
and health are readable at any zoom, and each person reads the plan through their own lens"
(`README.md:3-5`). Everything else in bp (the swarm, the ledger, releases, the VR light table)
is drawn on top of this plan or reached from it. The hunt over 180 days ranked its two
context-map groups 1st (Blueprint Workspace UI, heat 63, 351 commits) and 8th (Canvas Engine,
heat 27, 115 commits) (`tiger.mjs hunt` at 4663536); the bp product tree lists
`blueprint-canvas` as a major live feature with `feature-detail-sheet`, `timeline-replay` and
`legend-variant-framework` as its standard companions (`.ai/lens-scan/app-structure.json`).
The swarm-steer workbench was hunted on 2026-10-18 and is out of scope here
(`tiger/hunts.md`). The owner picked this area for this hunt.

## Who uses it, for what

- **The owner / a product lead** opens `/` to see the whole product at once: where each
  feature stands (stage is the fill), where trouble is (flags, revision clouds), and what the
  swarm is doing. Done well = "the plan answers before I ask", readable at site zoom like a map.
- **A lens reader** (security, cost, design, performance, quality... and custom manifest lenses
  such as `com.kettle.cost`) presses a digit or picks a person on "Whose desk"
  (`rail/wide/view.tsx:21-27,57`; `packages/core/src/model/lens.ts:32-36`) and reads the same
  plan through that lens: marks, patterns, flags, "what clears it" on the feature page.
- **A live-product user**: a real repo scanned by `/lens-scan` is opened with `?product=<slug>`
  (`BlueprintApp.tsx:234,251`); proposals wait for Approve / Decline; metric history,
  screenshots (run A vs B) and the latest scan run appear on the feature page and strip.
- **A history reader** scrubs the timeline to ask "what did this look like on that week".
- Downstream readers of the same model: the Personas app (Release card links), the VR light
  table (Unreal client fetching plan + stream from the standalone server).

## What it does today

**Data in.** `BlueprintApp` reads `?scale`, `?lenses`, `?product` after mount
(`BlueprintApp.tsx:234`). Live: `buildLiveModel(structure, events, scan…)` (`:251`); otherwise the
Kettle sample (132 features) as a ~770 KB lazy chunk (`:48-54,252`). Later scans are fed in place
via `applyScan` + `engine.feed`, no rebuild (`:265-269`); a lens-set change rebuilds the engine
but keeps the camera (`:244,256`). A live map that changes *shape* needs a reload (`:281`).

**Zoom ladder.** Site (Campus/Building at `?scale>1`) → Wing → Room → Bay → Feature
(`engine/Engine.ts:262`). Ribbon↔tile blend is a smoothstep `lod()` between 1.1 and 1.65×KB1
(`Engine.ts:261`); at L0/L1 a bay is a ribbon strip, from L2 features are tiles
(`render/plan.ts:1,493-499`); titles grow toward 2× as the camera fits a bay (`plan.ts:337`).
Opening a feature (L4) lays a full page over the dimmed plan without moving the camera
(`Engine.ts:732-753`; `components/FeatureSheet.tsx:2-5,50,224-232`).

**Rendering.** Static raster (grid, table top, decor, buildings, labels) (`Engine.ts:503-506`)
cached with a 0.22 margin; gestures only transform the bitmap; re-raster on settle (140 ms),
×1.5 zoom bucket, blend drift 0.2 or content change; caps 12 MP cache / 6.5 MP screen, DPR≤2
(`render/static-cache.ts:1-20`; `Engine.ts:450-461`). Sim ticks repaint only changed rects, and
`render/simwatch.ts:1-6` records which sim values the raster painted. Dynamic layers in order:
overlays, order/rule zones, targets, heat, agents, pulses, pins, tracks, breaches, preview,
focus, answer, blockers, releases, scans, flags, lasso (`Engine.ts:471-483`). Draw-only-when-dirty,
~30 fps when only sim/scan moves (`Engine.ts:380,423`); frame loop allocates nothing
(`Engine.ts:137-139`; `render/glyphs.ts:7-13`). Text never below 12 px, measured widths cached
(`engine/text.ts:1-60`).

**Hit testing.** One layer list gives draw order and hit order (`render/hits.ts:1-9`); a moved
camera re-runs target layers against a no-op context (`Engine.ts:59-64,492-501`); 44 px touch
floor on coarse pointers (`hits.ts:8`).

**The lens contract.** A variant implements `LensExpression` {channels, fallback, composeGeneral,
expandedRect, spring} (`engine/lens/contract.ts:107-133`); a channel paints `shape`, `marks`,
`content`, `aggregate`, optional `decor` and accent (`contract.ts:90-105`). Hard rule: a lens never
recolours a node - fill is always lifecycle stage (`contract.ts:11-13`). Mixing: presence,
expansion `x = mix·(1−general)`, dominance; switches always pass through General with
interruptible springs (`lens/mix.ts:22-53,81-91`). A throwing channel is caught, logged once and
listed (`plan.ts:88-97,191-215`). The adopted *subtle* variant draws every lens from its manifest
(`variants/subtle/expression.ts:202-220`); custom glyph SVG paths are capped at 2048 chars and
parsed only by Path2D (`render/lens-glyph.ts:1-22`). Unmeasured features get a "?" texture
(`render/patterns.ts:1-6`; rule in `engine/lens/unknown.ts`).

**What the plan shows.** Flags per bad/watch lens at 32-44 px fixed screen size, merging into
counted clusters (`render/flags.ts:1-14`); survey marks for agents, RFI pennants for questions,
revision clouds for trouble (`render/glyphs.ts:1-2`); answer tracks on live tiles
(`render/tracks.ts:1-4`); scan marching outlines and sweeps (`render/scans.ts:1-6`); key-plan
minimap (`render/keyplan.ts:1-12`); per-domain line illustrations (`render/illo.ts:1-2`).

**Navigation.** `/` Find: combobox, 8 ranked results + "N more" (`rail/panels.tsx:17-74`;
`packages/core/src/model/search.ts:30-47`). Keys (`Engine.ts:1323-1375`): 1-9 lens, +/- and
up/down zoom, left/right walk rooms in a ring (`:695-703`), Enter opens, Esc steps back through a
14-step chain (`:669-694`), B blast radius, G GA readiness, `[ ]` week, T timeline, U undo.
Browser history records a place only after a 600 ms rest; back/forward restore full state
(`Engine.ts:1388-1425,1477-1502`). The canvas is `role="application"` with an aria-label listing
keys (`BlueprintApp.tsx:326-327`).

**The feature page.** Tabs: General + one per enabled lens; switching a tab switches the plan's
lens (`FeatureSheet.tsx:73-109`). General: per-lens headline tiles, swarm, Business,
depends-on / used-by, activity, revisions as time-travel links (`page/General.tsx:1-6`); "Lives in
code" (`page/CodeTree.tsx:1-10`). A lens tab picks blocks by data, never by lens id: headline,
health + reason, evidence, **"what clears it"** (verified steps to target per rule), metric rows
with sparklines, KPIs, decisions, Screens (`page/LensTab.tsx:1-13`; `docs/blueprint-ui.md:677-707`).
Modal focus trap, focus returns (`FeatureSheet.tsx:36-47,188-201`). Phone: one scrolling document
(`sheet/SheetBody.tsx:1-8,149-234`).

**Timeline.** Weekly revisions from the append-only `context-map.events.jsonl` (types `stage`,
`lens-health`, `kpi-threshold`, `milestone`, `feature-added/archived`, `lens-enabled/disabled`)
(`docs/standard/app-structure-v3.md:651-672`); `stageAt` replays stage on a date
(`packages/core/src/standard/present.ts:84-90`). A 28 px strip; hover previews a week's changes
without travelling (`timeline/Strip.tsx:1-5`; `timeline/changes.ts:1-41`). Kettle's simulated hour
is forward-only (`timeline/scrub.ts:36-38`). Live products show the latest scan run instead
(`timeline/run.ts:1-48`).

**What it does unusually well** (evolve these):
1. *Spatial stability + honest lenses*: lenses change what places say, never where they are or
   their fill; any manifest lens draws with zero code (`contract.ts:11-13`; `subtle/expression.ts:202-220`).
2. *Honest time*: past dates read "Not recorded for that date" instead of today's value, via one
   presenter (`recordAsOf` / `lensAsOf`), guarded by `check:timeview` (`docs/blueprint-ui.md:690-702`).
3. *"What clears it"*: the page turns a bad reading into verified steps to target.
4. *Speed at scale*: gesture p50 16.7 ms at `?scale=4` (528 features, 168 agents), engine work
   ~1.1 ms median (`docs/perf.md:3-17`, reading 2026-10-09).
5. *Live without rebuild*: scans stream into the existing model.

## Measured state

All numbers are labelled with their source; none was re-run for this dossier (perf.py needs a
running server and is not in the gate).

- Gate: `npm run check` (`scripts/check-all.mjs`) runs typecheck + every `check:*`; canvas-related
  ones: `check:camera`, `render-units`, `engine-harness`, `engine-copy`, `engine-store`,
  `engine-lines`, `overlays`, `chrome`, `deep-link`, `sim-undo`, `theme-colors`, `tokens`, `claims`,
  `sheet-rows`, `screens-strip`, `timeview`, `timeline-{keys,size,scrub,run,slider,changes}`, and
  the `variant-*` checks. Screenshots (`scripts/shots.py`) and perf (`scripts/perf.py`) are manual.
- Perf budgets (operator ruling 2026-10-21, `docs/perf.md:163-166`, enforced by `scripts/perf.py:26,39`):
  gesture p50 ≤ 16.7 ms at `?scale=4`; lens-switch tween p50 ceilings 33.3 ms (home/building/tile),
  50 ms (room).
- Readings (`docs/perf.md`): 2026-10-09 gesture p50 = p95 = 16.7 ms; 2026-10-12 the lens switch is
  "a ~30 fps spring" (tween p50 33.3 ms home, 50 ms room) because it re-rasters every frame;
  2026-10-28 the glass look raised static raster 1.5-2.0× (home 14.1-14.5 → 28.4-29.7 ms, room
  34.8-41.2 → 52.3-62.9 ms), gesture p50 held 16.7 ms but p99 rose to 67-83 ms.
- Lens-scan readings (`.ai/lens-scan/app-structure.json`, generated 2026-10-31):
  blueprint-canvas a11y "partial", standardsPct 50, frameP95Ms 50, interactionP95Ms 166.8,
  jankFrames 19, startupMs 1056.6, untestedPaths 12, testRatioPct 0, dupSites 7;
  feature-detail-sheet frameP95 33.3, startupMs 1739.8, unsafeSinks 1;
  timeline-replay frameP95 33.3, jankFrames 11; legend-variant-framework frameP95 50, jankFrames 42.
- Standards verdicts (`.ai/lens-scan/scan.db` coverage, judged 2026-10-30): blueprint-canvas
  **deviation** `canvas-graph/canvas-accessibility` - "`Engine.ts:694-702` walk() only flies the
  camera … a keyboard walk over the canvas announces nothing"; conformant `render-budget`,
  `direct-manipulation`. Timeline: 8 conformant. `.ai/registry-map.json`: every canvas pair
  "unknown".
- Usage, error rates, user counts: not measured.

## Recent history

134 commits touch the area between 2026-10-20 and 2026-11-02 (earlier history sits under
pre-monorepo paths, `871efa6`). No reverts.
- Honesty/correctness sweeps: variants stop printing unknowns as measurements (`84847e8`,
  `00b9b24`, `f297b7f`); hit tests read what the frame drew (`b3d2144`, `7754df2`).
- Variant split: `/` ships only subtle, shaped/bold lazy (`d0e31af`); legend became a "finder"
  that counts matches (`e81df73`, `62e0cdb`).
- Timeline: per-week change hairline (`c18df3b`), one slider model (`20fef30`), U undoes 20
  gestures (`bff9357`).
- "Desk becomes the table" glass look, 2026-10-28 (`258a31b`, `a756519`, `31605f5`, perf `48e9466`).
- Live products: one room per capability (`57ee810`), pending-work pulse (`cbbd240`), Morning
  Watch + follow (`ddf0474`, `6cb8a1b`), in-place product switch (`eee4902`).
- 10-30..11-02: lens-failed notice (`8d22093`), empty-plan wording (`9bb1f6f`), lens snaps under
  an open sheet (`bec4ec3`), onboarding hands over to the blueprint (`243008c`).

**Rejected - do not re-propose:**
- The "Orbit Atlas" branch; full per-lens rethemes (A/2: "the owner liked the ambition and
  rejected the readability cost", `docs/blueprint-ui.md:92-93`); any galaxy/star/cosmic metaphor
  (`.claude/perfect/config.md` Vetoes).
- A looping radar sweep or per-tile shimmer as progress (`docs/blueprint-ui.md:721`).
- Shaped / bold as the default expression - subtle adopted 2026-10-09 (`variants/registry.ts:2`).
- `dev-lens-dense-canvas` (more lens parts on dense tiles) - refuted, dense lenses already show 4.
- Kept but not chosen earlier (may be built on, not re-proposed as-is): "see the hour ahead" -
  backward scrub + 60-min counterfactual (`tiger/backlog.md`).

## Known limits and open questions

- Keyboard walks announce nothing (recorded deviation above); only the first 9 lenses have keys
  (`Engine.ts:1345`); built-in lenses cannot be switched off from the UI (`docs/blueprint-ui.md:1057`).
- Health has no history on the page: health, evidence and KPIs read "Not recorded for that date"
  on past dates (`docs/blueprint-ui.md:693-694`), although the event log defines `lens-health`
  events (`app-structure-v3.md:661`). Swarm, Business, dependencies and activity always show the
  current record even on a past date (`docs/blueprint-ui.md:702`).
- Kettle has one point per metric and no Screens (`docs/blueprint-ui.md:564,586`).
- Lens switch is a ~30 fps re-raster spring; text soft / briefly <12 px during gestures; glass costs
  1.5-2× raster (`docs/perf.md:24-30,65-67,169-172`).
- A live map that changes shape needs a reload (`BlueprintApp.tsx:281`); unfinished live tracks have
  no age cutoff; room "N tracked" count is not clickable (`tiger/backlog.md`).
- Lens strips cap at six full slots and never wrap (`docs/blueprint-ui.md:372-376`).
- Answer-keeping, batch answers and undo work on the sample only; live steers are measure / build
  / stop (`Engine.ts:922-940,959-962`). GA mode needs the sample's milestone (`Engine.ts:777-778`).
- Phones and the findings ledger draw no plan (`Engine.ts:409-410,546`).
- Open: what does a person who opens bp in the morning *not* get from the plan today that they
  have to dig for? Nobody has measured which zoom levels or lenses are actually used.

## Constraints

- Owner taste, non-negotiable (`.claude/perfect/config.md`): no galaxy/star/cosmic metaphors; L0
  behaves like a map (few large labelled sections, nested levels on zoom); nothing readable under
  12 px on screen, body 14 px; left-to-right chronology; **spatial stability** (a lens / filter /
  time change changes what places say, never where they are); **lenses never recolour nodes** -
  they differ by shape, icons, indicators, content and density; General is the composition of all
  lenses; blue/white primary palette in both themes. Practical readability over spectacle;
  "blazing fast" is praised; outcome value over cosmetic churn.
- Performance rules: the camera never touches React state; draw only when dirty; cache static
  geometry/rasters; allocate nothing in the frame loop; React re-renders only on discrete changes
  via `apps/web/src/engine/store.ts` selectors. Budgets above must hold.
- Colours/sizes from tokens in `apps/web/src/app/globals.css` (both themes; `check:tokens`);
  collapsed chrome sizes only in `apps/web/src/engine/chrome.ts`. Motion via `motion/react`;
  reduced motion makes entrances instant.
- No new runtime dependencies. Localhost-only API routes stay localhost-only. Reuse existing
  mechanisms in `apps/web/src/components`, `packages/core/src/model`, `apps/web/src/engine` first.
- Do not change the public schemas (`packages/schema`, app-structure v3, events log format) unless
  a proposal says so explicitly and why; the VR client and Personas read them.
- Out of scope: the swarm-steer workbench (hunted 2026-10-18), the VR Unreal client, the ledger /
  release pages, `.contest/`, `prototypes/`, `.spark/`, other repos.
- Registry standards that govern the area: `canvas-graph` (techniques viewport-transform,
  render-budget, canvas-accessibility, graph-layout, edge-management) and `time-travel-replay`.
  The read-only renderer still owes layout determinism, the arrival question for a live collection,
  and the full accessibility model (`canvas-graph` golden path).
- Stack: TypeScript, Next (app in `apps/web`), Canvas 2D engine, npm workspaces, Windows dev host.
