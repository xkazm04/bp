# Orbit kit (round 2 shared UI)

Every round 2 variant uses the same visual identity and the same app shell. Each variant designs only its
**map** and its **timeline**, so the comparison stays about shape. The kit is plain JS and CSS with no dependencies.

| File | Role |
| --- | --- |
| `prototypes/shared/v2/orbit-kit.css` | Tokens, themes, type, and component styles (all classes prefixed `ok-`) |
| `prototypes/shared/v2/orbit-kit.js` | `window.OK`: the shell, state, primitives, inspector, legend, and full-page feature detail |
| `prototypes/round-02/kit/index.html` | Kit demo and test page: the shell with a plain list "map" and a release list, plus the `#styleguide` route (tokens and primitives in both themes side by side) |
| `prototypes/round-02/kit/demo.js`, `demo.css` | The demo's list map and timeline: the reference wiring a variant copies, then replaces with its own shapes |
| `scripts/kit-check.mjs` | `npm run kit-check -- <page.html>`: drives a mounted shell through all 491 features (every primitive, block, lens, filter, inspector and feature page tab, with the page's own listeners) and fails on errors or slow changes |
| `scripts/scenarios/round-02-kit.json` | Screenshot scenarios for `scripts/shoot.mjs`: 1920, 1440, 1280 and 820 px in light and dark, the 390 px phone in both themes, and the styleguide (164 shots). Copy it for a variant and swap the `.kd-*` selectors for the variant's own |

Pages load, in this order: the Google Fonts stylesheet for **Jost** (300–600) and **DM Mono** (400, 500),
`orbit-kit.css`, `blueprint-data.js`, `blueprint-model.js`, `orbit-kit.js`, and then the page script. The page body
holds one `<div id="app"></div>`; `OK.mount` sizes it, sets `html.ok-app` (full height, no page scroll) and fills it.

## Identity: Orbit

The identity comes from round 1 variant B. It feels like a precise astronomical instrument: calm, measured and luminous.

- **Light (default)**: a daylight celestial chart. Pale, cool paper; ink-blue hairlines; fine graticules and tick scales.
- **Dark**: a night sky. Blue-black ink (not pure black), luminous linework, and soft glows on live elements.
- **Type**: Jost for labels, in tracked uppercase for chart lettering and sentence case for UI copy. DM Mono for
  every number, date and reference, with tabular figures.
- **Shapes**: rings, arcs, thin ticks and dotted orbits. Status is shown by glyph form: a filled disc is live, a ring
  with a dot is ready, a half disc is in build, a dotted ring is planned, and a red cross-star is blocked.
- **Other marks**: needs attention is a red six-ray asterisk; human gates are magenta rings (triage dashed, approval
  solid with a dot, changes requested red); release package items are small squares (new +, improved ^, fixed ✓) so they
  never read as status; ledger actors are an orbiting ring (agent), a disc (human) and a diamond (system).
- **Plain words**: round 1 used instrument jargon (Epoch, MAG, BRG). Keep the instrument styling but label things plainly.

### Theme mechanics

Light is the default no matter what the OS prefers (client decision). Dark is opt-in. The toggle cycles
**Light → Dark → Auto** and persists in `localStorage` under the key `orbit-kit.theme` (`light`, `dark` or `auto`),
inside try/catch. Screenshot scenarios can start in dark with `"storage": { "orbit-kit.theme": "dark" }`. The shell
always writes the choice to `<html data-theme>` (including `light`). The classes `.ok-theme-light` and `.ok-theme-dark`
apply either palette to one subtree regardless of the page theme (the styleguide uses them for its side-by-side columns).

```css
:root { /* every token: light values */ color-scheme: light; }
:root[data-theme="dark"] { /* dark values */ color-scheme: dark; }
@media (prefers-color-scheme: dark) { :root[data-theme="auto"] { /* the same dark values */ color-scheme: dark; } }
body { background: var(--ok-paper); color: var(--ok-ink); }
```

### Tokens (CSS custom properties)

- Surfaces and ink: `--ok-paper`, `--ok-paper-hi`, `--ok-sky-a`, `--ok-sky-b`, `--ok-ink`, `--ok-ink-2`, `--ok-ink-3`,
  `--ok-ink-4`, `--ok-rule`, `--ok-rule-2`, `--ok-band`, `--ok-band-hi`, `--ok-panel` (the top bar and filter rail),
  `--ok-panel-solid` (every floating panel: inspector, legend, popovers, sheets), `--ok-panel-edge`, `--ok-shadow`, `--ok-glow`.
  Panels are solid and the kit uses no `backdrop-filter`: a blur under a panel repaints the whole map behind it on every change.
- Lens hues, one per lens and used only to identify the lens (tabs, swatches, headers):
  `--ok-lens-overall`, `--ok-lens-dev`, `--ok-lens-ops`, `--ok-lens-biz`, `--ok-lens-sec`, `--ok-lens-comp`,
  `--ok-lens-ux`, `--ok-lens-cost`.
- Rating bands, an ordered scale that is distinct from the lens hues and readable without colour (glyph shape plus
  lightness): `--ok-good`, `--ok-fair`, `--ok-poor`, `--ok-critical`, `--ok-na`, and `--ok-*-soft` fills for each.
- Signals: `--ok-alarm` and `--ok-alarm-soft` (needs attention, blocked, changes requested), `--ok-gate` and
  `--ok-gate-soft` (waiting for a human: triage or approval), and `--ok-focus` (keyboard focus ring).
- Also: `--ok-on-ink` (text and glyphs on an ink-filled control) and `--ok-scrim` (behind phone sheets).
- Fonts: `--ok-f-label` (Jost), `--ok-f-body` (Jost), `--ok-f-mono` (DM Mono).
- Metrics: `--ok-bar-h` (56px, 102px when the lens dial wraps to its own row, 98px on phones), `--ok-filter-h` (46px),
  `--ok-insp-w` (392px, 344px under 1200px), `--ok-gut` (16px side gutter, 12px on phones). They are set on `.ok-shell`,
  so variants read them there.

The `#styleguide` route of the kit demo shows every token with its resolved value in both themes.

## Shell

`OK.mount(opts)` builds the shell inside `opts.root`:

- **Top bar**:
  - Brand mark, then a two-line nameplate: product name with live and next version, and the variant name under it.
  - **View switch**: Map / Timeline.
  - **Lens bar**: the four role lenses (Overall, Development, Operations, Business), a divider, then the four
    specialist lenses (Security, Compliance, UX, Cost). Each shows the product-level band glyph and score; keys 1–8.
  - On the right: search (with a results list: arrows move, Enter peeks the feature), legend and theme.
  - **Fitting**: the shell measures the bar on resize and on font load (never per frame) and adds the fewest classes
    that make it fit, in this order: `ok-fit-short` (short lens names: Dev, Ops, Biz, Sec, Comp), `ok-fit-narrow`,
    `ok-fit-compact` (hides the version), `ok-fit-viewicon` (icon-only view switch), `ok-fit-searchicon`, and finally
    `ok-fit-tworow` (the lens dial takes its own row; 820px side panel). Lens names are always words.
  - The filter rail does the same with `ok-ff1`…`ok-ff12`, cumulatively: the readout's question, the Status label, the
    Human gates label, the Attention label, the status labels (glyph and count stay), an unchosen initiative's label,
    the readout's lens name, the n/a band count, the gate labels (glyphs and counts stay), the whole readout, a chosen
    initiative's name (its icon stays, the name is in the title), and last of all "N of M". Hover titles and aria-labels
    keep every word. A variant that changes the bar or rail after mounting should dispatch a `resize` to refit.
- **Filter bar**:
  - Status chips with glyphs and counts (multi-select).
  - An **Initiatives** picker listing permanent and temporary initiatives with coverage counts. Choosing one
    highlights its features and fades the rest.
  - A **Human gates** toggle with three counts (Triage · Approval · Changes); clicking a count narrows to that gate.
  - **Attention**, then **Clear** and "N of 491" while any filter is active.
  - A short lens readout on the right: the lens name and question, and the band counts for the current lens.
- **Stage**: two absolutely positioned containers, `mapEl` and `timelineEl`. The variant renders into them, and only
  the active view is visible.
- **Inspector**: a floating side panel on desktop (`--ok-insp-w`) and a bottom sheet on phones. Three kinds:
  the standard **feature peek** (`shell.peek`), the standard **node inspector** for an area, domain, module or release
  (`shell.inspect`), and a **custom** panel (`shell.inspector.open`).
- **Full-page feature detail**: an overlay over the whole shell (see below).
- **Legend**: a panel with the kit's standard sections (status glyphs, rating bands, gates, attention, initiatives)
  plus the variant's own sections.
- **Phone (≤ 760px)**:
  - A compact top bar with product, view switch, search icon and menu (the menu sheet holds the theme switch and the legend).
  - The lens bar as a horizontally scrolling pill row with the active pill kept in view.
  - Filters behind a **Filters** button (it shows the active count) that opens a bottom sheet with status, gates,
    attention and the initiatives list; its footer says "Show N of M". The rail shows the product band counts, and
    "N of M" in their place while a filter is active. A sheet always opens scrolled to its top.

Keys: `1`–`8` lens · `V` toggles Map / Timeline · `/` search · `G` human gates · `A` attention · `L` legend ·
`Enter` opens the feature page for the selection · `Esc` closes the topmost panel (search, initiatives, sheet, feature
page, legend, inspector), then deselects. Keys are ignored while typing. On the feature page the tabs follow the ARIA
tabs pattern (arrow keys, Home, End). Focus is visible everywhere (`--ok-focus`), opening the feature page moves focus to
its title, and closing it returns focus to where it was. Status changes are announced through a polite live region.
`prefers-reduced-motion` turns off kit transitions and animations.

## JS API (`window.OK`)

```js
const shell = OK.mount({
  root,                         // container element (the page's #app); the kit sizes it
  variant: 'Orbit Plan',        // shown under the product name
  legend: (state) => html,      // variant legend sections (optional): '<section class="ok-lg-sec"><h3>…</h3>…</section>'
});
shell.mapEl, shell.timelineEl   // containers the variant fills (position: absolute; inset: 0); only the active view is visible
shell.stageEl, shell.root       // the stage that holds both, and the .ok-shell element
shell.state                     // live object, read only: { lens, view, statuses: Set, query, initiative, gates: null|'any'|'triage'|'approval'|'changes',
                                //   attention, selection: { type: 'feature'|'module'|'domain'|'area'|'release', id } | null,
                                //   theme: 'light'|'dark'|'auto', page: { id, tab } | null }
shell.on(event, fn)             // fn(payload, state); returns an unsubscribe function. Events and payloads:
                                //   'lens' { lens } · 'view' { view } · 'filter' { what, active, shown } (what: statuses|query|initiative|gates|attention|clear)
                                //   'select' ref|null · 'locate' { type, id, featureId? } (bring it into view) · 'theme' { theme, dark }
                                //   'feature-open' { featureId, tab } · 'feature-close' { featureId } · 'inspector' { open, rect }
                                //   (rect is a getter for freeRect(): reading it measures layout, so read it only when you need it)
shell.setLens(id); shell.setView('map'|'timeline')
shell.select(ref|null)          // marks the selection (no panel); select(null) also closes the standard inspector
shell.peek(featureId)           // selects the feature and opens the standard feature peek, with an "Open feature page" button
shell.inspect({ type, id })     // standard inspector for 'area'|'domain'|'module'|'release' (a 'feature' ref peeks)
shell.isDimmed(featureOrId)     // true when filters, search, initiative or gates exclude it (fade it, never move it)
shell.isHit(featureOrId)        // search match (for a highlight ring)
shell.filterActive(); shell.shownCount(); shell.dimmedIds(); shell.hitIds()   // the last two are Sets of feature ids
shell.setStatuses(list); shell.setQuery(q); shell.setInitiative(id|null); shell.setGates(kind|null); shell.setAttention(bool); shell.clearFilters()
shell.openFeature(featureId, tab?)   // tab: 'overview' (default) | 'work' | 'ledger'
shell.closeFeature()
shell.inspector.open({ kicker, title, subtitle, body, footer, onClose })   // html strings; custom panel
shell.inspector.close(); shell.inspector.isOpen()
shell.legend.toggle(on?); shell.legend.refresh()
shell.freeRect()                // { x, y, w, h } of the stage area not covered by the inspector or sheet, in stage px
shell.isPhone(); shell.isDark(); shell.setTheme('light'|'dark'|'auto'); shell.announce(text); shell.destroy()
OK.shell                        // the mounted shell
```

Filter state is recomputed once per filter event with `BP.matches`, and `isDimmed`/`isHit` are Set lookups, so a
variant can repaint 500 features on `filter` and `lens` events without lag. Nothing in the kit runs per frame, and
no kit event handler reads layout: opening, re-rendering and resetting the inspector never forces a synchronous
layout (see **Performance** below).

**Declarative hooks.** Inside the shell, any element with these attributes is handled by the kit on click, so blocks
and variant markup need no wiring: `data-ok-peek="<featureId>"` (peek and emit `locate`), `data-ok-open="<featureId>"`
(feature page; add `data-ok-tab="work"` to open a tab), `data-ok-inspect="<type>:<id>"` (standard inspector and
`locate`), `data-ok-setlens="<lensId>"`. **CSS hooks** on `.ok-shell`: `[data-ok-lens]`, `[data-ok-view]`, and the
classes `ok-filtering`, `ok-has-insp`, `ok-page-open`.

Primitives (pure functions that return markup strings):

- `OK.svg.status(status, r)`: the status glyph centred on 0,0.
- `OK.svg.band(band, r)`: the rating band glyph. Shape-coded: good is a full disc, fair a three-quarter disc,
  poor a half disc, critical a ring with a cross, and na a dashed ring.
- `OK.svg.corona(feature, r, { lens, status, width, gap })`: an 8-segment ring, clockwise from the top in lens order,
  with each lens segment coloured by its band (na segments faint and thin). It is the compact "state in every lens"
  mark. `lens` adds an outer tick on that lens's segment; `status: true` puts the status glyph inside.
- `OK.svg.jewel(lensId, band, r)` (lens-hue ring around the band glyph, as on the lens dial), `OK.svg.gate(kind, r)`,
  `OK.svg.attention(r)`, `OK.svg.releaseKind(kind, r)`, `OK.svg.actor(kind, r)`, `OK.svg.result(result, r)`,
  `OK.svg.icon(name, px)` (search, close, legend, light, dark, auto, map, timeline, menu, filter, chev, locate, open,
  check, demo, report, goal, ticket, scan, branch, arrow, back), `OK.svg.mark(px)`, and
  `OK.svg.wrap(inner, r, px, cls?, label?)` to make any of them an inline `<svg>`. `OK.version` is the kit version.
- `OK.html.status(status, px, label?)`, `OK.html.band(band, px, label?)`, `OK.html.corona(feature, px, opts)`,
  `OK.html.jewel(lensId, band, px)`, `OK.html.gate(kind, px)`, `OK.html.attention(px)`: the glyphs as inline SVG
  (`OK.html.icon` is `OK.svg.icon`).
- `OK.html.rating(rating, { size: 'sm'|'md'|'lg', label })`: a badge with the band glyph, score (0–100) and headline.
  `sm` is glyph and score only; `md` puts the headline on one line with an ellipsis (so give it 260px or more, or
  use `lg`, which wraps). Headlines are 20–55 characters (blocked reasons up to 90).
- `OK.html.lensChip(lensId)`, `OK.html.statusChip(status)`, `OK.html.gateChip(gate|kind)`, `OK.html.bandChip(band)`,
  `OK.html.priority(p)`, `OK.html.releaseChip(feature)` ("Shipped in v1.9" or "Targets v1.12").
- `OK.blocks.ratingTable(nodeRef, { lens })`: per-lens band, score, spread bar and n/a count for a module, domain or area
  (`nodeRef = { type, id }`; any other type means the product). The current lens row is marked; lens names switch lens.
- `OK.blocks.statusBar(rollup)`, `OK.blocks.featureList(features, { lens, limit, path, action: 'peek'|'open', empty })`,
  `OK.blocks.gates(features, { limit })`, `OK.blocks.releasePackage(releaseId, { noHead })`: the release items grouped by
  domain, with new, improved and fixed marks. For a release that has not shipped (next or future) each new feature
  also shows its status glyph at the end of its row, and a second count line says how many are ready, in build,
  blocked or planned, so a timeline can show what is at risk.
- `OK.fmt.pct` ("12%", "2.5%", "0.04%"), `OK.fmt.money`, `OK.fmt.num`, `OK.fmt.score` (0–1 to "0"–"100", rounded
  down so a number never shows a better band than its glyph: 0.7963 is "79", fair), `OK.fmt.date` ("8 Oct 2026"),
  `OK.fmt.dateShort` ("8 Oct"), `OK.fmt.time`, `OK.fmt.dateTime`, `OK.fmt.days`, `OK.fmt.rel` ("3 days ago", relative
  to `BP.data.meta.asOf`), `OK.fmt.ms`.
- `OK.lens(id)` returns `{ ...BP lens def, short, hue: 'var(--ok-lens-…)' }` (short names: Overall, Dev, Ops, Biz, Sec,
  Comp, UX, Cost); `OK.lenses()` lists them. `OK.bandColor(band)` and `OK.bandSoft(band)` return the token strings.
- `OK.statusLabel(status)`, `OK.bandLabel(band)` and `OK.labels` (plain-word labels for statuses, bands, gates, builders,
  sources, work item and branch states, activities, ledger actions, results, actor kinds, initiative types, coverage
  states, surfaces and release kinds).
- `OK.nodeRating(ref, lens)`, `OK.nodeFeatures(ref)`, `OK.nodeRollup(ref)`: BP lookups by `{ type, id }`. `OK.esc(text)`.

## Full-page feature detail

`shell.openFeature(id)` opens a full page over the stage and the filter bar. The top bar stays visible, so switching lens while on the page highlights that lens's tile.

- **Header**: a breadcrumb (area › domain › module, each clickable to inspect it on the map), the feature title,
  status, priority, release, needs attention, owner, builder, updated date, progress (while not live or ready) and the
  8-lens corona with the current lens ticked. Actions: **Show on map** (closes the page, peeks the feature and emits
  `locate`) and **Close**. When the header scrolls away, the sticky tab bar shows the feature name.
- **Tab Overview**:
  - The summary, then the blocked reason or note, and beside them a "Waiting for a human" box when gates are open
    (each row and its button go to the Work tab).
  - Eight **lens tiles** (4 × 2 on desktop, 2 columns on tablets, 1 on phones), each with a band glyph, score, headline,
    facts and reasons; non-applicable lenses say why ("No UI surface"). The current lens's tile is outlined and marked
    "Current lens", and selecting a tile switches lens.
  - **Connections**: dependencies and dependents (clickable: they open that feature's page), initiatives this feature
    is part of with its coverage state, and the releases the feature appears in.
- **Tab Work**:
  - Work items grouped by state, with their source (goal, ticket or scan, plus the reference).
  - Branches with activity, state, checks and evidence (the demo or report title and summary).
  - Human gates are highlighted: triage waiting, awaiting approval, changes requested with the reviewer's note.
  - Gate cards come first, then work items grouped by state and branches side by side (stacked under 1200px).
  - Approve, Request changes (with an inline note) and Triage (Accept to backlog or Dismiss) work locally and label
    themselves "Not saved in this prototype". Decisions show as "by you, just now" and update the gate counts on the page.
- **Tab Ledger**:
  - An audited activity table with time, actor (with agent, human or system mark), action, lens, result,
    summary, reference and hash. Actors resolve with `BP.actor`: a person, an agent crew, or a system such as
    "CI pipeline", "Security scanner" or "SLO monitor".
  - Filter chips per lens and per actor kind; newest first.
  - Lens chips list only lenses with entries, plus "Workflow" for entries that are not evidence for one lens.
  - The table scrolls inside its own container. When the container is narrower than 1000px the reference and hash move
    under the summary and the lens moves under the action; on phones each row stacks into a card.
- Esc closes the page. It has its own sticky header under the top bar. On phones it covers everything except
  the compact top bar.

## Performance

Measured on the real data (491 features, the demo's 9,700-element page) with `npm run kit-check`: a lens switch costs
under 10 ms of script including the demo's repaint, a filter change under 20 ms, a peek under 1 ms, a node inspector
about 2 ms, and the feature page a median of 10 ms (40 ms at most) for any feature and tab. Everything after that is
the browser's style, layout and paint, which grows with the variant's DOM. To keep a variant instant:

- **Repaint in place.** On `lens` and `filter`, change attributes or classes on elements you keep (for example
  `data-band`, `is-dim`, `is-hit`). Never rebuild the map, never re-sort, never move anything.
- **Use the kit's sets.** `shell.isDimmed(f)` and `shell.isHit(f)` are Set lookups; `shell.dimmedIds()` and
  `shell.hitIds()` give the Sets themselves. `BP.rating`, rollups, gates and search are memoised, so calling them for
  every feature on every lens change is cheap.
- **No transitions on hundreds of elements.** An opacity fade on every feature gives each one its own compositor layer
  for every frame of the fade, which doubled the cost of a filter change in the demo. Fade a few elements, or none.
- **No layout reads in event handlers.** `getBoundingClientRect`, `offsetWidth` or `scrollTop` right after a change
  forces a synchronous layout of the whole page. Read the inspector `rect` only when you need it, and measure in
  `requestAnimationFrame` (the kit does this itself).
- **No `backdrop-filter`** over the map.
- **Check it:** `npm run kit-check -- prototypes/round-02/<variant>/index.html` (add `--width 390 --height 844` for the
  phone layout) fails when a lens switch passes 40 ms, a filter change 60 ms or a feature page 60 ms of script (95th
  percentile), or when anything throws or logs an error. Then run
  `npm run shoot -- <page> --scenarios scripts/scenarios/round-02-kit.json` (adapted to the variant's selectors) for
  the five viewports in both themes.

