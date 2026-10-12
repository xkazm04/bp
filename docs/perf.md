# Performance

Measured 2026-10-09 on the production build (`npx next start -p 3107`), headless Chromium via Playwright
for Python, viewport 1920x1080, device pixel ratio 1, `?scale=4` (four product lines, 528 features,
168 agents, simulation playing at 8x). Baseline rAF cadence of that browser on an empty page: 16.7 ms.

## Gesture: 1.5 s of wheel zoom at ~40% across, then 1.5 s of drag (requestAnimationFrame deltas)

| run | frames | p50 | p95 | p99 | max | static re-rasters |
|---|---|---|---|---|---|---|
| ×4, 1 | 182 | 16.7 ms | 16.7 ms | 33.3 ms | 33.4 ms | 7 |
| ×4, 2 | 183 | 16.7 ms | 16.8 ms | 16.8 ms | 33.4 ms | 8 |
| ×4, 3 | 184 | 16.7 ms | 16.7 ms | 16.8 ms | 33.4 ms | 7 |
| ×1 (reference) | 182–184 | 16.7 ms | 16.7–16.8 ms | 16.8 ms | 16.8–33.2 ms | 5–6 |

**Result: p50 16.7 ms, p95 16.7 ms at `?scale=4` — the 60 fps budget holds.** The engine's own work per
frame during the gesture is about 1.1 ms median, 2.4 ms p95 (draw 0.7 / 1.7 ms).

Lens switch at ×4, measured 2026-10-12 on a busier machine than the table above (the mix tween re-rasters the static layer every frame for ~0.5 s, 32–50 rasters).
`perf.lastRasterMs` now includes the deferred raster Chrome pays in the first `drawImage` (it used to read
only the 4–11 ms of recorded canvas calls). Full raster per frame, production build, 1920x1080 DPR1
(`python scripts/perf.py --lod`): home 17.6 ms, L-bld 20.4, L-blend 26.9, L-tiles 40.5, L-room 47.9,
L-feat 21.6. `python scripts/perf.py --tween` (rAF deltas, lens switch and back): home p50 33.3 / p95 66.7 ms,
L-bld 33.3 / 50, L-tiles 33.3 / 66.7, L-room 50 / 83.2. So the lens switch is a ~30 fps spring, not 60,
and worse the more zoomed in (the raster covers the viewport plus the margin); see "Known costs" below.

## What the cache and culling do

The plan (walls, wing fills, ribbons or fixtures with their stage fills, lens marks and text, and every
label) is rastered once into an offscreen bitmap covering the viewport plus a 22% margin; during a
pan or zoom each frame only transforms that bitmap with one `drawImage`, and the plan is re-rastered
only when the gesture settles (140 ms still), when the zoom leaves its bucket (x1.5 either way), when
the view leaves the covered area, or when something static changes (lens mix, time, theme, filters).
On top, the dynamic layers (agents, pins, pulses, hover, targets, previews) are culled to the viewport,
use pre-rendered glow sprites instead of per-agent gradients, and read memoised aggregates, so the
per-frame work is a few hundred cheap primitives.

## The B/1 lesson, applied (and one finding)

- The camera, the clock, hover position and the lens tween never enter React state; React re-renders on
  discrete changes only (selectors over an external store), and simulation updates reach the store at
  most every 250 ms.
- The loop draws only when dirty and sleeps when nothing moves; when only the simulation runs it draws at
  about 30 fps; marching-dash and pulse animations do not keep the loop alive on their own.
- Aggregates (stage counts, health, swarm stats, lens aggregates) are cached per place and per time
  window, not recomputed per frame as in A/1. Text widths and wraps are measured once.
- Wall geometry is built once per layout as world-space `Path2D` and transformed per raster.
- DPR is capped at 2; the static raster is capped at 12 MP.
- **Finding:** CSS `backdrop-filter: blur()` on the dock, tabs, ladder and bottom bar (inherited from A/1)
  halved the frame rate (p50 33.3 ms, p95 50 ms) because every panel re-blurred the moving canvas each
  frame. Removing it gave the numbers above. Do not put `backdrop-filter` over the map.

## Canvas-render pass (cache resolution, frame allocations, illustration loads)

- **Cache resolution.** `deviceRes()` (render/static-cache.ts) is the one resolution authority for the screen canvas and
  the static raster, so the cached bitmap is always at the screen's device resolution and an at-rest draw is 1:1
  (smoothing off only then; any scale ratio smooths). Memory is bounded by shrinking the pan margin, not the
  resolution: the raster stays under 12 MP (the screen cap is 6.5 MP, so the margin is >= ~0.18 of the viewport at the
  worst case instead of 0.22). Patterns are built at that same resolution.
- **Frame allocations.** A plain pan frame builds no flag records (pooled), no static-key string (a version counter,
  field-compared), no view record, no camera-signature string, no font/colour key strings (cached per theme and U), and
  no pattern re-anchor (no dynamic layer draws a pattern; patterns are anchored at raster time). Remaining: the
  `Set` iterator over frame listeners and whatever `sim`/`featRect` allocate.
- **Illustration loads.** `loadArt` calls back once after all 13 images settle, and a newer `readTheme` supersedes an
  older set still loading, so a theme/font/DPR change costs one extra re-raster, not up to 13.
- **Sim-play refresh (~every 900 ms) is a patch, not a raster (canvas-render sim-static-to-dynamic).** The static raster
  reads the simulation in exactly three places: a tile or ribbon segment's live rollout/progress (the stage fill and every
  variant channel's `marks()`/`content()` through `E.live`), whether an agent chip sits on the tile (plan.ts reserves its row),
  and the wing/building swarm lines (`statsOf`, whose agent count also moves the name). Each is registered while it paints
  (`render/simwatch.ts`: the values it painted plus its rect). `simStaticV` is no longer an input of `staticKey()` (it still
  feeds the minimap's signature), so a sim tick never changes the raster's key: with the camera still, `check()` answers
  'exact', and the frame runs `patchSim()` instead. That compares every registered value with the simulation (a few lookups
  per item, no allocation), clears only the changed rects in the cached bitmap (snapped outward to whole device pixels) and
  runs the same `paintPlan` clipped to them; plan.ts skips every building, wing, bay, tile and label block that misses the
  clip (`patchMiss`), so the repaint is the grid, decor, wing fill, walls and labels under the changed pixels plus the few
  changed tiles and neighbours. Because it is the same code in the same order the pixels equal a full raster's (z-order
  with walls and labels is kept), and it applies to every variant (subtle, shaped, bold) with no per-variant code. A change
  that shifts a label's layout (a wing gaining its first agent moves the wing name) clears the whole label block. During a
  gesture the patch still runs on the cached bitmap at the camera it was rastered with. Counters on `window.__bp.perf`:
  `rasters` (does not move on sim ticks), `patches` and `lastPatchMs`. Not measured here (no browser in the build tree):
  `python scripts/perf.py` with the sim playing and the camera still should show `rasters` flat and `lastPatchMs` a
  fraction of `lastRasterMs`; patch cost grows with the number of changed items, not with the plan.
- Remaining full rasters while playing: anything in `staticKey` (theme, fonts, size, lens mix, time, delta, blast, GA, key,
  who, view) and the pan/zoom settle, exactly as without a sim.
- **LOD ramps (canvas-render).** The ribbon -> tile blend (`Engine.lod`) spans a zoom ratio of 1.5 (`smooth(1.1, 1.65, k/KB1)`),
  the cache's `BUCKET`. The blend is baked into the bitmap, so the cache also re-rasters when the live blend drifts 0.2 from the
  baked one (`LOD_STEP`): a wheel zoom through the crossfade costs at most five extra rasters (one per 0.2 of blend) instead
  of one jump at a bucket crossing; outside the blend (pure ribbons, pure tiles) nothing changes. Tile text, the big/small tile
  layout, bay tags and room labels now fade over 8-16 px of size (room labels over the last 24 px of width they need).
- **Per-tile records (canvas-render hygiene).** `makeGeom`, the blended mark rect and the `MarkArgs` handed to channels are
  one reused record each (read during the call, never keep them; noted in lens/contract.ts), base's `composeGeneral`/`band`
  hand back reused rects like subtle's, and a lens-dominated tile's outline `Path2D` is rebuilt only when its geometry, lens or
  dominance changed since the last full raster (patches reuse it). The text width and wrap caches are capped (clear on overflow).

## Frame-loop allocations and layout reads (engine-frame-alloc)

- `syncPlace` runs only when the camera, the safe area, U, the home scale or `open` moved (a numeric signature, compared
  field by field); its per-level work (`chainBest`, `entered` via `Camera.fitK`) reuses pooled records and builds no
  `Pad`/`Cam`/array/key string. The place store is written only when the place ids change.
- `onFrame` listeners (scale bar, zoom readout, decision card) run on frames where the camera moved, and once more after a
  store change, a layout change or a new subscription; sim-only frames skip them (the sim clock has `onSimTime`).
- ScaleBar reads layout only when its inputs change (text length, bar shown, U, free width, ladder content), never per
  frame; DecisionCard gets its height from a ResizeObserver instead of `offsetHeight` per frame.
- The settle wake-up is armed once per gesture (not clear+set per frame); `sim.expire` runs every 500 ms of wall time.

## Known costs

- During a gesture the cached raster is scaled up to x1.5 before re-rastering, so text can look soft (and
  briefly smaller than 12 px when zooming out within a bucket) until the gesture settles.
- The lens tween re-rasters every frame; a variant with expensive `marks()` or `decor()` will feel it
  first there. Keep marks to a few primitives per tile and reuse `th.pattern(...)`.
- Headless Chromium here composites in software; a GPU-backed browser should have more headroom.

Reproduce: with the production server running (`npm run build && npm start`, port 3000; another port via
`BP_BASE=http://localhost:<port>` or a full URL argument), run `python scripts/perf.py` (rAF deltas while sending
`mouse.wheel(0, -110)` every 50 ms for 1.5 s at (768, 486), then a 1.5 s drag; engine counters are on
`window.__bp.perf`.
