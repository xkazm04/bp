# Round 1: theme, canvas shape and content

Goal: find a visual identity and a canvas shape for the blueprint, and decide what a feature shows at each zoom level.
All four variants use the same mock product, **Larkspur**: a commerce platform with 6 domains, 20 modules and 122 features.
Each feature has Dev, Ops and Business dimensions with 4 facets each. The variants also share the same required
behaviours, so they differ only in shape and identity.

| | Variant | Live prototype | Source |
| --- | --- | --- | --- |
| A | **Cyanotype**: architect's floor plan | [open](https://claude.ai/artifact/1q58bvK12Csw1QLVRSogFa) | `prototypes/round-01/a-cyanotype/` |
| B | **Orbit**: star chart | [open](https://claude.ai/artifact/ScCCXfcMckECYAbb2ZFVPi) | `prototypes/round-01/b-orbit/` |
| C | **Atlas**: card tree on an infinite canvas | [open](https://claude.ai/artifact/NV8z1VNzLPmnCkpHj8NpDb) | `prototypes/round-01/c-atlas/` |
| D | **Periodic**: periodic table of features | [open](https://claude.ai/artifact/LVti9PRaieN1iFQfgT8nTV) | `prototypes/round-01/d-periodic/` |

Every variant has:

- pan and zoom, with 3 or more levels of detail
- Overall, Development, Operations and Business lenses (keys 1–4)
- status shown by shape as well as colour, and a "needs attention" signal
- an AI-trust overlay for agent-built work waiting for human review
- status filters and search
- a feature and module inspector, with dependencies drawn on the canvas
- a summary bar, a legend, a light/dark toggle and a phone layout

## The variants

### A · Cyanotype: the product as a building

- **Layout.** Domains are zones of a floor plan, modules are rooms sized by feature count, and features are tagged fixtures (F-001 to F-122).
- **Status.** Drawn with real drafting conventions: existing construction is solid, new construction hatched, future work dashed, and a redline X means blocked.
- **Lenses.** Each lens is a sheet of a drawing set with its own symbols: A-101 Architectural, S-201 Structural (braced or unbraced bays for tests), M-301 Services (deployed outlets on service runs) and B-401 Program (zoning washes by adoption).
- **AI review.** Revision clouds mark agent work waiting for review. Numbered redline keynotes list everything that needs attention.
- **Sheet furniture.** A title block, dimension strings along each zone that measure completion, and a scale bar that tracks the zoom.
- **Strengths.** The most literal reading of "architecture blueprint". The sheet-per-lens idea is the most coherent lens model of the four, and a revision cloud is a natural mark for "unverified AI work".
- **Costs.** Highest learning curve, because drafting symbols have to be learned. Fixtures are abstract until room zoom, and the overview carries a lot of small lettering.

### B · Orbit: the product as a star chart

- **Layout.** A core with Dev, Ops and Business gauges, then rings for domains and modules, then features as stars whose glyph shows status. A three-arc corona around each star shows its dimension scores.
- **Gravity lenses.** In Dev, Ops and Biz, stars move inward as they get done, so distance from the centre reads as "how far from done".
- **Dependencies.** Bundled through the interior, so cross-domain coupling becomes visible.
- **Focus.** Clicking a domain rotates and zooms its sector toward you.
- **Strengths.** The most striking view, and gravity gives the fastest answer to "where is the unfinished work?".
- **Costs.** Radial labels are harder to read, angle around the circle carries no meaning, and names appear only at about 1.5× zoom. The least suited to daily operational work.

### C · Atlas: the product as a working tree

- **Layout.** A left-to-right tree: product, then domain plates, then module heat tiles, then rows of feature cards. Each card has a 3×4 facet barcode (Dev, Ops and Biz rows).
- **Detail by zoom.** Heat tiles and barcodes at overview, then names, priority and builder, then labelled facets, owner and review state.
- **Lens focus.** A lens expands that dimension's facets on every card, re-sorts each row by its score, and tints the connectors.
- **Tooling.** Focus and collapse for any branch, a minimap, keyboard navigation through the tree, and a review queue that steps through unreviewed agent work.
- **Strengths.** The most practical and readable, and the closest to a tool a team would use daily. The review queue is a concrete workflow for controlling AI-built work.
- **Costs.** The least distinctive identity, and it is closest to existing tools. The overview is a long grid of similar cards.

### D · Periodic: the product as a periodic table

- **Layout.** Every feature is an element tile with an atomic number, a two-letter symbol, a status glyph and Dev, Ops and Biz bars. Modules are columns and domains are black bands.
- **Rearrangements.** The same tiles animate between Table (by module), Status (by lifecycle) and Release (a histogram from v1.0 to v2.0 and unscheduled). This is one dataset in three canvas shapes.
- **Lenses.** A lens turns each tile's fill into an ink ramp of its score and swaps the bars for four labelled facet pips.
- **Signals.** One orange is used only for attention, and a folded corner marks AI work waiting for review.
- **Strengths.** The densest overview that stays legible. The number and symbol give every feature a stable identity, and the arrangements answer different questions without leaving the canvas. The Swiss styling reads well in both themes.
- **Costs.** Symbols are a vocabulary to learn, and a deeper hierarchy (sub-modules) does not fit a table. Individual tiles have little room for detail at overview.

## Ideas worth keeping whichever shape wins

- **Lenses change the symbols, not just the colours** (A's sheets, B's gravity, C's facet expansion, D's ink ramp).
- **One signal colour reserved for "needs attention"**, separate from the status colours.
- **An AI-trust overlay plus a way to step through it** (C's review queue, A's keynotes).
- **Dependency links drawn on demand**, routed so they don't cross labels.
- **The same inspector content** in every variant: a breadcrumb, lifecycle, release, owner, builder and review, the 12 facets, metrics, and dependencies in both directions.

## Open questions for round 2

1. Which variant (or combination) should be the baseline, and which ideas from the others should it take?
2. Who opens the blueprint first, and what decision do they make there: a product or exec health check, an engineering or ops lead hunting problems, or a reviewer verifying AI work? Should each role get its own home view?
3. Should feature positions stay fixed, so the map can be learned like a building plan? Or may the layout re-sort by lens, status or release?
4. What unit needs human sign-off: a feature, each agent change (PR or run), or individual facets? Do approvals go stale when agents change the code again? Should approving and requesting changes happen inside the blueprint later?
5. Are Dev, Ops and Business with these 12 facets the right breakdown? Are lenses missing, such as Security, Compliance, UX, Data or Cost? Should facets be configurable per product?
6. Is a time axis needed: release phasing, "changed since my last visit", agent activity or completion trends?
7. Is a canvas one product or a portfolio of apps, and how large do real products get? Is a deeper hierarchy (sub-modules or sub-features) needed?
8. Should features have permanent short handles (F-059, "Mt", AUTH-07) that people and agents use in conversation?
9. Which theme should be the default: dark or light? Should the metaphor stay literal, or move into the structure under neutral tool styling?
10. In later phases, where should the status truth come from: agents' own reports, repo, CI and observability analysis, an issue tracker, or manual input? Should each facet show its evidence (for example "tests: done · 84% coverage · CI green")?

## Process notes

- Each variant went through three passes: a build with self-review over 3+ screenshot passes, a fresh-eyes design polish across 5 viewport sizes, and functional QA covering 12 checks on both the source page and the bundle as published.
- All checks pass, with no console errors and no sideways scrolling. The shared data passes `npm run validate`.
- Pinch-to-zoom is implemented in every variant but was only exercised with synthetic touch events, not on a real touch device.
