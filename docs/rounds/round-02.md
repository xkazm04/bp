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
| A | **Orbit Plan**: the product as a floor plan | Plan | %LINK_A% | `prototypes/round-02/a-plan/` |
| B | **Orbit Territories**: the product as a hex territory map | Plan | %LINK_B% | `prototypes/round-02/b-territories/` |
| C | **Orbit Atlas**: the product as an engraved card tree | Atlas | %LINK_C% | `prototypes/round-02/c-atlas/` |
| D | **Orbit Columns**: the product as a skyline of domain columns | Atlas | %LINK_D% | `prototypes/round-02/d-columns/` |

The kit's demo and styleguide (`prototypes/round-02/kit/`, with the styleguide at `#styleguide`) show the shared parts on their own.

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

%VARIANTS%

## Ideas worth keeping whichever shape wins

%IDEAS%

## Questions for round 3

%QUESTIONS%

## Process notes

%PROCESS%
