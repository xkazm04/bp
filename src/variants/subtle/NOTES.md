# Variant 1 · subtle: patterns

**Idea.** A lens is a *line type*, as on a drawing set. Rectangles and stage fills never change; each
lens owns one small ink glyph and one line type. Amber and red appear only as status: a glyph takes
its lens's health colour.

**General is the composition.** Along each fixture's top edge, six slots in fixed order (business,
design, development, operations, security, quality), each a glyph plus a short rail in its line type.
A lens lifts the other five off (fade, shrink, rise); its glyph slides to the head of the strip and
its rail runs the full width as the evidence line. Large fixtures also show the glyph as a faint watermark. On ribbons (L0/L1) General stays calm;
a lens draws its rail along each segment's foot and its glyph where that lens is unwell.

| lens | glyph | line | measures | reader |
|---|---|---|---|---|
| business | bars | double rule | value | simple, one fact |
| design | set square | dotted | sketch → polished | simple |
| development | `</>` | comb | progress; PR dots | dense, three facts |
| operations | pulse | chain | rollout; incidents, no alerting | dense |
| security | padlock | hatched band | data sensitivity; review seal | standard |
| quality | check | dimension | E2E passing; bug dots | standard |

Aggregates are plain sentences; the legend keys the six glyphs and the rail.

**Performance.** Rails are `fillRect`s plus three cached theme patterns; glyphs are one or two paths;
rects are reused; nothing is measured. `?scale=4` 1920x1080: zoom+drag p50 16.7 / p95 16.8 ms; lens
switch p50 16.7 ms (p95 33.4 at L0).

**Limits.** At `?scale=4` L0 only the 2–3 px rails and the aggregates change. Glyphs are 7–10 px.
Time travel shows glyphs only.
