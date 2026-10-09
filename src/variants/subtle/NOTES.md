# Variant 1 · subtle: patterns

**Idea.** A lens is a *line type*, as on a drawing set. Rectangles and stage fills never change; each
lens owns one small ink glyph and one line type. Amber and red appear only as status: a glyph takes
its lens's health colour.

**General is the composition.** Along each fixture's top edge, one slot per enabled lens in registry
order (the map's `lenses[]`), each a glyph plus a short rail in its line type. A lens lifts the others
off (fade, shrink, rise); its glyph slides to the head of the strip and its rail runs the full width as
the evidence line. Large fixtures also show the glyph as a faint watermark. On ribbons (L0/L1) General
stays calm; a lens draws its rail along each segment's foot and its glyph where that lens is unwell.

**Manifest-driven (app-structure v3).** Nothing here knows a lens id. Glyph = `presentation.glyph`
(the shared set, or a custom `{path}` drawn with `Path2D`), line = `presentation.line` (`solid` added),
rail length = `presentation.measures` (number over `max`, percent over 100, enum by position), evidence
text = `presentation.evidence` by type, cut by `reader.density` (2/3/4), stamp = the matched rule's
reason or the override's why, end dots = the first plain-count evidence field (dense and standard
readers), red/amber when the deciding rule names it. With more than six lenses the slots shrink to
share the strip (see the N-slot rule in `expression.ts` and `docs/blueprint-ui.md`).

| lens (built-in manifests) | glyph | line | measures | reader |
|---|---|---|---|---|
| business | bars | double rule | value / 5 | standard; dots = customer requests |
| design | set-square | dotted | design status, none → polished | simple |
| development | brackets | comb | progress; dots = open PRs | dense |
| operations | pulse | chain | rollout; dots = incidents | dense |
| security | padlock | hatched band | data class, public → payment; dots = findings | standard |
| quality | check | dimension | E2E pass rate; dots = P1 bugs | standard |
| com.kettle.cost (custom) | its own path (a coin stack) | solid | monthly cost / 5000 | standard |

Aggregates: the manifest's rollup verdict, bad and watch counts, a headline summary. The legend keys
the registry's glyphs and rails.

**Performance.** Rails are `fillRect`s plus three cached theme patterns; glyphs are one or two paths;
rects are reused; nothing is measured. `?scale=4` 1920x1080: zoom+drag p50 16.7 / p95 16.8 ms; lens
switch p50 16.7 ms (p95 33.4 at L0).

**Limits.** At `?scale=4` L0 only the 2–3 px rails and the aggregates change. Glyphs are 7–10 px.
Time travel shows glyphs only.
