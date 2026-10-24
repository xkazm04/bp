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
  - At L3 a feature tile's name is twice its plan size: it grows over the last stretch of the zoom into the bay
    (0.78 to 0.94 of the bay's fit zoom, `Engine.bayFitK`) and steps back 2 px at a time when the doubled name does
    not fit the tile.
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
  - The per-person queue with one-click answers and undo: U on the plan (and the toast's UNDO, the same method)
    takes back the reader's last 20 gestures newest first (answers, batches, kept answers, push / pause / order
    commands; `SwarmSim.undoLast`, in memory, emptied by a restart; a live product keeps none). Checked by
    `npm run check:sim-undo`.
  - Targeting (click, shift-drag lasso), and steering commands that preview before commit (Payments
    GA push, pause, orders).
- **Keyboard and phone.** Keyboard throughout. On a phone, a reduced view: the queue and a list.
- **Map navigation (Google-Maps / Figma feel).** Trackpad pinch and Ctrl+wheel zoom to the cursor; a two-finger
  trackpad scroll pans; Shift+wheel pans horizontally; a classic mouse wheel still zooms to the cursor. The
  wheel has no device field, so `WheelIntent` (`engine/camera.ts`) classifies the stream (line/page mode, deltaX,
  the 120-aligned `wheelDeltaY` of a notch, small/fractional pixel deltas, a latched running stream); its doc
  comment lists the failure modes. A touch pinch anchors the world point under its starting midpoint, so moving
  the fingers pans while pinching, and the finger left after a pinch carries on as a pan.
- **Phone parity.** The phone queue answers like the desktop one: urgency in words, a live proposal's summary and
  `before → expected` line, Approve / Decline with an optional note, "Show N more" past 12. The simulation keeps
  running on a light timer while no plan is drawn (a toast's Show opens the feature), the footer is the honest
  `LiveFoot`, the header carries the product name and the scan status, and the springs obey reduced motion.
- **Back / forward.** The URL hash carries nine parameters (`Engine.hashOf`): lens, place (`at=` or `open=`),
  time (`t=`), the comparison window (`d=`, only when it is not the 7-day default), the modes (`blast=`, `ga=1`),
  person (`who=`) and the page with its ledger prototype (`page=ledger`, `lv=`). A place the user
  rests at for 600 ms, or opening or closing a feature, pushes a history entry; lens, time and toggles only replace
  the current one, so a fly-through spams nothing. Back, forward and a hash pasted into the tab restore lens, time,
  modes, place (fly) and the open feature; while the camera arrives the engine writes nothing, then adopts.

Two other variants are references only, never to copy wholesale:
- **B/1** (round 3 contest archive, not in this repo) is simpler and noticeably faster. Study why: fewer
  layers per frame and less work per tile.
- **A/2** (round 3 contest archive, not in this repo) shows six full lens rethemes. The owner liked the ambition
  and rejected the readability cost.

Data (since the app-structure v3 adoption, spark `blueprint-data-standard` WP3):
- The product comes **only** from the v3 map `packages/core/data/kettle.app-structure.json` and its events log
  `packages/core/data/kettle.events.jsonl` (spec: `docs/standard/app-structure-v3.md`). The standard's loader
  `packages/core/src/standard/load.ts` reads them (v3, or v2 per spec section 11) into the internal model that
  `@/lib/data` exposes (`loadProduct()`); `packages/core/data/swarm.json` stays the runtime feed (`SWARM`).
  `packages/core/data/kettle.json` is the old sample, kept only for the conversion and check scripts.
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
  (`packages/core/src/standard/health.ts`, the feature passed as context for bound fields, the KPIs for
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
- **Header tabs** show each lens as its short code, its question count and its digit key; the full name and
  description are the tooltip. General and the built-in lenses fill the top row; the product's own (custom,
  `source: 'project'`) lenses sit on a second row below, labelled Custom. With no custom lens the strip is one
  row of full-height tabs.
- A decision or standing order in `swarm.json` names its lens by id; one whose lens is disabled or
  unknown is still listed, under General.

## Supported browsers (2026-10-22)

**Floor:** Chrome 116, Safari 17.4, Firefox 124 (current evergreen desktop and phone browsers; no polyfills, no
legacy targets). The floor is set by the newest web API the app calls on purpose, `AbortSignal.any` in
`apps/web/src/lib/scan/client.ts` (which composes a caller's signal with the request bound). An older browser fails
the scan requests with a TypeError and is unsupported, not worked around.

- Nothing in `apps/web/src` may use a web API (script or CSS) newer than this floor without raising it here first.
  `npm run check:claims` holds the list of newer APIs it knows about, reads the floor from the line above, and
  fails on a use past it. Add an API to its table when you reach for a recent one.
- A feature the floor lacks (such as `requestIdleCallback` in Safari) is used only behind a `typeof` guard.

## Architecture

```
apps/web/src/app/                    routes (App Router). '/' = the blueprint (subtle); '/variants' = the index; '/v/[variant]' = one variant
packages/core/src/data/               typed data (done)
packages/core/src/model/              pure TS: indexes, aggregates, layout, scale clone, swarm sim state
apps/web/src/engine/                 canvas engine: camera, frame loop, LOD, hit testing, layers, lens mixing
apps/web/src/components/             React UI around the canvas (header, tabs, dock, queue, sheet, ladder…)
apps/web/src/variants/<id>/          one lens expression per variant (see below) + optional UI overrides
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

- `data-theme="dark" | "light"` on `<html>`, set before paint (see `apps/web/src/app/layout.tsx`).
- Tokens live in `apps/web/src/app/globals.css`. Light is the dark palette roughly inverted: white paper,
  navy ink, the same blues, with the status colours darkened for contrast.
- The engine reads the tokens with `getComputedStyle` and re-rasters on four triggers (`Engine.readTheme`):
  on mount, on a `data-theme` change (a `MutationObserver` on `<html>`), once the web fonts have loaded, and
  on a device-resolution change - the last one because the hatch patterns are rastered at that resolution
  (`theme.ts` `Patterns`), so a window moved to another monitor would otherwise keep the old one's patterns.
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

## Trouble flags (2026-10-12)

The owner's rule: lens icons are the top-priority signals to watch and act on, and managing the
blueprint is mostly finding flags and resolving them. Three prototypes were compared (index tabs on the
top border, trouble-only flags, large icon cells). Flags won, but a flag sized to fit its tile was
unreadable when zoomed out, so flags are not part of any tile. They are an engine layer in
`apps/web/src/engine/render/flags.ts`, the same for every variant.

- **One flag per feature and lens that is bad or on watch**, read from `feature.trouble`, only at
  "now" (time travel shows stage only). A lens filter that dims a feature hides its flags too.
- **On-screen size, not world size.** A flag is 32 px (times UI scale) on every level, from the site
  plan to a single tile, and grows over a large tile up to 44 px (12% of the tile's width). A watch flag
  is 0.8 of a bad one. Bad is red, watch is amber, with the lens glyph in paper colour. Health
  colours carry status only, never the lens.
- **It may cross the tile's top border.** A flag stands on the top edge of its tile and rises into the
  gap above. At bay zoom it can cover the foot of the tile on the row above (its stamp and chips).
  That is accepted, because the flag outranks it.
- **Its position names the lens.** Over a tile, flags stand across the top edge in registry order,
  the order of General's strip. Over a ribbon segment (site and wing plans) a flag stands over the
  segment's middle. A lens fades its flags with its presence in the mix, so a lens view keeps only its
  own.
- **Clusters, like map markers.** Flags are placed bad first, then by presence, then left to right.
  A flag that would collide with one already placed merges into it, which then shows a count badge
  (12 px text, the floor). The merge distance is 4 px over tiles and widens to 26 px on the site
  plan, so the site shows a few large flags per room and zooming in splits them.
- **Titles stay readable.** Three title boxes push a flag aside, and a flag that steps far enough draws a
  leader line to a dot on its feature. (a) A room label in its header: the room label renderer records it in
  world units (`RoomNode.labelBox`), so the flags, drawn at the live camera, can find it between rasters.
  (b) A room label pinned to the top of the view rather than sitting in its header: `flags.ts` `pinnedBox`
  recomputes it from the layout and the live camera by the same rules `plan.ts` draws it with, since the
  renderer records no box for that case. (c) The wing title stacked above its wing: `flags.ts` `wingBox`,
  the same way. A flag steps to whichever side of the box is nearer, except for (a), which it only ever
  steps right of.
- **Act on it.** Hovering a flag grows it slightly and shows the feature's hover card. Clicking a flag
  (or a cluster of one feature) switches to the flag's lens and opens the feature on that lens's tab.
  Clicking a cluster of several features flies to them so it splits. When the camera cannot get
  meaningfully closer, the click opens the first feature. The engine hit-tests the flags of the last
  frame. No flag reacts while a feature page is open.
- **The hit list** (`apps/web/src/engine/render/hits.ts`). What the pointer can hit is what the frame
  drew: each target layer registers a region as it draws a mark (agent chips and discs, the "+N"
  overflow chip, which hits as its feature, tile question pins, room cluster pins, track marks, then the
  flags), and `clickAt` / `hoverAt` and the `pinAt` / `trackAt` / `agentAt` readers walk it topmost first,
  so hit order is draw order and an agent the overflow chip hides is not clickable. A crossfading mark is
  hit-testable when drawn at >= 0.5 of its presence (`PRESENT`); a coarse pointer grows every region to a
  44 px square around its centre (`TOUCH`). A pointer test after the camera moved re-runs the target
  layers into a context that draws nothing. Records are pooled. Checked by `npm run check:engine-harness`
  (section 3b) and `check:render-units`.
- **Drawn on top, each frame**, after every dynamic layer, so they stay crisp at one size during a
  gesture. On the Kettle sample about 100 candidates are laid out per frame, and the layout holds the rule of
  allocating nothing in the frame loop: the `Flag` records come from a pool reused frame to frame, each one's
  `fids` and `lenses` arrays are truncated and refilled rather than replaced, the troubled-feature list and
  the upper-cased names are cached, and the two recomputed title boxes are written into one shared record. A
  plain pan allocates nothing. Still profile before `?scale=4` sign-off.
- **The lens glyph set** (`glyph()`) lives in `apps/web/src/engine/render/lens-glyph.ts` so the engine can draw
  it. The subtle variant re-exports it from `marks.ts`, and its ribbon no longer draws its own glyph
  knockout while flags are on.
- `?flags=0` turns the layer off, to compare against the plan without it.

## Lens fill and unknowns (2026-10-13)

The owner's rules: a progress rail as a thin line is unreadable at its size, so a lens view fills the
tile instead; a feature a lens knows nothing about shows a "?" so a glance says "rescan"; a feature a
lens has nothing to add to goes transparent.

- **Fill = the lens's measure, in its own line type.** In a lens view (subtle variant, and the manifest
  channel any variant uses for a custom lens) the lens's `presentation.line` is laid as an ink pattern
  across the tile body, left to right, up to `lensLine(measures, value)` (enums: position / (count - 1)).
  The motifs: solid = ruled lines, double = paired rules, dotted = a dot grid, comb = ticks on a base,
  chain = dash and dot, hatched = back diagonals, dimension = a rule with end ticks, wave = a square
  wave. A hairline marks
  where the measure ends. Ink at about 0.26 alpha (sparse motifs carry a little more ink so every lens
  reads equally dark): never a hue, so the stage fill beneath stays legible and text on top stays
  readable in both themes. This is the one sanctioned exception to "a lens never fills a tile": a
  pattern, not a colour. It starts below the top band, which keeps the lens glyph and the count dots on
  a clean ground. Ribbon segments (L0/L1) fill the same way, growing in from the left with the lens.
- **The tween.** General keeps its compact strip rails exactly as before. As a lens expands, its rail
  fades out while its fill fades in on the same weight (the expansion), so General to lens and back is
  one movement. A measured headline that is absent (other values are measured) keeps the broken
  hairline on the top edge in the lens view.
- **"?" = not scanned yet.** When the feature's health under the dominant lens is `unmeasured` (no
  facet), a texture of "?" glyphs lies over the tile body. Each glyph is 13 px times UI scale, never
  under the 12 px floor. A body too small for one cell of the texture gets a single centred "?"; one
  too small for a 12 px glyph gets nothing (the evidence line still says NOT MEASURED). In General only
  a feature with no measured lens at all gets the texture (Kettle has none; a live product before its
  first scan shows it everywhere). The engine draws it (`apps/web/src/engine/render/plan.ts`), so every variant
  shows it.
- **Faded = this lens has nothing here.** When the dominant lens's health is `na` (`applicable: false`
  or an `applies_when` miss) the whole tile or segment fades to 0.35, in that lens's view only. `na` is
  never trouble, so a faded feature carries no flag for that lens.
- **Weights.** The "?" and the fade use the weights the trouble marks crossfade on: General's verdict
  by (1 - dominance), the dominant lens's by its dominance. Both are part of the static raster (the lens
  tween re-rasters anyway); nothing changes position.
- **Patterns are cached.** `apps/web/src/engine/render/patterns.ts` builds each pattern once per theme object,
  motif, device resolution and size bucket (UI scale in quarter steps), anchors it to the rect it fills
  (snapped to a device pixel) and hands it out by number. The per-tile path never calls
  `createPattern` and allocates nothing.

## The three variants

These are routes `/v/subtle`, `/v/shaped` and `/v/bold`, plus `/` (the blueprint, subtle) and `/variants` (an index with the three cards
and the theme toggle). They share the engine, the UI and the data, and differ only in their
`apps/web/src/variants/<id>/` expression and small UI overrides. They span the owner's range:

1. **subtle: patterns.** Every tile keeps its rectangle. Lenses differ by line patterns, hairline
   marks and small icon sets in fixed slots. In General, one tiny indicator per enabled lens sits in
   a strip, and a lens enlarges its own indicator into the tile's evidence line. Ink colours, except that
   a glyph takes its lens's health: amber to watch, red for trouble, faint when n/a or unmeasured
   (`apps/web/src/variants/subtle/marks.ts` `healthInk`, the one place that decides it; the General key
   shows the four).
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

The shaped and bold variants know the six built-in lens ids and
read their values from the facets through `apps/web/src/variants/base/legacy.ts`; for any other lens id they fall
back to the subtle manifest-driven channel and the default, manifest-driven sheet panel.

All three: General stays the clearest view. A lens is subtle yet noticeable in variant 1, and
unmistakable in variant 3. Every variant supports both themes and `?scale=4`.

## Live products

Kettle is built in and needs no server route. Its map, events and swarm (~770 KB) are a lazy chunk (`packages/core/src/data/sample.ts`, `packages/core/src/model/sample.ts`), fetched with a dynamic `import()` only when the sample is shown, so a live product's page never ships them: nothing on the live path imports them statically (the model barrel and `@/lib/data` carry types and the loader only). Any other product is a **live product**: a repo that the `/lens-scan` skill has scanned, opened with `?product=<slug>`. No `?product` means Kettle, exactly as before.

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

The blueprint reads the store through a read-only connection. Its own only write is a proposal decision, made on a short-lived read-write connection with a 2000 ms busy timeout (triage and release writes go through lens-scan's store.mjs: see Packs, triage and releases). The server code is `packages/core/src/server/store.server.ts` and `products.server.ts`. Both throw if loaded in a browser, and only route handlers import them. `node:sqlite` is a Node 24 builtin. It prints an ExperimentalWarning once per process, and it needs no `next.config` change.

**Wire convention.** The row types are in `packages/core/src/scan/types.ts`. JSON columns (`runs.lenses`, `runs.scope`, `shots.report`) arrive parsed. NULL columns are omitted, so the JSON never contains `null`. A feature with no measurement row is unmeasured. Store v4 (`proposals`): `origin` is omitted when it is `scan` (only `ado` / `sweep` travel), and `external_ref`, `external_url`, `tier` (0..3), `risk_class`, `ranked_by`, `ranked_at` are omitted when NULL; a v3 store reads with none of them (`store.server.ts` reads `SELECT *`, so absent columns are absent keys). The train's parser door (`packages/core/src/train/wire.ts`) holds tier to 0..3 and `risk_class` / `origin` to their enums. Checked by `npm run check:scan-wire` (a v4 row, a scan row, a v3 file).

**Routes.** All routes run on the Node runtime with `force-dynamic`. An unknown slug answers 404 `{ error }`.

| Route | Answer |
|---|---|
| `GET /api/products` | `ProductInfo[]`: `{ slug, name, root, live, readiness }`. `live` = `scan.db` exists. `readiness` (`packages/core/src/scan/readiness.ts`): `{ rootExists, map, mapVersion: 2\|3\|null, events, store, features, lenses, measuredFacets, proposals: n\|null (open), lastRunAt: iso\|null, error? }`, from stats, one cached parse of the map and one read-only store query; a broken product reports what it lacks and never breaks the list. `readinessLevel(r)` gives `missing` (no root or map), `map-only`, `measured` (readings in the store), `full` (measured + events log). |
| `POST /api/products` | Register `{ slug, name, root }`. **201** with the entry; **400** for a bad body, a slug outside `^[a-z0-9][a-z0-9-]{0,62}$`, `kettle`, an empty name, or a root that is not a directory; **409** for a slug in use. |
| `PATCH /api/products/<slug>` | `{ name?, root? }` (the slug never changes). **200** with the entry; **400**; **404** for an unknown slug. |
| `DELETE /api/products/<slug>` | Unregister: drops the line only, nothing on disk is deleted. **200** `{ slug }`; **404**. |

Registry writes (`packages/core/src/server/registry.server.ts`) rewrite `bp.products.local.json` atomically (temp file + rename), create it when absent, and keep unknown keys and entry order; a file that does not parse is never overwritten (**409**). They answer **403** unless the request is local: a loopback `Host`, a loopback `Origin` when one is sent, no cross-site `Sec-Fetch-Site`, and only loopback `X-Forwarded-For` hops.
| `GET /api/products/<slug>/structure` | `{ structure, events, rev }`. `events` is `''` when there is no log. `rev` fingerprints the map files (mtime and size of `app-structure.json` and `events.jsonl`), the string the stream's `map` event carries. 404 when `app-structure.json` is missing. |
| `GET /api/products/<slug>/scan` | `ScanSnapshot`: all runs, measurements, proposals, shots and coverage, plus the latest 200 activity rows in ascending id order. A missing store gives empty arrays. |
| `GET /api/products/<slug>/stream` | Server-Sent Events, described below. |
| `POST /api/products/<slug>/proposals/<id>` | Body `{ decision: 'approve' \| 'decline', note?: string }`. Sets `status`, `decided_by = 'blueprint'`, `decided_at`, `decision_note` and `updated_at`, but only while the status is `proposed`. Answers: **200** with the updated `Proposal`; **409** with the current row as the body (someone already decided, or the skill moved it on); **404** for an unknown id or a missing store; **400** for any other body (extra keys, a note that is not a string, a body that is not JSON); **503** when the store stayed locked past the busy timeout. |
| `GET /api/products/<slug>/shots/<path>` | The file bytes as png, jpeg or webp (by extension; no video type is advertised, nothing in the tree writes or plays one; anything else gets 415). `<path>` is relative to `<store>/shots`. A full `Shot.path` with its leading `shots/` is accepted too. **403** for anything that would resolve outside `shots/`: `.`, `..`, empty, absolute or drive segments, `\`, `/` or `:` encoded inside a segment (`..%2F..%2Fx`), NUL, and symlinks that point out. Plain `../` in a URL is collapsed by the HTTP layer before routing, so it never reaches the handler (Next answers 404). |
| `POST /api/products/<slug>/scans` | Body `{ lens, scope: ScanScope }`: queue a lens scan (`/lens-scan measure`). **202** with the `ScanJob`; **400** `{ error: 'unknown-lens' }` (not an enabled lens of the map), `'no-scan-method'` (no built-in method and no manifest `scan` block), `'bad-scope'` (a kind outside feature/bay/room/wing/all/selection, an empty label, an `id` or feature failing `SAFE_ID`, a feature the map lacks, `all` with features or an id, another kind without them, more than 200 selection features). `selection` is the ledger's selected features: no `id`, 1..200 features, each in the map; the UI labels it `Selection (n)`; **429** when 16 jobs are queued; **404** for an unknown slug or a product without a map. |
| `GET /api/products/<slug>/scans` | `ScanJob[]`, oldest first. |
| `DELETE /api/products/<slug>/scans/<job>` | Cancel: a queued job leaves the queue, a running one is killed with its process tree. **200** with the `ScanJob` (a finished one as it is); **404**. |
| `POST /api/products/<slug>/dispatch` | Body `{ ids }` (1..50 proposal ids). Each `proposed` id is approved through the decision write (`decided_by = 'blueprint'`), an `approved` one is taken as it is, anything else is skipped as `{ id, status }` (`unknown` when the store lacks it; `in-job` when a queued or running execute job already builds it, so a finding is never queued twice). Then one execute job (`/lens-scan execute`) builds them all: **202** `{ job, approved, skipped }` (`approved` = the ids this call approved, `job.proposals` = all of them); **409** `{ error, skipped }` when none can go (the Kettle sim answers the same error and list); **400**; **404** without a store; **503** when the store stayed locked. The admission rule is `packages/core/src/scan/admit.ts` (`admitForBuild`, `busyIds`, `canBuild`, `buildChunks`), the one copy this route, lens execute, wave dispatch, the scan sim, Build what is approved here and the ledger read (`npm run check:build-admit`). |
| `POST /api/products/<slug>/lenses` | Body `{ manifest, temporary? }`: add a lens to the map's `lenses[]` (spec 8.1). A permanent project lens (default; a reverse-DNS id) becomes `{ id, version, source: 'project', enabled: true, created_at, manifest }`; a temporary one (`temporary: true`, or a `tmp.` id) also carries `temporary: true`. The manifest must pass `checkLensManifest` in that mode with `taken` = the map's other enabled lenses' glyph+line looks, read inside the same atomic write. **201** the entry; **400** `{ error }` saying what failed (also for a non-boolean `temporary`); **404**; **409** when the id exists (any source) or the map does not parse. |
| `PATCH /api/products/<slug>/lenses/<id>` | `{ enabled }`: retire or restore a project lens (temporary or permanent). **200** the entry; **403** for a built-in (`source: 'builtin'`); **404**. |
| `DELETE /api/products/<slug>/lenses/<id>` | Remove a project lens's entry (temporary or permanent); its facets stay. **200** `{ id }`; **403** for a built-in; **404**. |
| `POST /api/products/<slug>/lenses/<id>/execute` | Body `{}`: execute the lens's backlog. Its `proposed` findings are approved through the decision write (`decided_by = 'blueprint'`), its `approved` ones taken as they are, in store order (created_at, then id), and execute jobs of at most 50 are queued over them. Skipped `{ id, status }`: `executing` / `done` / `failed` / `declined`, and `in-job` for one a queued or running execute job already builds. **202** `{ jobs, approved, skipped }`; **409** `{ error: 'nothing to execute', skipped }`; **400** `unknown-lens` (not in the map, or disabled); **404** unknown product / map / store; **429** `{ error, jobs, approved, skipped }` when the queue cap stopped it (the approvals stand; `jobs` holds the ones queued); **503** when the store stayed locked. |
| `POST /api/lens-draft` | Body `{ product: <slug> \| 'kettle', message (1..4000), session?, kind?: 'project' \| 'temporary' }` (kind defaults to `project`): one turn of the lens onboarding chat. The first turn's prompt is `/lens-scan onboard --draft-only [--temporary]` followed by the message (the contract lives in the lens-scan skill, `references/lens-onboarding.md`); later turns `--resume` with the message alone. The last fenced `lens-manifest` block is checked with `checkLensManifest` in the kind's mode (a live product's taken looks included). **200** `{ session, reply, done: false }`, `{ session, reply, draft, done: true }` or `{ session, reply, done: false, error }`; **400** (also a bad `kind`); **404**; **502**; **503**; **504**. |

**Scan jobs** (`packages/core/src/server/jobs.server.ts`). For a live product the scan routes run the Claude Code CLI headless in the product repo: `BP_CLAUDE_BIN`, else `claude` on PATH (on Windows `claude.exe`, `.com`, then a `.cmd`/`.bat` shim through `cmd.exe`, whose command line then holds only the shim path and characters with no meaning to cmd; a `.js`/`.mjs` path runs on the server's Node). Its argv is fixed, `-p --dangerously-skip-permissions --output-format text`, and **the prompt goes on stdin**, never on the command line: `/lens-scan measure --lens <lens>[ --scope <feature,...>]` or `/lens-scan execute --proposals <id,...>`, every id held to `SAFE_ID` and to the map or the store first. **Every job runs with `--dangerously-skip-permissions`** (the operator's choice: a headless run cannot answer permission prompts), so it can edit and run anything in that repo; the routes stay localhost-only. The env adds `BP_JOB_ID`, which lens-scan writes into its run's note (`bp-job:<id>`, or `bp-job:<id> <more>`): the job takes that run's id (`run_id`) from the stream, and at exit from the store. A registry per product on `globalThis` (it survives a dev reload) keeps the latest 50 jobs, at most 3 running and a FIFO queue of at most 16. Status: `queued` → `running` → `done` (exit 0 with a run), `failed` (another exit code, with the last stderr line or `exit <n>` as `error`; or exit 0 with no run, with lens-scan's `lens-scan refused: …` line; or `Claude Code CLI not found (set BP_CLAUDE_BIN)`), or `cancelled`. Each job logs stdout and stderr to `<root>/.ai/lens-scan/work/bp-jobs/<job>.log` and keeps its last 20 lines (at most 2 KB) as `log_tail`. The stream sends `event: jobs` (`ScanJob[]`) after each snapshot when the product has jobs, and on every change of the registry (log lines at most every 400 ms). `useLiveProduct` returns `jobs` (`[]` before the first event; it changes only on a discrete change: a job added, a status, a run attached, so a log line re-renders nothing); `useLiveJobs(slug)` follows every event, log lines included. Fetch helpers: `postScan`, `postDispatch`, `deleteJob`, `postProjectLens`, `patchLens`, `deleteLens`, `executeLens`, `postLensDraft`, each rejecting with an `Error` that carries `status` and `body`. Every request is bounded: it gives up at `REQUEST_TIMEOUT_MS` (20 s) and rejects with the abort (a `TimeoutError`); `postLensDraft`, the one slow route (its own 504 at 3 minutes), has its own `LENS_DRAFT_TIMEOUT_MS` (200 s) and also takes a caller `signal`, so a turn can be cancelled. The onboarding chat runs `claude -p --output-format json --dangerously-skip-permissions [--resume <session>]` the same way; its first turn is `/lens-scan onboard --draft-only [--temporary]` and the user's message (`onboardPrompt` in `packages/core/src/scan/lens-draft.ts`); the contract lives in the lens-scan skill. A selection scan's prompt is `--scope <slug,...>` like any other kind. A lens execute queues one `/lens-scan execute --proposals ...` job per 50 ids. Actions `startSelectionScan`, `executeLensBacklog` and `addProjectLens` sit beside `startScan`; the Kettle sim answers the same (`ScanSim.executeLens`, selection scopes), and `addProjectLens` writes this browser's store (`temp-lens.ts`, which now keeps project entries too) under the same checks (400 / 409). Project-lens writes (temporary or permanent; never a built-in) (`packages/core/src/server/lens-write.server.ts`) rewrite the map atomically (temp file + rename), keeping key order, unknown keys, indentation and line endings, and never overwrite a map that does not parse; the stream's `map` event carries them to every client. `npm run check:scan-jobs` drives all of it against a fake CLI (`scripts/fixtures/fake-claude.mjs`).

**SSE semantics** (`/stream`). One long-lived read-only connection per client:
- `event: snapshot`: a `ScanSnapshot`, sent on connect. While the store file does not exist, it is sent with empty arrays and the route keeps checking. It is sent again, in full, once the file appears.
- `event: delta`: a `ScanDelta` (same keys, only new or changed rows). Each second the route reads `PRAGMA data_version` on the same connection. That value changes only when another connection commits (the skill, or a decision), so an idle store costs one pragma a second. When it changes, the route sends the rows past its cursors: measurements, activity and shots by `id`; runs, proposals, packs and releases by `updated_at`; coverage by `judged_at`. Rows that tie on a timestamp are not resent. Empty deltas are not sent. A store already open when the stream connects shows a new row within about 1 s.
- `event: map`: `{ rev }`, the fingerprint of the map files. Sent once the map exists (after the snapshot) and again whenever it changes: the skill writes each metric's latest value back into the map's facets (spec 15). Checked each second with two `stat` calls, independent of the store. The client refetches `/structure` when `rev` differs from the one it holds.
- `event: ping`: `{ at }`, sent after 15 s without another event.
- `event: error`: `{ message }`, sent when the store file exists but cannot be read (corrupt, mid-migration, locked past the timeout). It is sent once per distinct message, never in place of the empty snapshot of an absent store; the route keeps retrying and a good read sends a snapshot. The client shows status `error` with the text until then.
- When the client disconnects, the interval stops and the connection closes. If a read fails (the store was replaced or stayed locked), the route reopens on the next tick and sends a fresh snapshot.

**Client** (`apps/web/src/lib/scan/client.ts`):
- `useLiveProduct(slug)`: `null` gives `{ status: 'missing', events: '' }`. Otherwise it fetches the structure (404 gives `missing` with the `error` text), then follows `/stream`. It refetches the structure when the stream sends `map` with a new `rev`, and when the latest run leaves `running` (a body equal to the one held changes nothing; a failed fetch keeps the old map and retries after 3 s); `structureRev` counts the maps taken. It replaces the scan on `snapshot` and merges each `delta`: rows are upserted by id, coverage by `(feature, standard)`, and only the latest 200 activity rows are kept. Status: `loading` until the first snapshot; `live`; `missing` while the repo has a structure but no store (features read unmeasured; it turns `live` when the store appears); `offline` while reconnecting (the hook reopens the EventSource with backoff of 0.5, 1, 2, 4, 8 s, then every 10 s); `error` when the structure request fails, or when the stream sends `event: error` (the store exists and cannot be read; the header pill reads `Scan store error` with the text, and the next snapshot clears it).
- `decideProposal(slug, id, body)`: resolves to the updated `Proposal`. It rejects with an `Error` that carries `status`, plus `proposal` on a 409.
- `swarmFromScan(scan, features)`: builds the swarm feed from the latest run (`features` are ids, or `{ id, domain, capability }` so a run's `scope` can be matched: the same rule as the timeline's `scopeFeatures`; an agent's progress is the features its lens measured in this run over the features in scope, not over all). The scan is indexed once per measurements table (`packages/core/src/scan/derive.ts`: latest reading per feature, lens and metric; features measured per run and lens), so a delta costs one linear pass, not a scan per proposal and lens. One squad and one agent per lens (`scan-<lens>`, `scan-<lens>.1`, role `research` whatever the lens), each on the feature of its lens's latest activity row. Agent status: `idle` once the run is no longer running; `failed` if the lens's latest activity is an error; `waiting` when an open proposal exists for the lens; otherwise `working`. One decision per `proposed` proposal, with options Approve and Decline; urgency from risk (7 or more high, 4 or more medium); the proposal a waiting lens agent stands on holds that agent (`blocksAgents` 1), every other one holds none. The replay is the run's activity, `t` in seconds since the run started.

**How the app draws it** (`BlueprintApp`; `packages/core/src/model/live-feed.ts` for the model and feed, `live.ts` for the scan indexes):
- The model is built once the structure is in and the stream has answered: `buildLiveModel` reads the map with the same loader as Kettle (`loadMap`), and the swarm is `liveSwarm(P, scan)`: `swarmFromScan` with what a scan cannot know filled in. The decider is the person the map names (`liveDecider`: the human whose `field` is the proposal's lens, the feature's owner first when several are; else the feature's owner when that is a human; "whoever reviews" only when the map names nobody), so Review groups "Waiting for <person>" on a live product too; the domain is the feature's own, and a question on a feature the map lacks is dropped.
- **Readings and map refreshes in place.** The map the page loaded can be older than the store, and a newer map arrives while it is open; neither rebuilds the model or moves anything. (1) *Readings*: `applyScan(M, scan)` (`live-feed.ts`, `live-health.ts`) takes the measurements past the ones it has seen and, per touched (feature, lens), lays the latest reading of each metric over the load-time facet value when it is not older than the facet's `measured_at` and fits a numeric, unbound field, then re-evaluates the lens with the standard evaluator (`evaluateLens`) and updates the feature's lens record, General health and trouble in place at every product line; the aggregates are cleared. `sim.liveValue`, the tile health, the headline and the metric rows therefore agree, and the cost is the touched features only. An emptied or replaced store restores the map's own values. (2) *Map*: `refreshLiveModel(M, structure, events, scan)` copies the new map's fields, lens records, KPIs and activity onto the same `Feature` objects (layout, caches and references stay; the time axis and as-of date stay), lays the readings over again and restamps the sim; a map that differs in shape (a feature added, removed or moved, other links or lenses) updates what both maps have and toasts that a reload places the rest. `sim.healthV` counts these in-place changes.
- **The sim's live mode.** The sim does not play a live scan as a replay: there is no recorded hour. Every later scan goes in place through `engine.feed(liveSwarm(...))` → `SwarmSim.applyFeed`. The agents are set from the feed (an agent whose feature changed travels there with the usual animation), questions new to the feed open (with a "New question" toast once a run has been seen), questions it no longer lists close, and its activity rows not shown yet go to the log, the pulses and the ticker. The engine, the layout and the static cache are untouched; only a new structure builds a new model. Nothing plays, so the frame loop sleeps between feeds. A new activity row moves its agent within about 1.5 s (1 s stream poll, then one frame).
- **Time.** Waits and ages use the wall clock (`sim.clockMs()`); event times are seconds since the run start, so the ticker reads real times. The bottom bar's clock box shows the run (start, `● LIVE · <phase>` or its status, lenses, agents) instead of the sim hour, and the revisions strip drops the hour ahead (no replay to scrub, no arrivals).
- **What a scan cannot fill** is not shown as zero: spend and tokens are hidden in live mode (sheet, hover card, morning watch, the steering panel). The Kettle-only steering (Payments GA push, the research crew's spend cap) is hidden; the GA mode (its View button, the `G` key, `#ga=1` and its overlay) exists only when the map has the `payments-ga` milestone; the search placeholder drops the Kettle example; pause, push and orders steer the sample swarm only: on a live product they are not offered and `Engine.preview` / `commitPreview` refuse them (`commitSample`, `apps/web/src/lib/model/live-steer.ts`), and a feed clears any `paused` left on an agent it updates. The "While you were away" digest is Kettle's and is not offered.
- **Steering a live product** (`apps/web/src/lib/model/live-steer.ts`, `apps/web/src/components/LiveSteer.tsx`). With a selection, the selection bar and the Agents overview offer three real verbs, each planned from the map, the stream's jobs and the scan (`planLive`, pure) and shown under the usual "ADDENDUM · NOT ISSUED YET" preview with Commit / Cancel (Enter / Esc): **Measure here** queues one `selection` scan per scannable lens over the selection's base features (the first 200), and the preview says how many start now and how many wait from the registry's limits (`MAX_RUNNING` 3, `MAX_QUEUED` 16 in `packages/core/src/scan/jobs.ts`); **Build what is approved here** dispatches ONE execute job over only the proposals already `approved` there (at most 50; ones a running or queued build holds are left out) - `dispatch()` approves what it is given, so it is never given a proposed one and the Review queue stays the only place anything is approved; with nothing approved it is unavailable and says why; **Stop work here** cancels the queued and running jobs whose scope (or execute job's proposals' features) meets the selection, and says which of them also cover places outside it. A verb that cannot run stays visible, marked unavailable (dashed), and says why when pressed. Refusals toast in words (`refusalText`); the swarm answers through the existing paths (the jobs become scan views, the store's rows reach `applyFeed`). Checked by `npm run check:live-steer`.
- **Project switcher** (`apps/web/src/components/ProjectSwitcher.tsx`, `ProjectsDialog.tsx`). In the header, before the pill: the current project's name, and a menu of Kettle (sample) and every registered product with its readiness as a shape and a word (dashed square = no map, outline = map only, half = measured, filled = full; diamond = the sample), then "Manage projects…". Choosing one loads `?product=<slug>` (no parameter for Kettle) on the same route with the other query parameters kept. The dialog adds, renames, re-roots and removes products, with the readiness checklist per row. A live product that cannot be drawn shows the switcher alone at the top right. A live product's tab title is `<name> · blueprint`.
- **Header pill.** One verdict (`packages/core/src/scan/liveness.ts` `scanLiveness` / `livenessWords`, checked by `npm run check:scan-liveness`) words every scan-status surface. `Live · <phase>` while the latest run is running, `Stalled · last update <age>` when it still says running but has shown no sign of life (its row's update or its newest activity row) for `SILENT_MS` (10 min), `Last scan [failed|aborted] <age>` once it ended, `Offline` while the stream reconnects, `Scan store error` when the store cannot be read, `Connecting` before the first snapshot, `No scan store` before the skill wrote one, `No scan yet` with a store and no run. The phone's pill is the short form of the same verdict (`Live scan`, `Stalled`, `Scan error`, the rest as above); the timeline strip and clock say `● LIVE · <PHASE>`, `STALLED` (warn tone) or the run's status; the plan draws a job silent for `SILENT_MS` as `stale`, and the Agents figure does not count it as running. Kettle shows nothing.
- **Queue cards.** A live question is a proposal card: the title, `metric: before → expected` with the unit (before = the latest reading of that feature, lens and metric in the scan; expected = before + `expected_delta`), the standard tag (`no standard` for `none`), size and risk, and Approve and Decline. Decline opens an inline note field (optional, no modal); Enter or the Decline button sends it. Approve is option 0 and Decline option 1, so the decision card and the keys 1 and 2 decide too (without a note). The card also says the proposal's one-line summary (first sentence of the body's Summary, shown when it adds to the title; the decision card carries the same line) and folds a **Details** region (a button with `aria-expanded`): the Summary, Impact and Evaluation sections of the body as plain-text paragraphs (never rendered as HTML; a missing section reads "Not stated."), the evidence and method of the reading behind the before value, and `parent_id` / `after_value` when set. Kettle's sample cards are unchanged.
- **Answer tracks** (`packages/core/src/scan/track.ts` `trackOf` / `tracksOf`, pure; `packages/core/src/model/live-tracks.ts`; the canvas layer `apps/web/src/engine/render/tracks.ts`). A decided proposal leaves the queue but stays on its tile until the store has evidence for it: one stage glyph and a 12 px label at the tile's bottom-left (the newest track; "+N" when the tile has more; the label only where it fits left of the question pins), and "N tracked" beside each room's question pin at the overview levels, culled to the viewport. Stages, read from the store's own record so the same marker returns after a reload: `saving` (the decision's POST is out; a 409 shows the decision the store holds, by whom) -> `approved` -> `building` (an execute job holds it, with the job id) -> `built on branch 46 (expected 52)` (its `after` reading on the pack branch, never the product's) -> `accepted` -> after the release, `confirmed` only when a current reading taken after the release meets the expected value (baseline + `expected_delta`, in its direction), `measured 50, expected 52` (not confirmed) when it falls short, `unknown` with no metric or no reading since; also `declined`, `build failed`, `sent back for rework`, `descoped`. A current reading taken before the release is labelled an observation, not evidence. Shown: decided in the last 14 days, or not finished. Tracks are not questions: the queue, J/K and every count stay proposed-only. Hover shows the record (expected vs branch vs current, job, commit, release); a click opens it beside the plan with its one next verb (`approved`: Build what is approved here; `building`: Stop work here; released and not confirmed: Measure here to confirm, its lens only), through the same NOT ISSUED YET preview as the selection's live verbs (`trackPlan`). Checked by `npm run check:live-tracks`.
- **Deciding** is optimistic: every product line's copy of the question closes at once and the agents it held go back to work. The decision is written to the store, so there is no undo. A refusal rolls it back with a toast saying why; a 409 says "Already decided elsewhere" and leaves the question closed (the next feed shows the other answer).
- **Empty states.** An unknown slug, or a repo without a structure, shows the standard empty state: "No scan store at `<root>/.ai/lens-scan`" (or "No product … in bp.products.local.json"), with a link to Kettle. A repo with a structure but no store loads, says "No scan store yet" in a toast and the pill, and every feature reads unmeasured.

### Packs, triage and releases (server)

lens-scan 1.5 builds approved items into a **pack** (`packs`: one lens's items on `pack/<short>-<n>`, never merged to main), a person **triages** each built item (accept, rework, descope), and accepted items ship in a **release** (`releases`: draft → building → pr-open → merged → tagged, or failed). The store is v3 (`docs/standard/lens-scan-store.sql`; v3 adds `proposals.triaged_from`, the status an item left at its latest triage, for the undo below; lens-scan 1.6.0 migrates a v1 or v2 file on open); a v1 store reads with `packs` and `releases` empty, never an error. `ScanSnapshot` carries both arrays; the stream sends them in a delta by `updated_at` like proposals, and the client upserts them by id. Measurements carry `proposal_id`, `phase` (`before` | `after`) and `commit_sha`; shots carry `proposal_id` and `phase`. **An `after` reading is never the feature's current state** (it was taken on an unmerged pack branch): `derive.ts` `isCurrent` keeps it out of `latestReading`, `metricHistory`, the live model's readings and the ledger's "before", as store.mjs `latest` and `gaps` do. Pure helpers: `packages/core/src/scan/compare.ts` (`compareOf(scan, id, lenses?)` → `{ p, before, after, shots, verdict, from?, to? }`, mirroring store.mjs `compare`; `verdict` is `moved` / `flat` / `worse` / `unmeasured` from the lens field's `better`, else the sign of `expected_delta`; `packItems`, `releaseItems`, `unreleased`, `packGroups` with counts per status) and `packages/core/src/scan/release.ts` (`suggestVersion`, `RELEASE_ID`). Checked by `npm run check:release-train`.

The blueprint never writes a triage or release move itself: `packages/core/src/server/release.server.ts` runs lens-scan's own `store.mjs` (`BP_LENS_SCAN_DIR` when set, and then it is the only place looked; else `~/.claude/skills/lens-scan` and then `<registry.local>/skills/lens-scan` for the registry `.ai/manifest.yaml` declares — all through realpath) with `execFile node … --db <root>/.ai/lens-scan/scan.db`, so store.mjs stays the single owner of the transition rules. Who triages is `user:<gh login>` (`gh api user --jq .login`, once per server process, 5 s timeout), else `user:blueprint`. The stream sees every such write through `PRAGMA data_version` like any other commit. All routes are localhost-only; writes need `Content-Type: application/json`.

| Route | Answer |
|---|---|
| `POST /api/products/<slug>/triage` | Body `{ ids (1..200, SAFE_ID), decision: 'accept' \| 'rework' \| 'descope' \| 'reopen', note? }` → `store.mjs triage`. **200** `{ decision, by, triaged, skipped: [{ id, status, reason? }], packs_triaged }`; **409** with the same body when nothing moved (e.g. `reason: 'note-required'` for a failed item accepted without a note, `in-release`); **400** bad body (its message names the four decisions); **404** unknown product or no store; **503** lens-scan not installed or the store stayed locked. **`reopen`** is the undo: an `accepted`, `rework` or `descoped` item goes back to its `triaged_from` (`done`, `failed`, `accepted`, `rework`, `proposed` or `approved`), its note and `triaged_from` cleared, out of a draft release; the answer's `decision` is `reopened`, plus `packs_reopened` (a `triaged` pack whose item is back at `done`/`failed` is `open` again; the parser door leaves it out). One step deep: a reopened item has no `triaged_from`. Skipped per item: its status when it is not accepted/rework/descoped, `no-prior-status` (a call made before v3), `in-release` (its release left draft), `rebuilt` (a rework whose rebuild exists), `pack-closed`. |
| `GET /api/products/<slug>/commits/<sha>` | One item commit for the compare panel. `sha` 7-40 hex, the `commit_sha` of a proposal in the store or a prefix of it (never an arbitrary object of the repo). Three `git show`s in the product root (`release.server.ts` `commitDiff`). **200** `CommitDiff { sha (full), message (trailers included), stat (git's), files: [{ path, add, del }] (a binary file 0/0), patch, lines, truncated }`, the patch cut at 2000 lines (`lines` is the full count), `cache-control: private, max-age=3600`; **400** not 7-40 hex, or a prefix of two item commits; **404** unknown product, no store, not an item commit, or a commit the repo lacks; **503** the store unreadable or git not run. |
| `GET /api/products/<slug>/releases/suggest` | **200** `{ version, from, reason }`: the latest `v*` tag (`git tag --list 'v*' --sort=-v:refname`) bumped minor when an accepted item with no release is a `baseline-upgrade` or says `capability: new`, else patch; with no tag the manifest version as it stands (`package.json`, `Cargo.toml` `[package]`/`[workspace.package]`, `tauri.conf.json`, at the root, `src-tauri`, `app`, `desktop` or `apps/<x>[/src-tauri]`), else `0.1.0`; a version that already has a release is passed over. |
| `POST /api/products/<slug>/releases` | Body `{ version (semver, no v), ids? }` → `release-create --version --by`, then `release-add --ids` (default: every accepted item with no release). **201** `{ release (with items), added, skipped }`; **409** when no named item is accepted and free, or the version exists; **400**; **404**; **503**. |
| `POST /api/products/<slug>/releases/<id>/build` | Body `{}`. A **release job** `/lens-scan release --id <id>`. **202** the `ScanJob`; **409** unless the release is `draft` or `failed`, or while a job of that release is queued or running; **412** `{ error: 'gh not authenticated' }` when `gh auth status` fails; **400** an id that is not `rel-<semver>`; **404**; **429**. |
| `POST /api/products/<slug>/releases/<id>/finish` | Body `{}`. A release job `/lens-scan release --id <id> --finish`, from `pr-open` or `merged`; same codes. |
| `GET /api/products/<slug>/plan` | `{ rev, lenses, wings, rooms, bays, tiles }` (packages/schema plan-1): the structure route's map laid out by core's layout, every tile's health per enabled lens. Boxes are world units, ids and parent ids are strings, `rev` is the structure route's. **404** for an unknown slug or a missing structure file; the built-in `kettle` slug answers the sample, read-only, in the same shape. |
| `GET /api/products/<slug>/waves` | `{ waves: Wave[] }`: the product's waves (none when the file is missing or unreadable). Kettle's sim keeps its own, in memory. |
| `POST /api/products/<slug>/waves` | Body `{ name, packages: [{ name, model, effort, ids }] }`: a draft wave of named packages (`packages/core/src/scan/waves.ts` `checkWaveBody`), numbered `pk-1`... **201** `{ wave }`; **400** `{ error }` for a bad body; **409** `{ error, taken }` when a finding is in another draft wave; **429** at 50 waves; **404** for an unknown product or a missing store. |
| `PATCH /api/products/<slug>/waves/<wave>` | Body `{ name?, packages? }`: change a draft wave (the packages replace the old ones and are numbered again). **200** `{ wave }`; **400** for a bad body or wave id; **404** for an unknown product, wave or missing store; **409** `{ error }` when the wave was dispatched, `{ error, taken }` when a finding is in another draft wave. |
| `DELETE /api/products/<slug>/waves/<wave>` | Delete a draft wave. **200** `{ id }`; **404**; **409** when it was dispatched. |
| `POST /api/products/<slug>/waves/<wave>/dispatch` | Body `{ packages?: string[] }` (default: every package): one `execute` job per package (and per 50 findings), run with the package's own `--model` and `--effort`. `proposed` findings are approved (`decided_by` `blueprint`) and `approved` ones taken, unless a queued or running execute job already builds them (skipped as `in-job`); the first job makes the wave `dispatched`, later calls append. **202** `{ wave, jobs, approved, skipped }`; **409** `{ error, skipped }` when none could go; **400** for a bad body or package; **404**; **429** when the queue cap stopped it (jobs so far are recorded, approvals stand); **503** when the store stayed locked. |

**Release jobs** are `ScanJob`s of `kind: 'release'` with `release`, `version` and `step` (`build` | `finish`), in the same registry, caps, logs and `jobs` events as measure and execute jobs; the Agents panel names one `Release 1.4.1 · build` (`jobLabel`). Matching: the cut's release-head measure run carries `bp-job:<id> · release <rel> at <sha>`, which attaches as `run_id`; but a release job ends **by the release's status in the store**, read at exit (a finish starts no run, and a cut can fail after its run): `done` when a cut left it `pr-open` (or later) or a finish left it `tagged`, else `failed` with lens-scan's `lens-scan release failed: …` / `lens-scan refused: …` line, or the release's `error`. `check:scan-jobs` drives draft → building → pr-open → tagged over the fake CLI and a fake `gh` (`BP_GH_BIN`).

**Demo product.** `node scripts/scan-demo.mjs [--dir .demo/kettle-live] [--reset] [--live] [--now <iso>] [--no-register]` builds a sample live product from the Kettle map and registers it as `kettle-live` (create or merge, idempotent; `--no-register` skips it). Its store is a projection, not a second catalogue: lenses, metric keys, units, methods and directions are the copied map's lens manifests, the measured features are exactly those whose facet carries a metric value, and the latest run reads that facet value, so `?product=kettle-live` and `/` agree on every measured number (`check:scan-demo`). It also carries Kettle's sample release train (`packages/core/src/model/train-sim.ts`, the packs and numbers `/` shows): packs k-des-1, k-des-2 and k-perf-1 with their built items (done, failed, a rework and its rebuild), phased readings whose baselines end on the map's facet values, two items accepted and a draft release of them, and the item shots as PNGs under `shots/<run>/`, so the Release Ledger and the live smoke meet real packs and releases rows (`check:scan-demo-train`). Open it with `?product=kettle-live`.
- The seed has two finished runs a week apart, with development, security and design metrics on 20 features. It also has 7 proposals in mixed states, including one baseline upgrade with two propagation children, 6 coverage rows, and placeholder PNG shots of 2 features × 2 themes per run.
- An existing store is kept, because an open stream may hold it. `--reset` recreates the store.
- `--live` adds a running run. It writes an activity row every 1.5 s, a measurement every 3 s and a proposal every 20 s. Ctrl-C marks the run done; a run left `running` by a hard kill is marked `aborted` at the next `--live`.
- `.demo/` is gitignored. All of it is invented sample data.

## Metric rows

A lens field with `metric` (app-structure v3.1) is a measured metric: its key is the metric key in the scan store and its latest reading is the facet value. In the feature sheet, every lens panel ends with its metric rows (`MetricRows` in `apps/web/src/components/sheet/LensPanel.tsx`), after the panel's own evidence fields, whichever variant draws the panel. They come from the manifest alone; there is no lens id in the code.

- A row reads the label, then the value with its unit (the manifest's unit, else the reading's), and an arrow against the previous reading (▲ or ▼) coloured by `metric.better`: mint when it moved the better way, red when it moved the worse way. No arrow when it did not move or there is one reading.
- The second line holds a 64×16 SVG sparkline of the history, the target (`target 0`; the sparkline draws it as a dashed amber tick), and the method tag (`static`, `probe`, `harness`, `judgement`, the reading's method else the manifest's).
- History is the scan's readings of that feature, lens and metric, ordered by `measured_at`. Kettle has no store, so its single point is the facet value. One point shows the value only (no arrow, no sparkline). No point reads `—` like any other absent value.
- In General a panel shows its measured metrics, at most three, then "N more metrics in the lens reading". When the lens stands alone it shows every metric field, unmeasured ones as `—`. A collapsed panel (another lens chosen) shows none.
- The sparkline is React SVG in the sheet. Nothing about metrics runs in the canvas frame loop. Text stays at the 12 px floor.
- **Evidence** (2026-10-14). On the feature page's lens tab (`apps/web/src/components/page/LensTab.tsx`), each row in "Measured"
  carries the latest reading's `evidence` text under it (on a past date: the latest reading by then), 14 px, two lines
  clamped, a **more** / **less** toggle only when it runs longer. It is the store's `measurements.evidence`, so it is
  where a judgement lens explains its number: the bottleneck behind Operations' capacity estimate and the listed
  limitations, Business' unhandled cases, Quality's untested paths. A reading without evidence (every Kettle sim
  reading) shows nothing extra.

## Business section

When a feature has any of `experience`, `core` or `variations` (v3.1), the sheet shows a Business section after the lens panels (`apps/web/src/components/sheet/Business.tsx`). It is hidden when all three are absent.

- **As-is:** the customer experience today, one paragraph.
- **Core · what every variation shares:** two bullet lists, Shared tech and Core schema.
- **Variations:** a compact table with one row per variation: its name and audience, the bullets it adds to the core, its parameters, and a stage chip (the stage symbol and word). Lens values stay on the core feature, so a variation has no lens reading of its own.

The Kettle sample's `invoice-ocr` (Paper invoice to payment) carries all three, with three bank variations.

## Screens strip

For a live product whose scan has shots of the feature, the sheet shows a Screens strip after the Business section (`apps/web/src/components/sheet/Screens.tsx`). Kettle has no store, so no strip.

- One thumbnail per size and theme: the latest run that has it, served by `/api/products/<slug>/shots/<path>`. A red badge counts the console errors its harness report records (`report.consoleErrors`, a count or a list).
- A thumbnail opens the viewer under the strip (not a modal). Run A and run B are selectors over the runs that have that size and theme; they default to the latest two. With two runs it compares them side by side or as a swipe (a range slider over the stacked images). With one run it shows that one and says compare needs two. Escape closes the viewer, not the sheet.
- Images load lazily and are never committed to the repo.
- **Not screenable** (2026-10-14). The lens-scan harness never fakes a shot: a feature it cannot render in a browser
  (a desktop shell's window, say) gets an activity `note` "unscreenable: <why>". When the feature has no shots and
  such a note exists for the lens (or for no lens), the lens tab's Screens section says "Not screenable in a browser:
  <why>" (the newest note) instead of nothing. Native window capture is a follow-up, not this build.

## Chrome and the feature page (2026-10 overhaul)

The owner's verdict: L0 was oversaturated, and L4 tried to hold too much at once. The chrome now
gets out of the plan's way, and L4 is a page. Earlier sections that say "dock", "bottom bar" or
"sheet" mean the rail, the timeline and the feature page below.

- **Collapsed chrome sets the plan's safe area; expanded chrome overlays it.** The collapsed
  sizes live in `apps/web/src/engine/chrome.ts` (`railWidth`, `baseHeight`) and are the only numbers the
  home fit reads. Anything that opens on click overlays the plan and never moves it. This is the
  spatial-stability rule.
- **Rail** (`apps/web/src/components/Dock.tsx`, `rail/`, `rail.css`): a 64 px column of counters.
  - The counters are Find, Asks/Review, Agents, Orders, Steer (Kettle only), Plan and View.
  - The rail never changes width and never opens by itself. Each counter opens its own flyout over the plan.
  - Find is a 340 px search. Every other flyout is a **workbench** (`rail/wide/`, chosen on 2026-10-15 over a
    column board and a table): three times as wide (`min(1020px, viewport − rail − 48px)`), opaque, a strip of key
    figures over two panes, a list on the left (J/K and the arrows walk it) and the selected item read in full on the
    right, each pane scrolling on its own. Type: body 15–16 px, meta 13 px, labels 12 px mono, titles 20–24 px,
    figures 28–38 px mono.
    - Review: the proposal or question, its metric move as a before → after figure, every body section open, and a
      sticky Approve / Decline (live) or the answers (Kettle). Agents: an overview (steering, the swarm's latest
      lines), each scan job (progress, clock, Cancel, log), each crew (agents and tasks). Orders: breached first;
      an order's words, scope, breaches and governed features (the plan outlines its places while it is selected),
      and a writer that turns the selection into an order from the four templates. Steer: spend against the cap by
      crew, the two presets with the standing order each rests on and their preview, and steering for the
      selection. Plan: the room schedule or the features in trouble, a feature's health by lens, or the legend,
      title block and keys. View: window, modes, whose desk and health as sections.
    - The flyout reports its measured width to the engine (`setFlyoutWidth`), so the hover card, the decision card
      and the selection bar keep to the plan left of it. With Agents, Orders or Steer open the selection bar steps
      aside: those panels carry the same controls and preview.
    - A pending steer preview (NOT ISSUED YET, Commit / Cancel) always has exactly one visible seat, decided once by
      `previewSeat` (`apps/web/src/lib/model/preview-seat.ts`): the selection bar, unless Agents, Orders or Steer is
      open with the rail shown; then the panel row that owns it (a Steer preset's own row, Steer's selection row,
      Orders' writer, the Agents overview), selected once when the preview arrives, else - no row owns it, or the
      reader moved off that row - the workbench's own pending bar over the detail's foot. So Enter never commits a
      preview the reader cannot see. No panel reads the preview's kind or order itself. Checked by
      `npm run check:preview-seat` and `check:rail-keys` rule 11.
  - Esc, the same counter, or a click on the plan closes it. Only one flyout is open at a time.
  - A changed count counts up or down and pulses once, at most every 3 s.
  - Keys: `/` opens Find, `\` hides the rail, `P` opens View.
- **Timeline** (`apps/web/src/components/BaseBar.tsx`, `timeline/`, `timeline.css`): a 28 px strip (24 px
  compact); with its margin it takes the 42 px (36 px) `baseHeight`.
  - It shows the time position, the sim clock or the run status, and a hairline you click or drag
    to time travel.
  - Click or `T` expands the full panel (key plan, clock and speeds, the revisions chart, the hour
    ahead) over the plan, up to the rail's edge. It never expands on hover.
  - The timeline panel and a rail flyout close each other.
  - When the strip shows a travelled date it turns accent, with "back to now".
  - Strip and panel share one scrub (`timeline/scrub.ts`, `check:timeline-scrub`): same date and hour
    mapping, same hour zone and snap to now, and a drag ends on release, cancel or lost capture. The
    hour only moves forward: dragging left of the head leaves it clamped and shows not-allowed.
    With one week of history the slider is inert and says why. A keyboard-activated key plan flies
    to its centre, never off the plan.
  - Strip and panel are one slider (`timeline/slider.ts` + `shared.ts` `useTimeSlider`,
    `check:timeline-slider`): one geometry builder, inert rule, ARIA and still title, one key map, and
    Escape declared per slider (strip: collapse, else back to now, else leave; panel: collapse). The sim
    transport is worded once: `HISTORY` / `● ×4` on the strip, `HISTORY · PAUSED` / `● LIVE · ×4` in the
    panel, and the play button names what Space does (back to now, replay the hour, play or pause).
  - A live product has no replay hour. The area right of "now" shows its latest run (status, features
    measured against the run's scope, elapsed time or "<age> · <duration>", worded like the header's
    "Last scan <age>"); with no run the history takes the full width. `timeline/run.ts`,
    `check:timeline-run`.
  - The revisions chart is titled "Features by stage, per revision" (it stays when the panel is compact)
    and labels the stage bands at the right edge (name and count at the travelled date) where a band
    is tall enough for 12 px text; the ink scheme is unchanged. Strip and panel format dates with `fmtD`.
- **Feature page** (`apps/web/src/components/FeatureSheet.tsx`, `page/`, `page.css`). The page replaces
  the drawer.
  - **Open and close:** the tile morphs into a full page, animating only `transform` and opacity.
    The plan dims behind it (a token colour only: never a `backdrop-filter` over the live canvas,
    see `docs/perf.md`), and Esc morphs back into the tile.
  - **Tabs:** General plus one tab per enabled lens. A tab switch also switches the plan's lens,
    and opening from a lens view lands on that lens.
  - **General** is the overview: a stat tile per lens, the swarm, Business, dependencies and
    activity.
  - **Lives in code** (`page/CodeTree.tsx`, General): each context the feature belongs to, its group and
    its file paths (six shown, the rest behind "N more"), read from the map's contexts (the live product's
    structure, else Kettle's). A feature with no context shows no section.
  - **A lens tab shows that lens only.** Its blocks are chosen by data, never by lens id: metric
    rows when the lens has metric fields; the Screens strip when it has harness metrics and
    shots; Business when its reader role is `business`; and its KPIs, decisions and orders.
    Density follows `reader.density`.
  - **What clears it** (`standard/clear.ts`, `check:clear-path`). Rules are first-match, so the
    reason names one rule. Under it the lens tab lists every matching rule worse than the default as
    one step (field: now → target, and the health it clears): a number flips at its bound, an enum
    takes the last declared value no unwell rule matches, a boolean its other value, an `all` clears
    through a leaf that is not feature-bound (the stage is never the advice). The steps are verified
    (every target applied, the rules re-run); without a verified list it says why instead. For a
    watch or good reading it adds the margin to the next worse bound. Under an override the list is
    headed "The rules alone ask for"; on a past date it is absent. The General tile adds "· N steps
    to clear" when N > 1; the phone's expanded panel carries the list, cut by density.
  - **Time travel on the page** (`lib/model/timeview.ts`, `check:timeview`). When the plan is travelled
    back, the header carries an "As of <date> / Back to now" marker. The stage ladder and the lede
    show the stage on that date (`stageAt`, replayed from the events log); a headline or metric shows
    the scan's last reading on or before that date. Health, evidence, other fields and KPIs have no
    history and read "Not recorded for that date": a now-value is never shown for a past date.
    The rule has one home, the presenter `recordAsOf` (stage line, flags, lede) and `lensAsOf` (a
    lens's health, reason and dated headline), and every feature-detail surface reads it: the General
    and lens tabs, and the phone document, whose lens panels and metric rows are dated too. On a past
    date a variant's `ui.SheetPanel` is not mounted (it reads now-values and is handed no date): the
    dated panel stands in. `check:timeview` server-renders the phone and the bold lens tab on a past
    date and refuses a now-only record piece (the flags, the stage since, the plain sentence, the
    now-trouble lines) outside the presenter's now branch in any component file.
    At now nothing changes. Swarm, Business, dependencies and activity stay the current record.
  - **KPIs on a lens tab** resolve over all four scopes (feature, context, group, project; the group
    comes from the map's contexts), narrowest first, each with a scope hint, its age from
    `current.measured_at`, and a health from `warn_at`/`crit_at` read by `direction` (up: at or below
    is worse; down: at or above; no direction: read off which threshold is the worse one; no
    thresholds, no health). The health word and colours are the lens tiles'.
  - **Sections re-render on their own feature's data.** The page does not subscribe to the global
    `simV`; the lens tab, the stat tiles and the swarm section each select a string of what they
    read from the sim for this feature (`useSimSig`).
  - **The footer is honest:** the sample says it is illustrative; a live product states the stream
    status and the newest scan update it shows. Activity is titled by the window it shows.
  - **Motion:** sections enter staggered, and numbers count up. Under reduced motion both are
    instant.
  - **Phone:** the phone view keeps the single-document body (`sheet/SheetBody.tsx`).

## Scans on the plan (2026-10-13)

The owner's words: each lens view needs to run its scan at the feature, context or all, from a right-click on the
place; scans show where they work, several at once, each lens in its own colour, and parallel scans of the same lens.
Rejected: a looping radar sweep (fake progress, perpetual frames) and a per-tile shimmer.

- **Right-click menu** (`apps/web/src/components/ScanMenu.tsx`, `scan.css`). The engine's `contextmenu` (never the browser's
  own) puts `S.menu = { x, y, chain, tile }` (canvas CSS px; the hit chain outermost first, a tile only when one is
  hit). Ignored while a feature page or the ledger is shown. The menu names what was hit, then one group per scope,
  narrowest first: Feature, Bay, Room, Wing, Everything (`scopesAt` in `apps/web/src/lib/scan/scan-views.ts`; a wider scope
  with the same features as a narrower one is dropped, so a live product's one-room wing is not offered twice).
  Scope ids are base ids (feature slug, capability, domain, wing key): a `?scale` clone scans its base feature. In a
  lens view each scope is one item, "Scan <lens> · <scope>"; in General each scope has "Scan all lenses" (one job per
  scannable lens) and a row of lens buttons (glyph + short). A lens that is not `scannable` (live: no built-in and no
  manifest `scan` block) is disabled and named under "No scan method". Live products add the footer "Runs Claude
  Code in <root> with permissions skipped". It is placed at the pointer, flipped and clamped into the safe area
  clear of an open flyout; keys are its own (arrows, Home, End, Enter, Esc, Tab: ProjectSwitcher's roving focus);
  a choice, Esc (first in `goUp`), a click elsewhere or a wheel closes it. A refusal toasts the reason
  (`refusalText`), and a job that fails toasts its error (e.g. "Claude Code CLI not found (set BP_CLAUDE_BIN)").
  When the findings ledger holds a selection (`useLedgerSelection`, below), a last group "Ledger selection
  (n features)" offers the same items over exactly the features behind the selected findings: a `selection` scope
  (`{ kind: 'selection', label: 'Selection (n)', features }`, at most `MAX_SELECTION` = 200 slugs in map order),
  started with `startSelectionScan`.
  Before the click every item states what the scan would repeat (`scopeFacts` and `factsWords` in
  `packages/core/src/scan/views.ts`, over `useScanJobs(false, true)`: the stream's jobs and rows live, the scan sim's
  in Kettle). `busy` is a queued or running measure job of that lens whose scope overlaps (running, then stalled by
  `jobLiveness`, then queued), `read` the features with a current reading of the lens and the oldest of their latest
  `measured_at`, `queue` the registry's room (`MAX_RUNNING` / `MAX_QUEUED`, every job kind). A lens-view item's count
  column reads "running 4/12", "queued 4/12", "read 9/12 · 2 d" or the feature count; in General a lens button
  carries the same sentence in its name and title and a busy one a visible " · running" / " · queued" /
  " · stalled" suffix (text, never colour). Under the header one line "2 of 3 running · 5 queued" while any job
  waits or runs. A duplicate is shown, never refused (parallel scans of one lens are the owner's call); a full queue
  (16 queued) is the one refusal: every item turns `aria-disabled`, stays focusable, and is described by that line,
  which then reads the server's words "16 jobs are already queued". Pinned by `check:scan-client` section 9.
- **Actions** (`apps/web/src/lib/scan/actions.ts`): `startScan`, `dispatch`, `cancelJob` go to the live routes
  (`postScan`, `postDispatch`, `deleteJob`) or to the Kettle scan sim. `ScanCtxCtx` (BlueprintApp) says which.
  `startSelectionScan(ctx, lens, features)`, `executeLensBacklog(ctx, lens)` (`{ jobs, approved, skipped }`) and
  `addProjectLens(ctx, manifest, temporary?)` do the same for the Lenses panel. The UI's toasts and per-lens counts
  around them are `apps/web/src/components/ledger/lens/lens-ops.ts`, shared by the panel, the ledger and this menu.
- **Views** (`scanViews`): every queued or running measure job, a done one for 3 s with all ticks, a failed one for
  6 s in the bad colour with "failed"; cancelled ones vanish. A job's run is `run_id`, else the run whose note is
  `bp-job:<id>` (`isJobNote` in `jobs.ts`); done = the features measured in that run on that lens, plus those with a
  `measured` activity row (judged, nothing to measure: a temporary lens's "no impact"); current = the feature of
  the run's latest reading or measured row; m = the scope's features (everything = every base feature). The place is
  the scope's layout node; at `?scale` > 1 a job draws once per product line (the readings land in every line), and
  everything outlines each building (at 1x, the site). The accent is the manifest's `presentation.accent` for the
  theme, else ink. BlueprintApp recomputes views on discrete changes only (live: the jobs or the scan moved; Kettle:
  the sim notified) and hands them to `E.setScans`.
- **Drawing** (`apps/web/src/engine/render/scans.ts`, after the swarm layers, before the flags; only at now). A dashed
  outline in the accent (2 px, marching while running) around the place; each further view on the same place
  nests 6 px further in, in start order. A chip on the outline's top-left edge: glyph, lens short, `n/m` (`queued`,
  `failed`, `m/m done`), 12 px text, paper ground, accent border; nested chips line up side by side. The feature
  being judged gets a soft accent band sweeping left to right (1.2 s), clipped to its tile; done features get a
  small check at the tile's top-left when the tile is at least 24 px. Reduced motion: still dashes, no sweep, ticks
  stay. Boxes, nesting, chip text and widths and the done lists are worked out in `set()`; a frame reads arrays,
  reuses two rect records and allocates nothing; ticks are culled to the viewport (528 tiles at `?scale=4`).
- **The loop sleeps** unless a view is running: `scans.animating` joins the keep-alive (at most ~30 fps, 33 ms
  when only scans move); queued, done and failed views are static and draw once.
- **Kettle scan sim** (`packages/core/src/model/scan-sim.ts`). `bind()` gives it the base slugs in layout order, the enabled
  manifests and the facet values. A job is queued, then running (3 at most, FIFO, 16 queued); it walks its features
  left to right, one per 1.2 s, writing a `reading` row, then a `measured` row and one measurement per numeric
  metric field (the facet's value when it has one, else a deterministic value in the field's range). A temporary
  lens (`tmp.*`) finds about 40% of features out of its reach (deterministic): no measurement, `no impact` in the
  activity, listed by `noImpact()`. One run row per job (`run-<job>`, note `bp-job:<job>`). `dispatch` approves the
  proposed findings (decided by `blueprint`), keeps approved ones, skips the rest, and builds them in one execute
  job over about 15 s: approved, executing, done with `after_value` = before + `expected_delta`, a fake 7-hex
  `result_sha` and a measurement of the after value. `cancel` stops a job (its run aborted, a finding being built
  back to approved). A timer runs only while a job runs; subscribers hear once per tick.
- **Kettle readings** go the live way: BlueprintApp gives the Kettle model a `LiveFacets` on first use and applies
  the sim's snapshot (`apply`), then `setNa` for the no-impact pairs (the lens re-read with `applicable: false`, so
  the tile fades in that lens and carries no flag), and `sim.restamp()` re-rasters fills, "?" and fades. The Kettle
  features are the loader's cached objects, so a torn-down model puts them back (`LiveFacets.restore`).
- **Lens-set rebuild.** `refreshLiveModel` now says why a map changed shape (`why`: features, places, links,
  lenses). When only the lens set changed (a temporary lens added, retired or deleted), the model and engine are
  rebuilt on the same layout: the hash restores lens, place and page, the camera is set back exactly, the intro does
  not play, and the Kettle sim (jobs, rows, findings) carries over. Kettle rebuilds on `subscribeTempLenses` with
  `readTempLenses()` (all entries; the loader honours `enabled`).
- **Rail.** The Agents flyout opens with "Scans": every job newest first (glyph and lens, or "Execute · N
  findings"), scope, status, n/m, elapsed (a 1 s clock only while one runs), Cancel for queued and running, and for
  live products the log tail behind "Log" (`useLiveJobs`, every log line). The Agents figure is working agents plus
  running scans that are not already agents on the plan: in Kettle every running job; live, a running job unless
  its run is the latest run, whose lenses `swarmFromScan` already shows as working agents.
- **Ledger page hooks.** `E.setPage(page, lv?)` shows the drawing set or the ledger. The hash carries `page=ledger`
  and `lv=matrix` (plan and triage are omitted; an unknown `lv`, such as a retired prototype's, reads triage) and
  replaces the entry like the lens. While the ledger shows, the frame loop draws nothing and sleeps, the simulation
  keeps the phone's light timer (`lightSim`), no plan key fires wherever focus is (Esc only closes what overlays it,
  never the ledger), and pointer and wheel on the plan do nothing; leaving draws once.
- **Live products** behave the same through the routes; nothing here is Kettle-only except the sim and the
  temporary-lens subscription.

## Findings ledger (2026-10-13; the release train 2026-10-15)

The owner's words: findings need a standalone page, a ledger of items to click and dispatch across lenses. On
2026-10-14 the owner kept two of four prototypes, the triage table and the feature × lens matrix, as a pair; on
2026-10-15 the release-manager contest's winner A/1 ("The Ledger, Carried Through to Release") carried the ledger on
to the release: built pack items are triaged here, compared before and after, and shipped from a third tab. A/1's
type, density and palette are the look (`ledger-theme.css` redefines bp's colour roles on `.lg-page`; the train's
CSS is `train/**`, prefix `tr-`, every value through the `globals.css` tokens, and `node
scripts/check-train-quality.mjs` enforces it). The header's "drawing set" label is the switch.

- **Same route, a page over the plan** (`apps/web/src/components/ledger/LedgerPage.tsx`). UI state `page: 'plan' | 'ledger'`
  and `lv: 'triage' | 'matrix' | 'release'` (`apps/web/src/engine/state.ts`); `E.setPage(page, lv?)` switches. The engine, the
  live stream and running scans stay alive behind it. The header stays (the switch, the project, the lens tabs); the
  page covers the rail and the timeline, and everything it covers is `inert` while it shows; the toast stays above it.
  Opaque paper, no `backdrop-filter`; it rises in with `motion/react` and leaves at once.
- **Its own chunk.** The page and `train/**` load on demand: `LedgerPageLazy` (`Phone.tsx`, `React.lazy` + Suspense,
  mounted by BlueprintApp's chrome and by the phone only while `page` is `'ledger'`) is the one door; nothing `/`
  imports statically reaches them. The header keeps `useLedger.ts` (the open count) and `ledger.css` (the switch).
- **The switch** (`PageSwitch` in `Header.tsx`): `Project <name> · [drawing set | findings ledger] · sheet …`, two
  `aria-pressed` buttons, the open (proposed) count as a 12 px badge. **L** toggles it except in a text field, a
  dialog that owns its keys, the open feature page and the morning watch.
- **The top bar**: the title and `<product> · live lens scan | sample findings, simulated execution · n findings · n
  items in k packs`, the summary strip (changed, waiting for you, will ship: `SummaryStrip`), the three tabs (Triage
  table 1, Feature × lens matrix 2, Release 3 with the package count), Scan selected features, the Lenses button.
- **Two scopes** for the table and the matrix, `In packs n | Backlog n` (`LedgerUi.scope`); a scope switch drops the
  status filter (their chips differ), and the focus and the compare panel start over.
  1. *In packs* (`train/PackTable.tsx`): packs newest first, each a sticky pack row (lens glyph and id, branch, base
     commit, item count, state, SAMPLE on Kettle, one state mark per item and `n/m decided`) over its items. An item
     row: checkbox, lens, feature with the item id (and its attempt), title with its triage note, before → after with
     the metric key, the verdict (moved, flat, worse, unmeasured: `compare.ts verdictOf`), evidence (screens, a perf
     item's runs, the commit) and the state mark (`train/ui/Marks.tsx StateMark`, the one drawing of a state; ⚑ for an
     item accepted although it failed or did not move). Focused (ring), open (tint) and selected (accent bar) look
     different. A click opens the item in the compare panel; under the table sits the **decision bar**.
  2. *Backlog* (`variants/Triage.tsx`): every finding, open first, best value per effort first within a status, an
     "Inbox zero" note when nothing is proposed; under it the **dispatch bar** (selected, how many can go, the lenses
     spanned, effort, Clear, Dispatch n).

  The matrix in packs shows each item's state mark per cell and has no Dispatch (packs are triaged).
- **Decisions** (`train/Decide.tsx`, the one control; the decision bar and the compare footer both render it): Accept,
  Rework, Descope and Undo over the selection, else the open item, else the focused one. The rules live in
  `packages/core/src/train/rules.ts` alone: which statuses a decision starts from; rework and descope always need a note; an
  accept needs one when the item failed or did not move (it then ships flagged). The note editor takes the bar's line
  (or the compare footer's), with quick notes. Sent items are pending (`LedgerUi.pending`) until the store or the sim
  shows them in another status, or for 60 s (`PENDING_BOUND_MS`: then released with a toast that the decision may have landed): no optimistic flip; a refusal toasts what was skipped and why (`skipped[].reason`). A
  single decision on the focused item moves the focus, and the open compare, to the next waiting item. **Undo** is
  `reopen`: the item goes back to its `triaged_from` and out of a draft release, one step deep. The bar's package
  pill reads `Package v<draft or suggested> · n accepted`, with Release →. A decision that cannot apply keeps its button focusable (`Btn` `reason`: `aria-disabled`, click suppressed) and the why-not is its `aria-describedby` text, not a hover-only `title`. What a decision does is planned once (`train/plan.ts`: `planDecision` sends, asks a note, or refuses with why: nothing targeted, all pending, past the cap, none can move, or Undo on an item a newer attempt rebuilt; `decisionCounts` gives the bar's Accept n, needs-a-note and locked counts and every button's why-not); the buttons, the A/R/S/U keys, the note editor and the Release tab's Undo all read it, so a refused decision is a sentence, never a round trip.
- **The compare panel** (`train/compare/ComparePanel.tsx`): one pack item's evidence, docked right at
  `clamp(--cmp-min, 52%, --cmp-max)` from 1100 px (a wide window opens the first item the first time the table shows),
  over the table below that; **W** (or Enter again) gives it the full width. The head names the lens, id, pack and
  place in it, feature and title, with prev / next. The body: the metric strip or, for an item measured in baseline
  runs, the **perf table** (each run, the median, the after, the change and its %, the noise, the target, the verdict,
  a range strip, then the pack's other run items). **The noise rule** (`compare.ts runStats`): a change must beat the
  larger of the runs' spread (max − min) and, for a timing in ms with several runs, one frame (16.7 ms); within it,
  the item reads flat. Then the **screens**: before/after pairs by theme and size; **L** cycles light · dark · both,
  **M** side by side · slider · blink · change map, with the pixel verdict in words. The **change map** is a 32 × 18
  grid of the largest channel change per cell, computed once per pair per session in a worker (`changeMap.worker.ts`,
  with a main-thread fallback); more than 3 of 255 levels moved, more than 24 is visible (`packages/core/src/train/pixels.ts`,
  A/1's thresholds). Then what the measurement says, the commit (its files with add/del bars at once; the message and
  the patch behind a disclosure, the patch open from the start at full width, in chunks that skip layout off screen;
  fetched once per sha through the commits route, Kettle's sample diff) and the item's own text. The footer: what its
  state means, or its note, and Decide. The next item's screens are prefetched while the browser idles.
- **The Release tab** (`train/release/ReleaseView.tsx`; the states as data in `releaseState.ts`): the version
  (suggested with its reason by `GET releases/suggest`, editable, semver), **Create draft** (`POST releases`: the
  accepted items with no release, then what release-add left out), the package by lens (flagged items with their
  notes; Compare and Undo per item while the release is a draft), the rework queue and the descoped, the stepper
  **draft → building → pr-open → merged → tagged** (failed shows at the step it failed on, with Retry), the job log,
  the notes it will publish, and the history of past releases. **Build** (B) and **Finish** (F) run Claude Code on the
  person's machine with their own `gh` login (the build and finish routes; 412 while gh is not logged in): Build
  cherry-picks the accepted commits onto `release/<version>`, runs the gates, writes the notes and opens the PR; Finish,
  after the merge on GitHub, tags, publishes and marks the items released. Progress comes only from the stream (the
  release rows and the jobs event), never from polling. Esc goes back to triage.
- **Keys** (`train/keymap.ts`, one table: the handler, the footer reminders and the `?` sheet all read it, so a key
  shown is a key bound; the page owns them, `data-keys="own"`):
  - *In packs*: J/K or ↓/↑ move, X or Space selects, Enter compares (again: full width), A accept, R rework, S
    descope, U undo, `/` filter, 1-3 tabs, ? the keys, Esc.
  - *Backlog*: J/K, X/Space, Enter opens the feature, D dispatches the selection, A dispatches the focused finding,
    `/`, 1-3, ?, Esc.
  - *Compare* (layered over the scope it was opened from): L theme, M mode, W full width.
  - *Release*: B build, F finish, 1-3, ?, Esc back to triage.

  Esc is layered: a note being written, then full width, then the compare panel, then the selection, then (Release)
  the table, else the drawing set. Only the focused row's controls are in the Tab order; focus is always visible.
- **Phone** (`Phone.tsx` hosts it with `phone`): the table alone, in the page flow; pack items as cards over the
  decision bar (44 px buttons), compare as a full-screen sheet that owns a history entry (Back closes it), the release
  as one status line (`ReleaseStatusLine`); no tabs.
- **Kettle's sample train** (`packages/core/src/model/train-sim.ts`, on the scan sim's timer): packs k-des-1 (a moved, a flat, a
  worse, a failed and a reworked item), k-des-2 (the rework's rebuild) and k-perf-1 (two probe items with three
  baseline runs each) over real Kettle features, with readings, sample screens (`public/sample-shots`,
  `scripts/gen-sample-shots.mjs`) and commits; triage, reopen, the version suggestion and a release job, with the
  answers and refusals of the routes. The Release tab's sample toggles make the job run into a missing gh login, a
  conflict or a failing gate; a sample merge stands in for GitHub. Everything it makes says SAMPLE.
- **Findings** (`useLedger.ts`, one model for every view; `train/data.ts useTrain()` for packs, releases and
  evidence). Live: `useLive().product.scan`, jobs from `useLive().product.jobs`. Kettle: `M.findings` (the fixture
  below) overlaid by id with the scan sim's snapshot, jobs from `M.scanSim.jobs()`. Nothing else branches on the
  source. A finding's before value is Queue's `metricMove` over the readings, falling back to the map's facet value.
- **Selection and filters** live in a module store in `useLedger.ts` (`useLedgerUi(product)`, `setLedgerUi`): they
  survive a tab switch and closing the ledger, the desktop and phone ledgers share them, another product starts empty,
  and the Lenses panel and the plan's right-click read the selection (`useLedgerSelection()`). Status chips (state
  mark and count), lens chips (glyph, short, count in the scope), a feature chip from the matrix's **Table**
  (`feature <name> ×`), a text filter (`/`).
- **Waves** (`useWaves.ts`, `waves/WavesBar.tsx`, `waves/WaveComposer.tsx`, `waves/waves.css`; contract `packages/core/src/scan/waves.ts`).
  In the Backlog scope a strip tops the body: `All | one tab per wave | + New wave` (a tab is the wave's state mark, name and
  finding count; the selected tab, `LedgerUi.wave`, keeps only its findings in `rows`). The dispatch bar's **Add to wave**
  (beside Dispatch, which stays the direct path) opens the inline composer (`LedgerUi.composer`, not a modal) over the
  dispatchable selection that no draft wave holds (the others are named and left out): one default package (Opus, high),
  packages added, renamed, removed, each with a model Seg (Sonnet | Opus) and an effort Seg (low | medium | high | xhigh),
  findings moved between packages or removed, a warning when two packages share a feature. Create clears the selection and
  selects the new tab; the wave panel shows each package (model, effort, findings, job state) with Dispatch wave, Dispatch
  remaining, a package's own Dispatch, Edit and Delete (draft only; Delete asks twice). Dispatch rows flip through the same
  optimistic overlay as the direct path (`Ledger.dispatchWave`). A row in a wave shows a chip (`wave · package`, the title names
  model and effort) passed to the memoised `Row` as four strings, so the J/K budget is unchanged. The wave list reloads after
  every mutation and when a wave job changes status; a failing list reads as no waves. Text is 12 px or more, the buttons'
  rules sit under `.lg-page`, and below 720 px of table width (a container query) the tabs fold into a select and the
  composer stacks. Selectors to drive: `[data-wave="strip" | "new" | "add" | "composer" | "create" | "dispatch" | "remaining" |
  "edit" | "delete" | "delete-yes"]`, `[data-wave-panel]`, `[data-wave-pkg]`, `[data-wave-state]`.
- **Tier first** (store v4). The backlog orders by `tier` ascending first (untriaged after tier 3, `derive.ts tierRank`), then
  status rank, then value per effort; with no tier anywhere the order is exactly the v3 one. The review queue does the
  same ahead of its own order (`swarmFromScan` sorts open proposals tier then age; `sim.queueCmp` tier then score). A
  ranked item shows a tier chip `T0`..`T3` with its risk class word (`Queue.tsx TierChip`; T0 in the bad red, T1 in
  the watch amber, 12 px mono); an Azure DevOps item shows `ADO #<n>` (`OriginChip`), a link to the work item in a new
  tab (`rel="noopener noreferrer"`, http(s) only) on a ledger row and the review detail, plain text on a review list row
  (a listbox option holds no control). `kind` `work-item` reads "work item".
- **Dispatch** (the backlog) is `dispatch(useScanCtx(), ids)` (`apps/web/src/lib/scan/actions.ts`): proposed or approved
  findings with no job go as one execute run across lenses; optimistic until the next store or sim update, a refusal
  rolls back with a toast.
- **Value per effort** (`rankValue`, the backlog's order within a status and the order `/lens-scan execute` builds a
  batch in): `ev = gain × confidence ÷ effort`. Gain = 0.25 + 0.75 × |expected_delta| ÷ the largest |expected_delta|
  among the findings of the same lens and metric; 0.5 when a finding names no metric or delta. Confidence =
  (11 − risk) ÷ 10 (risk 1..10, missing reads 5). Effort = XS 1, S 2, M 3, L 5, XL 8 (missing reads M). Ties: the
  older, then the id.
- **The Lenses slot.** `LedgerPage` takes `lensButton` (top bar) and `lensPanel` (a side column) as nodes;
  `LensesButton` and `LensesPanel` plug in there (below).
- **Lens chip menus** (2026-10-14). Each lens chip has a disclosure (▾): **Scan this lens · everything**, **Scan
  selection**, **Execute backlog (n)** (it asks "Approve and build n findings in k jobs?" first) and **Open in Lenses
  panel**. An item that cannot run stays focusable and says why. Esc or a click outside closes it, the arrows move
  between items; the page's keys stay out (`.lg-pop`).
- **Scan selected features** (2026-10-14): with a selection, a picker of the scannable lenses (preset to the lenses of
  the selected findings), one `selection` scan per checked lens over the features behind it (at most 200 features).
- **Kettle findings** (`packages/core/data/kettle.findings.json`, generated, never hand-edited): `node
  scripts/fixtures/kettle-findings.mjs` writes 60 store-shaped proposals over the sample map from the map itself
  (every enabled lens, features in trouble first, mixed statuses, one baseline upgrade with two propagation
  children), seeded with the shared PRNG. `npm run check:findings` regenerates them in memory and fails on drift.
- **A live product** shows its store's proposals, packs and releases the same way; a finding on a feature its map
  lacks stays listed, its feature link disabled.
- **Budgets** (counted, never timed: `npm run check:train-budget`, `node scripts/check-train-budget.ts`):
  - *The chunk*: nothing `/` imports statically reaches `LedgerPage.tsx` or `train/**`. With `--bundle .next-wp5b
    [--before <dir>]` it reads a production build (`NEXT_DIST_DIR=.next-wp5b npx next build`, then restore
    `tsconfig.json`): `/`'s first-load scripts and styles must not carry `tr-cmp`; it prints their bytes and the
    ledger's chunks. At the cutover: first-load JS 1,367 → 1,277 KB (gzip 435 → 409 KB), CSS 184 → 149 KB; the
    ledger's own chunk is 95 KB of JS (gzip 30 KB) and 35 KB of CSS, fetched when the ledger first opens.
  - *The DOM at 10x*: a synthetic snapshot of 1,000 backlog findings and 120 pack items in 10 packs, server-rendered
    through the real components: the In packs table ≤ 3,300 elements (3,013: 25 per row), the Backlog ≤ 24,600
    (22,414: 20 per row; every row is mounted so J/K can focus it, and `content-visibility: auto` skips the off-screen
    ones' layout), the compare panel with its diff closed ≤ 110 (97), a perf item's ≤ 270 (243). A browser on a 10x
    store counts the same.
  - *Work per key*: a J/K step re-renders the two rows whose focus changed and nothing else (the rows are memoised and
    get the ledger's stable callbacks, never the `Ledger` object, which is new on every render). Counted in a dev
    build through React's devtools hook (a memoised row that bails out keeps its `memoizedProps` object): 2 item rows
    and 0 pack rows in packs, 2 rows in the backlog, on Kettle and on a 10x store.

## Lenses panel (2026-10-14; was Temporary lenses, 2026-10-13)

The ledger's temporary-lens panel grew into the place every lens of a product is managed: enable or disable, scan
everything or the ledger's selection, execute its backlog, and onboard a new one with Claude, permanent or temporary.
A temporary lens still brings one refactor, migration or project onto the table and is retired after; a permanent
project lens (a reverse-DNS id, `com.org.name`) stays with the product. Both are lenses like any other (fields, JSON
health rules, a glyph and a line, spec 8.1-8.2) with a `scan` block: judgement instructions, or composed steps
(script, skill, judgement) run in order. Files: `apps/web/src/components/ledger/lens/` (`LensesPanel.tsx`, `lens-ops.ts`,
`LensChat.tsx`, `DraftCard.tsx`, `lens.css`) and `apps/web/src/lib/scan/temp-lens.ts`.

- **Where it opens.** The findings ledger's top bar carries **Lenses** (`LensesButton`, with the number of lenses); a
  lens chip's **Open in Lenses panel** opens it on that lens's row. It sits in the ledger's side slot (380 px, the
  slot's full height, `data-keys="own"`, Esc closes and gives focus back to what opened it, Tab stays inside while
  focus is in it, a click outside is not caught). Whether it is open, and which row to bring into view, is a module
  store in `LensesPanel.tsx`, so the two exports can sit in different slots.
- **Every lens** (`useLensRows` in `lens-ops.ts`): the model's every lens entry, enabled or not, in the map's order
  (`E.M.P.base.allLenses`), then any entry the model has not rebuilt for yet (a live map's `lenses[]`, Kettle's
  browser store) as "not on the plan yet". One row each: the glyph and a run of the line (drawn by the canvas's own
  `glyph()` and `lineType()`), name, short, the kind tag (**built-in**, **project**, **temporary**), enabled /
  disabled (a temporary one reads retired), `measured n of m` features (health good/watch/bad, from the model) and
  `k no impact` (`na`), the open (proposed) findings, the creation day when known, and a ring while a measure or
  execute job on the lens is queued (dotted, still) or running (turning; still under reduced motion). The section
  header counts the kinds; with built-ins only, a note invites onboarding one.
- **Row actions.** **Scan all** (`startScan` with the `all` scope); **Scan selection (n)** (`startSelectionScan`
  over the features behind the ledger's selection, at most 200); **Execute backlog (n)**, which confirms inline
  ("Approve and build n findings in k jobs?", k = n / 50 rounded up) before `executeLensBacklog`; then, for project
  and temporary lenses only, **Disable** / **Enable** (**Retire** / **Restore** for a temporary one; live: `PATCH
  /lenses/<id>`, Kettle: the browser store) and **Delete** (inline "Delete <name>? Readings stay in the store.").
  Built-ins have neither: the kind tag's tooltip says "built-in lenses are set in the map". An action that cannot
  run stays in the Tab order (`aria-disabled`) and, chosen, says why under the row: "Enable the lens first", "This
  lens has no scan method: no built-in and no manifest scan block", "Select findings in the ledger first", "Nothing
  to build: no proposed or approved finding without a job". Outcomes are toasts; a refusal carries the route's or
  the sim's words as they are (a "lens-scan refused: …" line verbatim).
- **Onboard a lens.** Below the list, **Onboard a lens** opens the chat (open at once when a conversation exists).
  First a choice, **Permanent** (the default: kept with the project, reverse-DNS id) or **Temporary** (one refactor or
  migration, `tmp.*` id), fixed once the first message is sent (**New chat** keeps the choice and starts over). Each
  turn is one `POST /api/lens-draft` with `{ product, kind: 'project' | 'temporary', message, session? }`
  (`product`: the live slug, else `kettle`); the server runs `/lens-scan onboard --draft-only`, so the onboarding
  contract lives in the skill. Claude asks at most 3 questions (plain-text messages; nothing is rendered as markup),
  then drafts. While a turn runs: "Claude is thinking · m:ss" (a 1 s timer only while waiting) and **Cancel**, which
  aborts the fetch; the route sees the request's abort signal and kills the CLI's process tree, the previous session
  stays resumable, and the message goes back into the box. 503 (no CLI), 502 (the CLI failed), 504 (3 minutes) and a
  network failure show as a note with **Retry**; a draft whose shape the check refuses shows as a note and the chat
  goes on. The chat state is a module store: closing the panel mid-turn neither loses the conversation nor cancels
  Claude.
- **The draft card** shows the manifest whole before anything is written: name, short, id, version and kind, the
  glyph at **7 px** and **14 px** side by side (labelled; the sizes the plan draws it on a tile's rail and in chips)
  and whether it is a shared glyph or its own path, a run of the line type, the reader, each field (label, key, type,
  unit, which way is better, headline), each health rule in words (`bad when riskScore >= 7` and its reason), the
  default and the rollup, and the scan: judgement instructions, or the steps numbered in order (`script` with what it
  yields, `skill` with its args and budget, `judgement` with its instructions). It is checked with
  `checkLensManifest(draft, { mode, taken })` in the chosen mode, `taken` being the glyph+line looks of the
  product's other enabled lenses; a refusal (an id of the wrong form, a glyph path outside the 16×16 box, the same
  glyph and line as another lens) shows on the card and keeps **Add lens** off. **Add lens** calls
  `addProjectLens(ctx, manifest, temporary)`: live, `POST /lenses` (the map change reaches every client through the
  stream's `map` event and the lens-set rebuild adds the tab); Kettle, this browser's store (the model rebuilds on
  `subscribeTempLenses`). A 400, a 409 (the id exists) or a storage refusal shows on the card. Then the card offers
  **Scan now**. **Keep refining** focuses the box.
- **Kettle's store** (`apps/web/src/lib/scan/temp-lens.ts`): `localStorage['bp.tmpLenses.kettle']`, a JSON array of
  `LensEntry` (temporary and permanent project lenses). Every access is wrapped; a read keeps only well-formed entries and returns the same array while the
  stored text is unchanged (a `useSyncExternalStore` snapshot). `subscribeTempLenses` fires on this tab's writes and
  on the `storage` event of another tab (or a storage clear). A write the browser refuses throws a sentence the card
  shows.
- **The model** keeps `temporary` on `LensDef` (`packages/core/src/standard/load.ts`), so a tab or the legend can mark a
  temporary lens from the registry alone.
- **Lenses stay data.** Nothing in the panel, the chip menus or the right-click branches on a lens id; lenses differ
  by glyph and line only, and the accent colour marks scan work (the job ring) and nothing else.

## Done means

- `npm run build` and `npm run typecheck` pass. There are no console errors on load or while
  zooming, and no hydration warnings.
- Each route loads at 1280x800, 1920x1080 and 390x844, in both themes, at `?scale=1` and
  `?scale=4`.
- The 12 px floor holds, measured on DOM and canvas text.
- `docs/perf.md` gives the frame-time numbers.
- Screenshots of every route, theme and lens are in `docs/shots/` (git-ignored if large).
