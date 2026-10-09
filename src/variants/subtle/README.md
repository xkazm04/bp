# Variant 1 · subtle: patterns

Brief: `docs/blueprint-ui.md`, section "The three variants", item 1. Every tile keeps its rectangle;
lenses differ by line patterns, hairline marks and small icon sets in fixed slots. In General six tiny
indicators sit in a strip, and a lens enlarges its own indicator into the tile's evidence line. Ink
colours only (drop the base accents). Right now `index.ts` re-exports `base` under this id; edit only
this folder, following the seam described in `src/variants/README.md`.
