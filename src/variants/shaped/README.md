# Variant 2 · shaped: reshape and icons

Each lens reshapes the tile outline, brings its own icon vocabulary, words and one accent for its marks;
General composes the six lens icons into each fixture's top edge. See NOTES.md for the design, and:

- `index.ts` the Variant (expression + UI overrides), `channels.ts` the six channels (marks, content,
  aggregates, accents), `shapes.ts` outlines and edge marks, `icons.ts` the shared icon paths (SVG + Path2D)
- `Panel.tsx` sheet panel, `Legend.tsx` plan legend, `styles.css` scoped styles
- `shots.py` screenshot matrix, `perf_lens.py` lens-switch frame times (server: `$BP_BASE`, else `npm run dev` on :3000;
  `../shotkit.py`)
