# Variants: the lens-expression seam

Three routes share one engine, one UI and one data model, and differ only by what lives here:

```
src/variants/
  types.ts        Variant, VariantUI, SheetPanelProps (+ re-exports of the lens contract types)
  registry.ts     imports the three folders; the foundation owns it
  base/           the reference expression (A/1's lens behaviour under the no-recolour rule)
  subtle/         variant 1 — owned by its author
  shaped/         variant 2 — owned by its author
  bold/           variant 3 — owned by its author
```

**Rule: a variant author edits only their own folder.** Everything a variant may change is reachable
from `src/variants/<id>/index.ts`, which must export a `Variant` (named export `<id>` and default).
Today each folder re-exports `base` under its own id and name via `fromBase()`.

## What a variant provides

```ts
export interface Variant {
  id: 'subtle' | 'shaped' | 'bold';
  name: string;          // index card title
  description: string;   // index card line
  expression: LensExpression;   // the canvas side (required)
  ui?: VariantUI;               // the React side (optional overrides)
}
```

### 1. `expression: LensExpression` (canvas) — `src/engine/lens/contract.ts`

| member | when the engine calls it | notes |
|---|---|---|
| `channels[lens].marks(a)` | every visible tile/ribbon segment, while the lens is present | Draw indicators inside `a.r`. `a.x` (0..1) is the expansion: 0 = compact General form in its slot, 1 = the lens alone in `expandedRect`. Multiply alpha by `a.w`. Use `a.accent`, `a.th` colours and `a.th.pattern({...})`. **Never fill the tile with a colour**: the engine already drew the stage fill. |
| `channels[lens].shape?(p, tile, f, w)` | fixtures only (`form: 'tile'`, L2+), when this lens dominates (`w` = dominance 0..1); ribbon segments stay rectangles | Add the outline to `p` (screen px). At `w = 0` it must equal the plain rectangle `tile.x, tile.y, tile.w, tile.h`. The engine clips the stage fill to it and strokes it with the stage's dash style. |
| `channels[lens].content(f, live)` | text on fixtures (L2+) | `parts` = evidence line (right of the id, parts dropped from the end to fit; count capped by density), `stamp` = a warning near the foot. Crossfades with the General evidence by dominance. |
| `channels[lens].aggregate(fs)` | wing, room and building labels (cached per place) | `parts` after the feature count; optional `trouble`. |
| `channels[lens].density` | evidence part count on tiles; the sheet; the UI | `'simple' \| 'standard' \| 'dense'`. |
| `channels[lens].accent?` | marks, evidence text, the `--lens` CSS variable | `{ dark, light }`. Omit for ink only (variant 1). |
| `channels[lens].decor?(ctx, view, w, th)` | under the plan, screen space, weighted by dominance | Bold variant: grids, dimension lines, title-block ornaments. Cached with the static layer. |
| `composeGeneral(tile)` | every tile in General | Return a rect per lens (screen px) for the compact marks; `tile.strip` is the band reserved along the top edge. Return `{}` for tiles too small (base does this for ribbons). |
| `expandedRect?(tile, lens)` | every tile while a lens is expanding | Default `tile.body`. Base uses a foot band so the stage fill stays readable. |
| `spring?` | lens switches | `{ stiffness, damping }` for the mix tween. |
| `evidenceFont?(lens)` | tile evidence text | `'mono'` (default) or `'sans'`. |

**The mix (read this before drawing).** The view is seven weights (General + six lenses). The engine
derives per lens: *presence* `p` (draw at all), *expansion* `x = p·(1−general)`, *dominance*
`d = clamp(x − Σ others)`. Marks get `w = p` and `x`; shape, content, accent and decor follow `d`.
In General every `d` is 0; on a lens→lens switch `d` passes through 0, so exclusive things always go
back through the shared base and never cut from one lens to another. You do not animate anything
yourself: draw for the values you are given; the engine re-rasters every frame of the tween.

**The tile anatomy** (`TileGeom`, screen px): `form` (`'ribbon'` at L0/L1, `'tile'` at L2+), `strip`
(top band for General's cells), `body` (inset interior), `text` (the engine will print id, evidence,
name, stamp), `u` (UI scale: multiply your px sizes), `k` (camera zoom).

**Performance budget.** `marks` runs for every visible tile on every raster (and every frame during a
lens tween). Keep it to a handful of primitives, reuse `th.pattern()` (cached), allocate nothing big,
and never call `measureText` in a loop. See `docs/perf.md`.

### 2. `ui?: VariantUI` (React) — `src/variants/types.ts`

| member | consulted by | default |
|---|---|---|
| `SheetPanel` | feature sheet, one panel per lens (six in General; the chosen lens first and expanded, others collapsed to their key fact) | `DefaultLensPanel` in `src/components/sheet/LensPanel.tsx` — import and wrap it to extend |
| `Legend` | Plan tab legend for a view | `Legend` in `src/components/Legend.tsx` (draws live specimens with your own `marks`, so it follows your expression for free) |
| `density(lens)` | sheet rows, queue detail | the channel's `density` |
| `queueNote(d, view, model)` | an extra line under each queue card | none |
| `tabLabel(view)` | the lens tab sub-label | the sheet's short name |

React components in a variant folder must be client components (`'use client'` at the top).

### 3. Styles

The app root carries `data-variant="<id>"` and `data-view="general|business|…"`, and the CSS variable
`--lens` is the current lens accent. Put variant CSS in your folder (e.g. `styles.css`) and import it
from your `index.ts`; **scope every rule** under `[data-variant='<id>']`, because the registry loads
all three folders on every page:

```css
[data-variant='bold'][data-view='development'] .evp.cur { font-family: var(--mono); }
```

Never use `backdrop-filter` over the map (it halves the frame rate; see `docs/perf.md`).

## How to start a variant

```ts
// src/variants/shaped/index.ts
import { baseExpression } from '../base';
import type { Variant } from '../types';
import { business } from './business';   // your channels, one file each if you like

export const shaped: Variant = {
  id: 'shaped', name: 'Shaped · reshape and icons', description: '…',
  expression: {
    ...baseExpression, id: 'shaped', name: 'Shaped',
    channels: { ...baseExpression.channels, business },
  },
  ui: {},
};
export default shaped;
```

Hard rules from the contract (`docs/blueprint-ui.md`): node colour = lifecycle stage, never changed by
a lens; positions never move; nothing readable under 12 px (the engine's `tx.f()` clamps canvas text,
but your own `ctx.font` strings must respect it too); both themes and `?scale=4` must work.
