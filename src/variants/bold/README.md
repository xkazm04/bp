# Variant 3 · bold: decoration and content

Brief: `docs/blueprint-ui.md`, section "The three variants", item 3. Lens-specific decoration through
`channels[lens].decor` (dimension lines, grids, title-block ornaments, stamps, hatch families),
lens-specific sheet panels and density through `ui.SheetPanel` / `ui.density` (an artboard-simple
design lens, a mono, terminal-dense development lens) and richer tile content, still blue and white
first and readable (A/2 is the warning). The expression lives in `channels.ts` (marks, shapes, words), `decor.ts` (paper, rails, title blocks)
and `panels.tsx` (sheet panels); see `NOTES.md`. `shots.py` and `perf.py` here drive port 3113.
