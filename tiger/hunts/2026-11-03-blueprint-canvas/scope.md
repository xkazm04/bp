# Scope - 2026-11-03 blueprint canvas

**Thesis.** The plan already shows where every feature stands *now*. Make it answer what's wrong, since when,
and what will clear it, for any reader (by ear or by keyboard), on any past date and for any part of any
product, using only the lens manifests and readings bp already has.

## Core

- **C1 Fresh trouble index** (P09, P05). One engine-owned index of troubled features per lens, rebuilt when
  `sim.healthV` moves. It replaces the `flags.ts` WeakMap and the Overview count memo. Fixes: a feature that turns
  bad after load gets no flag or count until reload.
  *Verify:* a node check feeds a scan that turns X bad. `layoutFlags` then includes X and the Overview count
  rises by 1. Before the fix, neither happens.
- **C2 Spoken walk and trouble route** (P09, P02, P05; needs C1). A polite live region speaks the place's lens
  sentence on room walks and arrivals, after the camera rests. N / Shift+N step through the current lens's bad and
  watch features in walk order, frozen while reading, and new members show as "N new". Esc after a page keeps
  the position.
  *Verify:* `check:place-words` for General, a built-in lens and `com.kettle.cost`. In a browser, ArrowRight ×2
  changes the region twice, and N visits every troubled feature once. A re-judge should move
  canvas-graph/canvas-accessibility off deviation.
- **C3 Replay lens health on past dates** (P01, P11 guard). A pure `healthAsOf` re-runs today's rules over the
  readings in force on t, only for pairs whose rule inputs are all recorded, and from fresh inputs (never
  current overrides). Each value is labelled "replayed by today's rules from N readings". Flags and trouble
  marks draw on past dates; the fill stays the stage.
  *Verify:* `check:timeview` cases: 120@10-01 and 60@10-20 against "gt 100 → bad" give bad at 10-10 and good at
  10-25. A lens reading a non-metric field stays "Not recorded".

## Supporting

- **S1 "What clears it" knows its proposals** (P03, read side only). Each step shows whether a proposal
  targets it and whether now + expected delta clears it, falls short by X, or was delivered (`after_value`).
  *Verify:* `check:clear-cover` fixture: clears / short by 10 / delivered / uncovered.
- **S2 Compare two dates on the drawing** (P06; best after C3). Pin baseline A and endpoint B. Places show
  counts of what changed, the page shows both values with their dates, and first observations are never
  treated as starting from zero.
  *Verify:* a 3-feature fixture marks exactly 2. Geometry and camera stay unchanged, and the URL restores the
  comparison.

## Leap

- **L1 Readiness for whatever is selected** (P10, P04, P08, P12; uses S1 for coverage). G works on a
  selection, room, wing, milestone or the whole product, not only `payments-ga`. The callout reads
  "9 clear · 2 unproven (old readings) · 11 steps, 4 covered, 1 short · 1 blocked". Cross-lens conflicts are
  stated, and nothing recolours a node.
  *Verify:* `check:readiness` 5-feature fixture. On bp's live map (no milestones), G over a room opens the
  mode. perf.py at ?scale=4 keeps gesture p50 ≤ 16.7 ms.

## Left out

- P08 / P12: authored acceptance sheets, kept as browser UI metadata. L1 gets most of the value from the
  manifests alone.
- P07: changed files mapped to product impact. A different job, and mapping coverage is unproven (backlog).
- P11's criteria pinning: comparing the old rule against the new one is a hypothesis and costs a lot.
- P03's "Propose a fix" button: it needs `/lens-scan` to accept a feature scope and a target (a skill
  change).
