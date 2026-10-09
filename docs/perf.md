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

Lens switch at ×4 L0 (the mix tween re-rasters the static layer every frame for ~0.5 s, 28–33 rasters
of 3–4 ms each): p50 16.7 ms, p95 33.4 ms. A few frames drop while the queue's layout animation and the
canvas tween run together; see "Known costs" below.

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

## Known costs

- During a gesture the cached raster is scaled up to x1.5 before re-rastering, so text can look soft (and
  briefly smaller than 12 px when zooming out within a bucket) until the gesture settles.
- The lens tween re-rasters every frame; a variant with expensive `marks()` or `decor()` will feel it
  first there. Keep marks to a few primitives per tile and reuse `th.pattern(...)`.
- Headless Chromium here composites in software; a GPU-backed browser should have more headroom.

Reproduce: with the server on port 3107, run `python scripts/perf.py` (rAF deltas while sending
`mouse.wheel(0, -110)` every 50 ms for 1.5 s at (768, 486), then a 1.5 s drag; engine counters are on
`window.__bp.perf`.
