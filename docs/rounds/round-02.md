# Round 2: the Orbit identity, role lenses, gates and time at 500 features

Goal: carry round 1's chosen identity (Orbit) into the two directions the client kept: Cyanotype's containment structure, which opens like
Google Maps, and Atlas's practical tree. The goal is to test both at real scale: one product, 5 areas, 17 domains, 54 modules and
491 features. The binding decisions are in [round-02-brief.md](round-02-brief.md).

All four variants share:

- **The data, v0.2** ([data-model-v2.md](../data-model-v2.md)): a generated mock of Larkspur with 491 features, eight lens ratings
  built from metrics, initiatives, human gates on work items and branches, 2,539 ledger entries, and 15 releases.
- **The Orbit kit** ([orbit-kit.md](../orbit-kit.md)). It provides:
  - the shell: lens bar, Map/Timeline switch, search, filters, initiatives, gates, attention, legend and the Light › Dark › Auto theme;
  - the inspector;
  - the full-page feature detail with Overview, Work and Ledger tabs.

  The variants differ only in the **map** and the **timeline**.

| | Variant | Direction | Live prototype | Source |
| --- | --- | --- | --- | --- |
| A | **Orbit Plan**: the product as a floor plan | Plan | [open](https://claude.ai/artifact/WLCw1uWSpjnj4Nvx1i2QEZ) | removed (in `f2fbe96`) |
| B | **Orbit Territories**: the product as a hex territory map | Plan | [open](https://claude.ai/artifact/NHQWjHNAXQp5eahGMDv1yo) | removed (in `f2fbe96`) |
| C | **Orbit Atlas**: the product as an engraved card tree | Atlas | [open](https://claude.ai/artifact/1PZnZ9LLc8tywH7evd47VR) | `prototypes/round-02/c-atlas/` |
| D | **Orbit Columns**: the product as a skyline of domain columns | Atlas | [open](https://claude.ai/artifact/UaoUu9yUrfsSJLLYDiH4A7) | removed (in `f2fbe96`) |

The kit's demo and styleguide (`prototypes/round-02/kit/`, with the styleguide at `#styleguide`) show the shared parts on their own.

## Decision

The client picked **C · Orbit Atlas** as the winner. It is the baseline for round 3. The source for A, B and D was removed
from the branch after this round; it remains in git history at commit `f2fbe96`
(`git checkout f2fbe96 -- prototypes/round-02/<variant>`). The round 3 questions below are still open. Answer them for
Orbit Atlas, and take ideas from the other variants only where they help it.

## What every variant does

- **It opens like a map.**
  - The opening fit shows the whole product in the Overall lens: 5 areas and 17 named domains, each with its band, score, attention
    count and gate count.
  - Zooming uncovers more on a continuous zoom, through L0 (domains), L1 (modules), L2 (feature marks), L3 (names and the lens
    score) and L4 (an on-canvas mini-detail with the eight-lens corona). The levels cross-fade.
  - Labels are culled by priority so they never overlap. A location readout and sticky labels keep you oriented.
- **Fixed positions.** Each layout is computed once per screen size class. A lens, filter, search, initiative, gate or selection
  only recolours, fades or marks; nothing moves or re-sorts.
- **Role lenses.** Every mark and every rollup shows the current lens:
  - Overall
  - Development
  - Operations
  - Business
  - Security
  - Compliance
  - UX
  - Cost

  Each lens has its own look for "n/a". Operations, Business and Cost don't apply to 228 of the features.
- **Human gates and initiatives.** Triage, approval and changes-requested gates are marked on features and counted on modules and
  domains. An initiative highlights its features by coverage. Attention is always visible.
- **Selection.**
  - Click a feature to peek at it and draw its dependency links on the canvas.
  - Double-click, or press Enter, to open its full page.
  - Click a module, domain or area to inspect it.
  - Search with Enter flies to the result.
- **A timeline as the second view**, each in its own shape: 12 shipped releases, 1.12 next (with readiness), and 2.0 and 2.1 in the
  future, on a dated axis with a today marker. Clicking a release opens its package.
- **Light by default and dark supported**, from 1920 px down to the 820 px side panel and a 390 px phone.

## The variants

### A · Orbit Plan: the product as a floor plan

Cyanotype's containment plan, redrawn as one calm Orbit sheet.

- **Layout.**
  - Areas are wings, domains are zones, modules are rooms and features are fixtures on a fixed cell grid, so a room's size is its
    feature count.
  - The packer runs once per screen size class, then stretches to the stage.
- **The opening fit.**
  - Every zone has a plaque: its name in large tracked caps, the lens band and score, a status bar, and attention and gate
    counters. The score is the last thing to drop when space runs out.
  - Every room is tinted by its module's band for the current lens, so a lens switch repaints the whole plan.
  - Marks that would sit under a plaque ride on a small rail just below it. Nothing is hidden.
- **Zooming in.**
  - Sticky zone and room header bands, like map labels at the screen edge.
  - Fixtures tinted by band, with status shown by glyph form.
  - Names, then an on-canvas mini-detail.
- **Cyanotype ideas kept in a lighter form.**
  - Zone feet carry a slim lens gauge (Cyanotype's "measured edges").
  - Human gates show as a scalloped revision-cloud halo.
  - A corner readout with level, scale and location; it opens the inspector for what it names.
- **Timeline: Phasing.** The same plan in the same place, re-tinted by delivery phase:
  - Earlier releases fade.
  - The selected release lights up: new work in full colour, improved or fixed work half-lit.
  - The next release is outlined and later ones dashed.
  - A dated release ribbon with a today marker drives it, and Play steps through history.
- **Strengths.**
  - The most literal blueprint, and the plan doubles as a quantity chart.
  - "Where is it" and "when did it ship" share one memorised geometry.
  - The plaques read like a building directory.
- **Costs.**
  - Fixtures are abstract until you zoom.
  - Rectangular rooms leave space in small modules.
  - Desktop, the side panel and the phone each get their own arrangement, so positions differ between devices.

### B · Orbit Territories: the product as a territory map

A star chart crossed with a strategy-game map.

- **Layout.**
  - Every feature is a hex cell, modules are clusters, domains are raised region plates, and areas are continents parted by sea
    channels.
  - The Orbit graticule runs under the sea.
- **The opening fit.**
  - All 491 cells are on screen, coloured by band. The fill gets stronger as the band gets worse, so healthy land stays calm and
    trouble stands out.
  - n/a cells are hatched like unsurveyed ground.
  - Region labels sit on quiet plates, placed by collision. A label drops its counts, then its score, before it would drop its
    name.
  - Attention is a small corner mark that grows into a full badge as you zoom.
- **Zooming in.**
  - Module "city" labels.
  - Status glyphs in every cell.
  - Names and scores, with module tabs in the gaps between rows.
  - A per-cell mini-detail with the eight-lens corona.
  - A breadcrumb readout opens each level's inspector.
- **Timeline: Time-lapse.**
  - The same territory, shown as of a chosen release. Later land is unexplored, and the chosen package glows.
  - A scrubber with play replays the product growing release by release, under a features-live curve and a today marker.
  - It opens on 1.12, with its readiness ("39 ready · 47 in build · 7 blocked").
- **Strengths.**
  - The most memorable and the most map-like.
  - Every feature is visible from the first frame, so problem areas literally show as red land.
  - Growth over time is tangible.
- **Costs.**
  - Cell shape carries no meaning beyond count.
  - Arrangements differ per screen size class.
  - The most colour on screen.
  - Labels compete with cells on a phone.

### C · Orbit Atlas: the product as an engraved card tree

Atlas's practical left-to-right tree in Orbit dress.

- **Layout.**
  - The product root is an instrument dial with eight 270° lens gauges.
  - Hairline elbow connectors, which thin out by level, run from the dial to 5 engraved area titles, 17 domain score rings,
    54 module cards and 491 feature cards in fixed rows. Nothing re-sorts by lens.
  - At narrow widths the dial becomes a product plaque above the tree.
- **The opening fit.**
  - Domain score rings with names and counters.
  - Module band bars.
  - Feature tiles graded by band, with attention marks.
- **Zooming in.**
  - Module cards.
  - Grown domain plates that carry a domain sheet: status mix, gates by kind, their share of v1.12, and an every-lens table.
  - Feature chips, then cards, then full cards with the corona.
- **Atlas tools kept.**
  - Fold and expand.
  - Focus a branch (F).
  - A minimap.
  - Arrow-key tree navigation.
  - A **gates queue** (`[` and `]`) that steps through the 97 features waiting for a human, longest wait first.
- **Timeline: Release swimlanes.**
  - The 17 domains are lanes, grouped by area, on a to-scale time axis with a today line.
  - Each chip is a package item, tinted by the lens.
  - The next and future columns show readiness by status glyph.
  - A selected feature's chips are joined by a lifeline.
- **Strengths.**
  - The most practical: full horizontal names, a reading order like a list, and tools for daily work.
  - The gates queue is a ready workflow for approvers.
- **Costs.**
  - The least map-like.
  - At the opening fit, features are thin tiles at the end of long rows.
  - On desktop the dial takes width from the tree.

### D · Orbit Columns: the product as a skyline

Atlas turned into a top-down instrument panel.

- **Layout.**
  - A product band at the top: dial, score, status, gates, attention and the next release.
  - 5 area banners over 17 fixed-width domain columns. Module cards stack down each column, with one row per feature.
- **The opening fit.**
  - A skyline: a column's height is its feature count, and each module is a heat bar in its band, segmented per feature.
  - Filters light up the matching features as ticks at their exact rows, so they work without zooming.
  - At narrow widths, full domain titles are angled above the columns. There are no codes.
- **Zooming in.**
  - Module cards.
  - Rows with status and marks.
  - Names and scores.
  - Each row becomes its own mini-detail in reserved space, so nothing moves.
- **Timeline: Release stack.**
  - Time runs down while the 17 columns keep their exact x positions and zoom.
  - Each release is a band whose header names its biggest items, at-risk items first, and v1.12 lists what is blocked.
- **Strengths.**
  - The densest overview that stays legible: size and health are read in one look.
  - The map and timeline share columns, so switching views changes only the vertical axis.
- **Costs.**
  - 17 columns is near the width limit; 2–3× the domains would need wrapping or horizontal travel.
  - Angled titles at narrow widths.
  - Heat bars show the module's band, not each feature's.

## Ideas worth keeping whichever shape wins

- **A domain plaque at the opening fit**, with name, lens score and counters, where the score is the last thing to drop
  (Plan and Territories; Atlas's score rings).
- **Geometry that encodes quantity**: room area, cell count and column height all equal the number of features.
- **One geometry, two readings.** The timeline keeps the map's positions: Plan re-tints the same plan, and Columns keeps the same
  columns. People learn one shape.
- **Filters that work at the overview**: Columns' match ticks, Plan's mark rail and Territories' faded land.
- **Calm at rest, loud on trouble.** Fill strength rises as the band gets worse (Territories), and attention is a small mark that
  grows with zoom.
- **A product instrument** with all eight lenses on the map itself (Atlas's dial, Columns' band). The kit now has a standard
  product inspector behind it.
- **A gates queue** that steps through everything waiting for a human (Atlas).
- **A lifeline** joining one feature's appearances across releases (Atlas and Columns).
- **A breadcrumb readout** that keeps you oriented and opens the inspector for each level (Plan and Territories).

## Questions for round 3

### Product

1. **Direction.** Which family leads round 3: the Plan family (A Plan or B Territories) or the Atlas family (C Atlas or
   D Columns)? Which single variant should be the baseline, and which ideas from the others should it take?
2. **The first glance.**
   - Plan opens on domain plaques over tinted rooms. Territories, Atlas and Columns show every feature from the first frame.
   - Which suits an executive's first look, and which suits a developer's?
3. **Positions across devices.**
   - Plan and Territories pack a different arrangement for desktop, the side panel and the phone.
   - Atlas and Columns keep one order everywhere.
   - Must the map be learnable across devices, at the cost of smaller shapes on narrow screens?
4. **Ratings.**
   - Are the bands right (good 80+, fair 60+, poor 40+, critical below)?
   - Overall is a weighted mean of the lenses that apply (Development, Operations and Security weigh most), capped at poor
     when any lens is critical, and its headline leads with what is wrong ("Critical in Cost"). Are those the right weights,
     and should one critical lens cap it harder?
   - Should thresholds or weights be configurable per product or domain?
5. **"Doesn't apply" vs "not monitored".** Today both are hatched n/a. Should a monitoring gap (Operations not monitored) look
   like a problem, different from a lens that genuinely doesn't apply (no UX rating for an API)?
6. **Gates as actions.**
   - In round 3, should triage, approve and request changes become real actions in the blueprint, with a comment that lands in
     the ledger?
   - Who may approve what: a security reviewer for security findings, a designer for UX?
   - Do approvers think in features (Atlas's queue: 97) or in gates (the rail: 113)?
7. **The timeline.**
   - Which of the four answers your release questions best: Phasing, Time-lapse, Swimlanes or Stack?
   - Should it open on the next release (1.12, what is at risk) or the last shipped?
   - What makes an item "biggest" in a release summary: at risk first, customer-facing first, or initiative work first?
8. **Initiatives.** Keep them as filters, or also give each its own progress view (coverage, deadline, findings burned down)?
9. **Role homes and shared views.**
   - Should each role land on its lens with a saved filter (for example, a developer on Development plus approvals waiting)?
   - Should views (lens, filters, focus, folds) be shareable as links?
10. **Approving with confidence.** On the feature page, what evidence do you need before you approve a branch: a demo
    recording, a test report, a diff summary, a preview link, or something else?
11. **Scale.** At 2–3× the domains (35–50), Columns needs to wrap and Atlas grows taller, while Plan and Territories pack.
    Do you need a level between module and feature (feature groups or epics)?

### Variant details (answer only for the variants you keep)

- **Plan.**
  - Is the room tint the right density for the first view, or should it be lighter so the plaques dominate?
  - Is the small displacement of marks onto the plaque rail acceptable?
  - Should Phasing open on v1.12?
- **Territories.**
  - Should fills reach full colour at the Modules layer instead of the Features layer?
  - Is a corner mark loud enough for attention at an executive glance?
  - When space is tight, labels drop counts before names. Is that the right priority?
- **Atlas.**
  - Should desktop also use the top product plaque and give the dial's width back to the tree?
  - Should the dial's lens scale switch the lens, or be read-only?
  - Should folds and focus persist?
- **Columns.**
  - Are angled titles acceptable for the first view at narrow widths?
  - Should heat segments use each feature's own band (more information, but busier)?
  - Should the row mini-detail show for every row, or only the selected one?

## Process notes

- **Foundation first.**
  - The v0.2 dataset is generated deterministically and validated: `npm run generate:v2 && npm run validate:v2`.
  - The Orbit kit was built and integrated on real data before any variant started.
  - The kit went from 0.2.0 to 0.2.2 during the round. The variants asked for a legend hook and keys, a product inspector, an
    event on outside theme changes, layout-free inspector hints and a select source. Review then fixed four small bugs. Every
    change is additive.
- **Three passes per variant.**
  1. A build with at least 3 screenshot review-and-fix passes.
  2. A fresh-eyes design polish scored on a 13-point rubric. The average score went from 3.2 to 4.2 (Plan), 3.4 to 4.1
     (Territories), 3.7 to 4.4 (Atlas) and 3.5 to 4.1 (Columns).
  3. Functional QA on 15 checks with state assertions against the data. Every check passes for all four.
- **What QA asserts.** Layout fingerprints prove that positions never move on a lens, filter, search, initiative, gates or
  selection change. Counts drawn on the map match the model, and dependency links match the data.
- **kit-check passes** on desktop and phone for every page.
  - A lens switch costs 1–3 ms of script and a filter change 2–12 ms, against budgets of 40 and 60 ms.
  - A map frame takes about 1–5 ms at 491 features.
- **The published bundles were tested as the viewer renders them** (a host-preview wrapper) at 1440, 820 and 390 px in light
  and dark: zero errors, no blocked hosts and no sideways scrolling.
- **Not yet tested:** pinch-to-zoom was only driven with synthetic touch events, not on a real device. The time-lapse
  colours past releases by today's ratings, because the mock data has no rating history.
- **Kit work planned for round 3:** canvas painters that share the glyph geometry (`OK.canvas`) and resolved theme colours
  (`OK.tokens()`). All four canvas variants had to re-draw the kit's glyphs by hand.
