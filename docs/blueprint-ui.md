# Kettle blueprint UI: design and build contract

This is the contract for the Next.js app in this repo. It comes from three design contest rounds
(history and the owner's verbatim verdicts: `docs/contest-history.md`). Read this whole file before writing code.

## What the owner decided (verbatim)

> A/1 is the baseline winner, with difference each len won't color nodes but can reshape the
> rectangels or use different icons for indicators. I see the General view has most clarity and the
> difference between lenses need to be subtle yet noticable. A/2 did interesting job to retheme each
> len but at cost of readability. It also did not catch difficulty differences as artboard for
> example may leverage simplier interface then dev technical people in Terminal
>
> Another challenge is in seamless transition between layers, in best case General is composition
> of all lenses, switching from general to any len will create seamless transition where only
> specific len remain.
>
> B/1 is infferior but blazing fast as it is more simple than A/1, it serves as good reminder to
> 'give it all' to performance optimizations, preventing unncessary re-rendering on zoom and movement
>
> Create light theme as secondary option to see how roughly inverted color choices would look like
>
> We can leave html/css space and scaffold NextJS app to master the UI there with all animation and
> performance techniques we can get from the stack or framer motion. Prototype 3 variants there with
> ranges of how to express lens differences - from most subtle patterns into more aggressive design
> differences, keeping still blue/white primary color pallette but involving content change, use of
> secondary colors and decorative elements

Earlier standing decisions that still hold:
- **L0 works like an online map or a design tool.** It shows a few abstract, large, labelled
  sections with aggregates. Nested levels open as you zoom. Never shrink text to fit:
  **nothing the user must read is under 12 px on screen; body text is 14 px.**
- **Left-to-right chronology.** Wings are ordered by when their work began, features oldest first.
- **Spatial stability.** A lens, filter, time position or decision changes what places say, never
  where they are.
- **No galaxy or star metaphors.**
- **Scales beyond 132.** `?scale=4` clones the product into four product lines (528 features), and
  L0 stays as clear as at 1x.

## The baseline to port

A/1, "The Drawing Set: Site Watch":
- Source: `prototypes/site-watch/` (`index.html`, `style.css`, `app.js`, about 230 KB of vanilla
  canvas code; opens from disk). Read `NOTES.md` first. Its predecessor, round 2's winner, is
  `prototypes/drawing-set/`.

Everything it does is in scope to keep:
- **Levels and wayfinding.**
  - The L0 site of five wings, then L1 wing, L2 room, L3 bay, L4 feature sheet, all by continuous
    semantic zoom.
  - The level ladder, scale bar and key plan (minimap). The breadcrumb names the container with the
    largest visible share.
  - The `?scale=4` campus.
- **Finding and reading.**
  - Search with `/`.
  - Revisions strip and time travel across the 27 weekly snapshots.
  - The feature sheet as a document.
- **The swarm and steering.**
  - The simulated swarm: agents as survey marks, RFI pennants for decisions, standing orders as
    dashed zones with stamps, and breaches as red rivets.
  - The replayable hour at 1x to 240x, and "while you were away".
  - The per-person queue with one-click answers and undo.
  - Targeting (click, shift-drag lasso), and steering commands that preview before commit (Payments
    GA push, pause, orders).
- **Keyboard and phone.** Keyboard throughout. On a phone, a reduced view: the queue and a list.

Two other variants are references only, never to copy wholesale:
- **B/1** (round 3 contest archive, not in this repo) is simpler and noticeably faster. Study why: fewer
  layers per frame and less work per tile.
- **A/2** (round 3 contest archive, not in this repo) shows six full lens rethemes. The owner liked the ambition
  and rejected the readability cost.

Data (since the app-structure v3 adoption, spark `blueprint-data-standard` WP3):
- The product comes **only** from the v3 map `src/data/kettle.app-structure.json` and its events log
  `src/data/kettle.events.jsonl` (spec: `docs/standard/app-structure-v3.md`). The standard's loader
  `src/lib/standard/load.ts` reads them (v3, or v2 per spec section 11) into the internal model that
  `@/lib/data` exposes (`loadProduct()`); `src/data/swarm.json` stays the runtime feed (`SWARM`).
  `src/data/kettle.json` is the old sample, kept only for the conversion and check scripts.
- Feature ids in the app are slugs. A short passthrough `id` (`PAY-09`) is shown as a display code only.
- People, the activity feed and the tagline come from the map's `extensions` (the sample keeps them
  under `com.kettle.sample`); without them an actor id is shown as its own name.
- History is replayed from the events log: a feature's stage revisions (time travel, "what changed",
  the sheet's revisions table) and the 27 weekly snapshot counts of the revisions strip. The replay
  reproduces the old stored snapshots exactly.
- The people and moments of use are in `docs/research/users.md`.
- The swarm is a simulation, and the UI says so.
- A live product (`?product=<slug>`) comes from its repo's scan store instead: its own map through the same loader, and the swarm from its scan. See **Live products** below.

### Lenses are data

- The **registry** is the map's `lenses[]` where `enabled` is true, in file order. Everything about a
  lens (tab name and short, legend, glyph, line, measured field, evidence fields, density, health,
  rollup, reasons) comes from its manifest. Adding a lens to the map, or enabling one, makes it appear
  everywhere with no code change; disabling one removes it everywhere. Lens ids are plain strings.
- **Session toggle:** `?lenses=-security,+com.kettle.cost` disables or enables lenses for the
  session, on top of the file's `enabled` (`-id` off, `+id` or a bare id on; unknown ids are ignored).
  The General legend says so.
- **Health** per feature and lens is computed once per data load with the reference evaluator
  (`src/lib/standard/health.ts`, the feature passed as context for bound fields, the KPIs for
  KPI-bound fields), read on the map's as-of date, and cached with the matched rule's reason. It never
  runs in the frame loop.
- **General health** of a feature (tile trouble marks, "in trouble" counts, the phone list) is the
  **worst of its enabled lenses' measured healths**, bad over watch over good; `unmeasured` and `na`
  do not count, and a feature with no measured lens reads `unmeasured` (spec 8.4). Over the six
  built-ins on the Kettle sample this equals the old stored overall health on every feature
  (54 good, 64 watch, 14 bad); enabling `com.kettle.cost` does not change it.
- **Place aggregates** (room, wing, building labels under a lens): the manifest's `health.rollup`
  verdict, the bad and watch counts, and a headline-field summary (money summed, a rate or scale
  averaged, the top enum value counted).
- **Keyboard:** 1 = General, 2..9 = the enabled lenses in registry order (beyond nine, the tab strip
  still reaches them).
- A decision or standing order in `swarm.json` names its lens by id; one whose lens is disabled or
  unknown is still listed, under General.

## Architecture

```
src/app/                    routes (App Router). '/' = variant index; '/v/[variant]' = the blueprint
src/lib/data/               typed data (done)
src/lib/model/              pure TS: indexes, aggregates, layout, scale clone, swarm sim state
src/engine/                 canvas engine: camera, frame loop, LOD, hit testing, layers, lens mixing
src/components/             React UI around the canvas (header, tabs, dock, queue, sheet, ladder…)
src/variants/<id>/          one lens expression per variant (see below) + optional UI overrides
```

### Performance rules (the B/1 lesson: give it all)

1. **The camera never touches React state.** Pan, zoom, hover and the simulation clock live inside
   the engine. React re-renders only on discrete changes: level, breadcrumb, selection, queue
   contents, lens, theme. Use a small external store and `useSyncExternalStore` with selectors, so
   one panel's change does not re-render the others.
2. **Draw only when dirty.** One `requestAnimationFrame` loop that sleeps when nothing moves. Do not
   run a perpetual loop for idle effects. Throttle the simulation's visual pulses.
3. **Cache the static plan.**
   - The building geometry is computed once per layout as `Path2D` objects.
   - The static layer (walls, fills, labels that do not change with the clock) is rastered into an
     offscreen bitmap per zoom bucket. During a gesture, transform the cached bitmap. Re-raster
     when the gesture settles, or when the zoom crosses a bucket.
   - Dynamic layers (agents, pins, pulses, hover) draw on top each frame, culled to the viewport.
4. **Cull and simplify.** Skip off-screen items, and skip sub-pixel detail by level of detail.
   Measure each text width once and cache it. Allocate nothing in the frame loop.
5. **Budget: 60 fps while panning and zooming at 1920x1080 with `?scale=4`.** Check it with a
   scripted wheel and drag in Playwright that records `requestAnimationFrame` deltas. Report p50
   and p95 frame times in `docs/perf.md`.
6. **Device pixel ratio** capped at 2. Wheel listeners are passive where possible, and pointer
   events coalesced.
7. **Motion** (the `motion` package, `motion/react`) handles DOM panels, sheets, toasts and
   layout transitions. For canvas values, use `animate()` from `motion` to tween plain numbers
   (camera fly-to, the lens mix) and feed them to the engine. Springs are interruptible.

### Theme

- `data-theme="dark" | "light"` on `<html>`, set before paint (see `src/app/layout.tsx`).
- Tokens live in `src/app/globals.css`. Light is the dark palette roughly inverted: white paper,
  navy ink, the same blues, with the status colours darkened for contrast.
- The engine reads the tokens with `getComputedStyle` on mount and on theme change, then re-rasters.
- A toggle in the UI (and `?theme=light`) switches the theme and remembers it in `localStorage`
  (wrapped in try/catch).

## Lenses: General is the composition, a lens is what remains

This is the core of the round. The engine models the view as a **mix**:

```ts
type LensMix = { general: number } & Record<string, number>; // General + one weight per enabled lens, each 0..1
// General:          general = 1, every lens = 1  → all N lens channels drawn in compact form
// Lens "security":  general = 0, security = 1, others = 0 → only security remains, expanded
```

- Switching lenses tweens the mix with a spring. A switch from General to Security fades and
  collapses the other channels, while Security's channel grows into the space they leave. The
  plan, the positions and the **node colours never change**. A tile's base fill is its lifecycle
  stage, and it is the same in every lens.
- Switching from Security to Design passes smoothly through the shared base. It never cuts.
- A lens is expressed only through:
  - **shape:** the tile outline, corners, notches, edges, insets;
  - **indicators:** icons, glyphs and marks in the tile and at room and wing level;
  - **content:** what the tile, room aggregate, sheet and queue say under this lens;
  - **density:** each lens's reader (design is simpler, development is denser and more technical);
  - **secondary colours and decoration:** only in the variants that go that far, always within the
    blue and white primary palette.
- The mix must work at every level: L0 wing aggregates, L1 and L2 rooms, L3 tiles and the L4 sheet.

The expression contract each variant implements (refine the types as you build, but keep the idea):

```ts
interface LensExpression {
  id: string;                         // 'subtle' | 'shaped' | 'bold'
  name: string;                       // shown on the index page
  channels: Record<string, LensChannel>;          // lenses the variant draws itself
  fallback?(lens: LensDef): LensChannel;           // any other lens, from its manifest alone
  /** How the registry's channels share a tile in General (slots, edges, corners…). */
  composeGeneral(tile: TileGeom, lenses: readonly string[]): Record<string, Rect>;
}
interface LensChannel {
  density: 'simple' | 'standard' | 'dense';
  accent?: string;                    // optional secondary colour for this lens's marks
  /** Tile outline for this lens, blended from the base rectangle by w (0..1). */
  shape?(p: Path2D, tile: TileGeom, f: Feature, w: number): void;
  /** Indicators inside the given rect; compact=true in General. */
  marks(ctx: CanvasRenderingContext2D, r: Rect, f: Feature, w: number, compact: boolean, th: Theme): void;
  /** What a tile, room and wing say under this lens. */
  content(f: Feature): { line: string; stamp?: string };
  aggregate(fs: Feature[]): { line: string; value?: number };
  /** Optional decoration under the plan (bold variant). */
  decor?(ctx: CanvasRenderingContext2D, view: Viewport, w: number, th: Theme): void;
}
```

## The three variants

These are routes `/v/subtle`, `/v/shaped` and `/v/bold`, plus `/` (an index with the three cards
and the theme toggle). They share the engine, the UI and the data, and differ only in their
`src/variants/<id>/` expression and small UI overrides. They span the owner's range:

1. **subtle: patterns.** Every tile keeps its rectangle. Lenses differ by line patterns, hairline
   marks and small icon sets in fixed slots. In General, one tiny indicator per enabled lens sits in
   a strip, and a lens enlarges its own indicator into the tile's evidence line. Ink colours only.
   **It is drawn entirely from the manifests:** the glyph by `presentation.glyph` (the shared set, or a
   custom `{path}` parsed only by `Path2D`, at most 2048 characters), the line by `presentation.line`
   (the shared set, `solid` included), the line's length by `presentation.measures` (a number over its
   `max`, 0..100 for percent, the largest value in the map when there is no `max`; an enum by
   position / (count - 1)), the evidence text by `presentation.evidence` formatted by type and cut to
   2, 3 or 4 fields by `reader.density`, the stamp by the matched rule's reason (or the override's
   why). **The N-slot rule:** a fixture gets a strip when a slot of the six-slot grid, (strip - 5 gaps)
   / 6, is at least 10u wide, exactly as before. Up to six lenses keep that slot size, left-aligned in
   registry order. With more than six, the slots shrink to share the strip, (strip - (N - 1) gaps) / N;
   a slot of at least 10u shows glyph and rail, a narrower one the glyph only. The strip never wraps
   (it would cover the id row); the tabs and keys reach every lens.
2. **shaped: reshape and icons.**
   - Each lens reshapes the tile so it says something about that field. Business is a ticket whose
     notch depth shows value. Security cuts the corners of sensitive data. Operations is a pill with
     a gauge edge. Development is bracketed with a progress spine. Quality is a ruled checklist.
     Design is an artboard with crop marks.
   - Each lens has its own icon vocabulary and content. Each gets one secondary accent colour, used
     for its marks only.
   - Density follows the reader: design is sparse, development is denser.
3. **bold: decoration and content.** The furthest the palette allows.
   - Lens-specific decoration: dimension lines and grids, title-block ornaments, stamps, hatch
     families.
   - Lens-specific panel layouts and density: an artboard-simple design lens, and a mono, terminal-dense
     development lens.
   - Richer content per tile.
   - Still blue and white first, with readability kept. A/2 is the warning.

The shaped and bold variants (and the base expression they share) know the six built-in lens ids and
read their values from the facets through `src/variants/base/legacy.ts`; for any other lens id they fall
back to the subtle manifest-driven channel and the default, manifest-driven sheet panel.

All three: General stays the clearest view. A lens is subtle yet noticeable in variant 1, and
unmistakable in variant 3. Every variant supports both themes and `?scale=4`.

## Live products

Kettle is built in and loads statically (no server route is involved). Any other product is a **live product**: a repo that the `/lens-scan` skill has scanned, opened with `?product=<slug>`. No `?product` means Kettle, exactly as before.

**Product list.** `bp.products.local.json` at the blueprint repo root (gitignored; `bp.products.example.json` shows the shape):

```json
{ "products": [{ "slug": "personas", "name": "Personas", "root": "C:/code/personas" }] }
```

`root` is the product repo (absolute, or relative to the blueprint's working directory). The file is re-read on every request, so editing it needs no restart. A missing file means no live products. Duplicate slugs keep the first entry.

**Store location.** Everything sits under `<root>/.ai/lens-scan/`:
- `scan.db`: the SQLite store (DDL in `docs/standard/lens-scan-store.sql`). The skill writes it in WAL mode.
- `app-structure.json`: the product's app-structure map.
- `events.jsonl`: the events log (optional). Without it the revisions strip has one week, the as-of date.
- `shots/`: screenshots.

The blueprint reads the store through a read-only connection. Its only write is a proposal decision, made on a short-lived read-write connection with a 2000 ms busy timeout. The server code is `src/lib/scan/store.server.ts` and `products.server.ts`. Both throw if loaded in a browser, and only route handlers import them. `node:sqlite` is a Node 24 builtin. It prints an ExperimentalWarning once per process, and it needs no `next.config` change.

**Wire convention.** The row types are in `src/lib/scan/types.ts`. JSON columns (`runs.lenses`, `runs.scope`, `shots.report`) arrive parsed. NULL columns are omitted, so the JSON never contains `null`. A feature with no measurement row is unmeasured.

**Routes.** All routes run on the Node runtime with `force-dynamic`. An unknown slug answers 404 `{ error }`.

| Route | Answer |
|---|---|
| `GET /api/products` | `ProductInfo[]`: `{ slug, name, live }`. `live` = `scan.db` exists. |
| `GET /api/products/<slug>/structure` | `{ structure, events }`. `events` is `''` when there is no log. 404 when `app-structure.json` is missing. |
| `GET /api/products/<slug>/scan` | `ScanSnapshot`: all runs, measurements, proposals, shots and coverage, plus the latest 200 activity rows in ascending id order. A missing store gives empty arrays. |
| `GET /api/products/<slug>/stream` | Server-Sent Events, described below. |
| `POST /api/products/<slug>/proposals/<id>` | Body `{ decision: 'approve' \| 'decline', note?: string }`. Sets `status`, `decided_by = 'blueprint'`, `decided_at`, `decision_note` and `updated_at`, but only while the status is `proposed`. Answers: **200** with the updated `Proposal`; **409** with the current row as the body (someone already decided, or the skill moved it on); **404** for an unknown id or a missing store; **400** for any other body (extra keys, a note that is not a string, a body that is not JSON); **503** when the store stayed locked past the busy timeout. |
| `GET /api/products/<slug>/shots/<path>` | The file bytes as png, jpeg, webp or webm (by extension; anything else gets 415). `<path>` is relative to `<store>/shots`. A full `Shot.path` with its leading `shots/` is accepted too. **403** for anything that would resolve outside `shots/`: `.`, `..`, empty, absolute or drive segments, `\`, `/` or `:` encoded inside a segment (`..%2F..%2Fx`), NUL, and symlinks that point out. Plain `../` in a URL is collapsed by the HTTP layer before routing, so it never reaches the handler (Next answers 404). |

**SSE semantics** (`/stream`). One long-lived read-only connection per client:
- `event: snapshot`: a `ScanSnapshot`, sent on connect. While the store file does not exist, it is sent with empty arrays and the route keeps checking. It is sent again, in full, once the file appears.
- `event: delta`: a `ScanDelta` (same keys, only new or changed rows). Each second the route reads `PRAGMA data_version` on the same connection. That value changes only when another connection commits (the skill, or a decision), so an idle store costs one pragma a second. When it changes, the route sends the rows past its cursors: measurements, activity and shots by `id`; runs and proposals by `updated_at`; coverage by `judged_at`. Rows that tie on a timestamp are not resent. Empty deltas are not sent. A store already open when the stream connects shows a new row within about 1 s.
- `event: ping`: `{ at }`, sent after 15 s without another event.
- When the client disconnects, the interval stops and the connection closes. If a read fails (the store was replaced or stayed locked), the route reopens on the next tick and sends a fresh snapshot.

**Client** (`src/lib/scan/client.ts`):
- `useLiveProduct(slug)`: `null` gives `{ status: 'missing', events: '' }`. Otherwise it fetches the structure (404 gives `missing` with the `error` text), then follows `/stream`. It replaces the scan on `snapshot` and merges each `delta`: rows are upserted by id, coverage by `(feature, standard)`, and only the latest 200 activity rows are kept. Status: `loading` until the first snapshot; `live`; `missing` while the repo has a structure but no store (features read unmeasured; it turns `live` when the store appears); `offline` while reconnecting (the hook reopens the EventSource with backoff of 0.5, 1, 2, 4, 8 s, then every 10 s); `error` when the structure request fails.
- `decideProposal(slug, id, body)`: resolves to the updated `Proposal`. It rejects with an `Error` that carries `status`, plus `proposal` on a 409.
- `swarmFromScan(scan, featureSlugs)`: builds the swarm feed from the latest run. One squad and one agent per lens (`scan-<lens>`, `scan-<lens>.1`, role `research` whatever the lens), each on the feature of its lens's latest activity row. Agent status: `idle` once the run is no longer running; `failed` if the lens's latest activity is an error; `waiting` when an open proposal exists for the lens; otherwise `working`. One decision per `proposed` proposal, with options Approve and Decline; urgency from risk (7 or more high, 4 or more medium). The replay is the run's activity, `t` in seconds since the run started.

**How the app draws it** (`BlueprintApp`; `src/lib/model/live-feed.ts` for the model and feed, `live.ts` for the scan indexes):
- The model is built once the structure is in and the stream has answered: `buildLiveModel` reads the map with the same loader as Kettle (`loadMap`), and the swarm is `liveSwarm(P, scan)`: `swarmFromScan` with what a scan cannot know filled in. The decider is "whoever reviews" (a scan names no person), the domain is the feature's own, and a question on a feature the map lacks is dropped.
- **The sim's live mode.** The sim does not play a live scan as a replay: there is no recorded hour. Every later scan goes in place through `engine.feed(liveSwarm(...))` → `SwarmSim.applyFeed`. The agents are set from the feed (an agent whose feature changed travels there with the usual animation), questions new to the feed open (with a "New question" toast once a run has been seen), questions it no longer lists close, and its activity rows not shown yet go to the log, the pulses and the ticker. The engine, the layout and the static cache are untouched; only a new structure builds a new model. Nothing plays, so the frame loop sleeps between feeds. A new activity row moves its agent within about 1.5 s (1 s stream poll, then one frame).
- **Time.** Waits and ages use the wall clock (`sim.clockMs()`); event times are seconds since the run start, so the ticker reads real times. The bottom bar's clock box shows the run (start, `● LIVE · <phase>` or its status, lenses, agents) instead of the sim hour, and the revisions strip drops the hour ahead (no replay to scrub, no arrivals).
- **What a scan cannot fill** is not shown as zero: spend and tokens are hidden in live mode (sheet, hover card, morning watch, the steering panel). The Kettle-only steering (Payments GA push, the research crew's spend cap) is hidden; pause, push and orders on a selection stay, but the next feed puts the agents back where the scan has them. The "While you were away" digest is Kettle's and is not offered.
- **Header pill.** `Live · <phase>` while the latest run is running, `Last scan <age>` otherwise, `Offline` while the stream reconnects, `No scan store` before the skill wrote one. Kettle shows nothing.
- **Queue cards.** A live question is a proposal card: the title, `metric: before → expected` with the unit (before = the latest reading of that feature, lens and metric in the scan; expected = before + `expected_delta`), the standard tag (`no standard` for `none`), size and risk, and Approve and Decline. Decline opens an inline note field (optional, no modal); Enter or the Decline button sends it. Approve is option 0 and Decline option 1, so the decision card and the keys 1 and 2 decide too (without a note).
- **Deciding** is optimistic: every product line's copy of the question closes at once and the agents it held go back to work. The decision is written to the store, so there is no undo. A refusal rolls it back with a toast saying why; a 409 says "Already decided elsewhere" and leaves the question closed (the next feed shows the other answer).
- **Empty states.** An unknown slug, or a repo without a structure, shows the standard empty state: "No scan store at `<root>/.ai/lens-scan`" (or "No product … in bp.products.local.json"), with a link to Kettle. A repo with a structure but no store loads, says "No scan store yet" in a toast and the pill, and every feature reads unmeasured.

**Demo product.** `node scripts/scan-demo.mjs [--dir .demo/kettle-live] [--reset] [--live]` builds a sample live product from the Kettle map and registers it as `kettle-live` (create or merge, idempotent). Open it with `?product=kettle-live`.
- The seed has two finished runs a week apart, with development, security and design metrics on 20 features. It also has 7 proposals in mixed states, including one baseline upgrade with two propagation children, 6 coverage rows, and placeholder PNG shots of 2 features × 2 themes per run.
- An existing store is kept, because an open stream may hold it. `--reset` recreates the store.
- `--live` adds a running run. It writes an activity row every 1.5 s, a measurement every 3 s and a proposal every 20 s. Ctrl-C marks the run done; a run left `running` by a hard kill is marked `aborted` at the next `--live`.
- `.demo/` is gitignored. All of it is invented sample data.

## Metric rows

A lens field with `metric` (app-structure v3.1) is a measured metric: its key is the metric key in the scan store and its latest reading is the facet value. In the feature sheet, every lens panel ends with its metric rows (`MetricRows` in `src/components/sheet/LensPanel.tsx`), after the panel's own evidence fields, whichever variant draws the panel. They come from the manifest alone; there is no lens id in the code.

- A row reads the label, then the value with its unit (the manifest's unit, else the reading's), and an arrow against the previous reading (▲ or ▼) coloured by `metric.better`: mint when it moved the better way, red when it moved the worse way. No arrow when it did not move or there is one reading.
- The second line holds a 64×16 SVG sparkline of the history, the target (`target 0`; the sparkline draws it as a dashed amber tick), and the method tag (`static`, `probe`, `harness`, `judgement`, the reading's method else the manifest's).
- History is the scan's readings of that feature, lens and metric, ordered by `measured_at`. Kettle has no store, so its single point is the facet value. One point shows the value only (no arrow, no sparkline). No point reads `—` like any other absent value.
- In General a panel shows its measured metrics, at most three, then "N more metrics in the lens reading". When the lens stands alone it shows every metric field, unmeasured ones as `—`. A collapsed panel (another lens chosen) shows none.
- The sparkline is React SVG in the sheet. Nothing about metrics runs in the canvas frame loop. Text stays at the 12 px floor.

## Business section

When a feature has any of `experience`, `core` or `variations` (v3.1), the sheet shows a Business section after the lens panels (`src/components/sheet/Business.tsx`). It is hidden when all three are absent.

- **As-is:** the customer experience today, one paragraph.
- **Core · what every variation shares:** two bullet lists, Shared tech and Core schema.
- **Variations:** a compact table with one row per variation: its name and audience, the bullets it adds to the core, its parameters, and a stage chip (the stage symbol and word). Lens values stay on the core feature, so a variation has no lens reading of its own.

The Kettle sample's `invoice-ocr` (Paper invoice to payment) carries all three, with three bank variations.

## Screens strip

For a live product whose scan has shots of the feature, the sheet shows a Screens strip after the Business section (`src/components/sheet/Screens.tsx`). Kettle has no store, so no strip.

- One thumbnail per size and theme: the latest run that has it, served by `/api/products/<slug>/shots/<path>`. A red badge counts the console errors its harness report records (`report.consoleErrors`, a count or a list).
- A thumbnail opens the viewer under the strip (not a modal). Run A and run B are selectors over the runs that have that size and theme; they default to the latest two. With two runs it compares them side by side or as a swipe (a range slider over the stacked images). With one run it shows that one and says compare needs two. Escape closes the viewer, not the sheet.
- Images load lazily and are never committed to the repo.

## Done means

- `npm run build` and `npm run typecheck` pass. There are no console errors on load or while
  zooming, and no hydration warnings.
- Each route loads at 1280x800, 1920x1080 and 390x844, in both themes, at `?scale=1` and
  `?scale=4`.
- The 12 px floor holds, measured on DOM and canvas text.
- `docs/perf.md` gives the frame-time numbers.
- Screenshots of every route, theme and lens are in `docs/shots/` (git-ignored if large).
