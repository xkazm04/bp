# Run note: the visual pass (night builder, wave 4, 2026-11-09)

The owner: "The visual quality and design improvement is something we should chase too, as now web app improved so should
our blueprint desk." The pass moves the desk's reading surfaces onto the web's drawing-set language (the ledger's
`backlog.css` and `ledger.css`: double-rule walls, lettered section bubbles, rounded-square marker pins, drawn meters,
square corners) and makes what a person looks at most cheaper where it could.

Captures: [`w4-before-target.jpg`](../captures/w4-before-target.jpg), [`w4-target.jpg`](../captures/w4-target.jpg),
[`w4-scan-running.jpg`](../captures/w4-scan-running.jpg), [`w4-wrist.jpg`](../captures/w4-wrist.jpg),
[`w4-deck.jpg`](../captures/w4-deck.jpg). All from PIE on the bundled snapshot, `BpView.Pose target|wrist|deck`, 1600 x 900.
No headset was available.

## What changed

| Surface | Before | After |
|---|---|---|
| A scan on the rooms | translucent lit wall boxes in the lens accent (a neon wall at site level) | opaque unlit double rules drawn on the paper, a meter of one cell per feature, a tick; each room keeps its own lens accent |
| Wrist panel | blue translucent glass, rounded, glow rings, forearm showing through | an opaque sheet (`SSheet`: grid, double-rule wall), square rows, tabs with the ledger's accent foot bar, a lettered bubble on the section line, focus rows with the lens's amber marker pin (manifest `short`: DES, SEC) |
| Screen deck | near-black rounded glass; warm-grey paper for feature sheets | every screen on the blueprint sheet, square controls, lettered sections (A METRIC, B SUMMARY), the risk chip in the ledger's mark and band colour (`▲ 10 RISK`, red) |
| Finding tags | "KF-034 / RISK 10" | the ledger's marks: `▲ 10`, band colour, drawn on the tag's canvas (Barlow has no such glyphs) |
| Pin beads | glowing spheres with translucent halos | flat amber squares on the paper (the plan's marker); halos off by default (`bp.PinHalos`) |
| Wing labels | "WING A" line over the name | a lettered circle beside the name, as the web's sections |

Files: `apps/vr/Source/bp/BpSheet.h` (new), `BpWrist.cpp`, `BpDeck.cpp`, `BpMarks.cpp`, `BpScanMarks.cpp`, `BpTable.cpp`,
`BpTable.h`, `BpPawn.h`, and `BpLink` (the lens's short code). No uasset was generated; no raster asset was needed.

## Scorecard against the target (the L3.4 method)

Scores are this builder's reading, 0 to 3, of each `art-breakdown.md` element, from the target pose:
0 absent, 1 present but reads wrong, 2 reads as the concept's element, 3 matches it.

| # | Element | Before | After | Reason |
|---|---|---|---|---|
| 1 | Lit table, white edge | 2 | 2 | Unchanged; the near rim band is still thicker than the concept's |
| 2 | Paper, grid, compass, scale, title | 2 | 2 | Unchanged |
| 3 | Wing labels | 2 | 2 | Lettered bubbles read closer to the web; the concept's "WING 08" is a different vocabulary |
| 4 | Room volumes | 2 | 2 | Unchanged |
| 5 | Furniture | 2 | 2 | Unchanged |
| 6 | Lifted room | 2 | 2 | Unchanged |
| 7 | Amber pins, tags | 2 | 2 | The tags now carry the ledger's risk marks; the beads are flat markers, so less like the concept's glowing heads, more like the plan |
| 8 | Scan line | **1** | **2** | The sweep reads as the concept's line now the neon walls are gone: the rooms it passes are drawn, not lit |
| 9 | Lamp agent | 2 | 2 | Unchanged |
| 10 | Decision card | 2 | 2 | Unchanged (the deck is a separate surface) |
| 11 | Wrist panel | 2 | 2 | Moved toward the web's sheet, away from the concept's glass; legibility up, score unchanged |
| 12 | Real hands | 2 | 2 | Unchanged |
| 13 | Dark studio | 2 | 2 | Unchanged |
| 14 | Night city | 2 | 2 | Unchanged |
| 15 | Haze, bloom | 2 | 2 | Unchanged |
| | **Total** | **29 / 45** | **30 / 45** | |

No element scores 0. The 29 and 30 are read against the concept image; they do not measure what this pass was for, which
was the web's sheet language. That is read here on its own scale:

| Surface | Web sheet language, before | After |
|---|---|---|
| Wrist panel | 1: rounded translucent glass | 3: sheet, double rule, lettered section, marker pins, square tabs |
| Screen deck | 1: rounded dark glass, grey paper | 3: the web's sheet on every screen, sections lettered, risk in the ledger's mark |
| Scan marks | 0: a neon wall the web has no equivalent of | 3: a double-rule wall and drawn meter |
| Tags and pins | 1: "RISK 10" and glowing beads | 2: the marks and square markers are the web's; the tags stay warm paper (the concept) |
| Wing labels | 1 | 2: lettered, but no counts (removed in FC3: no room at the floor) |

## Cost

CSV profiler, `--bundle --xr-sim --vr`, target pose, p50 of the last 100 frames, stereo:

| Run | Draws | Primitives |
|---|---|---|
| Idle, `bp.PinHalos 0` (default) | 219 | 547,426 |
| Idle, `bp.PinHalos 1` | 221 | 547,450 |
| Sample scan running, `bp.ScanMarks 1` | 225 | 547,522 |
| Sample scan running, `bp.ScanMarks 0` | 221 | 547,454 |

So a scan's marks cost +4 draws and +68 primitives (one more material bucket, opaque and unlit), while the translucent
wall boxes they replace no longer overdraw the rooms. The halos cost -2 draws and -24 primitives off by default. The wrist
panel and the deck screens draw in the same number of quads as before; the wrist's quad is now opaque. No new translucent
surface, no texture, no new material. The bundle regression lines print `Kettle wings=5` in flat and in the Simulator.

Text: the wrist and deck's type sizes were not changed. `BpView.TextCard` reads five wrist classes under the 22' floor
(room counts, project state, focus lens and scan band at 19', the sub-line at 21'); their sizes were not touched by this
pass and it was not measured before it; raising them needs a layout change (next item below). The bubble
letters are decorative; the sheets read at the deck's 57' title and 34' chips.

## The next visual items, in order

1. The wrist's five under-floor classes (counts, state, focus lens, scan band, sub-line 19-21'): widen the panel or shrink the voice row
   to raise the type to 22'.
2. The near rim band at the target pose, still thicker than the concept's strip.
3. The bright cyan scan sweep: the line is the concept's, but its glow band is wider than the concept's line.
4. Finding tags on the web's dark sheet (dark tag, amber pin) if the owner prefers web over concept; the tags were kept as the
   concept's warm paper.
5. The table's decision card still uses rounded glass and "RISK 10"; it should adopt the same sheet and marks.

Unverified without the device: the wrist's opaque sheet against the forearm on the Quest (`bp.WristTint`), the scan rules'
visibility at the headset's resolution (`bp.ScanMarkGlow`), and the deck's brightness (`bp.DeckTint`).
