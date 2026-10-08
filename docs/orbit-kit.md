# Orbit kit (round 2 shared UI)

Every round 2 variant uses the same visual identity and the same app shell. Each variant designs only its
**map** and its **timeline**, so the comparison stays about shape. The kit is plain JS and CSS with no dependencies.

| File | Role |
| --- | --- |
| `prototypes/shared/v2/orbit-kit.css` | Tokens, themes, type, and component styles (all classes prefixed `ok-`) |
| `prototypes/shared/v2/orbit-kit.js` | `window.OK`: the shell, state, primitives, inspector, legend, and full-page feature detail |
| `prototypes/round-02/kit/index.html` | Kit demo and test page: the shell with a plain list "map", for screenshot testing |

Pages load, in this order: the Google Fonts stylesheet for **Jost** (300–600) and **DM Mono** (400, 500),
`orbit-kit.css`, `blueprint-data.js`, `blueprint-model.js`, `orbit-kit.js`, and then the page script.

## Identity: Orbit

The identity comes from round 1 variant B. It feels like a precise astronomical instrument: calm, measured and luminous.

- **Light (default)**: a daylight celestial chart. Pale, cool paper; ink-blue hairlines; fine graticules and tick scales.
- **Dark**: a night sky. Blue-black ink (not pure black), luminous linework, and soft glows on live elements.
- **Type**: Jost for labels, in tracked uppercase for chart lettering and sentence case for UI copy. DM Mono for
  every number, date and reference, with tabular figures.
- **Shapes**: rings, arcs, thin ticks and dotted orbits. Status is shown by glyph form: a filled disc is live, a ring
  with a dot is ready, a half disc is in build, a dotted ring is planned, and a red cross-star is blocked.
- **Plain words**: round 1 used instrument jargon (Epoch, MAG, BRG). Keep the instrument styling but label things plainly.

### Theme mechanics

Light is the default no matter what the OS prefers (client decision). Dark is opt-in. The toggle cycles
**Light → Dark → Auto** and persists in `localStorage` under the key `orbit-kit.theme` (`light`, `dark` or `auto`),
inside try/catch. Screenshot scenarios can start in dark with `"storage": { "orbit-kit.theme": "dark" }`.

```css
:root { /* every token: light values */ color-scheme: light; }
:root[data-theme="dark"] { /* dark values */ color-scheme: dark; }
@media (prefers-color-scheme: dark) { :root[data-theme="auto"] { /* the same dark values */ color-scheme: dark; } }
body { background: var(--ok-paper); color: var(--ok-ink); }
```

### Tokens (CSS custom properties)

- Surfaces and ink: `--ok-paper`, `--ok-paper-hi`, `--ok-sky-a`, `--ok-sky-b`, `--ok-ink`, `--ok-ink-2`, `--ok-ink-3`,
  `--ok-ink-4`, `--ok-rule`, `--ok-rule-2`, `--ok-band`, `--ok-band-hi`, `--ok-panel`, `--ok-panel-solid`, `--ok-panel-edge`,
  `--ok-shadow`, `--ok-glow`.
- Lens hues, one per lens and used only to identify the lens (tabs, swatches, headers):
  `--ok-lens-overall`, `--ok-lens-dev`, `--ok-lens-ops`, `--ok-lens-biz`, `--ok-lens-sec`, `--ok-lens-comp`,
  `--ok-lens-ux`, `--ok-lens-cost`.
- Rating bands, an ordered scale that is distinct from the lens hues and readable without colour (glyph shape plus
  lightness): `--ok-good`, `--ok-fair`, `--ok-poor`, `--ok-critical`, `--ok-na`, and `--ok-*-soft` fills for each.
- Signals: `--ok-alarm` (needs attention), `--ok-gate` (waiting for a human: triage or approval), and `--ok-focus`.
- Fonts: `--ok-f-label` (Jost), `--ok-f-body` (Jost), `--ok-f-mono` (DM Mono).
- Metrics: `--ok-bar-h`, `--ok-filter-h`, `--ok-insp-w`.

## Shell

`OK.mount(opts)` builds the shell inside `opts.root`:

- **Top bar**:
  - Brand mark, product name and version, and the variant name.
  - **View switch**: Map / Timeline.
  - **Lens bar**: the four role lenses (Overall, Development, Operations, Business), a divider, then the four
    specialist lenses (Security, Compliance, UX, Cost). Each shows the product-level band glyph and score; keys 1–8.
  - On the right: search, legend and theme.
- **Filter bar**:
  - Status chips with counts (multi-select).
  - An **Initiatives** picker listing permanent and temporary initiatives with coverage counts. Choosing one
    highlights its features and fades the rest.
  - A **Human gates** toggle with three counts (Triage · Approval · Changes); clicking a count narrows to that gate.
  - **Attention** and **Clear**.
  - A short lens readout: the lens question and the band counts for the current lens.
- **Stage**: two absolutely positioned containers, `mapEl` and `timelineEl`. The variant renders into them, and only
  the active view is visible.
- **Inspector**: a side panel on desktop (`--ok-insp-w`) and a bottom sheet on phones.
- **Full-page feature detail**: an overlay over the whole shell (see below).
- **Legend**: a panel with the kit's standard sections (status glyphs, rating bands, gates, attention, initiatives)
  plus the variant's own sections.
- **Phone (≤ 760px)**:
  - A compact top bar with product, view switch, search icon and menu.
  - The lens bar as a horizontally scrolling pill row with the active pill kept in view.
  - Filters behind a **Filters** button that opens a bottom sheet.

Keys: `1`–`8` lens · `V` toggles Map / Timeline · `/` search · `G` human gates · `A` attention · `L` legend ·
`Enter` opens the feature page for the selection · `Esc` closes the topmost panel, then deselects.

## JS API (`window.OK`)

```js
const shell = OK.mount({
  root,                         // container element (the page's #app)
  variant: 'Orbit Plan',        // shown in the top bar
  legend: () => html,           // variant legend sections (optional)
});
shell.mapEl, shell.timelineEl   // containers the variant fills (position: absolute; inset: 0)
shell.state                     // { lens, view, statuses: Set, query, initiative, gates: null|'any'|'triage'|'approval'|'changes',
                                //   attention, selection: { type: 'feature'|'module'|'domain'|'area'|'release', id } | null, theme }
shell.on(event, fn)             // events: 'lens', 'view', 'filter' (statuses, query, initiative, gates, attention),
                                //   'select', 'locate' ({ featureId } — fly to it), 'theme', 'feature-open', 'feature-close'
shell.setLens(id); shell.setView('map'|'timeline'); shell.select(ref|null)
shell.isDimmed(feature)         // true when filters, search, initiative or gates exclude it (fade it, never move it)
shell.isHit(feature)            // search match (for a highlight ring)
shell.filterActive()
shell.peek(featureId)           // standard feature peek in the inspector, with an "Open feature page" button
shell.openFeature(featureId); shell.closeFeature()
shell.inspector.open({ kicker, title, subtitle, body /* html */, onClose }); shell.inspector.close()
shell.freeRect()                // { x, y, w, h } of the stage area not covered by the inspector or sheet, in stage px
```

Primitives (pure functions that return markup strings):

- `OK.svg.status(status, r)`: the status glyph centred on 0,0.
- `OK.svg.band(band, r)`: the rating band glyph. Shape-coded: good is a full disc, fair a three-quarter disc,
  poor a half disc, critical a ring with a cross, and na a dashed ring.
- `OK.svg.corona(feature, r)`: an 8-segment ring with each lens segment coloured by its band (na segments
  faint). It is the compact "state in every lens" mark.
- `OK.html.rating(rating, { size: 'sm'|'md'|'lg', label })`: a badge with the band glyph, score and headline.
- `OK.html.lensChip(lensId)`, `OK.html.statusChip(status)`, `OK.html.gateChip(gate)`.
- `OK.blocks.ratingTable(nodeRef)`: per-lens band, score and counts for a module, domain or area
  (`nodeRef = { type, id }`).
- `OK.blocks.statusBar(rollup)`, `OK.blocks.featureList(features, { lens })`, `OK.blocks.gates(features)`,
  `OK.blocks.releasePackage(releaseId)`: the release items grouped by domain, with new, improved and fixed marks.
- `OK.fmt.pct`, `OK.fmt.money`, `OK.fmt.num`, `OK.fmt.date` ("8 Oct 2026"), `OK.fmt.rel` ("3 days ago", relative
  to `BP.data.meta.asOf`), `OK.fmt.ms`.
- `OK.lens(id)` returns `{ ...BP lens def, hue: 'var(--ok-lens-…)' }`. `OK.bandColor(band)` returns the token string.

## Full-page feature detail

`shell.openFeature(id)` opens a full page over the stage and the filter bar. The top bar stays visible, so switching lens while on the page highlights that lens's tile.

- **Header**: a breadcrumb (area › domain › module, each clickable to inspect it on the map), the feature title,
  status, priority, release, owner, builder, updated date and the 8-lens corona. Actions: **Show on map**
  (closes the page and emits `locate`) and **Close**.
- **Tab Overview**:
  - The summary, then the blocked reason or note.
  - Eight **lens tiles**, each with a band glyph, score, headline, facts and reasons; non-applicable lenses
    say why ("No UI surface").
  - Dependencies and dependents (clickable: they open that feature's page).
  - Initiatives this feature is part of.
  - The releases the feature appears in.
- **Tab Work**:
  - Work items grouped by state, with their source (goal, ticket or scan, plus the reference).
  - Branches with activity, state, checks and evidence (the demo or report title and summary).
  - Human gates are highlighted: triage waiting, awaiting approval, changes requested with the reviewer's note.
  - Approve, Request changes and Triage buttons work locally and label themselves "Not saved in this prototype".
- **Tab Ledger**:
  - An audited activity table with time, actor (with agent, human or system mark), action, lens, result,
    summary, reference and hash.
  - Filter chips per lens and per actor kind; newest first.
  - The table scrolls inside its own container, and on phones each row stacks into a card.
- Esc closes the page. It has its own sticky header under the top bar. On phones it covers everything except
  the compact top bar.
